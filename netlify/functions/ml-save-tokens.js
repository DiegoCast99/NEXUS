/* ============================================================
   NEXUS · POST /.netlify/functions/ml-save-tokens
   ------------------------------------------------------------
   Recibe el bundle cifrado de tokens de ML (generado por
   ml-oauth-callback) y lo almacena en Firestore bajo el uid
   del usuario autenticado.

   Body:   { "encBundle": "<blob cifrado>" }
   Header: Authorization: Bearer <Firebase ID token>

   El blob ya viene cifrado con TOKEN_ENC_KEY por el callback;
   esta funcion solo valida que sea descifrable (previene basura)
   y lo guarda tal cual.
   ============================================================ */
const {
  decrypt,
  writeUserField,
  uidFromIdToken,
  getIdToken,
  parseBody,
  json,
  mlAccount,
  mlSellerField
} = require("./_shared");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Solo POST." });
  try {
    const idToken = getIdToken(event);
    const uid = uidFromIdToken(idToken);
    const { encBundle, account } = parseBody(event);
    const mlId = mlAccount(account);

    if (!encBundle || typeof encBundle !== "string") {
      return json(400, { error: "Falta encBundle." });
    }

    let parsed;
    try {
      parsed = JSON.parse(decrypt(encBundle));
    } catch (e) {
      return json(400, { error: "Bundle de tokens invalido o corrupto." });
    }
    if (!parsed.access_token || !parsed.refresh_token) {
      return json(400, { error: "El bundle no contiene los tokens esperados." });
    }

    await writeUserField(uid, idToken, "secret_" + mlId, encBundle);

    if (parsed.user_id) {
      await writeUserField(uid, idToken, mlSellerField(mlId), String(parsed.user_id));
    }

    return json(200, { ok: true, userId: parsed.user_id || null });
  } catch (error) {
    return json(400, { error: error.message || "No se pudieron guardar los tokens de ML." });
  }
};
