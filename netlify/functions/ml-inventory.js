/* ============================================================
   Inventario central de Mercado Libre — persistencia (Fase 1/2/4)
   ------------------------------------------------------------
   Guarda el inventario en el campo `inventory` del doc del usuario en Firestore,
   SEPARADO de `nexusData` (que el navegador sobreescribe en bloque). Así el
   servidor es la fuente de verdad y el webhook de ventas (Fase 3) muta este mismo
   campo transaccionalmente.

   Estructura del objeto `inventory`:
     {
       products:    { "PROD-000123": { sku, name, stock } },
       compositions:{ "MLB123": [ { productId, qty } ] },
       listingState:{ "MLB123": { computed, published, status, lastSyncAt, error } },
       syncLog:     [ { ts, listing, antes, despues, motivo, resultado, error } ],
       updatedAt
     }

   Acciones:
   - get:  devuelve el blob actual.
   - save: MERGE con control de concurrencia optimista (Fase 4). En vez de pisar
           el campo entero, lee el estado fresco del servidor y fusiona:
             · products: merge 3-way por baseStock (si el usuario NO tocó un stock,
               se PRESERVA el del servidor — que puede traer un descuento por venta
               ocurrido mientras el panel estaba abierto).
             · compositions: las manda el navegador (fuente de verdad del usuario).
             · listingState: merge por clave (no se pierden entradas del webhook).
             · syncLog: unión deduplicada.
           Se escribe con precondición sobre updateTime y se reintenta ante
           conflicto. Devuelve el inventario ya fusionado para que el navegador
           adopte el estado real (incluido lo que no llegó a pisar).
   El registro de idempotencia de ventas vive en OTRO campo (ml_inventory_processed),
   que el navegador nunca toca.
   ============================================================ */
const {
  uidFromIdToken, getIdToken, readUserField, readUserDoc, writeUserFieldsIf, parseBody, json
} = require("./_shared");
const { normalizeInv, mergeProducts, mergeSyncLog } = require("./_inventory");

const FIELD = "inventory";
const MAX_BYTES = 900000; // margen bajo el limite de ~1MB por campo de Firestore
const MAX_RETRIES = 5;

function parseInv(raw) {
  let inv = {};
  if (raw) { try { inv = JSON.parse(raw); } catch (e) { inv = {}; } }
  return normalizeInv(inv);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Solo POST." });
  try {
    const idToken = getIdToken(event);
    const uid = uidFromIdToken(idToken);
    if (!uid) return json(401, { error: "Sin autenticacion." });

    const body = parseBody(event);
    const action = body.action;

    if (action === "get") {
      const raw = await readUserField(uid, idToken, FIELD);
      return json(200, { inventory: parseInv(raw) });
    }

    if (action === "save") {
      // El navegador manda las piezas por separado (no un blob que pise todo).
      const products = body.products && typeof body.products === "object" ? body.products : {};
      const compositions = body.compositions && typeof body.compositions === "object" ? body.compositions : {};
      const listingState = body.listingState && typeof body.listingState === "object" ? body.listingState : {};
      const syncLog = Array.isArray(body.syncLog) ? body.syncLog : [];

      for (let intento = 0; intento < MAX_RETRIES; intento++) {
        const doc = await readUserDoc(uid, idToken, [FIELD]);
        const server = parseInv(doc.fields && doc.fields[FIELD] && doc.fields[FIELD].stringValue);

        const merged = {
          products: mergeProducts(server.products, products),
          compositions: compositions,
          listingState: Object.assign({}, server.listingState, listingState),
          syncLog: mergeSyncLog(server.syncLog, syncLog, 200),
          updatedAt: new Date().toISOString()
        };

        const str = JSON.stringify(merged);
        if (str.length > MAX_BYTES) return json(400, { error: "El inventario es demasiado grande para guardar." });

        const ok = await writeUserFieldsIf(uid, idToken, { [FIELD]: { stringValue: str } }, [FIELD], doc.updateTime);
        if (ok) return json(200, { inventory: merged });
        if (intento === MAX_RETRIES - 1) return json(409, { error: "El inventario cambió mientras guardabas. Volvé a intentar." });
      }
    }

    return json(400, { error: "Accion desconocida." });
  } catch (e) {
    return json(500, { error: (e && e.message) || "Error de inventario." });
  }
};
