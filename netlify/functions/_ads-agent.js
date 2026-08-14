/* ============================================================
   NEXUS · _ads-agent.js — Motor del agente publicitario (node)
   ------------------------------------------------------------
   ESPEJO EXACTO de computePlan de js/dashboard/ads-agent.js
   (misma matematica de pacing y recomendaciones). Si tocas una,
   toca la otra. Sin DOM, sin red: testeable y reusable por el
   autopilot server-side. Zero-dep.

   Objetivo: MAXIMIZAR VENTAS usando todo el techo mensual sin
   pasarse. Recomienda pausar campañas que gastan sin vender,
   escalar las que rinden con margen, y ajustar presupuestos.
   ============================================================ */

function esActiva(status) {
  var s = String(status || "").toLowerCase();
  return s === "active" || s === "enabled";
}

// campaigns: [{ id, name, status, budget(diario), gasto, ingresos, roas, ... }]
// opts: { monthlyCap, spentMTD, now(Date), minDaily, maxStepPct }
//   maxStepPct: paso maximo de cambio de presupuesto por corrida (0.5 = ±50%).
function computePlan(campaigns, opts) {
  campaigns = campaigns || [];
  opts = opts || {};
  var now = opts.now || new Date();
  var daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  var dayOfMonth = now.getDate();
  var daysLeft = Math.max(1, daysInMonth - dayOfMonth + 1);
  var cap = Number(opts.monthlyCap) || 0;
  var spent = Math.max(0, Number(opts.spentMTD) || 0);
  var remaining = Math.max(0, cap - spent);
  var minD = Number(opts.minDaily) || 0;
  var stepPct = opts.maxStepPct != null ? Number(opts.maxStepPct) : 0.5;

  var active = campaigns.filter(function (c) { return esActiva(c.status); });
  var currentDailyTotal = active.reduce(function (a, c) { return a + (Number(c.budget) || 0); }, 0);
  var targetDailyTotal = remaining / daysLeft;
  var projectedMonthly = spent + currentDailyTotal * daysLeft;

  var status;
  if (cap <= 0) status = "sincap";
  else if (spent >= cap) status = "capped";
  else if (projectedMonthly > cap * 1.05) status = "over";
  else if (projectedMonthly < cap * 0.9) status = "under";
  else status = "on";

  var pacing = {
    cap: cap, spent: spent, remaining: remaining,
    daysInMonth: daysInMonth, dayOfMonth: dayOfMonth, daysLeft: daysLeft,
    currentDailyTotal: currentDailyTotal, targetDailyTotal: targetDailyTotal,
    projectedMonthly: projectedMonthly, status: status, activeCount: active.length
  };

  var recs = [];
  function rec(o) { o.id = o.type + ":" + o.campaignId; recs.push(o); }

  if (status === "capped" && active.length) {
    active.forEach(function (c) {
      rec({ type: "pause_cap", campaignId: c.id, campaignName: c.name, patch: { status: "paused" },
        severity: "danger", title: "Pausar (techo alcanzado)",
        reason: "Ya se gasto el techo mensual. Pausar para no seguir gastando este mes." });
    });
    return { pacing: pacing, recs: recs };
  }

  var umbralGasto = Math.max(minD * 3, currentDailyTotal * 0.03, 1);
  var pausar = {};
  active.forEach(function (c) {
    var gasto = Number(c.gasto) || 0, roas = Number(c.roas) || 0, ingresos = Number(c.ingresos) || 0;
    if (gasto >= umbralGasto && ingresos <= 0) {
      pausar[c.id] = 1;
      rec({ type: "pause_loser", campaignId: c.id, campaignName: c.name, patch: { status: "paused" },
        severity: "danger", title: "Pausar (gasta sin vender)",
        reason: "Gasto sin ninguna venta atribuida en 30 dias." });
    } else if (gasto >= umbralGasto && roas > 0 && roas < 1) {
      pausar[c.id] = 1;
      rec({ type: "pause_low", campaignId: c.id, campaignName: c.name, patch: { status: "paused" },
        severity: "warn", title: "Pausar (pierde plata)",
        reason: "ROAS " + roas.toFixed(1) + ": gasta mas de lo que vende." });
    }
  });

  var siguen = active.filter(function (c) { return !pausar[c.id]; });
  if (cap > 0 && siguen.length) {
    var score = function (c) { var r = Number(c.roas) || 0; return r > 0 ? r : (Number(c.gasto) ? (Number(c.ingresos) || 0) / c.gasto : 0.2); };
    var totalScore = siguen.reduce(function (a, c) { return a + Math.max(0.15, score(c)); }, 0) || 1;
    siguen.forEach(function (c) {
      var cur = Number(c.budget) || 0;
      var w = Math.max(0.15, score(c)) / totalScore;
      var ideal = targetDailyTotal * w;
      var lo = cur > 0 ? cur * (1 - stepPct) : ideal;
      var hi = cur > 0 ? cur * (1 + stepPct) : ideal;
      var nuevo = Math.min(hi, Math.max(lo, ideal));
      if (minD) nuevo = Math.max(minD, nuevo);
      nuevo = Math.round(nuevo);
      if (nuevo <= 0) return;
      var cambioRel = cur > 0 ? Math.abs(nuevo - cur) / cur : 1;
      if (cambioRel < 0.1) return;
      var subir = nuevo > cur;
      rec({ type: "budget", campaignId: c.id, campaignName: c.name, patch: { budget: nuevo },
        severity: subir ? "good" : "info", title: subir ? "Subir presupuesto" : "Bajar presupuesto",
        fromBudget: cur, toBudget: nuevo,
        reason: subir ? "Rinde bien y hay margen en el techo: escalar capta mas ventas." : "Bajar para no pasarse del techo mensual." });
    });
  }

  var peso = { pause_cap: 0, pause_loser: 1, pause_low: 2, budget: 3 };
  recs.sort(function (a, b) {
    var pa = peso[a.type], pb = peso[b.type];
    if (pa !== pb) return pa - pb;
    return (a.severity === "good" ? 0 : 1) - (b.severity === "good" ? 0 : 1);
  });
  return { pacing: pacing, recs: recs };
}

// Guardarraíl final de seguridad para el modo autonomo: garantiza que la suma
// de presupuestos diarios que quedaran ACTIVOS no supere el objetivo diario del
// techo (con 10% de colchon). Si lo supera, escala las subidas hacia abajo.
// Nunca deja que el autopilot se pase del techo mensual.
function aplicarGuardarrailTecho(plan) {
  var target = plan.pacing.targetDailyTotal;
  if (!(target > 0)) return plan;
  var pausadas = {};
  plan.recs.forEach(function (r) { if (r.patch && r.patch.status === "paused") pausadas[r.campaignId] = 1; });
  var budgetRecs = plan.recs.filter(function (r) { return r.patch && r.patch.budget != null && !pausadas[r.campaignId]; });
  var sumaNuevos = budgetRecs.reduce(function (a, r) { return a + (Number(r.patch.budget) || 0); }, 0);
  var techo = target * 1.1;
  if (sumaNuevos > techo && sumaNuevos > 0) {
    var factor = techo / sumaNuevos;
    budgetRecs.forEach(function (r) {
      var v = Math.max(1, Math.round((Number(r.patch.budget) || 0) * factor));
      r.patch.budget = v; r.toBudget = v; r.clamped = true;
    });
  }
  return plan;
}

module.exports = { computePlan: computePlan, aplicarGuardarrailTecho: aplicarGuardarrailTecho, esActiva: esActiva };
