"use strict";
/* ============================================================
   Tests del MOTOR DEL AGENTE PUBLICITARIO (netlify/functions/_ads-agent.js)
   ------------------------------------------------------------
   Lógica que MUEVE PLATA (pausar/escalar campañas, guardarraíl del techo).
   Sin dependencias: runner nativo de Node.
   Correr:  node --test tests/   (o: node --test tests/ads-agent.test.js)
   Nota: js/dashboard/ads-agent.js tiene un ESPEJO EXACTO de computePlan;
   si cambia la matemática acá, cambiarla allá también.
   ============================================================ */
const test = require("node:test");
const assert = require("node:assert");
const ads = require("../netlify/functions/_ads-agent.js");

// `now` fijo para pacing determinista: 1-ago-2026 → daysInMonth 31, daysLeft 31.
const NOW = new Date(2026, 7, 1);

test("computePlan: techo alcanzado (spent>=cap) => pausar TODAS las activas (y solo esas)", () => {
  const camps = [
    { id: "c1", name: "A", status: "active", budget: 100 },
    { id: "c2", name: "B", status: "paused", budget: 100 }
  ];
  const plan = ads.computePlan(camps, { monthlyCap: 100, spentMTD: 120, now: NOW });
  assert.strictEqual(plan.pacing.status, "capped");
  const pauses = plan.recs.filter((r) => r.patch.status === "paused");
  assert.strictEqual(pauses.length, 1);
  assert.strictEqual(pauses[0].campaignId, "c1");
  assert.strictEqual(pauses[0].type, "pause_cap");
});

test("computePlan: campaña que gasta sin vender => pause_loser", () => {
  const camps = [{ id: "c1", name: "A", status: "active", budget: 500, gasto: 50, ingresos: 0, roas: 0 }];
  const plan = ads.computePlan(camps, { monthlyCap: 100000, spentMTD: 0, now: NOW });
  const r = plan.recs.find((x) => x.campaignId === "c1");
  assert.ok(r, "debería recomendar algo");
  assert.strictEqual(r.type, "pause_loser");
  assert.strictEqual(r.patch.status, "paused");
});

test("computePlan: ROAS<1 (pierde plata) => pause_low", () => {
  const camps = [{ id: "c1", name: "A", status: "active", budget: 500, gasto: 50, ingresos: 25, roas: 0.5 }];
  const plan = ads.computePlan(camps, { monthlyCap: 100000, spentMTD: 0, now: NOW });
  const r = plan.recs.find((x) => x.campaignId === "c1");
  assert.ok(r);
  assert.strictEqual(r.type, "pause_low");
});

test("computePlan: campaña sana (ROAS alto, con ventas) NO se pausa", () => {
  const camps = [{ id: "c1", name: "A", status: "active", budget: 500, gasto: 50, ingresos: 200, roas: 4 }];
  const plan = ads.computePlan(camps, { monthlyCap: 100000, spentMTD: 0, now: NOW });
  const pausada = plan.recs.some((r) => r.campaignId === "c1" && r.patch.status === "paused");
  assert.strictEqual(pausada, false);
});

test("computePlan: pacing calcula daysLeft, remaining y objetivo diario", () => {
  const plan = ads.computePlan([], { monthlyCap: 3100, spentMTD: 0, now: NOW });
  assert.strictEqual(plan.pacing.daysLeft, 31);
  assert.strictEqual(plan.pacing.remaining, 3100);
  assert.strictEqual(Math.round(plan.pacing.targetDailyTotal), 100); // 3100/31
});

test("computePlan: sin techo (cap<=0) => status sincap y sin recomendaciones de presupuesto", () => {
  const plan = ads.computePlan([{ id: "c1", status: "active", budget: 10 }], { monthlyCap: 0, spentMTD: 0, now: NOW });
  assert.strictEqual(plan.pacing.status, "sincap");
  assert.strictEqual(plan.recs.filter((r) => r.patch.budget != null).length, 0);
});

test("aplicarGuardarrailTecho: la suma de presupuestos activos NUNCA supera el objetivo diario (target*1.1)", () => {
  const plan = {
    pacing: { targetDailyTotal: 100 },
    recs: [
      { campaignId: "c1", patch: { budget: 200 } },
      { campaignId: "c2", patch: { budget: 200 } }
    ]
  };
  ads.aplicarGuardarrailTecho(plan);
  const suma = plan.recs.reduce((a, r) => a + (r.patch.budget || 0), 0);
  assert.ok(suma <= Math.ceil(100 * 1.1) + 1, "suma=" + suma + " no debe superar el techo diario");
  assert.ok(plan.recs.every((r) => r.clamped), "los presupuestos deben quedar marcados como clamped");
});

test("aplicarGuardarrailTecho: no cuenta el presupuesto de una campaña que se va a pausar", () => {
  const plan = {
    pacing: { targetDailyTotal: 100 },
    recs: [
      { campaignId: "c1", patch: { status: "paused" } },
      { campaignId: "c1", patch: { budget: 500 } } // misma campaña pausada → se ignora
    ]
  };
  ads.aplicarGuardarrailTecho(plan);
  const budgetRec = plan.recs.find((r) => r.patch.budget != null);
  assert.strictEqual(budgetRec.patch.budget, 500); // no se clampa
});

test("esActiva: active/enabled => true; resto => false", () => {
  assert.strictEqual(ads.esActiva("active"), true);
  assert.strictEqual(ads.esActiva("enabled"), true);
  assert.strictEqual(ads.esActiva("paused"), false);
  assert.strictEqual(ads.esActiva(""), false);
});
