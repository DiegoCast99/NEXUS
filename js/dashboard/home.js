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
  function intn(n) { try { return S.integerNumber(Number(n) || 0); } catch (e) { return String(Math.round(Number(n) || 0)); } }
  function fin(n) { try { return S.financeMoney(Number(n) || 0); } catch (e) { return String(Math.round(Number(n) || 0)); } }
  function logo(key, size) { try { return S.platformLogo ? S.platformLogo(key, size) : ""; } catch (e) { return ""; } }

  function periodDays() { return homePeriod === "hoy" ? 1 : Number(homePeriod) || 7; }
  function periodLabel() { return homePeriod === "hoy" ? "hoy" : "ult. " + homePeriod + " dias"; }
  function periodVs() { return homePeriod === "hoy" ? "vs ayer" : "vs periodo previo"; }

  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
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

  function mlData(days) {
    var items = collectOrders();
    var hasOrders = items.length > 0;
    var now = Date.now();
    var span = days * 86400000;
    var curFrom = days === 1 ? startOfToday() : now - span;
    var prevFrom = days === 1 ? startOfToday() - 86400000 : now - span * 2;
    var cur = aggWindow(items, curFrom, days === 1 ? now + 1 : now + 1);
    var prev = aggWindow(items, prevFrom, curFrom);

    // Top productos + por cuenta: dentro del PERIODO seleccionado.
    var trendMap = {}, byName = {}, perAccount = {};
    (S.mlAccounts ? S.mlAccounts() : []).forEach(function (a) { perAccount[a.id] = { id: a.id, name: a.name, revenue: 0, orders: 0, connected: !!(S.getCommerceConfig && S.getCommerceConfig(a.id).hasToken) }; });
    items.forEach(function (it) {
      var t = orderTime(it.o);
      if (t !== null && t < curFrom) return;
      var o = it.o, rev = Number(o.total) || 0;
      var nm = o.product || "Producto";
      if (!byName[nm]) byName[nm] = { name: nm, revenue: 0, orders: 0, units: 0, thumbnail: o.thumbnail || "" };
      byName[nm].revenue += rev; byName[nm].orders += 1; byName[nm].units += Number(o.units) || 1;
      if (perAccount[it.acc]) { perAccount[it.acc].revenue += rev; perAccount[it.acc].orders += 1; }
    });
    // Gráfica de ventas: SIEMPRE los últimos 14 días (como "esta semana" del mockup),
    // independiente del periodo de los KPIs.
    var trend14From = now - 14 * 86400000;
    items.forEach(function (it) {
      var t = orderTime(it.o);
      if (t !== null && t < trend14From) return;
      var o = it.o, dk = o.date || new Date(t || now).toISOString().slice(0, 10);
      trendMap[dk] = (trendMap[dk] || 0) + (Number(o.total) || 0);
    });

    // Fallback: sin allOrders pero con totals cacheados.
    if (!hasOrders) {
      (S.mlAccounts ? S.mlAccounts() : []).forEach(function (a) {
        var snap = S.getCommerceSnapshot && S.getCommerceSnapshot(a.id);
        var tt = snap && snap.totals; if (!tt) return;
        cur.revenue += Number(tt.revenue) || 0; cur.margin += Number(tt.margin) || 0;
        cur.orders += Number(tt.orders) || 0; cur.units += Number(tt.units) || 0;
        if (perAccount[a.id]) { perAccount[a.id].revenue = Number(tt.revenue) || 0; perAccount[a.id].orders = Number(tt.orders) || 0; }
        (snap.trend || []).forEach(function (p) { trendMap[p.date] = (trendMap[p.date] || 0) + (Number(p.revenue) || 0); });
        (snap.products || []).forEach(function (p) { var nm = p.name || "Producto"; if (!byName[nm]) byName[nm] = { name: nm, revenue: 0, orders: 0, units: 0, thumbnail: "" }; byName[nm].revenue += Number(p.revenue) || 0; byName[nm].orders += Number(p.orders) || 0; });
      });
    }

    var trend = Object.keys(trendMap).sort().map(function (d) { return { date: d, revenue: trendMap[d] }; });
    var topProducts = Object.keys(byName).map(function (k) { return byName[k]; }).sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 5);
    var accArr = Object.keys(perAccount).map(function (k) { return perAccount[k]; });
    return { cur: cur, prev: prev, trend: trend, topProducts: topProducts, perAccount: accArr, hasData: cur.orders > 0 };
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
    pie: '<path d="M12 3a9 9 0 1 0 9 9h-9Z"/><path d="M12 3v9h9A9 9 0 0 0 12 3Z"/>'
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
      kpiCard("Clientes", intn(c.customers), IC.users, deltaObj(c.customers, p.customers)) +
      kpiCard("Ganancias", curK(c.margin), IC.coin, deltaObj(c.margin, p.margin)) +
      kpiCard("Margen", margenPct.toFixed(1) + "%", IC.pie,
        margenPrevPct > 0 ? { dir: margenPct >= margenPrevPct ? "up" : "down", good: margenPct >= margenPrevPct, text: (margenPct >= margenPrevPct ? "+" : "") + (margenPct - margenPrevPct).toFixed(1) + "pts" } : null);
  }

  // ---- Gráfica de línea con puntos "iluminados" ----
  function renderSalesChart(trend) {
    var box = el("homeSalesChart"); var totalEl = el("homeSalesTotal");
    if (!box) return;
    var pts = trend.slice(-14);
    var total = pts.reduce(function (a, p) { return a + (Number(p.revenue) || 0); }, 0);
    if (totalEl) totalEl.textContent = pts.length ? cur(total) : "";
    if (!pts.length) { box.innerHTML = '<div class="home-empty">Sin ventas en el periodo. Cuando sincronices Mercado Libre, tus ingresos por dia aparecen acá.</div>'; return; }
    var W = 720, H = 240, padX = 14, padTop = 22, padBottom = 26;
    var max = Math.max.apply(null, pts.map(function (p) { return Number(p.revenue) || 0; })) || 1;
    var stepX = pts.length > 1 ? (W - padX * 2) / (pts.length - 1) : 0;
    function x(i) { return padX + stepX * i; }
    function y(v) { return padTop + (1 - (Number(v) || 0) / max) * (H - padTop - padBottom); }
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.revenue).toFixed(1); }).join(" ");
    var area = line + " L" + x(pts.length - 1).toFixed(1) + " " + (H - padBottom) + " L" + x(0).toFixed(1) + " " + (H - padBottom) + " Z";
    var dots = pts.map(function (p, i) { var last = i === pts.length - 1; return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.revenue).toFixed(1) + '" r="' + (last ? 5.6 : 4.6) + '" fill="url(#homeDotCore)"/>'; }).join("");
    var grid = "";
    for (var g = 1; g <= 3; g++) { var gy = padTop + ((H - padTop - padBottom) / 3) * g; grid += '<line x1="' + padX + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padX) + '" y2="' + gy.toFixed(1) + '" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>'; }
    var anim = S.shouldAnimateChart ? S.shouldAnimateChart("home-sales", pts.map(function (p) { return Number(p.revenue) || 0; }).join(",")) : false;
    box.innerHTML =
      '<svg class="' + (anim ? "hn-anim" : "") + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Ingresos por dia">' +
      '<defs>' +
      '<radialGradient id="homeDotCore" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#fff1e6"/><stop offset="45%" stop-color="#ff9457"/><stop offset="100%" stop-color="#ff5a2e"/></radialGradient>' +
      '<linearGradient id="homeArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(255,106,61,0.28)"/><stop offset="100%" stop-color="rgba(255,106,61,0)"/></linearGradient>' +
      '<filter id="homeGlow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<filter id="homeLineGlow" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '</defs>' + grid +
      '<path class="hn-area" d="' + area + '" fill="url(#homeArea)"/>' +
      '<path class="hn-line" pathLength="1" d="' + line + '" fill="none" stroke="#ff7a45" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" filter="url(#homeLineGlow)"/>' +
      '<g class="hn-dots" filter="url(#homeGlow)">' + dots + '</g></svg>';
  }

  // ---- Ventas por canal (dona SVG + leyenda con logos) ----
  var CH_COLORS = ["#ff6a3d", "#f5a623", "#ff3d2e", "#b24dff", "#52e1ff"];
  function renderChannels(ml) {
    var box = el("homeChannels"); if (!box) return;
    var mlRev = ml.perAccount.reduce(function (a, x) { return a + (x.revenue || 0); }, 0);
    // Canales reales + placeholders (Amazon/Tienda Mía/Shopee: aún sin conectar).
    var channels = [
      { name: "Mercado Libre", slug: "mercadolibre", value: mlRev, soon: false },
      { name: "Amazon", slug: "amazon", value: 0, soon: true },
      { name: "Tienda Mia", slug: "tiendamia", value: 0, soon: true },
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
        var av = animD ? ' style="--dlen:' + len.toFixed(2) + ';--dgap:' + gap.toFixed(2) + ';--ddur:' + Math.max(300, Math.round((len / C) * 1200)) + 'ms;--ddelay:' + Math.round((off / C) * 1200) + 'ms"' : "";
        segs += '<circle' + cls + av + ' cx="21" cy="21" r="15.9155" fill="none" stroke="' + CH_COLORS[i % CH_COLORS.length] + '" stroke-width="5" stroke-dasharray="' + len.toFixed(2) + ' ' + gap.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" stroke-linecap="butt" transform="rotate(-90 21 21)"/>';
        off += len;
      });
      donut = '<div class="home-donut"><svg' + svgCls + ' viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="21" r="15.9155" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="5"/>' + segs + '</svg><div class="home-donut-c"><b>' + curK(total) + '</b><small>Total</small></div></div>';
    } else {
      donut = '<div class="home-donut"><svg viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="21" r="15.9155" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="5"/></svg><div class="home-donut-c"><b>$0</b><small>Total</small></div></div>';
    }

    var legend = channels.map(function (c, i) {
      var p = total > 0 ? Math.round((c.value / total) * 100) : 0;
      var right = c.soon ? '<span class="home-ch-soon">Proximamente</span>' : '<b>' + p + '%</b>';
      var dot = c.soon ? '' : '<i style="background:' + CH_COLORS[Math.max(0, real.findIndex(function (r) { return r.slug === c.slug; })) % CH_COLORS.length] + '"></i>';
      return '<div class="home-ch' + (c.soon ? ' is-soon' : '') + '">' + logo(c.slug, 24) +
        '<span class="home-ch-name">' + esc(c.name) + '</span>' + dot + right + '</div>';
    }).join("");
    box.innerHTML = donut + '<div class="home-ch-legend">' + legend + '</div>';
  }

  // ---- Negocios (con logo de marketplace) ----
  function renderBiz(ml) {
    var box = el("homeBiz"); if (!box) return;
    var cards = [];
    ml.perAccount.forEach(function (a, idx) {
      var nombre = idx === 0 ? "Alpha Fitness" : "Alpha Fitness " + (idx + 1);
      // Cada tarjeta abre SU marketplace (deep-link #ecommerce-<id>), no una cuenta fija.
      cards.push(
        '<article class="home-biz-card" data-view="ecommerce-' + esc(a.id) + '" role="button" tabindex="0">' +
        '<div class="home-biz-top">' + logo("mercadolibre", 40) +
        '<span class="home-biz-badge ' + (a.connected ? "on" : "off") + '">' + (a.connected ? "Conectada" : "Sin conectar") + '</span></div>' +
        '<div class="home-biz-name">' + esc(nombre) + '<small>' + esc(a.name) + '</small></div>' +
        '<div class="home-biz-stat"><b>' + cur(a.revenue) + '</b><span>' + intn(a.orders) + ' ventas</span></div>' +
        '</article>');
    });
    [["Alpha Fitness BR", "Amazon Brasil", "amazon"], ["Alpha Store", "Tienda Mia", "tiendamia"], ["Alpha Shop", "Shopee", "shopee"]].forEach(function (p) {
      cards.push(
        '<article class="home-biz-card is-soon">' +
        '<div class="home-biz-top">' + logo(p[2], 40) +
        '<span class="home-biz-badge off">Proximamente</span></div>' +
        '<div class="home-biz-name">' + esc(p[0]) + '<small>' + esc(p[1]) + '</small></div>' +
        '<div class="home-biz-stat"><b>&mdash;</b><span>en evaluacion</span></div>' +
        '</article>');
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
      var delay = animG ? ' style="animation-delay:' + (i * 45) + 'ms"' : "";
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
    var ml = mlData(periodDays());
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
        renderHome();
      });
    }
    var biz = el("homeBiz");
    if (biz && !biz.dataset.bound) {
      biz.dataset.bound = "1";
      biz.addEventListener("click", function (e) { var card = e.target.closest(".home-biz-card[data-view]"); if (card && S.setView) S.setView(card.getAttribute("data-view")); });
      biz.addEventListener("keydown", function (e) { var card = e.target.closest(".home-biz-card[data-view]"); if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); card.click(); } });
    }
  }

  Object.assign(S, { renderHome: renderHome, initHome: initHome });
})();
