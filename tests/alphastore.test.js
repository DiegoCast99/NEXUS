"use strict";
/* ============================================================
   Tests del PUENTE DE STOCK con la tienda propia (netlify/functions/_alphastore.js)
   ------------------------------------------------------------
   La tienda web se enlaza como un canal más del inventario central: sus productos/
   sabores viven en inv.compositions con clave "store:<pid>" / "store:<pid>::<sabor>".
   Verifica que:
     · computeStoreUpdates arma bien los updates {productoId, sabor?, stock},
     · aplicarVenta con items "store:" descuenta el stock físico correcto,
     · una venta de un sabor baja SOLO ese sabor (unificado con ML).
   Correr: node --test tests/alphastore.test.js
   ============================================================ */
const test = require("node:test");
const assert = require("node:assert");
const inv = require("../netlify/functions/_inventory.js");
const as = require("../netlify/functions/_alphastore.js");

function makeInv(o) {
  return inv.normalizeInv(Object.assign({ products: {}, compositions: {} }, o || {}));
}

test("storeKey: simple y por sabor", () => {
  assert.strictEqual(as.storeKey("P1"), "store:P1");
  assert.strictEqual(as.storeKey("P1", "Chocolate"), "store:P1::Chocolate");
  assert.strictEqual(as.pidFromKey("store:P1::Chocolate"), "P1");
  assert.strictEqual(as.baseStoreKey("store:P1::Chocolate"), "store:P1");
  assert.ok(as.isStoreKey("store:P1"));
  assert.ok(!as.isStoreKey("MLU123"));
});

test("computeStoreUpdates: producto por sabor → un update por sabor con stock físico", () => {
  const i = makeInv({
    products: { van: { stock: 11 }, choc: { stock: 10 }, fru: { stock: 3 } },
    compositions: {
      "store:P1::Vainilla": [{ productId: "van", qty: 1 }],
      "store:P1::Chocolate": [{ productId: "choc", qty: 1 }],
      "store:P1::Frutilla": [{ productId: "fru", qty: 1 }]
    }
  });
  const ups = as.computeStoreUpdates(i, ["store:P1"]);
  const byFlavor = {};
  ups.forEach((u) => { byFlavor[u.sabor] = u.stock; assert.strictEqual(u.productoId, "P1"); });
  assert.deepStrictEqual(byFlavor, { Vainilla: 11, Chocolate: 10, Frutilla: 3 });
});

test("computeStoreUpdates: producto simple (sin sabor) → un update a nivel producto", () => {
  const i = makeInv({
    products: { bcaa: { stock: 8 } },
    compositions: { "store:P2": [{ productId: "bcaa", qty: 1 }] }
  });
  const ups = as.computeStoreUpdates(i, ["store:P2"]);
  assert.strictEqual(ups.length, 1);
  assert.strictEqual(ups[0].productoId, "P2");
  assert.strictEqual(ups[0].sabor, undefined);
  assert.strictEqual(ups[0].stock, 8);
});

test("computeStoreUpdates: combo (BOM) usa MIN/floor sobre componentes", () => {
  const i = makeInv({
    products: { whey: { stock: 5 }, crea: { stock: 2 } },
    compositions: { "store:COMBO": [{ productId: "whey", qty: 1 }, { productId: "crea", qty: 1 }] }
  });
  const ups = as.computeStoreUpdates(i, ["store:COMBO"]);
  assert.strictEqual(ups[0].stock, 2); // MIN(5,2)
});

test("venta en la tienda: baja SOLO el sabor vendido (unificado con ML)", () => {
  const i = makeInv({
    products: { van: { stock: 11 }, choc: { stock: 10 } },
    compositions: {
      "store:P1::Vainilla": [{ productId: "van", qty: 1 }],
      "store:P1::Chocolate": [{ productId: "choc", qty: 1 }],
      // La MISMA física alimenta una publicación de ML por variación
      "MLU9::V1": [{ productId: "choc", qty: 1 }]
    }
  });
  // Venta de 2 Chocolate en la tienda
  const items = [{ item: { id: "store:P1", variation_id: "Chocolate" }, quantity: 2 }];
  const r = inv.aplicarVenta(i, items);
  assert.deepStrictEqual(r.changedProducts, ["choc"]);
  assert.strictEqual(i.products.choc.stock, 8); // 10 - 2
  assert.strictEqual(i.products.van.stock, 11); // Vainilla intacto
  // Y el recálculo refleja el nuevo stock en la tienda Y en ML
  const ups = as.computeStoreUpdates(i, ["store:P1"]);
  const choc = ups.find((u) => u.sabor === "Chocolate");
  assert.strictEqual(choc.stock, 8);
  assert.strictEqual(inv.computeVariation(i, "MLU9", "V1"), 8); // ML también baja
});

test("listingsAfectadas: una venta de física devuelve claves ML y store juntas", () => {
  const i = makeInv({
    products: { choc: { stock: 10 } },
    compositions: {
      "store:P1::Chocolate": [{ productId: "choc", qty: 1 }],
      "MLU9::V1": [{ productId: "choc", qty: 1 }]
    }
  });
  const afectadas = inv.listingsAfectadas(i, ["choc"]);
  assert.ok(afectadas.indexOf("store:P1") !== -1);
  assert.ok(afectadas.indexOf("MLU9") !== -1);
  // El puente separa las de tienda
  assert.deepStrictEqual(afectadas.filter(as.isStoreKey), ["store:P1"]);
});

test("storeBaseKeys: enumera productos de tienda enlazados (dedup por base)", () => {
  const i = makeInv({
    compositions: {
      "store:P1::Vainilla": [{ productId: "van", qty: 1 }],
      "store:P1::Chocolate": [{ productId: "choc", qty: 1 }],
      "store:P2": [{ productId: "bcaa", qty: 1 }],
      "MLU9": [{ productId: "x", qty: 1 }]
    }
  });
  assert.deepStrictEqual(as.storeBaseKeys(i).sort(), ["store:P1", "store:P2"]);
});
