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
const { ML_ACCOUNTS, mlAccountName, mlSellerField, decrypt, encrypt } = require("./_shared");

const MAX_NOTIFIED = 60;
const ML_API = "https://api.mercadolibre.com";
const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const REFRESH_BUFFER_SECS = 300;

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

  // VERIFICAR LA ORDEN ANTES DE AVISAR. ML manda orders_v2 por CUALQUIER
  // evento de orden, incluidas compras que nunca se pagaron (el comprador
  // toco "Comprar" y abandono, pago rechazado, antifraude). Esas ordenes no
  // aparecen en el panel de ventas: avisarlas es una venta fantasma (paso en
  // produccion el 2026-07-20, dos avisos falsos de la cuenta 2). Solo es
  // venta real una orden PAGA. Si no se puede verificar (ML caido, token
  // irrecuperable), se avisa igual: peor que un falso aviso es callarse una
  // venta real.
  const chequeo = await verificarOrden(accountId, fields, uid, orderId);
  if (chequeo.verificada && !chequeo.esVenta) {
    console.warn("ml-notifications: orden " + orderId + " con status '" + chequeo.status +
      "' — no es una venta paga, no se notifica");
    // No se marca como notificada a proposito: si el pago se concreta mas
    // tarde, ML manda otro evento y AHI se avisa.
    return;
  }
  if (!chequeo.verificada) {
    console.warn("ml-notifications: no se pudo verificar la orden " + orderId +
      " (" + (chequeo.motivo || "sin detalle") + ") — se notifica igual");
  }

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

/* ---------- verificacion de la orden contra ML ---------- */

// Devuelve { verificada, esVenta, status } — o { verificada: false, motivo }
// si no se pudo consultar. Una orden es venta REAL solo con status "paid":
// confirmed / payment_required / payment_in_process son compras sin pagar,
// cancelled / invalid son compras caidas. Ninguna de esas se avisa.
async function verificarOrden(accountId, fields, uid, orderId) {
  try {
    const campo = "secret_" + accountId;
    const enc = fields[campo] && fields[campo].stringValue;
    if (!enc) return { verificada: false, motivo: "sin tokens de " + accountId };

    let tokens = JSON.parse(decrypt(enc));
    const ahora = Math.floor(Date.now() / 1000);
    const vence = (tokens.obtained_at || 0) + (tokens.expires_in || 0) - REFRESH_BUFFER_SECS;
    if (ahora >= vence && tokens.refresh_token) {
      tokens = await refrescarToken(tokens, uid, campo);
    }

    const res = await fetch(ML_API + "/orders/" + orderId, {
      headers: { Authorization: "Bearer " + tokens.access_token, Accept: "application/json" },
      cache: "no-store"
    });
    if (!res.ok) return { verificada: false, motivo: "ML respondio " + res.status };

    const orden = await res.json().catch(() => null);
    if (!orden || !orden.status) return { verificada: false, motivo: "orden sin status" };

    const status = String(orden.status);
    return { verificada: true, status: status, esVenta: status === "paid" };
  } catch (error) {
    return { verificada: false, motivo: (error && error.message) || "error" };
  }
}

// El webhook llega a cualquier hora y el access_token de ML dura 3 h: casi
// siempre va a estar vencido. Se refresca con la cuenta de servicio y se
// re-persiste cifrado, igual que hace el proxy.
async function refrescarToken(tokens, uid, campo) {
  const appId = process.env.ML_APP_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  if (!appId || !clientSecret) throw new Error("faltan ML_APP_ID / ML_CLIENT_SECRET");

  const res = await fetch(ML_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: appId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token
    }).toString()
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error("refresh de token fallo: " + (data.message || data.error || res.status));
  }

  const frescos = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in || 10800,
    user_id: data.user_id || tokens.user_id,
    obtained_at: Math.floor(Date.now() / 1000)
  };
  await adminPatchDoc("users/" + uid, {
    [campo]: { stringValue: encrypt(JSON.stringify(frescos)) }
  }, [campo]);
  return frescos;
}
