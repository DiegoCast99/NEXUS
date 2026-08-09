/* ============================================================
   NEXUS · Motor de inventario (puro, sin dependencias) — SERVER
   ------------------------------------------------------------
   Mismo cálculo BOM que el frontend (js/dashboard/inventory.js):
     stock_publicacion = MIN sobre componentes de floor(product.stock / qty)
   Se mantiene una copia server-side porque el navegador no puede requerir
   módulos de Netlify Functions (no hay build). Si tocás la fórmula acá,
   tocá también la del frontend, y viceversa.

   Funciones puras (no hacen I/O): las usa el webhook de ventas para
   descontar stock y recalcular las publicaciones afectadas.
   ============================================================ */

// Asegura la forma del objeto inventario (tolerante a docs viejos / vacíos).
// OJO: el registro de idempotencia (órdenes ya descontadas) NO vive acá, vive en
// un campo Firestore aparte (ml_inventory_processed) que SOLO escribe el webhook.
// Si viviera en este blob, un guardado del navegador (que reescribe el campo
// `inventory` entero) lo borraría y se podría descontar dos veces la misma venta.
function normalizeInv(inv) {
  if (!inv || typeof inv !== "object") inv = {};
  if (!inv.products || typeof inv.products !== "object") inv.products = {};
  if (!inv.compositions || typeof inv.compositions !== "object") inv.compositions = {};
  if (!inv.listingState || typeof inv.listingState !== "object") inv.listingState = {};
  if (!Array.isArray(inv.syncLog)) inv.syncLog = [];
  return inv;
}

// Stock que debería tener una publicación según su composición y el stock
// físico actual. Devuelve null si la publicación NO tiene composición (no la
// gestiona el inventario), o un entero >= 0.
function computeListing(inv, mlbId) {
  const comp = inv.compositions[mlbId];
  if (!comp || !comp.length) return null;
  let min = Infinity;
  for (let i = 0; i < comp.length; i++) {
    const p = inv.products[comp[i].productId];
    const qty = Number(comp[i].qty) || 1;
    if (!p || qty <= 0) return 0;
    const posibles = Math.floor((Number(p.stock) || 0) / qty);
    if (posibles < min) min = posibles;
  }
  return min === Infinity ? null : Math.max(0, min);
}

// Publicaciones cuya composición usa alguno de estos productos.
function listingsAfectadas(inv, productIds) {
  const set = {};
  productIds.forEach(function (pid) { set[pid] = true; });
  return Object.keys(inv.compositions).filter(function (mlbId) {
    return (inv.compositions[mlbId] || []).some(function (c) { return set[c.productId]; });
  });
}

// Aplica una venta: descuenta del stock físico de cada producto lo que la venta
// consumió (unidades vendidas × cantidad por composición). MUTA inv.products.
// Ignora publicaciones sin composición (no gestionadas). Nunca deja stock < 0.
// items = order_items de ML: [ { item: { id }, quantity } ]
function aplicarVenta(inv, items) {
  const changed = {};
  const detalle = [];
  (items || []).forEach(function (it) {
    const mlbId = it && it.item && it.item.id;
    const qtySold = Math.max(0, Math.floor(Number(it && it.quantity) || 0));
    if (!mlbId || !qtySold) return;
    const comp = inv.compositions[mlbId];
    if (!comp || !comp.length) return; // publicación no gestionada por inventario
    comp.forEach(function (c) {
      const p = inv.products[c.productId];
      if (!p) return;
      const consumo = qtySold * (Number(c.qty) || 1);
      p.stock = Math.max(0, (Number(p.stock) || 0) - consumo);
      changed[c.productId] = true;
    });
    detalle.push({ mlbId: mlbId, qtySold: qtySold });
  });
  return { changedProducts: Object.keys(changed), detalle: detalle };
}

// Merge 3-way del stock de productos entre lo que hay en el servidor y lo que
// manda el navegador al guardar. Cada producto del navegador trae `baseStock` =
// el stock que tenía cuando el navegador lo cargó. Reglas:
//   - Producto nuevo (sin baseStock): gana el navegador.
//   - El usuario NO tocó el stock (stock === baseStock): se PRESERVA el del
//     servidor, que puede traer un descuento por venta ocurrido mientras el
//     panel estaba abierto (evita pisar el descuento).
//   - El usuario SÍ editó el stock (stock !== baseStock): gana el navegador.
// sku/name siempre vienen del navegador (el webhook no los toca). Los productos
// ausentes del payload del navegador se consideran borrados por el usuario.
function mergeProducts(server, browser) {
  const out = {};
  const srv = server || {};
  Object.keys(browser || {}).forEach(function (id) {
    const b = browser[id] || {};
    const cur = srv[id] || {};
    const bStock = Math.max(0, Math.floor(Number(b.stock) || 0));
    let stock;
    if (b.baseStock == null) {
      stock = bStock; // producto nuevo
    } else if (Number(b.stock) === Number(b.baseStock)) {
      stock = cur.stock != null ? Math.max(0, Math.floor(Number(cur.stock) || 0)) : bStock; // preservar servidor
    } else {
      stock = bStock; // el usuario lo editó
    }
    out[id] = { sku: String(b.sku || ""), name: String(b.name || ""), stock: stock };
  });
  return out;
}

// Une dos historiales de sync (servidor + navegador) sin perder entradas de
// ninguno: concatena, deduplica por ts+listing+motivo, ordena por fecha desc y
// recorta. Así el webhook (ventas) y el navegador (sync manual) no se pisan el log.
function mergeSyncLog(a, b, cap) {
  const seen = {};
  const out = [];
  (a || []).concat(b || []).forEach(function (e) {
    if (!e) return;
    const k = String(e.ts) + "|" + String(e.listing) + "|" + String(e.motivo);
    if (seen[k]) return;
    seen[k] = true;
    out.push(e);
  });
  out.sort(function (x, y) { return String(y.ts).localeCompare(String(x.ts)); });
  if (out.length > (cap || 200)) out.length = cap || 200;
  return out;
}

module.exports = { normalizeInv, computeListing, listingsAfectadas, aplicarVenta, mergeProducts, mergeSyncLog };
