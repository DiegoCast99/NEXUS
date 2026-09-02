/* ============================================================
   NEXUS · Puente con la tienda propia (Alpha Fitness) — cara al navegador
   ------------------------------------------------------------
   Autenticado con el ID token del usuario (mismas reglas que ml-inventory).
   El token de la tienda NUNCA sale al navegador: vive en las env vars de Nexus.

   Acciones (POST { action }):
   - catalog: devuelve los productos de la tienda (id, nombre, sabores, stock)
              para construir la UI de enlace. { products: [...] }
   - push:    resync TOTAL — calcula el stock de todas las publicaciones "store:"
              del inventario y lo empuja a la tienda. { pushed, applied, result }
   - status:  { configured, linkedProducts } (diagnóstico rápido).
   ============================================================ */
const { uidFromIdToken, getIdToken, readUserField, parseBody, json } = require("./_shared");
const { normalizeInv } = require("./_inventory");
const { alphaConfig, computeStoreUpdates, storeBaseKeys, pushToStore, fetchStoreCatalog } = require("./_alphastore");
const { adminPatchDoc } = require("./_fbadmin");

function parseInv(raw) {
  let o = {};
  if (raw) { try { o = JSON.parse(raw); } catch (e) { o = {}; } }
  return normalizeInv(o);
}

// Registra el uid del titular para que el poller (server-side, sin idToken) sepa a
// qué doc de usuario aplicar las ventas de la tienda. Best-effort.
async function registrarOwner(uid) {
  try {
    await adminPatchDoc("config/alpha_store",
      { uid: { stringValue: uid }, updatedAt: { stringValue: new Date().toISOString() } },
      ["uid", "updatedAt"]);
  } catch (e) { /* no bloquea */ }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Solo POST." });
  try {
    const idToken = getIdToken(event);
    const uid = uidFromIdToken(idToken);
    if (!uid) return json(401, { error: "Sin autenticacion." });

    const body = parseBody(event);
    const action = body.action;
    const cfg = alphaConfig();

    if (action === "status") {
      const raw = await readUserField(uid, idToken, "inventory");
      const inv = parseInv(raw);
      return json(200, { configured: !!cfg, linkedProducts: storeBaseKeys(inv).length });
    }

    if (!cfg) {
      return json(400, { error: "La tienda no está configurada en Nexus (faltan las variables ALPHA_SITE_URL / token)." });
    }

    if (action === "catalog") {
      const products = await fetchStoreCatalog(cfg);
      return json(200, { products: products });
    }

    if (action === "push") {
      const raw = await readUserField(uid, idToken, "inventory");
      const inv = parseInv(raw);
      const updates = computeStoreUpdates(inv, storeBaseKeys(inv));
      let result = { applied: 0, results: [] };
      if (updates.length) result = await pushToStore(cfg, updates);
      await registrarOwner(uid);
      return json(200, { pushed: updates.length, applied: result.applied || 0, result: result });
    }

    return json(400, { error: "Accion desconocida." });
  } catch (e) {
    return json(500, { error: (e && e.message) || "Error de la tienda." });
  }
};
