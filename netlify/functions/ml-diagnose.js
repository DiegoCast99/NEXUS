/* ============================================================
   NEXUS · POST /.netlify/functions/ml-diagnose
   ------------------------------------------------------------
   Revisa cada eslabon de la cadena que dispara la notificacion de
   una venta REAL, que es distinta a la del push de prueba:

     Mercado Libre --webhook--> ml-notifications
        -> busca ml_seller_id en Firestore (cuenta de servicio)
        -> lee push_subs
        -> manda el push

   El push de prueba NO usa la cuenta de servicio ni ml_seller_id,
   por eso puede funcionar mientras la venta real falla.

   Header: Authorization: Bearer <Firebase ID token>
   ============================================================ */
const { decrypt, readUserField, uidFromIdToken, getIdToken, json } = require("./_shared");
const { getAccessToken, adminQueryUsersByField } = require("./_fbadmin");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Solo POST." });
  try {
    const idToken = getIdToken(event);
    const uid = uidFromIdToken(idToken);
    const checks = {};

    // 1. Dispositivos suscritos al push.
    let subs = [];
    try {
      const raw = await readUserField(uid, idToken, "push_subs");
      if (raw) subs = JSON.parse(raw);
    } catch (e) { /* sin suscripciones */ }
    checks.pushSubs = Array.isArray(subs) ? subs.length : 0;

    // 2. Tokens de ML guardados (y el seller id que traen adentro).
    let sellerFromTokens = null;
    try {
      const encBundle = await readUserField(uid, idToken, "secret_mercadolibre");
      if (encBundle) {
        const parsed = JSON.parse(decrypt(encBundle));
        sellerFromTokens = parsed.user_id ? String(parsed.user_id) : null;
      }
    } catch (e) { /* sin tokens */ }
    checks.mlConnected = Boolean(sellerFromTokens);

    // 3. ml_seller_id: el campo consultable que usa el webhook.
    let sellerId = null;
    try {
      sellerId = await readUserField(uid, idToken, "ml_seller_id");
    } catch (e) { /* sin campo */ }
    checks.mlSellerId = sellerId || null;

    // 4. Cuenta de servicio de Firebase (la usa SOLO el webhook).
    try {
      await getAccessToken();
      checks.firebaseAdmin = "ok";
    } catch (e) {
      checks.firebaseAdmin = "falla";
      checks.firebaseAdminError = String((e && e.message) || e).slice(0, 180);
    }

    // 5. La busqueda exacta que hace el webhook: seller -> uid.
    if (sellerId && checks.firebaseAdmin === "ok") {
      try {
        const hit = await adminQueryUsersByField("ml_seller_id", sellerId);
        checks.sellerResolves = hit ? (hit.uid === uid ? "ok" : "otro-uid") : "no-encontrado";
      } catch (e) {
        checks.sellerResolves = "falla";
      }
    } else {
      checks.sellerResolves = "omitido";
    }

    return json(200, { ok: true, checks });
  } catch (error) {
    return json(400, { error: error.message || "No se pudo diagnosticar." });
  }
};
