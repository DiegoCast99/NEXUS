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
  // Multi-cuenta: a qué cuenta de ML pertenece cada publicación (mlbId base ->
  // "mercadolibre" | "mercadolibre2" | ...). Lo usa el sync para empujar cada
  // anuncio con el token de SU cuenta, aunque la venta caiga en otra.
  if (!inv.listingAccounts || typeof inv.listingAccounts !== "object") inv.listingAccounts = {};
  if (!Array.isArray(inv.syncLog)) inv.syncLog = [];
  return inv;
}

// Clave de composición. Publicación simple: "MLB123". Por variación (sabor):
// "MLB123::456" (456 = variation_id). Retrocompatible: las simples ya guardadas
// siguen como "MLB123".
function compKey(mlbId, varId) {
  return (varId != null && varId !== "") ? (mlbId + "::" + varId) : String(mlbId);
}

// MIN/floor sobre un array de componentes [{productId, qty}] → entero >= 0, o null.
function computeComp(inv, comp) {
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

// Composición aplicable a una venta de (mlbId, varId). Si hay composición de esa
// variación, esa; si no, la de la publicación entera (fallback, aplica a todas las
// variaciones). null = no gestionada.
function compFor(inv, mlbId, varId) {
  const comps = inv.compositions || {};
  if (varId != null && varId !== "") {
    const k = compKey(mlbId, varId);
    if (Array.isArray(comps[k]) && comps[k].length) return comps[k];
  }
  return (Array.isArray(comps[mlbId]) && comps[mlbId].length) ? comps[mlbId] : null;
}

// Stock calculado de UNA variación (o de la publicación simple si varId null).
function computeVariation(inv, mlbId, varId) {
  return computeComp(inv, compFor(inv, mlbId, varId));
}

// Stock calculado de la publicación para MOSTRAR: si tiene composiciones por
// variación, la SUMA de todas; si es simple, la de su composición; null si nada.
function computeListing(inv, mlbId) {
  const comps = inv.compositions || {};
  const pref = mlbId + "::";
  const varKeys = Object.keys(comps).filter(function (k) { return k.indexOf(pref) === 0; });
  if (varKeys.length) {
    let total = 0, algo = false;
    varKeys.forEach(function (k) {
      const c = computeComp(inv, comps[k]);
      if (c != null) { total += c; algo = true; }
    });
    return algo ? total : null;
  }
  return Array.isArray(comps[mlbId]) ? computeComp(inv, comps[mlbId]) : null;
}

// Publicaciones (mlbId base) cuya composición —a nivel publicación o de cualquier
// variación— usa alguno de estos productos.
function listingsAfectadas(inv, productIds) {
  const set = {};
  productIds.forEach(function (pid) { set[pid] = true; });
  const out = {};
  Object.keys(inv.compositions || {}).forEach(function (key) {
    const comp = inv.compositions[key];
    if (Array.isArray(comp) && comp.some(function (c) { return set[c.productId]; })) {
      out[String(key).split("::")[0]] = true;
    }
  });
  return Object.keys(out);
}

// Aplica una venta: descuenta del stock físico lo que la venta consumió, usando la
// composición del SABOR vendido (variation_id) si existe. MUTA inv.products. Ignora
// lo no gestionado. Nunca deja stock < 0.
// items = order_items de ML: [ { item: { id, variation_id }, quantity } ]
function aplicarVenta(inv, items) {
  const changed = {};
  const detalle = [];
  (items || []).forEach(function (it) {
    const mlbId = it && it.item && it.item.id;
    const varId = (it && it.item && it.item.variation_id != null) ? it.item.variation_id : null;
    const qtySold = Math.max(0, Math.floor(Number(it && it.quantity) || 0));
    if (!mlbId || !qtySold) return;
    const comp = compFor(inv, mlbId, varId);
    if (!comp || !comp.length) return; // no gestionada por inventario
    comp.forEach(function (c) {
      const p = inv.products[c.productId];
      if (!p) return;
      const consumo = qtySold * (Number(c.qty) || 1);
      p.stock = Math.max(0, (Number(p.stock) || 0) - consumo);
      changed[c.productId] = true;
    });
    detalle.push({ mlbId: mlbId, varId: varId, qtySold: qtySold });
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
    // sku/name/cost son del navegador (el webhook no los toca); stock es el merge.
    out[id] = { sku: String(b.sku || ""), name: String(b.name || ""), stock: stock, cost: Math.max(0, Number(b.cost) || 0) };
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

module.exports = { normalizeInv, compKey, computeComp, compFor, computeVariation, computeListing, listingsAfectadas, aplicarVenta, mergeProducts, mergeSyncLog };
