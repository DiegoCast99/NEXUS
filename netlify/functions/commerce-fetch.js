/* ============================================================
   NEXUS · POST /.netlify/functions/commerce-fetch
   ------------------------------------------------------------
   Lee y descifra el token de una tienda (Kairos/Billion/KiwiFi) desde
   Firestore y llama al endpoint del negocio DESDE EL SERVIDOR. Devuelve
   el payload crudo (el cliente normaliza). El apiToken nunca viaja por
   el navegador. La apiUrl pasa por un guard anti-SSRF.

   Body:   { "provider": "commerce:kairos", "apiUrl": "https://...", "pixelId": "..." }
   Header: Authorization: Bearer <Firebase ID token>
   ============================================================ */
const {
  decrypt,
  readUserField,
  uidFromIdToken,
  getIdToken,
  providerField,
  assertSafeUrl,
  parseBody,
  json
} = require("./_shared");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  try {
    const idToken = getIdToken(event);
    const uid = uidFromIdToken(idToken);
    const { provider, apiUrl, pixelId } = parseBody(event);

    const safeUrl = assertSafeUrl(apiUrl);
    const field = providerField(provider || "commerce");

    const enc = await readUserField(uid, idToken, field);
    if (!enc) {
      return json(400, { error: "No hay token de e-commerce guardado para este negocio." });
    }
    const apiToken = decrypt(enc);

    const res = await fetch(safeUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + apiToken,
        "X-Nexus-Pixel": pixelId || ""
      }
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = payload.message || payload.error || "El endpoint del negocio no respondió correctamente.";
      return json(502, { error: message });
    }

    return json(200, { payload });
  } catch (error) {
    return json(400, { error: error.message || "No se pudieron traer datos del e-commerce." });
  }
};
