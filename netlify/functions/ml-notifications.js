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
const { adminGetDoc, adminPatchDoc, adminPatchDocIf, adminQueryUsersByField } = require("./_fbadmin");
const { sendPush } = require("./_webpush");
const { ML_ACCOUNTS, mlAccountName, mlSellerField, decrypt, encrypt } = require("./_shared");
const { normalizeInv, computeListing, computeVariation, listingsAfectadas, aplicarVenta } = require("./_inventory");

const MAX_NOTIFIED = 60;
const ML_API = "https://api.mercadolibre.com";
const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const REFRESH_BUFFER_SECS = 300;

// Inventario (Fase 3): descuento de stock por venta.
// El registro de idempotencia vive en un campo APARTE del blob `inventory`, para
// que el guardado del navegador (que reescribe `inventory` entero) no lo borre.
const INV_LEDGER_FIELD = "ml_inventory_processed";
const INV_MAX_PROCESSED = 200;
const INV_MAX_LOG = 200;
const INV_MAX_RETRIES = 5;

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

  // VERIFICAR LA ORDEN UNA SOLA VEZ. Sirve para dos cosas independientes:
  // (a) descontar inventario y (b) decidir si el push es una venta real.
  // ML manda orders_v2 por CUALQUIER evento de orden, incluidas compras que
  // nunca se pagaron (el comprador toco "Comprar" y abandono, pago rechazado,
  // antifraude). Esas ordenes no aparecen en el panel de ventas: tratarlas como
  // venta es una venta fantasma (paso en produccion el 2026-07-20, dos avisos
  // falsos de la cuenta 2). Solo es venta real una orden PAGA.
  const chequeo = await verificarOrden(accountId, fields, uid, orderId);

  // ---------- Fase 3: descuento de stock por venta ----------
  // Corre INDEPENDIENTE del push (aunque no haya suscripciones). Solo ventas
  // pagadas y verificadas: descontar por una orden fantasma seria un error dificil
  // de revertir, asi que ante duda NO se descuenta. Idempotencia propia (registro
  // ml_inventory_processed) para no descontar dos veces si ML reenvia el webhook.
  if (chequeo.verificada && chequeo.esVenta && chequeo.orden && chequeo.accessToken) {
    try {
      await descontarStockPorVenta(accountId, uid, orderId, chequeo.orden, chequeo.accessToken, fields);
    } catch (e) {
      console.error("ml-notifications inventario: descuento fallo para orden " + orderId + ":", e && e.message);
    }
  }

  // ---------- Push de la venta ----------
  // Solo se avisan ventas pagadas (o no verificables). Las NO pagadas no se
  // marcan a proposito: si el pago se concreta despues, ML manda otro evento y
  // AHI se avisa.
  if (chequeo.verificada && !chequeo.esVenta) {
    console.warn("ml-notifications: orden " + orderId + " con status '" + chequeo.status +
      "' — no es una venta paga, no se notifica");
    return;
  }
  if (!chequeo.verificada) {
    console.warn("ml-notifications: no se pudo verificar la orden " + orderId +
      " (" + (chequeo.motivo || "sin detalle") + ") — se notifica igual");
  }

  // IDEMPOTENCIA ATÓMICA. ML manda VARIOS eventos por la misma orden y llegan en
  // paralelo: sin serializar, cada invocación pasaba el chequeo y mandaba su push
  // (salian 2-3 notificaciones iguales). Ahora se "reclama" la orden con
  // precondición ANTES de enviar; solo UNA invocación gana el claim → un solo push.
  const claim = await reclamarNotificacion(uid, orderId);
  if (!claim.claimed) return;   // ya la reclamó/notificó otra invocación (o sin doc)
  const subs = claim.subs;
  if (!subs.length) return;     // nada a donde notificar

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
  for (const sub of subs) {
    try {
      const result = await sendPush(sub, payload);
      if (!result.gone) alive.push(sub);
    } catch (e) {
      alive.push(sub);
      console.warn("ml-notifications push error:", e && e.message);
    }
  }

  // Podar suscripciones caducadas (best-effort). ml_notified_ids ya lo escribió el
  // claim, así que acá solo se actualiza push_subs si algo caducó.
  if (alive.length !== subs.length) {
    await adminPatchDoc("users/" + uid, { push_subs: { stringValue: JSON.stringify(alive) } }, ["push_subs"]);
  }
}

