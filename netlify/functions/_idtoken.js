/* ============================================================
   NEXUS · Verificación de Firebase ID Token (zero-dep, server-side)
   ------------------------------------------------------------
   Verifica DE VERDAD (firma RS256 + claims) un ID token de Firebase Auth emitido
   al navegador del admin. Sirve para autenticar acciones del dashboard contra una
   función (ej. "enviar correo de prueba") SIN exponer secretos en el front: el
   navegador manda su ID token, acá se valida la firma contra los certificados
   públicos de Google y se comprueba aud/iss/exp + el uid.

   Ojo: esto SÍ verifica la firma (a diferencia del atajo viejo que solo decodificaba
   el payload). Usa node:crypto (RSA-SHA256) contra los x509 de securetoken.
   ============================================================ */
const crypto = require("crypto");

const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let _certs = null, _certsExp = 0;

async function getGoogleCerts() {
  const now = Date.now();
  if (_certs && now < _certsExp) return _certs;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error("no se pudieron traer los certs de Google (" + res.status + ")");
  const cc = res.headers.get("cache-control") || "";
  const m = /max-age=(\d+)/.exec(cc);
  _certsExp = now + (m ? parseInt(m[1], 10) : 3600) * 1000;
  _certs = await res.json();  // { "<kid>": "-----BEGIN CERTIFICATE-----\n..." }
  return _certs;
}

function b64urlToBuf(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}
function b64urlToJson(s) { return JSON.parse(b64urlToBuf(s).toString("utf8")); }

// Devuelve el payload {sub(uid), email, ...} si el token es válido; lanza si no.
async function verifyFirebaseIdToken(idToken, projectId) {
  if (!idToken || typeof idToken !== "string") throw new Error("token vacío");
  if (!projectId) throw new Error("projectId requerido");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("formato de token inválido");

  let header, payload;
  try { header = b64urlToJson(parts[0]); payload = b64urlToJson(parts[1]); }
  catch (e) { throw new Error("token no decodificable"); }

  if (header.alg !== "RS256") throw new Error("alg inválido (esperado RS256)");
  if (!header.kid) throw new Error("sin kid");

  const certs = await getGoogleCerts();
  const pem = certs[header.kid];
  if (!pem) throw new Error("kid desconocido (cert rotado)");

  const pub = crypto.createPublicKey(pem);
  const okSig = crypto.verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), pub, b64urlToBuf(parts[2]));
  if (!okSig) throw new Error("firma inválida");

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error("token expirado");
  if (payload.iat && payload.iat > now + 300) throw new Error("iat en el futuro");
  if (payload.aud !== projectId) throw new Error("aud inválido");
  if (payload.iss !== "https://securetoken.google.com/" + projectId) throw new Error("iss inválido");
  if (!payload.sub) throw new Error("sub (uid) vacío");
  return payload;
}

module.exports = { verifyFirebaseIdToken, getGoogleCerts, b64urlToJson };
