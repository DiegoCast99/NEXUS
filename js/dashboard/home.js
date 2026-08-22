/* ============================================================
   NEXUS Dashboard · Home "Resumen general" (rediseño 2026-08)
   Réplica del mockup con datos REALES ya cacheados (snapshots de
   ML/Meta + finanzas). KPIs con delta real (periodo vs periodo
   anterior), gráfica de ventas, ventas por canal (dona + logos),
   negocios (con logos de marketplace), top productos, alertas,
   gastos del mes y rendimiento de campañas. Degrada con
   placeholders si aún no hay datos sincronizados.
   Parte de window.NexusDash — namespace compartido (sin build).
   ============================================================ */
(function () {
  const S = window.NexusDash;
  if (!S) return;

  // Arranca en 30 dias para mostrar datos reales al entrar (con "hoy" quedaba
  // todo en $0 si aun no habia ventas HOY, aunque hubiera del mes).
  var homePeriod = "30"; // "hoy" | "7" | "30"
  var invAlertsCache = null;

  function el(id) { return document.getElementById(id); }
  function esc(s) { try { return S.escapeHtml(String(s == null ? "" : s)); } catch (e) { return String(s == null ? "" : s); } }
  function cur(n) { try { return S.currency(Number(n) || 0); } catch (e) { return "$" + Math.round(Number(n) || 0); } }
  function curK(n) { n = Number(n) || 0; try { return "$" + S.compactNumber(n); } catch (e) { return cur(n); } }
  // Plataformas brasileras → sus ventas van en REALES (R$), no en pesos.
  function esBR(id) { return id === "mercadolivre" || id === "amazon" || id === "shopee"; }
  function curPlat(id, n) {
    n = Number(n) || 0;
    if (esBR(id)) { try { return "R$ " + Math.round(n).toLocaleString("pt-BR"); } catch (e) { return "R$ " + Math.round(n); } }
    return cur(n);
  }
  function intn(n) { try { return S.integerNumber(Number(n) || 0); } catch (e) { return String(Math.round(Number(n) || 0)); } }
  function fin(n) { try { return S.financeMoney(Number(n) || 0); } catch (e) { return String(Math.round(Number(n) || 0)); } }
  function logo(key, size) { try { return S.platformLogo ? S.platformLogo(key, size) : ""; } catch (e) { return ""; } }
  // Logo del negocio: usa la FOTO propia que cargó el titular (Configuración del
  // marketplace) si existe; si no, el logo de marca generado.
  function bizLogo(id, slug, size) {
    var url = S.marketplacePhoto ? S.marketplacePhoto(id) : "";
    if (url) {
      var r = Math.round(size * 0.26);
      return '<span class="pf-logo pf-photo" style="width:' + size + 'px;height:' + size + 'px;border-radius:' + r + 'px"><img src="' + esc(url) + '" alt="" onerror="this.style.display=\'none\'"/></span>';
    }
    return logo(slug, size);
  }

  // Rango personalizado (YYYY-MM-DD) cuando homePeriod === "custom".
  var homeCustomFrom = "", homeCustomTo = "";
  function periodLabel() {
    if (homePeriod === "custom" && homeCustomFrom && homeCustomTo) return homeCustomFrom + " → " + homeCustomTo;
    return homePeriod === "hoy" ? "hoy" : "ult. " + homePeriod + " días";
  }
  function periodVs() { return homePeriod === "hoy" ? "vs ayer" : "vs periodo previo"; }

  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function startOfDayTs(dstr) { var t = new Date(dstr + "T00:00:00").getTime(); return isNaN(t) ? null : t; }
  function endOfDayTs(dstr) { var t = new Date(dstr + "T23:59:59.999").getTime(); return isNaN(t) ? null : t; }
  // Ventana [from, to) del periodo activo (hoy / 7 / 30 / personalizado).
  function periodWindow() {
    var now = Date.now();
    if (homePeriod === "custom" && homeCustomFrom && homeCustomTo) {
      var from = startOfDayTs(homeCustomFrom), to = endOfDayTs(homeCustomTo);
      if (from == null || to == null || from > to) return { from: now - 7 * 86400000, to: now + 1 };
      return { from: from, to: to + 1 };
    }
    if (homePeriod === "hoy") return { from: startOfToday(), to: now + 1 };
    var d = Number(homePeriod) || 7;
    return { from: now - d * 86400000, to: now + 1 };
  }
  function orderTime(o) {
    var raw = o && (o.createdAt || o.date);
    if (!raw) return null;
    var t = new Date(raw).getTime();
    return isNaN(t) ? null : t;
  }

  // Junta TODAS las órdenes de todas las cuentas ML, con su cuenta.
  function collectOrders() {
    var accounts = (S.mlAccounts && S.mlAccounts()) || [];
    var out = [];
    accounts.forEach(function (acc) {
      var snap = S.getCommerceSnapshot && S.getCommerceSnapshot(acc.id);
      (snap && snap.allOrders ? snap.allOrders : []).forEach(function (o) {
        out.push({ o: o, acc: acc.id, accName: acc.name });
      });
    });
    return out;
  }

  // Suma sobre una ventana [fromTs, toTs). Devuelve totales + clientes distintos.
  function aggWindow(items, fromTs, toTs) {
    var agg = { revenue: 0, margin: 0, orders: 0, units: 0 };
    var custs = {};
    items.forEach(function (it) {
      var t = orderTime(it.o);
      if (t !== null && (t < fromTs || t >= toTs)) return;
      var o = it.o;
      var rev = Number(o.total) || 0;
      agg.revenue += rev;
      agg.margin += Number(o.margin != null ? o.margin : rev * 0.36) || 0;
      agg.orders += 1;
      agg.units += Number(o.units) || 1;
      var c = (o.customer || "").toString().trim().toLowerCase();
      if (c) custs[c] = 1;
    });
    agg.customers = Object.keys(custs).length;
    return agg;
  }

  // ¿Algún snapshot ML trae la serie diaria de visitas? (los viejos no la tienen).
  function hayVisitasDiarias() {
    var accounts = (S.mlAccounts && S.mlAccounts()) || [];
    for (var i = 0; i < accounts.length; i++) {
      var snap = S.getCommerceSnapshot && S.getCommerceSnapshot(accounts[i].id);
      if (snap && snap.visitsByDay && Object.keys(snap.visitsByDay).length) return true;
    }
    return false;
  }
  // Suma las visitas (serie diaria de todas las cuentas ML) cuyos días caen en
  // [fromTs, toTs). Cada día es "YYYY-MM-DD" → se ubica al inicio de ese día local.
  function sumVisitas(fromTs, toTs) {
    var total = 0;
    (S.mlAccounts ? S.mlAccounts() : []).forEach(function (a) {
      var snap = S.getCommerceSnapshot && S.getCommerceSnapshot(a.id);
      var byDay = snap && snap.visitsByDay;
      if (!byDay) return;
      Object.keys(byDay).forEach(function (dstr) {
        var t = startOfDayTs(dstr);
        if (t == null) return;
        if (t >= fromTs && t < toTs) total += Number(byDay[dstr]) || 0;
      });
    });
    return total;
  }

  function mlData() {
    var items = collectOrders();
    var hasOrders = items.length > 0;
    var now = Date.now();
    var win = periodWindow();
    var curFrom = win.from, curTo = win.to;
    var span = curTo - curFrom;
    var cur = aggWindow(items, curFrom, curTo);
    var prev = aggWindow(items, curFrom - span, curFrom);

    // VISITAS de Mercado Libre: los pedidos no las traen; vienen como SERIE DIARIA
    // en el snapshot de cada cuenta ML (visitsByDay, de fetchMLVisitsDaily). Se
    // suman por día dentro de la ventana del período elegido — igual que las ventas
    // — así "Visitas" sigue Hoy/7/15/30/personalizado y tiene delta real vs. previo.
    if (hayVisitasDiarias()) {
      cur.visitas = sumVisitas(curFrom, curTo);
      prev.visitas = sumVisitas(curFrom - span, curFrom);
    } else {
      // Snapshot viejo (sin serie diaria) o ML no la dio: total agregado, sin delta.
      var vtot = 0;
      (S.mlAccounts ? S.mlAccounts() : []).forEach(function (a) {
        var snap = S.getCommerceSnapshot && S.getCommerceSnapshot(a.id);
        var tt = snap && snap.totals;
        if (tt && typeof tt.sessions === "number") vtot += tt.sessions;
      });
      cur.visitas = vtot; prev.visitas = 0;
    }

    // Top productos + por cuenta + tendencia: TODO dentro de la ventana [curFrom, curTo).
    // La gráfica "Ingresos por día" ahora sigue el período elegido (antes 14 días
    // fijos): por eso al cambiar el período la gráfica cambia y se re-anima.
    var trendMap = {}, trendCount = {}, byName = {}, perAccount = {};
    (S.mlAccounts ? S.mlAccounts() : []).forEach(function (a) { perAccount[a.id] = { id: a.id, name: a.name, revenue: 0, orders: 0, connected: !!(S.getCommerceConfig && S.getCommerceConfig(a.id).hasToken) }; });
    items.forEach(function (it) {
      var t = orderTime(it.o);
      if (t !== null && (t < curFrom || t >= curTo)) return;
      var o = it.o, rev = Number(o.total) || 0;
      var nm = o.product || "Producto";
      if (!byName[nm]) byName[nm] = { name: nm, revenue: 0, orders: 0, units: 0, thumbnail: o.thumbnail || "" };
      byName[nm].revenue += rev; byName[nm].orders += 1; byName[nm].units += Number(o.units) || 1;
      if (perAccount[it.acc]) { perAccount[it.acc].revenue += rev; perAccount[it.acc].orders += 1; }
      var dk = o.date || new Date(t || now).toISOString().slice(0, 10);
      trendMap[dk] = (trendMap[dk] || 0) + rev;
      trendCount[dk] = (trendCount[dk] || 0) + 1;   // cantidad de ventas de ese día
    });

    // Fallback: sin allOrders pero con totals cacheados.
    if (!hasOrders) {
      (S.mlAccounts ? S.mlAccounts() : []).forEach(function (a) {
        var snap = S.getCommerceSnapshot && S.getCommerceSnapshot(a.id);
        var tt = snap && snap.totals; if (!tt) return;
        cur.revenue += Number(tt.revenue) || 0; cur.margin += Number(tt.margin) || 0;
        cur.orders += Number(tt.orders) || 0; cur.units += Number(tt.units) || 0;
        if (perAccount[a.id]) { perAccount[a.id].revenue = Number(tt.revenue) || 0; perAccount[a.id].orders = Number(tt.orders) || 0; }
        (snap.trend || []).forEach(function (p) { trendMap[p.date] = (trendMap[p.date] || 0) + (Number(p.revenue) || 0); trendCount[p.date] = (trendCount[p.date] || 0) + (Number(p.orders) || 0); });
        (snap.products || []).forEach(function (p) { var nm = p.name || "Producto"; if (!byName[nm]) byName[nm] = { name: nm, revenue: 0, orders: 0, units: 0, thumbnail: "" }; byName[nm].revenue += Number(p.revenue) || 0; byName[nm].orders += Number(p.orders) || 0; });
      });
    }

    var trend = Object.keys(trendMap).sort().map(function (d) { return { date: d, revenue: trendMap[d], count: trendCount[d] || 0 }; });
    var topProducts = Object.keys(byName).map(function (k) { return byName[k]; }).sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 5);
    var accArr = Object.keys(perAccount).map(function (k) { return perAccount[k]; });
    // Facturación de la tienda web Alpha Fitness (conector genérico) para el canal
    // "Alpha Fitness" de "Ventas por canal". 0 hasta que se conecte/sincronice.
    var alphaRevenue = 0;
    try {
      var asnap = S.getCommerceSnapshot ? S.getCommerceSnapshot("alphaweb") : null;
      if (asnap && asnap.totals) alphaRevenue = Number(asnap.totals.revenue) || 0;
    } catch (e) { alphaRevenue = 0; }
    return { cur: cur, prev: prev, trend: trend, topProducts: topProducts, perAccount: accArr, alphaRevenue: alphaRevenue, hasData: cur.orders > 0 };
  }

  function metaTotals() {
    var plats = S.metaPlatforms || [];
    var spend = 0, revenue = 0, has = false, roas = 0;
    plats.forEach(function (p) {
      var st = S.getMetaPlatformState && S.getMetaPlatformState(p.id);
      var t = st && st.snapshot && st.snapshot.totals;
      if (t) { spend += Number(t.spend) || 0; revenue += Number(t.revenue) || 0; has = true; }
    });
    if (spend > 0) roas = revenue / spend;
    return { spend: spend, revenue: revenue, roas: roas, has: has };
  }

  function financeMonth() {
    try {
      var movs = (S.state && S.state.movements) || [];
      var mes = S.currentMonth ? S.currentMonth() : "";
      var delMes = movs.filter(function (m) { return S.movementMonth ? S.movementMonth(m) === mes : true; });
      var sum = S.summarize ? S.summarize(delMes) : { income: 0, expense: 0, balance: 0 };
      // gastos por día (para el mini-chart) + mes anterior (delta)
      var byDay = {};
      delMes.filter(function (m) { return m.type === "expense"; }).forEach(function (m) { byDay[m.date] = (byDay[m.date] || 0) + (Number(m.amount) || 0); });
      var prevMonthExpense = 0;
      if (S.shiftMonth && S.currentMonth) {
        var pm = S.shiftMonth(S.currentMonth(), -1);
        movs.forEach(function (m) { if (m.type === "expense" && S.movementMonth && S.movementMonth(m) === pm) prevMonthExpense += Number(m.amount) || 0; });
      }
      return { income: sum.income, expense: sum.expense, balance: sum.balance, byDay: byDay, prevExpense: prevMonthExpense };
    } catch (e) { return { income: 0, expense: 0, balance: 0, byDay: {}, prevExpense: 0 }; }
  }

  // ---- delta helpers ----
  function deltaObj(cur, prev, opts) {
    opts = opts || {};
    if (!(prev > 0)) {
      if (cur > 0) return { dir: "up", good: true, text: opts.newLabel || "nuevo" };
      return null;
    }
    var pct = ((cur - prev) / prev) * 100;
    var dir = pct >= 0 ? "up" : "down";
    var good = opts.downGood ? pct < 0 : pct >= 0;
    return { dir: dir, good: good, text: (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%" };
  }

  var IC = {
    money: '<path d="M3 6h18v12H3z"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9v6M18 9v6"/>',
    bag: '<path d="M6 8h12l-1 11H7L6 8Z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 6a3 3 0 0 1 0 6"/><path d="M20.5 19a5.5 5.5 0 0 0-3-4.9"/>',
    coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10a2.5 2 0 0 1 5 0c0 2.5-5 1.5-5 4a2.5 2 0 0 0 5 0"/>',
    pie: '<path d="M12 3a9 9 0 1 0 9 9h-9Z"/><path d="M12 3v9h9A9 9 0 0 0 12 3Z"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'
  };

  function kpiCard(label, value, icon, delta) {
    var d = "";
    if (delta) {
      d = '<span class="home-kpi-delta ' + esc(delta.dir) + (delta.good ? ' good' : '') + '">' +
        (delta.dir === "down" ? "&#9660;" : "&#9650;") + " " + esc(delta.text) +
        ' <span class="vs">' + esc(delta.vs || periodVs()) + "</span></span>";
    }
    return '<article class="metric-card home-kpi">' +
      '<div class="home-kpi-top"><span class="home-kpi-label">' + esc(label) + '</span>' +
      '<span class="home-kpi-ic"><svg viewBox="0 0 24 24" aria-hidden="true">' + icon + '</svg></span></div>' +
      '<div class="home-kpi-val">' + value + '</div>' + d + '</article>';
  }

  function renderKpis(ml) {
    var box = el("homeKpis"); if (!box) return;
    var c = ml.cur, p = ml.prev;
    var margenPct = c.revenue > 0 ? (c.margin / c.revenue) * 100 : 0;
    var margenPrevPct = p.revenue > 0 ? (p.margin / p.revenue) * 100 : 0;
    box.innerHTML =
      kpiCard("Ventas totales", curK(c.revenue), IC.money, deltaObj(c.revenue, p.revenue)) +
      kpiCard("Pedidos", intn(c.orders), IC.bag, deltaObj(c.orders, p.orders)) +
      kpiCard("Visitas", intn(c.visitas || 0), IC.eye, deltaObj(c.visitas || 0, p.visitas || 0)) +
      kpiCard("Ganancias", curK(c.margin), IC.coin, deltaObj(c.margin, p.margin)) +
      kpiCard("Margen", margenPct.toFixed(1) + "%", IC.pie,
        margenPrevPct > 0 ? { dir: margenPct >= margenPrevPct ? "up" : "down", good: margenPct >= margenPrevPct, text: (margenPct >= margenPrevPct ? "+" : "") + (margenPct - margenPrevPct).toFixed(1) + "pts" } : null);
  }

  // ---- Gráfica de línea con puntos "iluminados" + ejes (días abajo, $ izq.) ----
  function renderSalesChart(trend) {
    var box = el("homeSalesChart"); var totalEl = el("homeSalesTotal");
    if (!box) return;
    var pts = trend.slice();   // ya viene filtrado al período elegido (sin cap fijo)
    var total = pts.reduce(function (a, p) { return a + (Number(p.revenue) || 0); }, 0);
    if (totalEl) totalEl.textContent = pts.length ? cur(total) : "";
    if (!pts.length) { box.innerHTML = '<div class="home-empty">Sin ventas en el periodo. Cuando sincronices Mercado Libre, tus ingresos por dia aparecen acá.</div>'; return; }
    // padL/padBottom dejan lugar para las etiquetas de los ejes (superpuestas en HTML).
    var W = 720, H = 220, padL = 60, padR = 16, padTop = 18, padBottom = 30;
    var plotW = W - padL - padR, plotH = H - padTop - padBottom;
    var rawMax = Math.max.apply(null, pts.map(function (p) { return Number(p.revenue) || 0; })) || 1;
    var scale = rawMax * 1.08;   // 8% de aire arriba para que el pico no toque el borde
    var stepX = pts.length > 1 ? plotW / (pts.length - 1) : 0;
    function x(i) { return pts.length > 1 ? padL + stepX * i : padL + plotW / 2; }
    function y(v) { return padTop + (1 - (Number(v) || 0) / scale) * plotH; }
    var baseY = H - padBottom;
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.revenue).toFixed(1); }).join(" ");
    var area = line + " L" + x(pts.length - 1).toFixed(1) + " " + baseY + " L" + x(0).toFixed(1) + " " + baseY + " Z";
    var showDots = pts.length <= 45;
    var dots = showDots ? pts.map(function (p, i) { var last = i === pts.length - 1; return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.revenue).toFixed(1) + '" r="' + (last ? 5.6 : 4.6) + '" fill="url(#homeDotCore)"/>'; }).join("") : "";

    // Rejilla horizontal + etiquetas de $ (eje Y, izquierda), 4 niveles.
    var grid = "", yLabels = "";
    for (var g = 0; g <= 3; g++) {
      var frac = g / 3, gy = padTop + frac * plotH, val = scale * (1 - frac);
      grid += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) + '" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>';
      yLabels += '<span class="hc-y" style="top:' + (gy / H * 100).toFixed(2) + '%">' + curK(val) + '</span>';
    }
    // Etiquetas de días (eje X, abajo): ~6 repartidas + siempre la última.
    var stepLbl = Math.max(1, Math.ceil(pts.length / 6)), xLabels = "";
    pts.forEach(function (p, i) {
      if (i % stepLbl !== 0 && i !== pts.length - 1) return;
      var d = String(p.date || ""), lbl = d.length >= 10 ? (d.slice(8, 10) + "/" + d.slice(5, 7)) : d;
      xLabels += '<span class="hc-x" style="left:' + (x(i) / W * 100).toFixed(2) + '%">' + esc(lbl) + '</span>';
    });

    // Geometría por punto (en coords del viewBox) para el hover: monto + cantidad de ese día.
    var geomPts = pts.map(function (p, i) {
      var d = String(p.date || "");
      var lbl = d.length >= 10 ? (d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4)) : d;
      return { cx: x(i), cy: y(p.revenue), revenue: Number(p.revenue) || 0, count: Number(p.count) || 0, label: lbl };
    });

    var anim = S.shouldAnimateChart ? S.shouldAnimateChart("home-sales", pts.map(function (p) { return Number(p.revenue) || 0; }).join(",")) : false;
    var svg =
      '<svg class="' + (anim ? "hn-anim" : "") + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Ingresos por dia">' +
      '<defs>' +
      '<radialGradient id="homeDotCore" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#fff1e6"/><stop offset="45%" stop-color="#ff9457"/><stop offset="100%" stop-color="#ff5a2e"/></radialGradient>' +
      '<linearGradient id="homeArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(255,106,61,0.28)"/><stop offset="100%" stop-color="rgba(255,106,61,0)"/></linearGradient>' +
      '<filter id="homeGlow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<filter id="homeLineGlow" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '</defs>' + grid +
      '<path class="hn-area" d="' + area + '" fill="url(#homeArea)"/>' +
      '<path class="hn-line" pathLength="1" d="' + line + '" fill="none" stroke="#ff7a45" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" filter="url(#homeLineGlow)"/>' +
      '<g class="hn-dots" filter="url(#homeGlow)">' + dots + '</g>' +
      // Capa de hover: guía vertical + punto resaltado (ocultos hasta pasar el mouse).
      '<line class="hn-hover-line" x1="0" y1="' + padTop + '" x2="0" y2="' + baseY + '" stroke="rgba(255,255,255,0.28)" stroke-width="1" style="opacity:0"/>' +
      '<circle class="hn-hover-dot" cx="0" cy="0" r="0" fill="url(#homeDotCore)" stroke="#fff" stroke-width="1.4"/>' +
      '</svg>';
    box.innerHTML = '<div class="hc-chart">' + svg + yLabels + xLabels + '</div>';
    wireSalesHover(box, geomPts);
  }

  // Hover de la gráfica SVG "Ingresos por día": al pasar el mouse (o tocar) muestra
  // el monto de ese día en el tooltip compartido y resalta el punto + guía vertical.
  function wireSalesHover(box, geomPts) {
    var chart = box.querySelector(".hc-chart");
    var svg = chart && chart.querySelector("svg");
    if (!chart || !svg || !geomPts.length) return;
    var dot = svg.querySelector(".hn-hover-dot");
    var vline = svg.querySelector(".hn-hover-line");
    var VBW = 720;   // ancho del viewBox
    function nearest(clientX) {
      var rect = svg.getBoundingClientRect();
      if (!rect.width) return -1;
      var vx = ((clientX - rect.left) / rect.width) * VBW;   // px pantalla -> unidades viewBox
      var best = 0, bd = Infinity;
      for (var i = 0; i < geomPts.length; i++) {
        var dd = Math.abs(geomPts[i].cx - vx);
        if (dd < bd) { bd = dd; best = i; }
      }
      return best;
    }
    function show(clientX, clientY) {
      var i = nearest(clientX); if (i < 0) return;
      var p = geomPts[i];
      if (dot) { dot.setAttribute("cx", p.cx.toFixed(1)); dot.setAttribute("cy", p.cy.toFixed(1)); dot.setAttribute("r", "6"); }
      if (vline) { vline.setAttribute("x1", p.cx.toFixed(1)); vline.setAttribute("x2", p.cx.toFixed(1)); vline.style.opacity = "1"; }
      // Fila: monto a la izquierda + CANTIDAD de ventas de ese día pegada al borde derecho.
      var n = Number(p.count) || 0;
      var cntTxt = n === 1 ? "1 venta" : intn(n) + " ventas";
      if (S.showTooltipAt) S.showTooltipAt(clientX, clientY,
        "<b>" + esc(p.label) + "</b>" +
        '<div class="hc-tip-row"><span>Ventas: ' + cur(p.revenue) + '</span><strong>' + esc(cntTxt) + '</strong></div>');
    }
    function hide() {
      if (dot) dot.setAttribute("r", "0");
      if (vline) vline.style.opacity = "0";
      if (S.hideChartTooltip) S.hideChartTooltip();
    }
    chart.addEventListener("mousemove", function (e) { show(e.clientX, e.clientY); });
    chart.addEventListener("mouseleave", hide);
    chart.addEventListener("pointerdown", function (e) { if (e.pointerType !== "mouse") show(e.clientX, e.clientY); });
  }

  // ---- Ventas por canal (dona SVG + leyenda con logos) ----
  var CH_COLORS = ["#ff6a3d", "#f5a623", "#ff3d2e", "#b24dff", "#52e1ff"];
  function renderChannels(ml) {
    var box = el("homeChannels"); if (!box) return;
    // Uruguay (ML1+ML2) y Brasil (Mercado Livre) van como canales SEPARADOS, igual
    // que las tarjetas de "Tus negocios". Amazon/Shopee: placeholders sin conectar.
    var uyRev = 0, brRev = 0;
    ml.perAccount.forEach(function (x) {
      if (x.id === "mercadolivre") brRev += (x.revenue || 0);
      else uyRev += (x.revenue || 0);
    });
    // Alpha Fitness (tienda propia): canal REAL (no "próximamente"). Su facturación
    // la alimenta el conector de la tienda web ("alphaweb").
    var alphaRev = Number(ml.alphaRevenue) || 0;
    // La foto del logo se sube por la UI bajo el id del app activo. Buscar dónde
    // quedó (alphaweb = la tienda web, alfafitness = el contenedor, o el slug) para
    // que el logo cargado aparezca en el canal.
    var alphaPhotoId = "alphaweb";
    if (S.marketplacePhoto) {
      ["alphaweb", "alfafitness", "alphafitness"].some(function (cand) {
        if (S.marketplacePhoto(cand)) { alphaPhotoId = cand; return true; }
        return false;
      });
    }
    var channels = [
      { name: "Mercado Libre", slug: "mercadolibre", value: uyRev, soon: false },
      { name: "Mercado Livre", slug: "mercadolivre", value: brRev, soon: false },
      { name: "Alpha Fitness", slug: "alphafitness", photoId: alphaPhotoId, value: alphaRev, soon: false },
      { name: "Amazon", slug: "amazon", value: 0, soon: true },
      { name: "Shopee", slug: "shopee", value: 0, soon: true }
    ];
    var total = channels.reduce(function (a, c) { return a + c.value; }, 0);
    var real = channels.filter(function (c) { return c.value > 0; });

    // Dona
    var donut;
    var animD = S.shouldAnimateChart ? S.shouldAnimateChart("home-donut", channels.map(function (c) { return c.value; }).join(",")) : false;
    var svgCls = animD ? ' class="hn-anim-donut"' : "";
    if (total > 0) {
      var C = 2 * Math.PI * 15.9155, off = 0, segs = "";
      real.forEach(function (c, i) {
        var frac = c.value / total, len = frac * C, gap = C - len;
        // Barrido: cada arco "se dibuja" (dasharray 0→len) en su tramo del giro.
        var cls = animD ? ' class="hn-arc"' : "";
        var av = animD ? ' style="--dlen:' + len.toFixed(2) + ';--dgap:' + gap.toFixed(2) + ';--ddur:' + Math.max(360, Math.round((len / C) * 1050)) + 'ms;--ddelay:' + Math.round((off / C) * 1050) + 'ms"' : "";
        segs += '<circle' + cls + av + ' cx="21" cy="21" r="15.9155" fill="none" stroke="' + CH_COLORS[i % CH_COLORS.length] + '" stroke-width="5" stroke-dasharray="' + len.toFixed(2) + ' ' + gap.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" stroke-linecap="butt" transform="rotate(-90 21 21)"/>';
        off += len;
      });
      donut = '<div class="home-donut"><svg' + svgCls + ' viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="21" r="15.9155" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="5"/>' + segs + '</svg><div class="home-donut-c"><b>' + curK(total) + '</b><small>Total</small></div></div>';
    } else {
      donut = '<div class="home-donut"><svg viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="21" r="15.9155" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="5"/></svg><div class="home-donut-c"><b>$0</b><small>Total</small></div></div>';
    }

    var legend = channels.map(function (c, i) {
      var isReal = !c.soon && c.value > 0;   // punto de color solo si aporta a la dona
      var p = total > 0 ? Math.round((c.value / total) * 100) : 0;
      var right = c.soon ? '<span class="home-ch-soon">Proximamente</span>' : '<b>' + p + '%</b>';
      var dot = isReal ? '<i style="background:' + CH_COLORS[real.findIndex(function (r) { return r.slug === c.slug; }) % CH_COLORS.length] + '"></i>' : '';
      return '<div class="home-ch' + (c.soon ? ' is-soon' : '') + '">' + bizLogo(c.photoId || c.slug, c.slug, 24) +
        '<span class="home-ch-name">' + esc(c.name) + '</span>' + dot + right + '</div>';
    }).join("");
    box.innerHTML = donut + '<div class="home-ch-legend">' + legend + '</div>';
  }

  // ---- Negocios (por marketplace, no por "Alpha Fitness") ----
  // Arma una tarjeta. o: {view, logoId, slug, title, sub, revenueStr, orders, connected, soon}
  function bizCardHTML(o) {
    var badge = o.soon
      ? '<span class="home-biz-badge off">Proximamente</span>'
      : '<span class="home-biz-badge ' + (o.connected ? "on" : "off") + '">' + (o.connected ? "Conectada" : "Sin conectar") + '</span>';
    var stat = o.soon
      ? '<div class="home-biz-stat"><b>&mdash;</b><span>en evaluacion</span></div>'
      : '<div class="home-biz-stat"><b>' + esc(o.revenueStr) + '</b><span>' + intn(o.orders) + ' ventas</span></div>';
    var open = o.soon ? 'class="home-biz-card is-soon"' : 'class="home-biz-card" data-view="' + esc(o.view) + '" role="button" tabindex="0"';
    return '<article ' + open + '>' +
      '<div class="home-biz-top">' + bizLogo(o.logoId, o.slug, 40) + badge + '</div>' +
      '<div class="home-biz-name">' + esc(o.title) + '<small>' + esc(o.sub || "") + '</small></div>' +
      stat + '</article>';
  }
  function renderBiz(ml) {
    var box = el("homeBiz"); if (!box) return;
    var cards = [];
    // Mercado Libre Uruguay = ML1 + ML2 UNIFICADOS (mismo país, mismos productos):
    // un solo cuadrito con saldo y ventas sumados. Al entrar se ven por separado.
    var uy = { revenue: 0, orders: 0, connected: false, n: 0 };
    var otras = [];
    ml.perAccount.forEach(function (a) {
      if (a.id === "mercadolibre" || a.id === "mercadolibre2") {
        uy.revenue += a.revenue; uy.orders += a.orders; uy.connected = uy.connected || a.connected; uy.n += 1;
      } else { otras.push(a); }
    });
    if (uy.n) {
      cards.push(bizCardHTML({ view: "ecommerce-mercadolibre", logoId: "mercadolibre", slug: "mercadolibre",
        title: "Mercado Libre", sub: "Uruguay", revenueStr: curPlat("mercadolibre", uy.revenue), orders: uy.orders, connected: uy.connected }));
    }
    // ML Brasil (y cualquier otra cuenta ML) aparte, en su moneda. En Brasil el
    // nombre va en portugués: "Mercado Livre".
    otras.forEach(function (a) {
      cards.push(bizCardHTML({ view: "ecommerce-" + a.id, logoId: a.id, slug: "mercadolibre",
        title: a.id === "mercadolivre" ? "Mercado Livre" : "Mercado Libre", sub: esBR(a.id) ? "Brasil" : "", revenueStr: curPlat(a.id, a.revenue), orders: a.orders, connected: a.connected }));
    });
    // Placeholders: marketplaces brasileros próximamente. Orden pedido por el
    // titular: Amazon Brasil y Shopee Brasil (Tienda Mía se quita por ahora).
    [["Amazon BR", "Brasil", "amazon"], ["Shopee", "Brasil", "shopee"]].forEach(function (p) {
      cards.push(bizCardHTML({ logoId: p[2], slug: p[2], title: p[0], sub: p[1], soon: true }));
    });
    box.innerHTML = cards.slice(0, 4).join("");
  }

  function renderTopProducts(ml) {
    var box = el("homeTopProducts"); if (!box) return;
    if (!ml.topProducts.length) { box.innerHTML = '<div class="home-empty">Cuando tengas ventas, tus productos mas vendidos se listan acá.</div>'; return; }
    box.innerHTML = ml.topProducts.map(function (p, i) {
      var thumb = p.thumbnail ? '<img class="home-li-thumb" src="' + esc(p.thumbnail) + '" alt="" onerror="this.style.display=\'none\'"/>' : '<span class="home-li-rank">' + (i + 1) + '</span>';
      return '<div class="home-li">' + thumb + '<div class="home-li-main"><b>' + esc(p.name) + '</b><small>' + intn(p.units || p.orders) + ' unidades</small></div><div class="home-li-val">' + cur(p.revenue) + '</div></div>';
    }).join("");
  }

  // ---- Alertas (stock + campañas) ----
  function renderAlerts() {
    var box = el("homeAlerts"); if (!box) return;
    var a = invAlertsCache;
    if (a === null) { box.innerHTML = '<div class="home-empty">Revisando tu stock...</div>'; fetchInventoryAlerts(); return; }
    if (a === false) { box.innerHTML = '<div class="home-empty">Conectá Mercado Libre para ver alertas de stock y sincronizacion.</div>'; return; }
    var items = [];
    (a.out || []).forEach(function (p) { items.push({ dot: "danger", name: "Sin stock: " + p.name, sub: "0 unidades" }); });
    (a.low || []).forEach(function (p) { items.push({ dot: "warn", name: "Stock bajo en " + p.name, sub: "Quedan " + p.stock + " unidades" }); });
    (a.errors || []).forEach(function (m) { items.push({ dot: "danger", name: "Error de sync", sub: m }); });
    if (!items.length) { box.innerHTML = '<div class="home-li"><span class="home-li-dot good"></span><div class="home-li-main"><b>Todo en orden</b><small>Sin faltantes ni errores de sync</small></div></div>'; return; }
    box.innerHTML = items.slice(0, 5).map(function (it) {
      return '<div class="home-li"><span class="home-li-dot ' + it.dot + '"></span><div class="home-li-main"><b>' + esc(it.name) + '</b><small>' + esc(it.sub) + '</small></div></div>';
    }).join("");
  }
  function fetchInventoryAlerts() {
    if (!(S.requireSecureApi)) { invAlertsCache = false; renderAlerts(); return; }
    var api; try { api = S.requireSecureApi(); } catch (e) { invAlertsCache = false; renderAlerts(); return; }
    if (!api || !api.inventory) { invAlertsCache = false; renderAlerts(); return; }
    Promise.resolve(api.inventory("get")).then(function (res) {
      var inv = (res && res.inventory) || {}; var products = inv.products || {};
      var out = [], low = [];
      Object.keys(products).forEach(function (k) { var p = products[k]; var st = Number(p.stock); if (st === 0) out.push({ name: p.name || p.sku || k, stock: 0 }); else if (st > 0 && st <= 3) low.push({ name: p.name || p.sku || k, stock: st }); });
      var errors = []; var ls = inv.listingState || {};
      Object.keys(ls).forEach(function (m) { if (ls[m] && ls[m].status === "error") errors.push(m); });
      invAlertsCache = { out: out, low: low, errors: errors }; renderAlerts();
    }).catch(function () { invAlertsCache = false; renderAlerts(); });
  }

  // ---- Gastos del mes (barras) ----
  function renderGastos(finance) {
    var totalEl = el("homeGastosTotal"), deltaEl = el("homeGastosDelta"), chartEl = el("homeGastosChart");
    if (totalEl) totalEl.textContent = fin(finance.expense);
    if (deltaEl) {
      var d = deltaObj(finance.expense, finance.prevExpense, { downGood: true });
      if (d) { deltaEl.className = "home-kpi-delta " + d.dir + (d.good ? " good" : ""); deltaEl.innerHTML = (d.dir === "down" ? "&#9660;" : "&#9650;") + " " + esc(d.text) + ' <span class="vs">vs mes anterior</span>'; }
      else { deltaEl.textContent = ""; }
    }
    if (!chartEl) return;
    var days = Object.keys(finance.byDay).sort();
    if (!days.length) { chartEl.innerHTML = '<div class="home-empty">Sin gastos cargados este mes.</div>'; return; }
    var vals = days.map(function (d) { return finance.byDay[d]; });
    var max = Math.max.apply(null, vals) || 1;
    var W = 320, H = 90, n = vals.length, gap = 3, bw = Math.max(4, (W - gap * (n - 1)) / n);
    var animG = S.shouldAnimateChart ? S.shouldAnimateChart("home-gastos", vals.join(",")) : false;
    var bars = vals.map(function (v, i) {
      var h = Math.max(2, (v / max) * (H - 6)); var x = i * (bw + gap);
      var delay = animG ? ' style="animation-delay:' + (i * 60) + 'ms"' : "";
      return '<rect class="hn-bar" x="' + x.toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="url(#gastosBar)"' + delay + "/>";
    }).join("");
    chartEl.innerHTML = '<svg class="' + (animG ? "hn-anim-bars" : "") + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="gastosBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ff8f4a"/><stop offset="100%" stop-color="#ff3d2e"/></linearGradient></defs>' + bars + '</svg>';
  }

  // ---- Rendimiento de campañas (Meta real + placeholders con logo) ----
  function renderCampaigns(meta) {
    var box = el("homeCampaigns"); if (!box) return;
    var rows = [];
    rows.push({ slug: "meta", name: "Meta Ads", real: meta.has, roas: meta.roas, sub: meta.has ? "Inversion " + cur(meta.spend) : "Sin conectar" });
    rows.push({ slug: "google", name: "Google Ads", real: false });
    rows.push({ slug: "tiktok", name: "TikTok Ads", real: false });
    rows.push({ slug: "email", name: "Email Marketing", real: false });
    box.innerHTML = rows.map(function (r) {
      var right = r.real
        ? '<div class="home-li-val">ROAS ' + (r.roas || 0).toFixed(1) + '</div>'
        : '<div class="home-li-val home-li-soon">Conectar</div>';
      return '<div class="home-li' + (r.real ? '' : ' is-soon') + '">' + logo(r.slug, 30) +
        '<div class="home-li-main"><b>' + esc(r.name) + '</b><small>' + esc(r.real ? r.sub : "No conectado") + '</small></div>' + right + '</div>';
    }).join("");
  }

  function renderHome() {
    if (!el("homeKpis")) return;
    var ml = mlData();
    var meta = metaTotals();
    var finance = financeMonth();
    renderKpis(ml);
    renderSalesChart(ml.trend);
    renderChannels(ml);
    renderBiz(ml);
    renderTopProducts(ml);
    renderAlerts();
    renderGastos(finance);
    renderCampaigns(meta);
  }

  function initHome() {
    var tabs = el("homePeriodTabs");
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = "1";
      tabs.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-home-period]"); if (!btn) return;
        homePeriod = btn.getAttribute("data-home-period");
        tabs.querySelectorAll("[data-home-period]").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
        var range = el("homeDateRange");
        if (homePeriod === "custom") {
          // Default: últimos 7 días si todavía no eligió fechas.
          if (!homeCustomFrom || !homeCustomTo) {
            homeCustomTo = new Date().toISOString().slice(0, 10);
            homeCustomFrom = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
          }
          if (el("homeDateFrom")) el("homeDateFrom").value = homeCustomFrom;
          if (el("homeDateTo")) el("homeDateTo").value = homeCustomTo;
          if (range) range.classList.remove("is-hidden");
        } else if (range) {
          range.classList.add("is-hidden");
        }
        if (S.bumpChartGen) S.bumpChartGen();  // fuerza re-animación de las gráficas al cambiar período
        renderHome();
      });
    }
    // Rango personalizado: los <input type="date"> abren el calendario nativo.
    ["homeDateFrom", "homeDateTo"].forEach(function (id) {
      var inp = el(id);
      if (inp && !inp.dataset.bound) {
        inp.dataset.bound = "1";
        inp.addEventListener("change", function () {
          if (el("homeDateFrom")) homeCustomFrom = el("homeDateFrom").value;
          if (el("homeDateTo")) homeCustomTo = el("homeDateTo").value;
          if (homeCustomFrom && homeCustomTo) {
            homePeriod = "custom";
            if (S.bumpChartGen) S.bumpChartGen();
            renderHome();
          }
        });
      }
    });
    var biz = el("homeBiz");
    if (biz && !biz.dataset.bound) {
      biz.dataset.bound = "1";
      biz.addEventListener("click", function (e) { var card = e.target.closest(".home-biz-card[data-view]"); if (card && S.setView) S.setView(card.getAttribute("data-view")); });
      biz.addEventListener("keydown", function (e) { var card = e.target.closest(".home-biz-card[data-view]"); if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); card.click(); } });
    }
  }

  Object.assign(S, { renderHome: renderHome, initHome: initHome });
})();
