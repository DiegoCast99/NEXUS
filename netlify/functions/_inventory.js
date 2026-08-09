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

module.exports = { normalizeInv, computeListing, listingsAfectadas, aplicarVenta };
