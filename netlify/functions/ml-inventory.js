/* ============================================================
   Inventario central de Mercado Libre — persistencia (Fase 1/2)
   ------------------------------------------------------------
   Guarda el inventario en el campo `inventory` del doc del usuario en Firestore,
   SEPARADO de `nexusData` (que el navegador sobreescribe en bloque). Asi el
   servidor es la fuente de verdad y la Fase 3 (webhook de ventas) podra mutar
   este mismo campo transaccionalmente sin que el navegador lo pise.

   Estructura del objeto `inventory`:
     {
       products:    { "PROD-000123": { sku, name, stock } },
       compositions:{ "MLB123": [ { productId, qty } ] },
       listingState:{ "MLB123": { computed, published, status, lastSyncAt, error } },
       syncLog:     [ { ts, listing, antes, despues, motivo, resultado, error } ],
       updatedAt
     }
   Acciones: get | save.  El calculo de stock y el PUT a ML los hace el
   navegador (reusa mlApi/ml-api-proxy, que ya maneja token/refresh). La Fase 3
   movera el descuento por venta al lado del servidor.
   ============================================================ */
const { uidFromIdToken, getIdToken, readUserField, writeUserField, parseBody, json } = require("./_shared");

const FIELD = "inventory";
const MAX_BYTES = 900000; // margen bajo el limite de ~1MB por campo de Firestore

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Solo POST." });
  try {
    const idToken = getIdToken(event);
    const uid = uidFromIdToken(idToken);
    if (!uid) return json(401, { error: "Sin autenticacion." });

    const { action, inventory } = parseBody(event);

    if (action === "get") {
      const raw = await readUserField(uid, idToken, FIELD);
      let inv = {};
      if (raw) { try { inv = JSON.parse(raw); } catch (e) { inv = {}; } }
      return json(200, { inventory: inv });
    }

    if (action === "save") {
      if (!inventory || typeof inventory !== "object") return json(400, { error: "Falta el inventario." });
      const str = JSON.stringify(inventory);
      if (str.length > MAX_BYTES) return json(400, { error: "El inventario es demasiado grande para guardar." });
      await writeUserField(uid, idToken, FIELD, str);
      return json(200, { ok: true });
    }

    return json(400, { error: "Accion desconocida." });
  } catch (e) {
    return json(500, { error: (e && e.message) || "Error de inventario." });
  }
};
