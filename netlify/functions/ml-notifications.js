/* ============================================================
   NEXUS · POST /.netlify/functions/ml-notifications
   ------------------------------------------------------------
   Webhook de Mercado Libre (Tópicos). ML hace POST acá cuando pasa
   algo con una orden. Flujo:

   1. Responde 200 rápido (ML reintenta si no recibe 2xx).
   2. Si el tópico es de órdenes, resuelve seller_id -> uid (admin).
   3. Deduplica por id de orden (evita notificar varias veces la misma).
   4. Lee las suscripciones push del usuario y manda "Vendiste / Mercado Libre".

   Sin sesión de usuario: usa la cuenta de servicio de Firebase (_fbadmin).
   ============================================================ */
const { adminGetDoc, adminPatchDoc, adminQueryUsersByField } = require("./_fbadmin");
const { sendPush } = require("./_webpush");
const { ML_ACCOUNTS, mlAccountName, mlSellerField } = require("./_shared");

const MAX_NOTIFIED = 60;

function ok() {
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
}

exports.handler = async (event) => {
  // ML valida la URL con un GET al configurarla — responder 200.
  if (event.httpMethod === "GET") return ok();
  if (event.httpMethod !== "POST") return ok();

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return ok();
  }

  // Procesamos best-effort; cualquier error interno igual devuelve 200
  // para que ML no reintente en loop (la dedup nos cubre si reintenta).
  try {
    await handleNotification(body);
  } catch (error) {
    console.error("ml-notifications error:", error && error.message);
  }
  return ok();
};

async function handleNotification(body) {
  const topic = String(body.topic || "");
  const sellerId = body.user_id != null ? String(body.user_id) : "";
  const resource = String(body.resource || "");

  // Solo ventas: orders_v2 (y el legacy orders). Ojo con no aflojar esto a
  // /^orders/: la app tambien esta suscrita a orders_feedback (calificaciones),
  // que empieza igual pero NO es una venta y dispararia un "¡Vendiste!" falso.
  if (!/^orders(_v2)?$/.test(topic)) return;
  if (!sellerId) return;

  const orderId = (resource.match(/\/orders\/(\d+)/) || [])[1] || resource;
  if (!orderId) return;

  // seller -> uid. La venta puede venir de cualquiera de las cuentas de ML
  // conectadas, y cada una guarda su seller en su propio campo consultable.
  // De paso queda cual matcheo: es lo que se muestra en la notificacion.
  let hit = null;
  let accountId = null;
  for (const mlId of ML_ACCOUNTS) {
    hit = await adminQueryUsersByField(mlSellerField(mlId), sellerId);
    if (hit) { accountId = mlId; break; }
  }
  if (!hit) {
    console.warn("ml-notifications: seller " + sellerId + " sin usuario en Firestore");
    return;
  }

  const uid = hit.uid;
  const fields = (hit.doc && hit.doc.fields) || {};

  // Dedup: lista de últimas órdenes notificadas (JSON en un campo string).
  let notified = [];
  try {
    const raw = fields.ml_notified_ids && fields.ml_notified_ids.stringValue;
    if (raw) notified = JSON.parse(raw);
    if (!Array.isArray(notified)) notified = [];
  } catch (e) {
    notified = [];
  }
  if (notified.indexOf(orderId) !== -1) return; // ya notificada

  // Suscripciones push del usuario.
  let subs = [];
  try {
    const raw = fields.push_subs && fields.push_subs.stringValue;
    if (raw) subs = JSON.parse(raw);
    if (!Array.isArray(subs)) subs = [];
  } catch (e) {
    subs = [];
  }
  if (subs.length === 0) return; // nada a donde notificar

  // Enviar el push a cada dispositivo. Quitar las suscripciones caducadas.
  // El cuerpo dice de que cuenta fue la venta ("Mercado Libre 1" / "...2"),
  // que es lo unico que distingue una notificacion de la otra en el celular.
  // `url` es el deep-link: al tocar la notificacion, Nexus aterriza en ESA
  // venta (cuenta + orden), no en la portada.
  const payload = {
    title: "¡Vendiste!",
    body: mlAccountName(accountId),
    tag: "ml-" + orderId,
    url: "/dashboard.html#venta-" + accountId + "-" + orderId
  };
  const alive = [];
  let sentCount = 0;
  for (const sub of subs) {
    try {
      const result = await sendPush(sub, payload);
      if (!result.gone) { alive.push(sub); sentCount += 1; }
    } catch (e) {
      alive.push(sub);
      console.warn("ml-notifications push error:", e && e.message);
    }
  }

  const updateFields = {};
  const maskPaths = [];

  if (alive.length !== subs.length) {
    updateFields.push_subs = { stringValue: JSON.stringify(alive) };
    maskPaths.push("push_subs");
  }

  if (sentCount > 0) {
    notified.unshift(orderId);
    if (notified.length > MAX_NOTIFIED) notified = notified.slice(0, MAX_NOTIFIED);
    updateFields.ml_notified_ids = { stringValue: JSON.stringify(notified) };
    maskPaths.push("ml_notified_ids");
  } else {
    console.warn("ml-notifications: 0 pushes enviados para orden " + orderId);
  }

  if (maskPaths.length > 0) {
    await adminPatchDoc("users/" + uid, updateFields, maskPaths);
  }
}
