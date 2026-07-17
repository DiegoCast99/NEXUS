/* ============================================================
   NEXUS · Funciones serverless — librería compartida
   ------------------------------------------------------------
   SOLO módulos nativos de Node (crypto) + fetch global (Node 18+).
   NADA de dependencias npm → deployable por drag-and-drop.

   Responsabilidades:
   - Cifrado/descifrado de tokens (AES-256-GCM con TOKEN_ENC_KEY).
   - Lectura/escritura de un campo en Firestore vía REST, usando el
     ID token de Firebase del usuario (Firestore aplica las reglas:
     cada usuario solo toca users/{suUid}).
   - Helpers de request/response para Netlify Functions.
   ============================================================ */
const crypto = require("crypto");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "nexus-systems-17a5b";
const FS_BASE =
  "https://firestore.googleapis.com/v1/projects/" +
  PROJECT_ID +
  "/databases/(default)/documents";

// --- Cifrado -------------------------------------------------
// La clave de 32 bytes se deriva por SHA-256 de TOKEN_ENC_KEY, así el
// titular puede poner cualquier passphrase fuerte como variable de entorno.
function keyBuffer() {
  const pass = process.env.TOKEN_ENC_KEY;
  if (!pass) throw new Error("Falta la variable de entorno TOKEN_ENC_KEY.");
  return crypto.createHash("sha256").update(String(pass)).digest();
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

function decrypt(blob) {
  const parts = String(blob).split(".");
  if (parts.length !== 3) throw new Error("Token cifrado con formato inválido.");
  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const ct = Buffer.from(parts[2], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// --- Identidad ----------------------------------------------
// Extrae el uid del ID token SIN verificar la firma: la verificación real
// la hace Firestore (rechaza si request.auth.uid != uid). Así el path
// users/{uid} siempre corresponde al dueño del token.
function uidFromIdToken(idToken) {
  const parts = String(idToken).split(".");
  if (parts.length !== 3) throw new Error("ID token con formato inválido.");
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  let payload;
  try {
    payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch (e) {
    throw new Error("No se pudo leer el ID token.");
  }
  const uid = payload.user_id || payload.sub;
  if (!uid) throw new Error("El ID token no contiene un uid.");
  return uid;
}

function getIdToken(event) {
  const headers = event.headers || {};
  const raw = headers.authorization || headers.Authorization || "";
  const m = String(raw).match(/^Bearer\s+(.+)$/i);
  if (!m) throw new Error("Falta la cabecera Authorization: Bearer <idToken>.");
  return m[1].trim();
}

// --- Cuentas de Mercado Libre --------------------------------
// Cada cuenta guarda sus tokens en su propio campo (secret_mercadolibre,
// secret_mercadolibre2). La primera es la historica: su nombre NO cambia,
// asi los tokens ya guardados y el webhook siguen funcionando.
const ML_ACCOUNTS = ["mercadolibre", "mercadolibre2", "mercadolivre"];

// Nombre visible de cada cuenta. Tiene que coincidir con el selector del panel
// (ML_ACCOUNTS en js/dashboard/store.js): es lo que el titular ve en la
// notificacion de la venta, asi sabe de que cuenta fue.
const ML_ACCOUNT_NAMES = {
  mercadolibre: "Mercado Libre 1",
  mercadolibre2: "Mercado Libre 2",
  mercadolivre: "Mercado Livre"
};

function mlAccountName(account) {
  return ML_ACCOUNT_NAMES[account] || "Mercado Libre";
}

// Devuelve la cuenta pedida solo si esta en la lista (evita que un cliente
// manipulado lea un campo arbitrario de Firestore).
function mlAccount(raw) {
  const id = String(raw || "mercadolibre");
  if (ML_ACCOUNTS.indexOf(id) === -1) throw new Error("Cuenta de ML invalida.");
  return id;
}

// Campo del seller id consultable por el webhook, por cuenta.
// El de la primera cuenta es historico: renombrarlo romperia sus notificaciones.
const ML_SELLER_FIELDS = {
  mercadolibre: "ml_seller_id",
  mercadolibre2: "ml_seller_id_2",
  mercadolivre: "ml_seller_id_3"
};

function mlSellerField(account) {
  return ML_SELLER_FIELDS[mlAccount(account)];
}

// Convierte un nombre de proveedor en un nombre de campo Firestore seguro.
// "meta" -> secret_meta ; "commerce:kairos" -> secret_commerce_kairos
function providerField(provider) {
  const slug = String(provider || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug || slug.length > 40) throw new Error("provider inválido.");
  return "secret_" + slug;
}

// --- Firestore REST -----------------------------------------
async function readUserField(uid, idToken, field) {
  const url = FS_BASE + "/users/" + encodeURIComponent(uid) + "?mask.fieldPaths=" + field;
  const res = await fetch(url, { headers: { Authorization: "Bearer " + idToken } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Firestore rechazó la lectura (" + res.status + ").");
  const doc = await res.json();
  const f = doc.fields && doc.fields[field];
  return f ? f.stringValue || null : null;
}

async function writeUserField(uid, idToken, field, stringValue) {
  const url =
    FS_BASE + "/users/" + encodeURIComponent(uid) + "?updateMask.fieldPaths=" + field;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer " + idToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields: { [field]: { stringValue: String(stringValue) } } })
  });
  if (!res.ok) throw new Error("Firestore rechazó la escritura (" + res.status + ").");
  return true;
}

// --- SSRF guard (para URLs de e-commerce que da el usuario) ---
function assertSafeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch (e) {
    throw new Error("apiUrl inválida.");
  }
  if (u.protocol !== "https:") throw new Error("apiUrl debe ser https.");
  const host = u.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new Error("apiUrl apunta a un host interno no permitido.");
  return u.toString();
}

// --- Request/response helpers -------------------------------
function parseBody(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error("El cuerpo del request no es JSON válido.");
  }
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(obj)
  };
}

module.exports = {
  ML_ACCOUNTS,
  mlAccount,
  mlAccountName,
  mlSellerField,
  encrypt,
  decrypt,
  uidFromIdToken,
  getIdToken,
  providerField,
  readUserField,
  writeUserField,
  assertSafeUrl,
  parseBody,
  json
};
