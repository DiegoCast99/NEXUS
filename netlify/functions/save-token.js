/* ============================================================
   NEXUS · POST /.netlify/functions/save-token
   ------------------------------------------------------------
   Recibe un token de proveedor (Meta / e-commerce), lo CIFRA y lo
   guarda en Firestore bajo users/{uid}. El token nunca queda en el
   navegador ni en texto plano en Firestore.

   Body:   { "provider": "meta" | "commerce:kairos" | ..., "token": "..." }
   Header: Authorization: Bearer <Firebase ID token>
   ============================================================ */
const {
  encrypt,
  writeUserField,
  uidFromIdToken,
  getIdToken,
  providerField,
  parseBody,
  json
} = require("./_shared");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  try {
    const idToken = getIdToken(event);
    const uid = uidFromIdToken(idToken);
    const { provider, token } = parseBody(event);

    if (!token || typeof token !== "string" || token.trim().length < 4) {
      return json(400, { error: "Falta el token o es demasiado corto." });
    }
    const field = providerField(provider);

    await writeUserField(uid, idToken, field, encrypt(token.trim()));
    return json(200, { ok: true });
  } catch (error) {
    return json(400, { error: error.message || "No se pudo guardar el token." });
  }
};
