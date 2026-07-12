/* ============================================================
   NEXUS · POST /.netlify/functions/send-test-push
   ------------------------------------------------------------
   Envía una notificación de PRUEBA a los dispositivos suscritos
   del propio usuario (autenticado). Sirve para confirmar que toda
   la cadena Web Push funciona sin esperar una venta real de ML.

   Header: Authorization: Bearer <Firebase ID token>
   ============================================================ */
const { readUserField, uidFromIdToken, getIdToken, json } = require("./_shared");
const { sendPush } = require("./_webpush");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Solo POST." });
  try {
    const idToken = getIdToken(event);
    const uid = uidFromIdToken(idToken);

    let subs = [];
    const raw = await readUserField(uid, idToken, "push_subs");
    if (raw) subs = JSON.parse(raw);
    if (!Array.isArray(subs) || subs.length === 0) {
      return json(400, { error: "No hay dispositivos suscritos todavía." });
    }

    let sent = 0;
    let lastError = "";
    for (const sub of subs) {
      try {
        const r = await sendPush(sub, { title: "Nexus", body: "Notificaciones activas ✓", tag: "nexus-test" });
        if (!r.gone) sent += 1;
      } catch (e) {
        lastError = (e && e.message) || String(e);
        console.error("send-test-push error:", lastError);
      }
    }
    if (sent === 0 && lastError) {
      return json(500, { error: "Push falló: " + lastError });
    }
    return json(200, { ok: true, sent });
  } catch (error) {
    return json(400, { error: error.message || "No se pudo enviar la prueba." });
  }
};
