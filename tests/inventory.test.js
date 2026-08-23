"use strict";
/* ============================================================
   Tests del MOTOR DE INVENTARIO (netlify/functions/_inventory.js)
   ------------------------------------------------------------
   Lógica que TOCA STOCK REAL (descuento por venta, cálculo de combos,
   merge al guardar). Sin dependencias: runner nativo de Node.
   Correr:  node --test tests/      (o: node --test tests/inventory.test.js)
   Nota: el frontend (js/dashboard/inventory.js) tiene un ESPEJO de computeComp;
   si cambia la fórmula acá, cambiarla allá también.
   ============================================================ */
const test = require("node:test");
const assert = require("node:assert");
const inv = require("../netlify/functions/_inventory.js");

function makeInv(o) {
  return inv.normalizeInv(Object.assign({ products: {}, compositions: {} }, o || {}));
}

test("computeComp: combo = MIN sobre floor(stock/qty) — whey5 + crea2 => 2", () => {
  const i = makeInv({ products: { whey: { stock: 5 }, crea: { stock: 2 } } });
  const comp = [{ productId: "whey", qty: 1 }, { productId: "crea", qty: 1 }];
  assert.strictEqual(inv.computeComp(i, comp), 2);
});

test("computeComp: floor cuando qty > 1 (5/2 => 2)", () => {
  const i = makeInv({ products: { crea: { stock: 5 } } });
  assert.strictEqual(inv.computeComp(i, [{ productId: "crea", qty: 2 }]), 2);
});

test("computeComp: producto inexistente => 0 (bloquea el combo)", () => {
  const i = makeInv({ products: { a: { stock: 10 } } });
  assert.strictEqual(inv.computeComp(i, [{ productId: "noexiste", qty: 1 }]), 0);
});

test("computeComp: qty negativa => 0; qty 0 o faltante se trata como 1 (default defensivo)", () => {
  const i = makeInv({ products: { a: { stock: 10 } } });
  assert.strictEqual(inv.computeComp(i, [{ productId: "a", qty: -1 }]), 0);  // negativa → guard
  assert.strictEqual(inv.computeComp(i, [{ productId: "a", qty: 0 }]), 10);  // 0 → se asume 1
  assert.strictEqual(inv.computeComp(i, [{ productId: "a" }]), 10);          // faltante → se asume 1
});

test("computeComp: composición vacía o nula => null (no gestionada)", () => {
  const i = makeInv({});
  assert.strictEqual(inv.computeComp(i, []), null);
  assert.strictEqual(inv.computeComp(i, null), null);
});

test("computeComp: nunca negativo", () => {
  const i = makeInv({ products: { a: { stock: 0 } } });
  assert.strictEqual(inv.computeComp(i, [{ productId: "a", qty: 1 }]), 0);
});

test("computeListing: publicación simple usa su composición", () => {
  const i = makeInv({
    products: { a: { stock: 7 } },
    compositions: { MLB1: [{ productId: "a", qty: 1 }] }
  });
  assert.strictEqual(inv.computeListing(i, "MLB1"), 7);
});

test("computeListing: con variaciones = SUMA de las variaciones", () => {
  const i = makeInv({
    products: { a: { stock: 4 }, b: { stock: 3 } },
    compositions: { "MLB1::10": [{ productId: "a", qty: 1 }], "MLB1::20": [{ productId: "b", qty: 1 }] }
  });
  assert.strictEqual(inv.computeListing(i, "MLB1"), 7);
});

test("compFor/computeVariation: la variación usa su comp; si no tiene, cae al de la publicación", () => {
  const i = makeInv({
    products: { a: { stock: 1 }, b: { stock: 9 } },
    compositions: { "MLB1": [{ productId: "b", qty: 1 }], "MLB1::10": [{ productId: "a", qty: 1 }] }
  });
  assert.strictEqual(inv.computeVariation(i, "MLB1", "10"), 1); // usa la específica
  assert.strictEqual(inv.computeVariation(i, "MLB1", "99"), 9); // fallback a la publicación
});

