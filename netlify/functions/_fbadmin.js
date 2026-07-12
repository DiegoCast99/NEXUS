/* ============================================================
   NEXUS · Firebase Admin vía REST — SIN dependencias npm.
   ------------------------------------------------------------
   El webhook de Mercado Libre llega SIN sesión de usuario, así que
   no puede usar el ID token del navegador. Para leer/escribir
   Firestore por su cuenta usa una CUENTA DE SERVICIO de Firebase:

   1. Firma un JWT RS256 con la private key de la cuenta de servicio.
   2. Lo canjea por un access_token OAuth2 (scope datastore).
   3. Llama a la API REST de Firestore como admin (saltea las reglas).

   Env vars necesarias:
   - FIREBASE_SA_EMAIL   → client_email de la cuenta de servicio
   - FIREBASE_SA_KEY     → private_key (PEM; los \n pueden venir escapados)
   - FIREBASE_PROJECT_ID → opcional (default nexus-systems-17a5b)
   ============================================================ */
const crypto = require("crypto");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "nexus-systems-17a5b";
const FS_BASE =
  "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents";

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cachedToken = null;
let cachedExp = 0;

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedExp - 60) return cachedToken;

  const email = process.env.FIREBASE_SA_EMAIL;
  let key = process.env.FIREBASE_SA_KEY;
  if (!email || !key) throw new Error("Faltan FIREBASE_SA_EMAIL / FIREBASE_SA_KEY.");
  key = key.replace(/\\n/g, "\n"); // Netlify suele escapar los saltos de línea.

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const signingInput = header + "." + claim;
  const sig = b64url(crypto.sign("RSA-SHA256", Buffer.from(signingInput), key));
  const assertion = signingInput + "." + sig;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }).toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error("No se pudo obtener token de cuenta de servicio: " + (data.error_description || data.error || res.status));
  }
  cachedToken = data.access_token;
  cachedExp = now + (data.expires_in || 3600);
  return cachedToken;
}

// --- Helpers de Firestore (admin) ---------------------------
async function adminGetDoc(path) {
  const token = await getAccessToken();
  const res = await fetch(FS_BASE + "/" + path, { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Firestore admin GET falló (" + res.status + ").");
  return res.json();
}

async function adminPatchDoc(path, fields, maskPaths) {
  const token = await getAccessToken();
  const mask = (maskPaths || Object.keys(fields)).map((f) => "updateMask.fieldPaths=" + encodeURIComponent(f)).join("&");
  const res = await fetch(FS_BASE + "/" + path + "?" + mask, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) throw new Error("Firestore admin PATCH falló (" + res.status + ").");
  return res.json();
}

// Busca en la colección `users` el doc cuyo campo `field` == `value` (stringValue).
// Devuelve { uid, doc } o null.
async function adminQueryUsersByField(field, value) {
  const token = await getAccessToken();
  const res = await fetch(FS_BASE + ":runQuery", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "users" }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: "EQUAL",
            value: { stringValue: String(value) }
          }
        },
        limit: 1
      }
    })
  });
  if (!res.ok) throw new Error("Firestore admin runQuery falló (" + res.status + ").");
  const rows = await res.json();
  const hit = Array.isArray(rows) ? rows.find((r) => r.document) : null;
  if (!hit) return null;
  const name = hit.document.name; // .../documents/users/{uid}
  const uid = name.slice(name.lastIndexOf("/") + 1);
  return { uid, doc: hit.document };
}

module.exports = { PROJECT_ID, getAccessToken, adminGetDoc, adminPatchDoc, adminQueryUsersByField, b64url };
