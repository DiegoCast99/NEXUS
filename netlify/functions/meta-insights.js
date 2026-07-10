/* ============================================================
   NEXUS · POST /.netlify/functions/meta-insights
   ------------------------------------------------------------
   Lee y descifra el token de Meta del usuario desde Firestore, llama
   a graph.facebook.com DESDE EL SERVIDOR y devuelve las filas crudas.
   El access_token nunca viaja por el navegador.

   Body:   { "adAccountId": "act_123", "apiVersion": "v21.0", "datePreset": "last_30d" }
   Header: Authorization: Bearer <Firebase ID token>
   ============================================================ */
const {
  decrypt,
  readUserField,
  uidFromIdToken,
  getIdToken,
  parseBody,
  json
} = require("./_shared");

const META_FIELDS = [
  "campaign_id",
  "campaign_name",
  "date_start",
  "date_stop",
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "actions",
  "action_values",
  "purchase_roas"
].join(",");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  try {
    const idToken = getIdToken(event);
    const uid = uidFromIdToken(idToken);
    const { adAccountId, apiVersion, datePreset } = parseBody(event);

    if (!adAccountId || !apiVersion) {
      return json(400, { error: "Faltan adAccountId y/o apiVersion." });
    }

    const enc = await readUserField(uid, idToken, "secret_meta");
    if (!enc) {
      return json(400, { error: "No hay token de Meta guardado. Guardá tus credenciales primero." });
    }
    const accessToken = decrypt(enc);

    const rows = [];
    let nextUrl =
      "https://graph.facebook.com/" +
      encodeURIComponent(apiVersion) +
      "/" +
      encodeURIComponent(adAccountId) +
      "/insights?" +
      new URLSearchParams({
        access_token: accessToken,
        date_preset: datePreset || "last_30d",
        fields: META_FIELDS,
        level: "campaign",
        limit: "100",
        time_increment: "1"
      }).toString();

    let page = 0;
    while (nextUrl && page < 5) {
      const res = await fetch(nextUrl, { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.error) {
        const message = (payload.error && payload.error.message) || "Meta no pudo devolver datos.";
        return json(502, { error: message });
      }
      rows.push(...(Array.isArray(payload.data) ? payload.data : []));
      nextUrl = (payload.paging && payload.paging.next) || "";
      page += 1;
    }

    return json(200, { rows });
  } catch (error) {
    return json(400, { error: error.message || "No se pudieron traer datos de Meta." });
  }
};
