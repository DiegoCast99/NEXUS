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
const { decrypt, readUserField, uidFromIdToken, getIdToken, json, ML_ACCOUNTS, mlSellerField } = require("./_shared");
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

    // 2. Cuenta de servicio de Firebase (la usa SOLO el webhook).
    try {
      await getAccessToken();
      checks.firebaseAdmin = "ok";
    } catch (e) {
      checks.firebaseAdmin = "falla";
      checks.firebaseAdminError = String((e && e.message) || e).slice(0, 180);
    }

    // 3. Una revision por CADA cuenta de ML: tokens guardados, seller id en su
    // campo consultable, y la busqueda exacta que hace el webhook.
    checks.accounts = [];
    for (const mlId of ML_ACCOUNTS) {
      const acc = { id: mlId, connected: false, sellerId: null, resolves: "omitido" };

      let sellerFromTokens = null;
      try {
        const encBundle = await readUserField(uid, idToken, "secret_" + mlId);
        if (encBundle) {
          const parsed = JSON.parse(decrypt(encBundle));
          sellerFromTokens = parsed.user_id ? String(parsed.user_id) : null;
        }
      } catch (e) { /* cuenta no conectada */ }
      acc.connected = Boolean(sellerFromTokens);

      try {
        acc.sellerId = await readUserField(uid, idToken, mlSellerField(mlId));
      } catch (e) { /* sin campo */ }

      if (acc.sellerId && checks.firebaseAdmin === "ok") {
        try {
          const hit = await adminQueryUsersByField(mlSellerField(mlId), acc.sellerId);
          acc.resolves = hit ? (hit.uid === uid ? "ok" : "otro-uid") : "no-encontrado";
        } catch (e) {
          acc.resolves = "falla";
        }
      }
      checks.accounts.push(acc);
    }

    // Resumen para el veredicto: cuantas cuentas quedaron listas para notificar.
    checks.mlConnected = checks.accounts.some((a) => a.connected);
    checks.accountsReady = checks.accounts.filter((a) => a.connected && a.resolves === "ok").length;
    checks.accountsConnected = checks.accounts.filter((a) => a.connected).length;

    return json(200, { ok: true, checks });
  } catch (error) {
    return json(400, { error: error.message || "No se pudo diagnosticar." });
  }
};