// Reclama una orden para notificarla UNA sola vez, aunque ML mande varios eventos
// en paralelo. Lee fresco, y si la orden no está en ml_notified_ids la agrega con
// precondición sobre updateTime. Devuelve { claimed, subs }: claimed=true solo para
// la invocación que ganó el claim (las demás ven la orden ya marcada, o pierden la
// precondición y reintentan). subs = suscripciones frescas para enviar.
async function reclamarNotificacion(uid, orderId) {
  for (let intento = 0; intento < INV_MAX_RETRIES; intento++) {
    const doc = await adminGetDoc("users/" + uid);
    if (!doc) return { claimed: false, subs: [] };
    const updateTime = doc.updateTime;

    let notified = [];
    try { const r = invFieldRaw(doc, "ml_notified_ids"); if (r) notified = JSON.parse(r); if (!Array.isArray(notified)) notified = []; } catch (e) { notified = []; }
    if (notified.indexOf(orderId) !== -1) return { claimed: false, subs: [] }; // ya notificada

    let subs = [];
    try { const r = invFieldRaw(doc, "push_subs"); if (r) subs = JSON.parse(r); if (!Array.isArray(subs)) subs = []; } catch (e) { subs = []; }

    notified.unshift(orderId);
    if (notified.length > MAX_NOTIFIED) notified = notified.slice(0, MAX_NOTIFIED);

    const ok = await adminPatchDocIf("users/" + uid,
      { ml_notified_ids: { stringValue: JSON.stringify(notified) } }, ["ml_notified_ids"], updateTime);
    if (ok) return { claimed: true, subs: subs };
    // conflicto: otro proceso escribió el doc → reintentar (re-lee; si ya quedó
    // notificada, la próxima vuelta sale con claimed:false).
  }
  return { claimed: false, subs: [] };
}

/* ---------- verificacion de la orden contra ML ---------- */

// Devuelve { verificada, esVenta, status, orden, accessToken } — o
// { verificada: false, motivo } si no se pudo consultar. Una orden es venta REAL
// solo con status "paid": confirmed / payment_required / payment_in_process son
// compras sin pagar, cancelled / invalid son compras caidas. Ninguna se avisa.
// `orden` y `accessToken` se devuelven para reusarlos en el descuento de stock
// (Fase 3) sin volver a descifrar el token ni re-consultar la orden.
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
    if (!res.ok) return { verificada: false, motivo: "ML respondio " + res.status, accessToken: tokens.access_token };

    const orden = await res.json().catch(() => null);
    if (!orden || !orden.status) return { verificada: false, motivo: "orden sin status", accessToken: tokens.access_token };

    const status = String(orden.status);
    return { verificada: true, status: status, esVenta: status === "paid", orden: orden, accessToken: tokens.access_token };
  } catch (error) {
    return { verificada: false, motivo: (error && error.message) || "error" };
  }
}

