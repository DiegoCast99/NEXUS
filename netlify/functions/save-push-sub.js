/* ============================================================
   NEXUS · POST /.netlify/functions/save-push-sub
   ------------------------------------------------------------
   Guarda la suscripción Web Push del dispositivo (iPhone/Android)
   bajo users/{uid} en Firestore. También guarda el seller id de
   Mercado Libre como campo consultable, para que el webhook pueda
   resolver seller -> uid sin sesión de usuario.

   Body:   { "subscription": {endpoint, keys:{p256dh, auth}}, "sellerId": "148308966" }
   Header: Authorization: Bearer <Firebase ID token>
   ============================================================ */
const {
  decrypt,
  readUserField,
  writeUserField,
  uidFromIdToken,
  getIdToken,
  parseBody,
  json
} = require("./_shared");

const MAX_SUBS = 8;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Solo POST." });
  try {
    const idToken = getIdToken(event);
    const uid = uidFromIdToken(idToken);
    const { subscription, sellerId } = parseBody(event);

    if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
      return json(400, { error: "Suscripción push inválida o incompleta." });
    }

    // Leer suscripciones existentes (JSON en un campo string) y hacer merge por endpoint.
    let subs = [];
    try {
      const raw = await readUserField(uid, idToken, "push_subs");
      if (raw) subs = JSON.parse(raw);
      if (!Array.isArray(subs)) subs = [];
    } catch (e) {
      subs = [];
    }

    const clean = {
      endpoint: String(subscription.endpoint),
      keys: { p256dh: String(subscription.keys.p256dh), auth: String(subscription.keys.auth) }
    };
    subs = subs.filter((s) => s && s.endpoint !== clean.endpoint);
    subs.unshift(clean);
    if (subs.length > MAX_SUBS) subs = subs.slice(0, MAX_SUBS);

    await writeUserField(uid, idToken, "push_subs", JSON.stringify(subs));

    // Seller id de ML: campo consultable que el webhook usa para resolver
    // venta -> usuario. Si el cliente no lo mando (pasa al activar desde el
    // iPhone, donde mlUserId no esta en el localStorage de ese dispositivo),
    // lo derivamos de los tokens de ML ya guardados en Firestore.
    let resolvedSeller = sellerId ? String(sellerId) : "";
    if (!resolvedSeller) {
      try {
        const encBundle = await readUserField(uid, idToken, "secret_mercadolibre");
        if (encBundle) {
          const parsed = JSON.parse(decrypt(encBundle));
          if (parsed.user_id) resolvedSeller = String(parsed.user_id);
        }
      } catch (e) { /* todavia no conecto Mercado Libre */ }
    }
    if (resolvedSeller) {
      await writeUserField(uid, idToken, "ml_seller_id", resolvedSeller);
    }

    return json(200, { ok: true, count: subs.length, sellerId: resolvedSeller || null });
  } catch (error) {
    return json(400, { error: error.message || "No se pudo guardar la suscripción." });
  }
};
