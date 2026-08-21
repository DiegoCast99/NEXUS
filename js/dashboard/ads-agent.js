/* ============================================================
   NEXUS Dashboard · Agente publicitario de Mercado Ads
   ------------------------------------------------------------
   Objetivo: MAXIMIZAR VENTAS respetando un TECHO DE GASTO MENSUAL
   que carga el titular. El agente:
     - "pacing": reparte el techo mensual en presupuesto diario
       segun los dias que quedan (para usar todo el techo, no pasarse).
     - recomienda pausar campañas que gastan sin vender, escalar las
       que rinden y tienen margen, y ajustar presupuestos al techo.
     - Nivel 1 (analisis) + Nivel 2 (aplicar con un click, con
       confirmacion). Nivel 3 (piloto automatico) queda cableado
       pero APAGADO hasta validar las reglas.

   Motor puro (computePlan) separado del render, para poder
   reusarlo en el futuro job server-side (Nivel 3) sin tocar la UI.
   Parte de window.NexusDash.
   ============================================================ */
(function () {
  const S = window.NexusDash;
  if (!S) return;

  var CFG_KEY = "nexus.ads.agent.v1";
  var mtdPedido = {}; // cuenta -> true (para no re-pedir el MTD en loop)

  function el(id) { return document.getElementById(id); }
  function esc(s) { try { return S.escapeHtml(String(s == null ? "" : s)); } catch (e) { return String(s == null ? "" : s); } }
  function money(n) {
    n = Number(n) || 0;
    try { return S.moneyWithCents.format(n); } catch (e) { try { return S.currency(n); } catch (e2) { return "$" + Math.round(n); } }
  }
  function activeCuenta() { try { return S.activeMLId ? S.activeMLId() : (S.state.commerce.selectedApp || "mercadolibre"); } catch (e) { return "mercadolibre"; } }
  function esActiva(status) { var s = String(status || "").toLowerCase(); return s === "active" || s === "enabled"; }

  // ---- Config por cuenta (techo mensual, piloto, log) ----
  function readCfgAll() { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (e) { return {}; } }
  function cfgFor(cuenta) {
    var all = readCfgAll();
    return all[cuenta] || { monthlyCap: 0, autopilot: false, log: [] };
  }
  function saveCfg(cuenta, cfg) {
    var all = readCfgAll();
    all[cuenta] = cfg;
    try { S.safeSetItem(CFG_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function logAction(cuenta, entry) {
    var cfg = cfgFor(cuenta);
    cfg.log = (cfg.log || []).slice(0, 40);
    cfg.log.unshift(entry);
    saveCfg(cuenta, cfg);
  }

  // ============================================================
  // MOTOR PURO — dado campañas + techo + gasto del mes, calcula
  // pacing y recomendaciones. Sin DOM, sin red: testeable/reusable.
  // ============================================================
  function computePlan(campaigns, opts) {
    campaigns = campaigns || [];
    var now = opts.now || new Date();
    var daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    var dayOfMonth = now.getDate();
    var daysLeft = Math.max(1, daysInMonth - dayOfMonth + 1);
    var cap = Number(opts.monthlyCap) || 0;
    var spent = Math.max(0, Number(opts.spentMTD) || 0);
    var remaining = Math.max(0, cap - spent);
    var minD = Number(opts.minDaily) || 0;

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

    // Sin techo cargado: no hay pacing, solo señales de eficiencia.
    // 1) Techo alcanzado -> pausar todo lo activo.
    if (status === "capped" && active.length) {
      active.forEach(function (c) {
        rec({ type: "pause_cap", campaignId: c.id, campaignName: c.name, patch: { status: "paused" },
          severity: "danger", title: "Pausar (techo alcanzado)",
          reason: "Ya gastaste el techo mensual (" + money(cap) + "). Pausá para no seguir gastando este mes." });
      });
      return { pacing: pacing, recs: recs };
    }

    // 2) Pausar perdedoras: gasto real, cero ventas (o ROAS < 1).
    var umbralGasto = Math.max(minD * 3, currentDailyTotal * 0.03, 1);
    var pausar = {};
    active.forEach(function (c) {
      var gasto = Number(c.gasto) || 0, roas = Number(c.roas) || 0, ingresos = Number(c.ingresos) || 0;
      if (gasto >= umbralGasto && ingresos <= 0) {
        pausar[c.id] = 1;
        rec({ type: "pause_loser", campaignId: c.id, campaignName: c.name, patch: { status: "paused" },
          severity: "danger", title: "Pausar (gasta sin vender)",
          reason: "Gastó " + money(gasto) + " en 30 días sin ninguna venta atribuida. Libera ese presupuesto para las que sí venden." });
      } else if (gasto >= umbralGasto && roas > 0 && roas < 1) {
        pausar[c.id] = 1;
        rec({ type: "pause_low", campaignId: c.id, campaignName: c.name, patch: { status: "paused" },
          severity: "warn", title: "Pausar (pierde plata)",
          reason: "ROAS " + roas.toFixed(1) + ": gastás más de lo que te devuelve en ventas. Conviene pausar o rearmar." });
      }
    });

    // 3) Pacing + escalado: repartir el techo diario entre las que siguen,
    //    ponderado por rendimiento (mejor ROAS -> más presupuesto).
    var siguen = active.filter(function (c) { return !pausar[c.id]; });
    if (cap > 0 && siguen.length) {
      function score(c) { var r = Number(c.roas) || 0; return r > 0 ? r : (Number(c.gasto) ? (Number(c.ingresos) || 0) / c.gasto : 0.2); }
      var totalScore = siguen.reduce(function (a, c) { return a + Math.max(0.15, score(c)); }, 0) || 1;
      siguen.forEach(function (c) {
        var cur = Number(c.budget) || 0;
        var w = Math.max(0.15, score(c)) / totalScore;
        var ideal = targetDailyTotal * w;
        // Paso máximo por corrida: ±50% (seguridad). Piso configurable.
        var lo = cur > 0 ? cur * 0.5 : ideal;
        var hi = cur > 0 ? cur * 1.5 : ideal;
        var nuevo = Math.min(hi, Math.max(lo, ideal));
        if (minD) nuevo = Math.max(minD, nuevo);
        nuevo = Math.round(nuevo);
        if (nuevo <= 0) return;
        var cambioRel = cur > 0 ? Math.abs(nuevo - cur) / cur : 1;
        if (cambioRel < 0.1) return; // ignorar micro-ajustes
        var subir = nuevo > cur;
        var motivo;
        if (subir && (status === "under" || status === "on")) {
          motivo = "Rinde bien (ROAS " + (Number(c.roas) || 0).toFixed(1) + ") y hay margen en el techo. Subir el presupuesto diario capta más ventas.";
        } else if (!subir) {
          motivo = "Bajar el presupuesto diario para no pasarte del techo mensual (" + money(cap) + ").";
        } else {
          motivo = "Reasignar presupuesto hacia lo que mejor rinde.";
        }
        rec({ type: "budget", campaignId: c.id, campaignName: c.name, patch: { budget: nuevo },
          severity: subir ? "good" : "info", title: (subir ? "Subir presupuesto" : "Bajar presupuesto"),
          fromBudget: cur, toBudget: nuevo, reason: motivo });
      });
    }

    // Orden: primero lo crítico (pausar), después escalar, después bajar.
    var peso = { pause_cap: 0, pause_loser: 1, pause_low: 2, budget: 3 };
    recs.sort(function (a, b) {
      var pa = peso[a.type], pb = peso[b.type];
      if (pa !== pb) return pa - pb;
      // dentro de budget: subidas (good) antes que bajadas
      return (a.severity === "good" ? 0 : 1) - (b.severity === "good" ? 0 : 1);
    });
    return { pacing: pacing, recs: recs };
  }

  // ============================================================
  // Datos + render
  // ============================================================
  function campaignsFor(cuenta) {
    try { var d = S.adsDatos(cuenta); return (d && d.campaigns) || []; } catch (e) { return []; }
  }
  function spentMTDFor(cuenta) {
    try {
      var d = S.adsDatos(cuenta);
      if (d && typeof d.spentMTD === "number") return { value: d.spentMTD, estimado: false };
      // Estimación mientras carga el real: gasto 30d prorrateado a los días transcurridos.
      var g30 = d && d.totals ? Number(d.totals.gasto) || 0 : 0;
      var dom = new Date().getDate();
      return { value: (g30 / 30) * dom, estimado: true };
    } catch (e) { return { value: 0, estimado: true }; }
  }

  function pacingBadge(status) {
    var map = {
      on: ["on", "En ritmo"], under: ["under", "Por debajo del techo"], over: ["over", "Te vas a pasar"],
      capped: ["capped", "Techo alcanzado"], sincap: ["sincap", "Sin techo cargado"]
    };
    var m = map[status] || map.sincap;
    return '<span class="agent-badge ' + m[0] + '">' + m[1] + "</span>";
  }

  function renderAdsAgent() {
    var box = el("adsAgente");
    if (!box) return;
    var cuenta = activeCuenta();
    var cfg = cfgFor(cuenta);
    var camps = campaignsFor(cuenta);
    var mtd = spentMTDFor(cuenta);
    var plan = computePlan(camps, { monthlyCap: cfg.monthlyCap, spentMTD: mtd.value, now: new Date() });
    var p = plan.pacing;

    // Traer el gasto real del mes en 2do plano (una vez por apertura).
    if (S.cargarAdsMTD && !mtdPedido[cuenta] && camps.length) {
      mtdPedido[cuenta] = true;
      Promise.resolve(S.cargarAdsMTD(cuenta)).then(function (v) { if (v != null) renderAdsAgent(); }).catch(function () {});
    }

    var pctTecho = p.cap > 0 ? Math.min(100, Math.round((p.spent / p.cap) * 100)) : 0;

    var html = "";

    // --- Config: objetivo + techo mensual ---
    html += '<div class="agent-card agent-setup">' +
      '<div class="agent-setup-obj"><span class="agent-eyebrow">Objetivo</span><b>Maximizar ventas</b>' +
      '<small>El agente usa todo tu techo en las campañas que mejor venden y frena las que gastan al pedo.</small></div>' +
      '<label class="field agent-cap-field"><span>Techo de gasto mensual <em style="font-style:normal;font-weight:600;color:#ff8a5c">· en pesos ($)</em></span>' +
      '<span style="position:relative;display:block">' +
      '<span aria-hidden="true" style="position:absolute;left:13px;top:50%;transform:translateY(-50%);color:rgba(244,244,246,0.62);font-weight:600;pointer-events:none">$</span>' +
      '<input id="agentCapInput" type="text" inputmode="decimal" placeholder="30.000" value="' + (cfg.monthlyCap ? cfg.monthlyCap : "") + '" autocomplete="off" style="padding-left:28px" /></span>' +
      '<small style="display:block;margin-top:6px;color:rgba(244,244,246,0.5);font-size:11px">Es en pesos uruguayos (UYU), no en dólares.</small></label>' +
      '<button class="primary-button" type="button" id="agentCapSave">Guardar techo</button>' +
      '</div>';

    if (!p.cap) {
      html += '<div class="agent-empty">Cargá tu <b>techo de gasto mensual en pesos</b> arriba y el agente te arma el plan: cuánto poner por día, qué campañas escalar y cuáles frenar para vender lo máximo posible sin pasarte.</div>';
      box.innerHTML = html;
      return;
    }

    // --- Pacing ---
    html += '<div class="agent-card agent-pacing">' +
      '<div class="agent-pacing-head"><div><span class="agent-eyebrow">Este mes</span><h3>Ritmo de gasto</h3></div>' + pacingBadge(p.status) + '</div>' +
      '<div class="agent-pacing-bar"><i style="width:' + pctTecho + '%"></i></div>' +
      '<div class="agent-pacing-grid">' +
      pacingItem("Techo mensual", money(p.cap)) +
      pacingItem("Gastado" + (mtd.estimado ? " (est.)" : ""), money(p.spent)) +
      pacingItem("Disponible", money(p.remaining)) +
      pacingItem("Días restantes", String(p.daysLeft)) +
      pacingItem("Presupuesto diario sugerido", money(p.targetDailyTotal), "hi") +
      pacingItem("Diario actual", money(p.currentDailyTotal)) +
      '</div>' +
      '<p class="agent-pacing-note">' + pacingNote(p) + '</p>' +
      '</div>';

    // --- Recomendaciones ---
    html += '<div class="agent-card agent-recs">' +
      '<div class="agent-recs-head"><div><span class="agent-eyebrow">Plan de accion</span><h3>Recomendaciones</h3></div>';
    if (plan.recs.length) html += '<button class="primary-button" type="button" id="agentApplyAll">Aplicar todo (' + plan.recs.length + ')</button>';
    html += '</div>';

    if (!camps.length) {
      html += '<div class="agent-empty">No hay campañas cargadas todavía. Entrá a <b>Campañas</b> y actualizá para que el agente pueda analizarlas.</div>';
    } else if (!plan.recs.length) {
      html += '<div class="agent-ok"><span class="agent-ok-dot"></span><div><b>Todo en orden</b><small>El agente no ve cambios necesarios ahora mismo: el gasto va en ritmo y no hay campañas quemando presupuesto.</small></div></div>';
    } else {
      html += '<div class="agent-rec-list">' + plan.recs.map(recRow).join("") + "</div>";
    }
    html += "</div>";

    // --- Nivel 3: piloto automático ---
    html += renderAutopilot(cuenta, cfg);

    // --- Historial ---
    if (cfg.log && cfg.log.length) {
      html += '<div class="agent-card agent-log"><span class="agent-eyebrow">Historial</span><div class="agent-log-list">' +
        cfg.log.slice(0, 8).map(function (l) {
          return '<div class="agent-log-item"><b>' + esc(l.title) + '</b><small>' + esc(l.name) + (l.when ? " · " + esc(l.when) : "") + '</small></div>';
        }).join("") + '</div></div>';
    }

    box.innerHTML = html;
  }

  function pacingItem(label, value, cls) {
    return '<div class="agent-pi ' + (cls || "") + '"><span>' + esc(label) + '</span><b>' + value + '</b></div>';
  }
  function pacingNote(p) {
    if (p.status === "over") return "Al ritmo actual vas a gastar " + money(p.projectedMonthly) + " este mes y tu techo es " + money(p.cap) + ". El agente propone bajar presupuestos para no pasarte.";
    if (p.status === "under") return "Vas a usar solo " + money(p.projectedMonthly) + " de tu techo de " + money(p.cap) + ". Hay margen para escalar lo que vende y captar más ventas.";
    if (p.status === "capped") return "Alcanzaste el techo del mes. El agente propone pausar hasta que arranque el mes que viene.";
    return "Vas en ritmo para usar tu techo de " + money(p.cap) + " sin pasarte.";
  }
  function recRow(r) {
    var extra = "";
    if (r.type === "budget") extra = '<span class="agent-rec-delta">' + money(r.fromBudget) + ' <em>&rarr;</em> ' + money(r.toBudget) + " / día</span>";
    return '<div class="agent-rec sev-' + esc(r.severity) + '" data-rec="' + esc(r.id) + '">' +
      '<span class="agent-rec-ic"></span>' +
      '<div class="agent-rec-main"><b>' + esc(r.title) + '</b>' +
      '<span class="agent-rec-camp">' + esc(r.campaignName || r.campaignId) + '</span>' +
      '<small>' + esc(r.reason) + '</small>' + extra + '</div>' +
      '<button class="ghost-button agent-rec-apply" type="button" data-apply="' + esc(r.id) + '">Aplicar</button>' +
      '</div>';
  }

  // ============================================================
  // Aplicar (Nivel 2) — con confirmacion, reusa S.adsUpdateCampaign
  // ============================================================
  var lastPlan = null;
  function planActual() {
    var cuenta = activeCuenta();
    var cfg = cfgFor(cuenta);
    var mtd = spentMTDFor(cuenta);
    lastPlan = computePlan(campaignsFor(cuenta), { monthlyCap: cfg.monthlyCap, spentMTD: mtd.value, now: new Date() });
    return lastPlan;
  }
  function recById(id) {
    var pl = lastPlan || planActual();
    return (pl.recs || []).filter(function (r) { return r.id === id; })[0] || null;
  }
  async function aplicarRec(r, silencioso) {
    var cuenta = activeCuenta();
    if (!S.adsUpdateCampaign) throw new Error("Escritura no disponible");
    await S.adsUpdateCampaign(cuenta, r.campaignId, r.patch);
    logAction(cuenta, { title: r.title, name: r.campaignName, when: new Date().toLocaleDateString("es-UY", { day: "2-digit", month: "short" }) });
    if (!silencioso && S.cargarAds) { await S.cargarAds(cuenta); }
  }

  // Muestra el error REAL de Mercado Libre (ya no asumimos "solo lectura": el token
  // tiene ads:/read-write verificado). Un 401 acá suele ser un permiso a nivel de
  // cuenta de anunciante en Mercado Ads, no del token.
  function msgError(e) {
    var st = (e && (e.mlStatus || e.httpStatus)) || 0;
    var raw = (e && e.message) ? String(e.message) : "error";
    var base = raw + (st ? " (" + st + ")" : "");
    if (st === 401 || /permission to write/i.test(raw)) {
      return base + " — Mercado Libre rechazó la escritura. Tu token SÍ tiene permiso de publicidad, así que suele ser un permiso a nivel de cuenta de anunciante en Mercado Ads. Pasale este texto a soporte de Nexus.";
    }
    return base;
  }

  async function aplicarUno(id) {
    var r = recById(id);
    if (!r) return;
    if (!window.confirm("Aplicar en Mercado Libre: " + r.title + " — " + (r.campaignName || r.campaignId) + "?")) return;
    var btn = document.querySelector('[data-apply="' + CSS.escape(id) + '"]');
    if (btn) { btn.textContent = "Aplicando…"; btn.disabled = true; }
    try { await aplicarRec(r); renderAdsAgent(); }
    catch (e) { if (btn) { btn.textContent = "Reintentar"; btn.disabled = false; } window.alert("No se pudo aplicar: " + msgError(e)); }
  }
  async function aplicarTodo() {
    var pl = planActual();
    if (!pl.recs.length) return;
    if (!window.confirm("El agente va a aplicar " + pl.recs.length + " cambio(s) en tus campañas de Mercado Libre (pausar/ajustar presupuesto). ¿Confirmás?")) return;
    var btn = el("agentApplyAll");
    if (btn) { btn.textContent = "Aplicando…"; btn.disabled = true; }
    var ok = 0, err = 0, ultimoError = "";
    for (var i = 0; i < pl.recs.length; i++) {
      try { await aplicarRec(pl.recs[i], true); ok++; }
      catch (e) {
        err++;
        ultimoError = msgError(e);
      }
    }
    if (S.cargarAds) { try { await S.cargarAds(activeCuenta()); } catch (e) {} }
    renderAdsAgent();
    window.alert("Listo: " + ok + " aplicado(s)" + (err ? ", " + err + " con error" + (ultimoError ? ": " + ultimoError : ".") : "."));
  }

  function guardarTecho() {
    var cuenta = activeCuenta();
    var input = el("agentCapInput");
    if (!input) return;
    var val = Number(String(input.value || "").replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", "."));
    var cfg = cfgFor(cuenta);
    cfg.monthlyCap = Number.isFinite(val) && val > 0 ? Math.round(val) : 0;
    saveCfg(cuenta, cfg);
    mtdPedido[cuenta] = false; // re-pedir MTD
    renderAdsAgent();
  }

  // ============================================================
  // Nivel 3 · Piloto automatico (config server-side + simulacion)
  // ============================================================
  var autoStatus = {};   // cuenta -> { cfg, log, armed, offline } (del backend)
  var autoLoading = {};

  function autoAccCfg(cuenta) {
    var st = autoStatus[cuenta];
    var accs = (st && st.cfg && st.cfg.accounts) || {};
    return accs[cuenta] || null;
  }
  function loadAuto(cuenta) {
    if (autoLoading[cuenta] || autoStatus[cuenta]) return;
    if (!S.requireSecureApi) { autoStatus[cuenta] = { cfg: { accounts: {} }, log: [], offline: true }; return; }
    autoLoading[cuenta] = true;
    var api; try { api = S.requireSecureApi(); } catch (e) { autoStatus[cuenta] = { cfg: { accounts: {} }, log: [], offline: true }; autoLoading[cuenta] = false; return; }
    Promise.resolve(api.adsAgent("status")).then(function (r) {
      autoStatus[cuenta] = r && r.cfg ? r : { cfg: { accounts: {} }, log: [] };
      autoLoading[cuenta] = false; renderAdsAgent();
    }).catch(function () { autoStatus[cuenta] = { cfg: { accounts: {} }, log: [], offline: true }; autoLoading[cuenta] = false; });
  }

  function renderAutopilot(cuenta) {
    if (!autoStatus[cuenta]) loadAuto(cuenta);
    var st = autoStatus[cuenta];
    var acc = autoAccCfg(cuenta);
    var armed = !!(acc && acc.armed);
    var mode = (acc && acc.mode) || "sim";
    var maxChange = (acc && acc.maxChangePct) || 25;
    var minDaily = (acc && acc.minDaily != null && acc.minDaily !== 0) ? acc.minDaily : "";

    var h = '<div class="agent-card agent-auto">';
    h += '<div class="agent-auto-head"><div><span class="agent-eyebrow">Nivel 3</span><h3>Piloto automático</h3>' +
      '<small>El agente aplica estos ajustes <b>solo</b>, una vez por día, dentro de tu techo y tus límites. Arranca en <b>simulación</b> (registra lo que haría) hasta que lo pases a real.</small></div>' +
      '<button class="agent-toggle ' + (armed ? "is-on" : "is-off") + '" id="agentAutoToggle" type="button" role="switch" aria-checked="' + armed + '"><i></i></button></div>';

    if (st && st.offline) {
      h += '<div class="agent-auto-rules">El piloto se administra con tu sesión conectada. Entrá a Nexus logueado para armarlo.</div>';
    } else if (armed) {
      h += '<div class="agent-auto-body">';
      h += '<div class="agent-auto-row"><span class="agent-auto-lbl">Modo</span><div class="agent-seg">' +
        '<button type="button" data-auto-mode="sim" class="' + (mode === "sim" ? "is-active" : "") + '">Simulación</button>' +
        '<button type="button" data-auto-mode="real" class="' + (mode === "real" ? "is-active" : "") + '">Real</button></div></div>';
      h += '<p class="agent-auto-modenote">' + (mode === "real"
        ? "En modo <b>real</b> el piloto <b>aplica de verdad</b> los cambios en Mercado Libre, dentro de tu techo y límites."
        : "En <b>simulación</b> registra lo que haría cada día, sin tocar nada. Revisá el historial unos días antes de pasar a real.") + "</p>";
      h += '<div class="agent-auto-guards">' +
        '<label class="field"><span>Máx. cambio de presupuesto por corrida (%)</span><input id="agentMaxChange" type="text" inputmode="decimal" value="' + maxChange + '" /></label>' +
        '<label class="field"><span>Presupuesto diario mínimo por campaña</span><input id="agentMinDaily" type="text" inputmode="decimal" value="' + minDaily + '" placeholder="0" /></label>' +
        '<button class="ghost-button" type="button" id="agentGuardsSave">Guardar límites</button></div>';
      h += '<div class="agent-auto-actions"><button class="ghost-button" type="button" id="agentSimNow">Probar ahora (simulación)</button></div>';
      h += '<div id="agentSimResult"></div></div>';
    } else {
      h += '<div class="agent-auto-rules">Activá el interruptor para que el piloto administre esta cuenta a diario. Vas a poder elegir simulación o real, el máximo de cambio por corrida y el piso diario.</div>';
    }
    h += "</div>";

    if (st && st.log && st.log.length) {
      h += '<div class="agent-card agent-log"><span class="agent-eyebrow">Historial del piloto</span><div class="agent-log-list">' +
        st.log.slice(0, 6).map(function (run) {
          var n = (run.runs || []).reduce(function (a, x) { return a + (x.count || 0); }, 0);
          var fecha = ""; try { fecha = new Date(run.at).toLocaleString("es-UY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) {}
          var modo = (run.runs && run.runs[0] && run.runs[0].mode) || "sim";
          return '<div class="agent-log-item"><b>' + (n ? n + " ajuste(s)" : "sin cambios") + " · " + (modo === "real" ? "real" : "simulación") + '</b><small>' + esc(fecha) + (run.trigger === "manual" ? " · manual" : "") + "</small></div>";
        }).join("") + "</div></div>";
    }
    return h;
  }

  function saveAutoArm(cuenta, changes, armedOverride) {
    var st = autoStatus[cuenta] || (autoStatus[cuenta] = { cfg: { accounts: {} }, log: [] });
    st.cfg = st.cfg || { accounts: {} }; st.cfg.accounts = st.cfg.accounts || {};
    var prev = st.cfg.accounts[cuenta] || {};
    var cap = cfgFor(cuenta).monthlyCap || 0;
    var next = Object.assign({ armed: true, mode: "sim", maxChangePct: 25, minDaily: 0, monthlyCap: cap }, prev, changes);
    if (armedOverride === false) next.armed = false;
    if (armedOverride === true) next.armed = true;
    next.monthlyCap = cap;
    st.cfg.accounts[cuenta] = next;
    renderAdsAgent();
    if (!S.requireSecureApi) return;
    var api; try { api = S.requireSecureApi(); } catch (e) { return; }
    var action = next.armed ? "arm" : "disarm";
    Promise.resolve(api.adsAgent(action, { account: cuenta, monthlyCap: cap, mode: next.mode, maxChangePct: next.maxChangePct, minDaily: next.minDaily }))
      .then(function (r) { if (r && r.cfg) { st.cfg = r.cfg; } })
      .catch(function (e) { window.alert("No se pudo guardar el piloto: " + (e && e.message ? e.message : "error")); });
  }
  function toggleAuto(cuenta) {
    var acc = autoAccCfg(cuenta);
    var armed = !!(acc && acc.armed);
    if (!armed && !cfgFor(cuenta).monthlyCap) { window.alert("Primero cargá tu techo de gasto mensual arriba."); return; }
    saveAutoArm(cuenta, {}, !armed);
  }
  function setAutoMode(cuenta, mode) {
    if (mode === "real" && !window.confirm("Modo REAL: el piloto va a aplicar cambios de presupuesto y pausas en tus campañas de Mercado Libre, solo, todos los días, dentro de tu techo. ¿Confirmás?")) return;
    saveAutoArm(cuenta, { mode: mode });
  }
  function saveAutoGuards(cuenta) {
    var mc = parseFloat(String((el("agentMaxChange") || {}).value || "25").replace(",", ".")) || 25;
    var md = parseFloat(String((el("agentMinDaily") || {}).value || "0").replace(",", ".")) || 0;
    saveAutoArm(cuenta, { maxChangePct: Math.min(100, Math.max(1, mc)), minDaily: Math.max(0, md) });
  }
  function simNow(cuenta) {
    var acc = autoAccCfg(cuenta) || {};
    var mtd = spentMTDFor(cuenta);
    var plan = computePlan(campaignsFor(cuenta), {
      monthlyCap: cfgFor(cuenta).monthlyCap, spentMTD: mtd.value, now: new Date(),
      minDaily: Number(acc.minDaily) || 0, maxStepPct: (Number(acc.maxChangePct) || 25) / 100
    });
    var box = el("agentSimResult"); if (!box) return;
    if (!plan.recs.length) { box.innerHTML = '<div class="agent-sim-ok">El piloto no haría cambios hoy: todo va en ritmo.</div>'; return; }
    box.innerHTML = '<div class="agent-sim-head">El piloto haría hoy (' + plan.recs.length + "):</div>" +
      '<div class="agent-sim-list">' + plan.recs.map(function (r) {
        var d = r.type === "budget" ? (" · " + money(r.fromBudget) + " → " + money(r.toBudget) + "/día") : "";
        return '<div class="agent-sim-item sev-' + esc(r.severity) + '"><b>' + esc(r.title) + "</b> " + esc(r.campaignName) + d + "</div>";
      }).join("") + "</div>";
  }

  // ============================================================
  // Init / wiring
  // ============================================================
  function initAdsAgent() {
    if (initAdsAgent._done) return;
    initAdsAgent._done = true;

    // Tabs Campañas | Agente dentro del panel Publicidad.
    document.addEventListener("click", function (e) {
      var tab = e.target.closest("[data-ads-tab]");
      if (tab) {
        var name = tab.getAttribute("data-ads-tab");
        document.querySelectorAll("[data-ads-tab]").forEach(function (t) { t.classList.toggle("is-active", t === tab); });
        document.querySelectorAll("[data-ads-pane]").forEach(function (pane) {
          pane.classList.toggle("is-hidden", pane.getAttribute("data-ads-pane") !== name);
        });
        var panel = el("adsPanel");
        if (panel) panel.classList.toggle("ads-on-agente", name === "agente");
        if (name === "agente") renderAdsAgent();
        return;
      }
      // Guardar techo
      if (e.target.closest("#agentCapSave")) { guardarTecho(); return; }
      // Aplicar todo
      if (e.target.closest("#agentApplyAll")) { aplicarTodo(); return; }
      // Nivel 3 · piloto automatico
      if (e.target.closest("#agentAutoToggle")) { toggleAuto(activeCuenta()); return; }
      var md = e.target.closest("[data-auto-mode]");
      if (md) { setAutoMode(activeCuenta(), md.getAttribute("data-auto-mode")); return; }
      if (e.target.closest("#agentGuardsSave")) { saveAutoGuards(activeCuenta()); return; }
      if (e.target.closest("#agentSimNow")) { simNow(activeCuenta()); return; }
      // Aplicar una recomendacion
      var ap = e.target.closest("[data-apply]");
      if (ap) { aplicarUno(ap.getAttribute("data-apply")); return; }
    });

    // Enter en el input del techo = guardar.
    document.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target && e.target.id === "agentCapInput") { e.preventDefault(); guardarTecho(); }
    });

    // Cuando se abre la sección Publicidad, si el tab activo es Agente, refrescar.
    (window).addEventListener("nexus:section", function (ev) {
      var d = ev && ev.detail;
      if (d && d.module === "ecommerce" && d.section === "publicidad") {
        var agenteTab = document.querySelector('[data-ads-tab="agente"].is-active');
        if (agenteTab) setTimeout(renderAdsAgent, 60);
      }
    });
  }

  Object.assign(S, { renderAdsAgent: renderAdsAgent, initAdsAgent: initAdsAgent, computeAdsPlan: computePlan });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAdsAgent);
  else initAdsAgent();
})();
