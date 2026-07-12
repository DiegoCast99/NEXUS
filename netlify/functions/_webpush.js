/* ============================================================
   NEXUS · Web Push (VAPID + aes128gcm) — SIN dependencias npm.
   ------------------------------------------------------------
   Implementa el envío de notificaciones Web Push usando solo el
   módulo `crypto` de Node:
   - VAPID (RFC 8292): firma un JWT ES256 para autenticar ante el
     servicio de push (Apple / FCM / Mozilla).
   - Cifrado de payload (RFC 8291 + RFC 8188, content-encoding
     aes128gcm): ECDH P-256 + HKDF-SHA256 + AES-128-GCM.

   La clave pública VAPID va hardcodeada (es pública); la privada
   se lee de la env var VAPID_PRIVATE (solo el escalar `d` en base64url).
   ============================================================ */
const crypto = require("crypto");

// Clave pública VAPID (applicationServerKey): punto sin comprimir en base64url.
// El navegador la usa al suscribirse; acá la usamos en el header `k=` de VAPID.
const VAPID_PUBLIC = "BLohTYozFQLoQcY2Qe63hTPZBNiMZMwyI11o4OQ2gfEuZzHMFCP9AssIsluHLRBx1EMGWh5-e2lBobW7688t-m4";
const VAPID_SUBJECT = "mailto:diegocast99@gmail.com";

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBuf(str) {
  return Buffer.from(String(str).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}
// HKDF-Expand para longitudes <= 32 (T(1) = HMAC(prk, info || 0x01)).
function hkdfExpand(prk, info, length) {
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).slice(0, length);
}

// --- VAPID: clave de firma y JWT ES256 -----------------------
function vapidSigningKey() {
  const d = process.env.VAPID_PRIVATE;
  if (!d) throw new Error("Falta la env var VAPID_PRIVATE.");
  const pub = b64urlToBuf(VAPID_PUBLIC); // [0x04, X(32), Y(32)]
  const x = b64url(pub.slice(1, 33));
  const y = b64url(pub.slice(33, 65));
  return crypto.createPrivateKey({
    key: { kty: "EC", crv: "P-256", x, y, d },
    format: "jwk"
  });
}

function buildVapidJwt(audienceOrigin) {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    aud: audienceOrigin,
    exp: now + 12 * 60 * 60,
    sub: VAPID_SUBJECT
  }));
  const signingInput = header + "." + payload;
  // dsaEncoding ieee-p1363 => firma cruda r||s (64 bytes), lo que exige JWS ES256.
  const sig = crypto.sign("sha256", Buffer.from(signingInput), {
    key: vapidSigningKey(),
    dsaEncoding: "ieee-p1363"
  });
  return signingInput + "." + b64url(sig);
}

// --- Cifrado del payload (aes128gcm, RFC 8291) ---------------
function encryptPayload(plaintext, uaPublicB64, authB64) {
  const uaPublic = b64urlToBuf(uaPublicB64); // 65 bytes (clave pública del navegador)
  const authSecret = b64urlToBuf(authB64);   // 16 bytes
  const salt = crypto.randomBytes(16);

  // Par efímero del servidor (uno por mensaje).
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();          // 65 bytes
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  // Paso 1: combinar auth_secret + ecdh_secret (RFC 8291 §3.4).
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hkdfExpand(prkKey, keyInfo, 32);

  // Paso 2: derivar CEK y NONCE (content-encoding aes128gcm, RFC 8188).
  const prk = hmac(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdfExpand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);

  // Un solo record: plaintext + delimitador 0x02.
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const padded = Buffer.concat([plaintext, Buffer.from([2])]);
  const enc = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  // Header aes128gcm: salt(16) || record_size(4) || idlen(1) || keyid(asPublic).
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  const header = Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic]);
  return Buffer.concat([header, enc]);
}

// --- Envío --------------------------------------------------
// Devuelve { statusCode, gone } — gone=true si la suscripción caducó (404/410).
async function sendPush(subscription, payloadObj) {
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    throw new Error("Suscripción push inválida.");
  }
  const body = encryptPayload(
    Buffer.from(JSON.stringify(payloadObj), "utf8"),
    subscription.keys.p256dh,
    subscription.keys.auth
  );
  const origin = new URL(subscription.endpoint).origin;
  const jwt = buildVapidJwt(origin);

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": "2419200",
      "Authorization": "vapid t=" + jwt + ", k=" + VAPID_PUBLIC
    },
    body
  });
  return { statusCode: res.status, gone: res.status === 404 || res.status === 410 };
}

module.exports = { VAPID_PUBLIC, sendPush, encryptPayload, buildVapidJwt, b64url, b64urlToBuf };