test("aplicarVenta: descuenta qtySold * qty por componente (usando la variación vendida)", () => {
  const i = makeInv({
    products: { whey: { stock: 10 }, crea: { stock: 10 } },
    compositions: { "MLB1::10": [{ productId: "whey", qty: 2 }, { productId: "crea", qty: 1 }] }
  });
  const r = inv.aplicarVenta(i, [{ item: { id: "MLB1", variation_id: "10" }, quantity: 3 }]);
  assert.strictEqual(i.products.whey.stock, 4); // 10 - 3*2
  assert.strictEqual(i.products.crea.stock, 7); // 10 - 3*1
  assert.deepStrictEqual(r.changedProducts.sort(), ["crea", "whey"]);
});

test("aplicarVenta: nunca deja stock negativo", () => {
  const i = makeInv({ products: { a: { stock: 1 } }, compositions: { MLB1: [{ productId: "a", qty: 1 }] } });
  inv.aplicarVenta(i, [{ item: { id: "MLB1" }, quantity: 5 }]);
  assert.strictEqual(i.products.a.stock, 0);
});

test("aplicarVenta: ignora publicaciones no gestionadas (sin composición)", () => {
  const i = makeInv({ products: { a: { stock: 5 } }, compositions: {} });
  const r = inv.aplicarVenta(i, [{ item: { id: "MLBX" }, quantity: 2 }]);
  assert.strictEqual(i.products.a.stock, 5);
  assert.deepStrictEqual(r.changedProducts, []);
});

test("mergeProducts: producto nuevo (sin baseStock) gana el navegador", () => {
  const out = inv.mergeProducts({}, { a: { stock: 8, name: "X" } });
  assert.strictEqual(out.a.stock, 8);
});

test("mergeProducts: sin editar (stock===baseStock) PRESERVA el servidor (descuento por venta)", () => {
  const server = { a: { stock: 6 } };                              // el webhook descontó a 6
  const browser = { a: { stock: 10, baseStock: 10, name: "X" } };  // el panel tenía 10 y NO lo tocó
  assert.strictEqual(inv.mergeProducts(server, browser).a.stock, 6);
});

test("mergeProducts: editado (stock!==baseStock) gana el navegador", () => {
  const server = { a: { stock: 6 } };
  const browser = { a: { stock: 20, baseStock: 10, name: "X" } };  // el usuario lo subió a 20
  assert.strictEqual(inv.mergeProducts(server, browser).a.stock, 20);
});

test("mergeProducts: preserva el costo (COGS) que manda el navegador", () => {
  const out = inv.mergeProducts({ a: { stock: 6, cost: 100 } }, { a: { stock: 10, baseStock: 10, name: "X", cost: 120 } });
  assert.strictEqual(out.a.stock, 6);   // stock: gana el servidor (sin editar)
  assert.strictEqual(out.a.cost, 120);  // costo: gana el navegador (lo maneja el titular)
});

test("mergeProducts: preserva el COSTO (COGS) del navegador", () => {
  const out = inv.mergeProducts({ a: { stock: 6 } }, { a: { stock: 10, baseStock: 10, name: "X", cost: 250 } });
  assert.strictEqual(out.a.cost, 250);   // el costo lo maneja el navegador
  assert.strictEqual(out.a.stock, 6);    // el stock igual preserva el servidor
});

test("mergeProducts: productos ausentes del navegador se consideran borrados", () => {
  const out = inv.mergeProducts({ a: { stock: 5 }, b: { stock: 3 } }, { a: { stock: 5, baseStock: 5 } });
  assert.ok(out.a);
  assert.strictEqual(out.b, undefined);
});

test("listingsAfectadas: devuelve mlbId base que usan el producto (incluye variaciones)", () => {
  const i = makeInv({
    compositions: {
      "MLB1": [{ productId: "a", qty: 1 }],
      "MLB2::7": [{ productId: "a", qty: 1 }],
      "MLB3": [{ productId: "b", qty: 1 }]
    }
  });
  assert.deepStrictEqual(inv.listingsAfectadas(i, ["a"]).sort(), ["MLB1", "MLB2"]);
});
