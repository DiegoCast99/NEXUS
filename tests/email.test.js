"use strict";
/* ============================================================
   Tests del MOTOR DE EMAIL (netlify/functions/_email.js)
   ------------------------------------------------------------
   Verifica el render de plantillas (escapado vs crudo), la tabla de ítems,
   la selección de plantilla por evento, el wrapper de marca y el payload de Brevo.
   Correr: node --test tests/email.test.js
   ============================================================ */
const test = require("node:test");
const assert = require("node:assert");
const E = require("../netlify/functions/_email.js");

test("esc: escapa HTML peligroso", () => {
  assert.strictEqual(E.esc('<b>"x"&\'</b>'), "&lt;b&gt;&quot;x&quot;&amp;&#39;&lt;/b&gt;");
});

test("render: {{var}} escapa, {{{var}}} es crudo, desconocidas → ''", () => {
  const out = E.render("Hola {{n}} · {{{h}}} · {{falta}}", { n: "<Ana>", h: "<b>ok</b>" });
  assert.strictEqual(out, "Hola &lt;Ana&gt; · <b>ok</b> · ");
});

test("render: nombre con inyección HTML queda neutralizado", () => {
  const out = E.render("{{cliente}}", { cliente: '<img src=x onerror=alert(1)>' });
  assert.ok(out.indexOf("<img") === -1, "no debe contener el tag crudo");
});

test("buildItemsHtml: arma filas con cantidad y subtotal", () => {
  const html = E.buildItemsHtml([{ nombre: "Whey", cantidad: 2, precio: 10, sabor: "Choco" }]);
  assert.ok(html.indexOf("Whey") !== -1);
  assert.ok(html.indexOf("Choco") !== -1);
  assert.ok(html.indexOf("× 2") !== -1);
  assert.ok(html.indexOf("$20.00") !== -1, "2 × $10 = $20.00");
});

test("buildItemsHtml: lista vacía → ''", () => {
  assert.strictEqual(E.buildItemsHtml([]), "");
  assert.strictEqual(E.buildItemsHtml(null), "");
});

test("pickTemplate: elige por evento y respeta activo:false", () => {
  const tpls = [
    { id: "venta", evento: "venta", activo: false },
    { id: "venta2", evento: "venta", activo: true }
  ];
  assert.strictEqual(E.pickTemplate(tpls, "venta").id, "venta2");
  assert.strictEqual(E.pickTemplate(tpls, "inexistente"), null);
});

test("renderTemplate: pre-renderiza items y arma asunto + wrapper de marca", () => {
  const tpl = { asunto: "Pedido {{numeroOrden}}", cuerpoHtml: "Hola {{cliente}} {{{items}}} Total {{total}}" };
  const r = E.renderTemplate(tpl, {
    numeroOrden: "AF-1", cliente: "Ana", total: "$20.00",
    items: [{ nombre: "Whey", cantidad: 1, precio: 20 }]
  });
  assert.strictEqual(r.subject, "Pedido AF-1");
  assert.ok(r.html.indexOf("ALPHA FITNESS") !== -1, "wrapper de marca");
  assert.ok(r.html.indexOf("Whey") !== -1, "items renderizados");
  assert.ok(r.html.indexOf("Total $20.00") !== -1);
});

test("DEFAULT_TEMPLATES: existen semillas 'venta' y 'envio' activas", () => {
  assert.ok(E.pickTemplate(E.DEFAULT_TEMPLATES, "venta"));
  assert.ok(E.pickTemplate(E.DEFAULT_TEMPLATES, "envio"));
});

test("brevoPayload: estructura correcta con y sin replyTo", () => {
  const p = E.brevoPayload({ senderName: "Alpha", senderEmail: "a@b.com", to: "c@d.com", toName: "Ana", subject: "S", html: "<p>H</p>", replyTo: "r@e.com" });
  assert.strictEqual(p.sender.email, "a@b.com");
  assert.strictEqual(p.to[0].email, "c@d.com");
  assert.strictEqual(p.subject, "S");
  assert.strictEqual(p.replyTo.email, "r@e.com");
  const p2 = E.brevoPayload({ senderEmail: "a@b.com", to: "c@d.com", subject: "S", html: "H" });
  assert.strictEqual(p2.replyTo, undefined);
  assert.strictEqual(p2.sender.name, "Alpha Fitness");
});
