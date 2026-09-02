/* ============================================================
   NEXUS · Puente de stock con la tienda propia (Alpha Fitness)
   ------------------------------------------------------------
   La tienda web se enlaza como un canal más del inventario central: cada
   producto/sabor de la tienda es una "publicación" con composición BOM guardada
   en inv.compositions bajo la clave "store:<productoId>" (o
   "store:<productoId>::<sabor>"). Este módulo:
     · lee la config del sitio de Alpha (env vars),
     · calcula el stock a empujar por producto/sabor (mismo motor BOM),
     · empuja el stock a la tienda (POST nexus-stock),
     · lee ventas (GET nexus-feed) y catálogo (GET nexus-stock) de la tienda.
   Zero-dep (fetch global de Node 18+). Reusa el motor puro de _inventory.js.
   ============================================================ */
const { computeListing, computeVariation } = require("./_inventory");

const STORE_PREFIX = "store:";

function isStoreKey(k) { return String(k).indexOf(STORE_PREFIX) === 0; }
function storeKey(productoId, sabor) {
  return (sabor != null && sabor !== "") ? (STORE_PREFIX + productoId + "::" + sabor) : (STORE_PREFIX + productoId);
}
function baseStoreKey(k) { return String(k).split("::")[0]; }           // "store:PID::Choc" -> "store:PID"
function pidFromKey(k) { return baseStoreKey(k).slice(STORE_PREFIX.length); } // -> "PID"

// Config del sitio de Alpha (server-side). El token se REUSA del feed si no hay uno
// dedicado. Devuelve null si falta config (los llamadores no-opean sin romper).
function alphaConfig() {
  const base = String(process.env.ALPHA_SITE_URL || "").replace(/\/+$/, "");
  const token = process.env.ALPHA_NEXUS_TOKEN || process.env.NEXUS_FEED_TOKEN || "";
  if (!base || !token) return null;
  return {
    feedUrl: base + "/.netlify/functions/nexus-feed",
    stockUrl: base + "/.netlify/functions/nexus-stock",
    token: token
  };
}

// Dado el inventario y una lista de claves BASE ("store:<pid>"), calcula los updates
// { productoId, sabor?, stock } que hay que empujar a la tienda. Por sabor si la
// publicación tiene composiciones por variación; si no, a nivel producto.
function computeStoreUpdates(inv, baseKeys) {
  const comps = (inv && inv.compositions) || {};
  const out = [];
  const vistos = {};
  (baseKeys || []).forEach(function (raw) {
    const base = baseStoreKey(raw);
    if (!isStoreKey(base) || vistos[base]) return;
    vistos[base] = true;
    const pid = pidFromKey(base);
    const pref = base + "::";
    const varKeys = Object.keys(comps).filter(function (k) { return k.indexOf(pref) === 0; });
    if (varKeys.length) {
      varKeys.forEach(function (k) {
        const sabor = k.slice(pref.length);
        const stock = computeVariation(inv, base, sabor);
        if (stock == null) return;
        out.push({ productoId: pid, sabor: sabor, stock: stock });
      });
    } else if (Array.isArray(comps[base]) && comps[base].length) {
      const stock = computeListing(inv, base);
      if (stock == null) return;
      out.push({ productoId: pid, stock: stock });
    }
  });
  return out;
}

// Todas las claves BASE de tienda que existen en el inventario (para resync total).
function storeBaseKeys(inv) {
  const comps = (inv && inv.compositions) || {};
  const set = {};
  Object.keys(comps).forEach(function (k) { if (isStoreKey(k)) set[baseStoreKey(k)] = true; });
  return Object.keys(set);
}

// POST del stock calculado a la tienda. Devuelve { applied, results } o lanza.
async function pushToStore(cfg, updates) {
  if (!cfg || !updates || !updates.length) return { applied: 0, results: [] };
  const res = await fetch(cfg.stockUrl, {
    method: "POST",
    headers: { Authorization: "Bearer " + cfg.token, "Content-Type": "application/json" },
    body: JSON.stringify({ updates: updates })
  });
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error("store push -> " + res.status + " " + (data.error || ""));
  return data;
}

// GET de ventas de la tienda (feed curado). Devuelve el array de orders.
async function fetchStoreOrders(cfg) {
  const res = await fetch(cfg.feedUrl, { headers: { Authorization: "Bearer " + cfg.token }, cache: "no-store" });
  if (!res.ok) throw new Error("store feed -> " + res.status);
  const data = await res.json().catch(function () { return {}; });
  return Array.isArray(data.orders) ? data.orders : [];
}

// GET del catálogo de la tienda (productos + stock por sabor) para la UI de enlace.
async function fetchStoreCatalog(cfg) {
  const res = await fetch(cfg.stockUrl, { headers: { Authorization: "Bearer " + cfg.token }, cache: "no-store" });
  if (!res.ok) throw new Error("store catalog -> " + res.status);
  const data = await res.json().catch(function () { return {}; });
  return Array.isArray(data.products) ? data.products : [];
}

module.exports = {
  STORE_PREFIX, isStoreKey, storeKey, baseStoreKey, pidFromKey,
  alphaConfig, computeStoreUpdates, storeBaseKeys,
  pushToStore, fetchStoreOrders, fetchStoreCatalog
};
