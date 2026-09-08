/* ============================================================
   NEXUS · Poller de ventas de la tienda propia (Alpha Fitness) — PROGRAMADO
   ------------------------------------------------------------
   La tienda no tiene webhook hacia Nexus, así que Nexus consulta su feed cada
   pocos minutos (netlify.toml define el schedule) y, por cada venta NUEVA, descuenta
   el stock físico central (idempotente) y re-sincroniza Mercado Libre + la tienda.
   Reusa el MISMO núcleo que el webhook de ML (procesarVentaInventario), así una
   venta en la tienda baja el stock igual que una venta en ML.

   SEGURO POR DISEÑO: no-op salvo que (a) la tienda esté configurada (ALPHA_SITE_URL)
   y (b) el titular haya hecho al menos una sincronización desde Nexus (que registra
   su uid en config/alpha_store). La idempotencia vive en ml_inventory_processed con
   clave "store:<orderId>" — nunca descuenta dos veces la misma venta.
   ============================================================ */
const { adminGetDoc } = require("./_fbadmin");
const { alphaConfig, fetchStoreOrders } = require("./_alphastore");
const { procesarVentaInventario, notificarVentaPush } = require("./ml-notifications");

function parseLedger(fields) {
  const f = fields && fields.ml_inventory_processed;
  const raw = f && f.stringValue;
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

exports.handler = async function () {
  const cfg = alphaConfig();
  if (!cfg) { console.log("[alpha-store-poll] tienda no configurada, no-op."); return { statusCode: 200, body: "sin config" }; }

  // uid del titular (registrado por alpha-store al primer "Sincronizar tienda").
  const meta = await adminGetDoc("config/alpha_store");
  const uid = meta && meta.fields && meta.fields.uid && meta.fields.uid.stringValue;
  if (!uid) { console.log("[alpha-store-poll] sin owner registrado, no-op."); return { statusCode: 200, body: "sin owner" }; }

  const userDoc = await adminGetDoc("users/" + uid);
  const fields = (userDoc && userDoc.fields) || {};

  let orders = [];
  try { orders = await fetchStoreOrders(cfg); }
  catch (e) { console.error("[alpha-store-poll] feed:", e && e.message); return { statusCode: 200, body: "feed error" }; }

  // Filtro previo por el ledger (una lectura) para no llamar al núcleo por órdenes ya
  // procesadas; el núcleo igual re-chequea el ledger fresco (doble seguro).
  const ledger = parseLedger(fields);
  const procesadas = {}; ledger.forEach(function (k) { procesadas[k] = true; });

  // Pre-filtro de ventas ya NOTIFICADAS (para no reclamar el push por cada orden vieja en
  // cada corrida). notificarVentaPush igual re-chequea fresco (doble seguro, idempotente).
  const yaNotificadas = {};
  try {
    const nraw = fields.ml_notified_ids && fields.ml_notified_ids.stringValue;
    (JSON.parse(nraw || "[]") || []).forEach(function (k) { yaNotificadas[k] = true; });
  } catch (e) { /* noop */ }

  let nuevas = 0, avisadas = 0;
  for (const o of orders) {
    if (!o || !o.id) continue;
    if (o.cancelled || o.status === "cancelado") continue;
    const orderKey = "store:" + o.id;

    // (1) PUSH "¡Vendiste!" al celular del titular. Independiente del inventario: la venta
    //     se avisa aunque no tenga items mapeables al stock central. Idempotente por
    //     ml_notified_ids (misma dedup que las ventas de ML) → un solo push por venta.
    if (!yaNotificadas[orderKey]) {
      try {
        const total = Number(o.total) || 0;
        const prod = o.product || "Pedido";
        const r = await notificarVentaPush(uid, orderKey, {
          title: "¡Vendiste!",
          body: "Alpha Fitness · " + prod + (total ? " · $" + Math.round(total) : ""),
          tag: "store-" + o.id,
          url: "/dashboard.html#venta-alphaweb-" + o.id
        });
        if (r && r.sent) avisadas += r.sent;
      } catch (e) { console.error("[alpha-store-poll] push " + o.id + ":", e && e.message); }
    }

    // (2) INVENTARIO: descontar stock central (solo órdenes nuevas con items mapeables).
    if (procesadas[orderKey]) continue;

    // Items de la tienda → formato order_items de ML con id "store:<pid>" y sabor.
    const items = (Array.isArray(o.items) ? o.items : [])
      .filter(function (it) { return it && it.productoId; })
      .map(function (it) {
        return { item: { id: "store:" + it.productoId, variation_id: it.sabor || null }, quantity: Math.max(0, parseInt(it.cantidad, 10) || 0) };
      });
    if (!items.length) continue;

    try {
      await procesarVentaInventario({
        uid: uid, fields: fields,
        orderKey: orderKey, items: items,
        motivo: "Venta tienda " + o.id
      });
      nuevas++;
    } catch (e) { console.error("[alpha-store-poll] orden " + o.id + ":", e && e.message); }
  }

  console.log("[alpha-store-poll] ordenes nuevas: " + nuevas + " · push enviados: " + avisadas);
  return { statusCode: 200, body: "ok " + nuevas + " push " + avisadas };
};