// Access token de CUALQUIER cuenta conectada (para el sync multi-cuenta). Descifra
// secret_<cuenta> desde el doc y lo refresca si está vencido, re-persistiendo. Lanza
// si esa cuenta no tiene tokens guardados.
async function tokenParaCuenta(uid, fields, account) {
  const campo = "secret_" + account;
  const enc = fields && fields[campo] && fields[campo].stringValue;
  if (!enc) throw new Error("sin tokens de " + account);
  let tokens = JSON.parse(decrypt(enc));
  const ahora = Math.floor(Date.now() / 1000);
  const vence = (tokens.obtained_at || 0) + (tokens.expires_in || 0) - REFRESH_BUFFER_SECS;
  if (ahora >= vence && tokens.refresh_token) tokens = await refrescarToken(tokens, uid, campo);
  return tokens.access_token;
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

/* ============================================================
   Fase 3 · Descuento de stock por venta + re-sync a Mercado Libre
   ============================================================ */

function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function parseInvField(raw) {
  try { return normalizeInv(JSON.parse(raw || "")); } catch (e) { return normalizeInv({}); }
}
function invFieldRaw(doc, field) {
  return doc && doc.fields && doc.fields[field] && doc.fields[field].stringValue;
}
function parseLedger(doc) {
  try { const a = JSON.parse(invFieldRaw(doc, INV_LEDGER_FIELD) || "[]"); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}

// Descuenta el stock físico consumido por una venta y re-sincroniza a ML las
// publicaciones afectadas. Dos fases separadas a proposito, porque el PUT a ML es
// un efecto externo que NO debe repetirse en cada reintento de la escritura:
//
//   Fase A) Descuento de stock + marca de orden procesada. Transaccional: lee el
//           campo `inventory` con su updateTime, descuenta en memoria y escribe
//           con precondición. Si otro proceso escribió primero, reintenta con
//           lectura fresca. El registro ml_inventory_processed hace el descuento
//           idempotente ante reenvios del webhook de ML.
//
//   Fase B) Recalcula las publicaciones afectadas, hace el PUT a ML UNA sola vez,
//           y persiste listingState + log. La ESCRITURA reintenta ante conflicto;
//           los PUT (ya hechos) no se repiten.
async function descontarStockPorVenta(accountId, uid, orderId, orden, accessToken, fields) {
  const items = Array.isArray(orden.order_items) ? orden.order_items : [];
  if (!items.length) return;
  const orderKey = accountId + ":" + orderId;

  // --- Fase A: descuento + idempotencia ---
  // Lee el blob `inventory` (productos) y el registro `ml_inventory_processed`
  // (órdenes ya descontadas, campo aparte). Descuenta el stock, agrega la orden al
  // registro y escribe AMBOS campos en UN solo PATCH atómico con precondición sobre
  // updateTime. Si otro proceso escribió antes, la precondición falla y reintenta
  // con lectura fresca → nunca descuenta dos veces la misma venta.
  let changed = null;
  for (let intento = 0; intento < INV_MAX_RETRIES; intento++) {
    const doc = await adminGetDoc("users/" + uid);
    if (!doc) return;
    const updateTime = doc.updateTime;
    const inv = parseInvField(invFieldRaw(doc, "inventory"));
    const ledger = parseLedger(doc);
    if (ledger.indexOf(orderKey) !== -1) return; // ya descontada

    const r = aplicarVenta(inv, items);
    if (!r.detalle.length) return; // ninguna publicación de la orden está gestionada

    ledger.unshift(orderKey);
    if (ledger.length > INV_MAX_PROCESSED) ledger.length = INV_MAX_PROCESSED;

    const ok = await adminPatchDocIf("users/" + uid, {
      inventory: { stringValue: JSON.stringify(inv) },
      [INV_LEDGER_FIELD]: { stringValue: JSON.stringify(ledger) }
    }, ["inventory", INV_LEDGER_FIELD], updateTime);
    if (ok) { changed = r.changedProducts; break; }
    if (intento === INV_MAX_RETRIES - 1) {
      console.error("ml-notifications inventario: no se pudo descontar orden " + orderId + " (conflictos)");
      return;
    }
  }
  if (!changed || !changed.length) return;

  // --- Fase B: recalcular, empujar a ML (una vez) y persistir estado ---
  let pushed = null;
  for (let intento = 0; intento < INV_MAX_RETRIES; intento++) {
    const doc = await adminGetDoc("users/" + uid);
    if (!doc) return;
    const updateTime = doc.updateTime;
    const inv = parseInvField(invFieldRaw(doc, "inventory"));

    if (pushed === null) {
      pushed = {};
      // Token por cuenta: la de la venta ya viene fresca; las demás se resuelven
      // bajo demanda (multi-cuenta). Así una venta en ML1 puede empujar el stock a
      // publicaciones de ML2 con el token de ML2.
      const tokenCache = { [accountId]: accessToken };
      const afectadas = listingsAfectadas(inv, changed);
      for (let i = 0; i < afectadas.length; i++) {
        const mlbId = afectadas[i];
        const computedApprox = computeListing(inv, mlbId); // total aprox para el skip
        if (computedApprox == null) continue;
        const prev = inv.listingState[mlbId] || {};
        if (prev.published === computedApprox && prev.status === "synced") continue; // ya sincronizada
        const antes = prev.published != null ? prev.published : null;

        // Cuenta dueña de ESTA publicación. Si no está registrada, cae en la de la venta.
        const acc = (inv.listingAccounts && inv.listingAccounts[mlbId]) || accountId;
        if (!(acc in tokenCache)) {
          try { tokenCache[acc] = await tokenParaCuenta(uid, fields, acc); }
          catch (e) { tokenCache[acc] = null; }
        }
        const tok = tokenCache[acc];
        if (!tok) { pushed[mlbId] = { computed: computedApprox, ok: false, error: "sin token de " + acc, antes: antes }; continue; }

        try {
          const publicado = await syncListingToML(tok, inv, mlbId);
          if (publicado == null) continue; // nada gestionado (ni por variación)
          pushed[mlbId] = { computed: publicado, ok: true, antes: antes };
        } catch (e) {
          pushed[mlbId] = { computed: computedApprox, ok: false, error: (e && e.message) || "error", antes: antes };
        }
        await sleep(120);
      }
      if (!Object.keys(pushed).length) return; // nada que persistir
    }

    // Aplica los resultados de los PUT al inv fresco (idempotente ante reintento).
    Object.keys(pushed).forEach(function (mlbId) {
      const p = pushed[mlbId];
      inv.listingState[mlbId] = p.ok
        ? { computed: p.computed, published: p.computed, status: "synced", lastSyncAt: nowIso(), error: null }
        : Object.assign({}, inv.listingState[mlbId], { computed: p.computed, status: "error", lastSyncAt: nowIso(), error: p.error });
      inv.syncLog.unshift({
        ts: nowIso(), listing: mlbId,
        antes: p.antes == null ? "—" : p.antes, despues: p.computed,
        motivo: "Venta " + orderId, resultado: p.ok ? "ok" : "error",
        error: p.ok ? undefined : p.error
      });
    });
    if (inv.syncLog.length > INV_MAX_LOG) inv.syncLog.length = INV_MAX_LOG;

    const ok = await adminPatchDocIf("users/" + uid,
      { inventory: { stringValue: JSON.stringify(inv) } }, ["inventory"], updateTime);
    if (ok) return;
    // conflicto: releer y re-aplicar `pushed` sin volver a hacer PUT a ML
  }
  console.error("ml-notifications inventario: no se pudo persistir el estado de sync de la orden " + orderId);
}

// Sincroniza el stock de una publicación a ML con el token del server, calculando
// POR VARIACIÓN (sabor): cada variación gestionada recibe su propio stock calculado;
// las no gestionadas se dejan como están (PUT parcial). Sin variaciones, setea
// available_quantity. Devuelve el TOTAL publicado (suma de las variaciones
// gestionadas), o null si la publicación no tiene nada gestionado. (0 pausa la
// variación/publicación; >0 la reactiva.)
async function syncListingToML(accessToken, inv, mlbId) {
  const detRes = await fetch(ML_API + "/items/" + mlbId + "?attributes=id,variations", {
    headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" },
    cache: "no-store"
  });
  if (!detRes.ok) throw new Error("GET item " + mlbId + " -> " + detRes.status);
  const det = await detRes.json().catch(() => ({}));
  const vars = (det && det.variations) || [];

  let body, total;
  if (vars.length) {
    const varsBody = [];
    total = 0;
    vars.forEach(function (v) {
      const c = computeVariation(inv, mlbId, v.id);
      if (c != null) { varsBody.push({ id: v.id, available_quantity: c }); total += c; }
    });
    if (!varsBody.length) return null; // ninguna variación gestionada
    body = { variations: varsBody };
  } else {
    const c = computeVariation(inv, mlbId, null);
    if (c == null) return null;
    body = { available_quantity: c };
    total = c;
  }

  const putRes = await fetch(ML_API + "/items/" + mlbId, {
    method: "PUT",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  if (!putRes.ok) {
    const t = await putRes.text().catch(() => "");
    throw new Error("PUT item " + mlbId + " -> " + putRes.status + " " + t.slice(0, 120));
  }
  return total;
}

// Export interno para tests unitarios (Netlify solo invoca `handler`).
exports._test = { descontarStockPorVenta, syncListingToML, reclamarNotificacion };
