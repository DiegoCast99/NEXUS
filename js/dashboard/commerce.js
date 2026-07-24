/* ============================================================
   NEXUS Dashboard · Módulo · E-Commerce
   Parte de window.NexusDash — namespace compartido (sin build).
   ============================================================ */
(function () {
  const S = window.NexusDash;
  const { commerceApps, currency, demoCommerceData, drawCommerceTrendChart, elements, escapeHtml } = S;
  const { formatMetaDate, getCommerceApp, getCommerceConfig, getCommerceSnapshot, hasCommerceConnection, integerNumber, isMLApp } = S;
  const { ML_APP_ID, ML_AUTH_URL, moneyWithCents, saveCommerceConfigs, saveCommerceSnapshots, state, toDateInput } = S;
  const setCommerceMessage = S.createIntegrationMessenger({
    slice: () => state.commerce,
    getElement: () => elements.commerceMessage
  });

  const setMlMessage = S.createIntegrationMessenger({
    slice: () => state.commerce,
    getElement: () => elements.mlMessage
  });

  // ---- Config form (negocios genéricos) ----------------------

  function readCommerceConfigFromForm() {
    const apiToken = String(elements.commerceApiToken?.value || "").trim();
    const prev = getCommerceConfig();
    return {
      pixelId: String(elements.commercePixelId?.value || "").trim(),
      apiUrl: String(elements.commerceApiUrl?.value || "").trim(),
      apiToken,
      hasToken: Boolean(apiToken) || Boolean(prev && prev.hasToken),
      refreshInterval: elements.commerceRefreshInterval?.value || "0"
    };
  }

  function populateCommerceConfigForm() {
    const app = getCommerceApp();
    const config = getCommerceConfig(app.id);
    if (elements.commerceConfigTitle) elements.commerceConfigTitle.textContent = `Configurar ${app.name}`;
    if (elements.commercePixelId) elements.commercePixelId.value = config.pixelId || "";
    if (elements.commerceApiUrl) elements.commerceApiUrl.value = config.apiUrl || "";
    if (elements.commerceApiToken) {
      elements.commerceApiToken.value = config.apiToken || "";
      elements.commerceApiToken.placeholder = config.hasToken
        ? "•••••••• (guardado de forma segura)"
        : "API Token";
    }
    if (elements.commerceRefreshInterval) elements.commerceRefreshInterval.value = config.refreshInterval || "0";
  }

  // ---- Normalización y snapshots -----------------------------

  function buildDemoCommerceSnapshot(appId) {
    const rows = demoCommerceData[appId] || demoCommerceData.kairos;
    const orders = rows.map(([id, customer, product, status, total, margin, sessions, dayOffset]) => {
      const date = new Date();
      date.setDate(date.getDate() + dayOffset);
      return {
        id,
        customer,
        product,
        status,
        total,
        margin,
        sessions,
        date: toDateInput(date)
      };
    });
    return createCommerceSnapshot(orders, "demo");
  }

  function normalizeCommerceOrder(order, index = 0) {
    const total = Number(order.total ?? order.revenue ?? order.amount ?? order.value) || 0;
    const cost = Number(order.cost ?? order.cogs ?? 0);
    const margin = Number(order.margin ?? order.profit ?? (cost ? total - cost : total * 0.36)) || 0;
    return {
      id: String(order.id || order.orderId || order.name || `ORD-${Date.now()}-${index}`),
      customer: String(order.customer || order.customerName || order.email || "Cliente"),
      product: String(order.product || order.productName || order.item || "Producto"),
      status: String(order.status || order.paymentStatus || "Pagado"),
      total,
      margin,
      sessions: Number(order.sessions || order.visits || order.traffic || 0),
      // Campos de las metricas por periodo. Van explicitos porque esta funcion
      // se re-aplica sobre ordenes ya normalizadas y descartaria lo que no lista.
      units: Number(order.units ?? order.quantity ?? 1) || 1,
      commission: Number(order.commission ?? order.fee ?? 0) || 0,
      shipping: Number(order.shipping ?? order.shippingCost ?? 0) || 0,
      thumbnail: String(order.thumbnail || order.image || ""),
      stock: (order.stock === 0 || order.stock) ? Number(order.stock) : null,
      cancelled: Boolean(order.cancelled),
      refunded: Boolean(order.refunded),
      // Datos de Mercado Pago: idem, explicitos o se perderian al re-normalizar.
      releaseDate: String(order.releaseDate || ""),
      credited: Boolean(order.credited),
      paymentIds: Array.isArray(order.paymentIds) ? order.paymentIds : [],
      date: String(order.date || order.createdAt || toDateInput()).slice(0, 10)
    };
  }

  function aggregateCommerceProducts(orders) {
    const products = new Map();
    orders.forEach((order) => {
      const current = products.get(order.product) || { name: order.product, orders: 0, revenue: 0, margin: 0 };
      current.orders += 1;
      current.revenue += order.total;
      current.margin += order.margin;
      products.set(order.product, current);
    });
    return Array.from(products.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  }

  // Serie diaria del periodo. Con `range` se rellenan los dias sin ventas en 0,
  // asi la grafica muestra el periodo completo (y no salta dias vacios).
  function aggregateCommerceTrend(orders, range) {
    const days = new Map();
    orders.forEach((order) => {
      const current = days.get(order.date) || { date: order.date, revenue: 0, orders: 0 };
      current.revenue += order.total;
      current.orders += 1;
      days.set(order.date, current);
    });

    if (!range || !range.from || !range.to) {
      return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-10);
    }

    const serie = [];
    const cursor = new Date(range.from + "T12:00:00");
    const fin = new Date(range.to + "T12:00:00");
    let guard = 0;
    while (cursor <= fin && guard < 400) {
      const dia = toDateInput(cursor);
      serie.push(days.get(dia) || { date: dia, revenue: 0, orders: 0 });
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
    return serie;
  }

  // `extra` trae lo que no sale de las ordenes: visitas (API aparte) y el
  // rango del periodo consultado.
  function createCommerceSnapshot(orders, source, extra) {
    const info = extra || {};
    const normalizedOrders = orders.map(normalizeCommerceOrder);
    const totals = normalizedOrders.reduce((total, order) => ({
      revenue: total.revenue + order.total,
      margin: total.margin + order.margin,
      sessions: total.sessions + order.sessions,
      orders: total.orders + 1,
      units: total.units + (order.units || 1),
      commission: total.commission + (order.commission || 0),
      shipping: total.shipping + (order.shipping || 0),
      cancelledCount: total.cancelledCount + (order.cancelled ? 1 : 0),
      cancelledValue: total.cancelledValue + (order.cancelled ? order.total : 0),
      refundedCount: total.refundedCount + (order.refunded ? 1 : 0),
      refundedValue: total.refundedValue + (order.refunded ? order.total : 0)
    }), {
      revenue: 0, margin: 0, sessions: 0, orders: 0, units: 0,
      commission: 0, shipping: 0,
      cancelledCount: 0, cancelledValue: 0, refundedCount: 0, refundedValue: 0
    });

    // Visitas reales de ML si vinieron; si no, lo que traigan las ordenes.
    if (typeof info.visits === "number" && info.visits > 0) totals.sessions = info.visits;

    // Costos al estilo del panel de ML: cargos+envio es lo que te descuentan,
    // "recibiste" es lo que queda. Publicidad NO sale de la API de ordenes.
    totals.costs = totals.commission + totals.shipping;
    totals.received = totals.revenue - totals.costs;
    totals.costsPct = totals.revenue ? (totals.costs / totals.revenue) * 100 : 0;
    totals.receivedPct = totals.revenue ? (totals.received / totals.revenue) * 100 : 0;

    totals.aov = totals.orders ? totals.revenue / totals.orders : 0;
    totals.unitPrice = totals.units ? totals.revenue / totals.units : 0;
    totals.conversion = totals.sessions ? (totals.orders / totals.sessions) * 100 : 0;

    return {
      source,
      fetchedAt: new Date().toISOString(),
      appId: state.commerce.activeApp,
      range: info.range || null,
      totals,
      orders: normalizedOrders.sort((a, b) => b.date.localeCompare(a.date)),
      products: aggregateCommerceProducts(normalizedOrders),
      trend: aggregateCommerceTrend(normalizedOrders, info.range)
    };
  }

  // ---- Fetch genérico (commerce proxy) -----------------------

  async function fetchCommerceData(config) {
    const result = await S.requireSecureApi().commerceFetch({
      provider: "commerce:" + state.commerce.activeApp,
      apiUrl: config.apiUrl,
      pixelId: config.pixelId
    });
    const payload = (result && result.payload) || {};
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.orders)
        ? payload.orders
        : Array.isArray(payload.data)
          ? payload.data
          : [];
    return rows.map(normalizeCommerceOrder);
  }

  // ---- Mercado Libre: OAuth + fetch --------------------------

  function buildMLAuthUrl() {
    var redirectUri = window.location.origin + "/.netlify/functions/ml-oauth-callback";
    var mlState = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
    sessionStorage.setItem("nexus_ml_state_expected", mlState);
    // El dominio depende del pais de la cuenta: Brasil no valida contra el de Uruguay.
    return S.mlAuthUrl(activeMLId())
      + "?response_type=code"
      + "&client_id=" + encodeURIComponent(ML_APP_ID)
      + "&redirect_uri=" + encodeURIComponent(redirectUri)
      + "&state=" + encodeURIComponent(mlState);
  }

  // Cuenta de Mercado Libre abierta ahora. Todo el motor de ML (config, tokens,
  // snapshots, periodo, auto-sync) trabaja sobre esta, para que las cuentas no
  // se pisen entre si. Fuera del panel de ML cae en la primera.
  function activeMLId() {
    var id = state.commerce.selectedApp || state.commerce.activeApp;
    return isMLApp(id) ? id : "mercadolibre";
  }

  // La cuenta que se esta conectando viaja en el `state` del OAuth, porque al
  // volver de Mercado Libre la pagina se recarga y se pierde el estado en RAM.
  function mlConnectingAccount(id) {
    try {
      if (id) sessionStorage.setItem("nexus_ml_account", id);
      return sessionStorage.getItem("nexus_ml_account") || "mercadolibre";
    } catch (e) {
      return "mercadolibre";
    }
  }

  function startMLOAuth() {
    mlConnectingAccount(activeMLId());
    window.location.href = buildMLAuthUrl();
  }

  async function handleMlOAuthReturn() {
    var encBundle = sessionStorage.getItem("nexus_ml_enc");
    var returnedState = sessionStorage.getItem("nexus_ml_state");
    sessionStorage.removeItem("nexus_ml_enc");
    sessionStorage.removeItem("nexus_ml_state");

    if (!encBundle) return;

    var expectedState = sessionStorage.getItem("nexus_ml_state_expected");
    sessionStorage.removeItem("nexus_ml_state_expected");
    if (expectedState && returnedState !== expectedState) {
      console.warn("ML OAuth state mismatch");
      return;
    }

    try {
      var api = S.requireSecureApi();
      var cuenta = mlConnectingAccount();
      var result = await api.mlSaveTokens(encBundle, cuenta);
      state.commerce.configs[cuenta] = Object.assign(
        state.commerce.configs[cuenta] || S.defaultCommerceConfig(),
        { hasToken: true, mlUserId: (result && result.userId) || "" }
      );
      saveCommerceConfigs();
      selectCommerceApp(cuenta);
      setMlMessage("Cuenta de Mercado Libre conectada exitosamente.", "success");
    } catch (err) {
      console.error("ML OAuth save error:", err);
      selectCommerceApp(mlConnectingAccount());
      setMlMessage("Error al guardar tokens: " + (err.message || err), "error");
    }
  }

  function normalizeMLOrder(mlOrder, index) {
    var payments = mlOrder.payments || [];
    var orderItems = mlOrder.order_items || [];
    var total = payments.reduce(function (s, p) { return s + (p.total_paid_amount || 0); }, 0) || (mlOrder.total_amount || 0);

    // Comisión REAL de ML. Dos fuentes que vienen en la misma respuesta de
    // /orders/search (sin llamadas extra):
    //   1) payments[].marketplace_fee — comisión efectivamente cobrada en el pago.
    //   2) order_items[].sale_fee × quantity — tarifa de venta por publicación.
    // Usamos la primera si ML la informa; si no, la segunda. Si ML no informa
    // ninguna (raro), estimamos el 13% (comisión típica ML Uruguay) para no
    // mostrar un margen falso del 100%.
    var paymentFee = payments.reduce(function (s, p) { return s + (Number(p.marketplace_fee) || 0); }, 0);
    var itemFee = orderItems.reduce(function (s, i) {
      return s + ((Number(i.sale_fee) || 0) * (Number(i.quantity) || 1));
    }, 0);
    var commission = paymentFee > 0 ? paymentFee : itemFee > 0 ? itemFee : total * 0.13;

    // Envío pagado por el vendedor, si ML lo informa en el pago.
    var shipping = payments.reduce(function (s, p) { return s + (Number(p.shipping_cost) || 0); }, 0);

    var margin = total - commission - shipping;

    var items = orderItems.map(function (i) { return i.item ? i.item.title : "Producto"; });
    var product = items.join(", ") || "Producto ML";

    // Id de la primera publicacion: con el traemos foto y stock aparte
    // (la API de pedidos no los incluye).
    var firstItem = orderItems[0] && orderItems[0].item ? orderItems[0].item : null;
    var itemId = firstItem ? String(firstItem.id || "") : "";

    var statusMap = {
      paid: "Pagado", cancelled: "Cancelado", pending: "Pendiente",
      confirmed: "Confirmado", payment_required: "Pago requerido",
      payment_in_process: "En proceso"
    };
    var status = statusMap[mlOrder.status] || mlOrder.status || "Desconocido";

    var buyer = mlOrder.buyer || {};
    var customer = (buyer.first_name || "") + " " + (buyer.last_name || "");
    if (customer.trim().length === 0) customer = "Comprador ML";

    // Unidades reales del pedido (un pedido puede llevar varios items).
    var units = orderItems.reduce(function (s, i) { return s + (Number(i.quantity) || 0); }, 0) || 1;

    // ML no marca "devuelta" a nivel orden: lo inferimos del pago reembolsado,
    // que es la senal mas confiable sin sumar la API de reclamos.
    var refunded = payments.some(function (p) {
      return p.status === "refunded" || p.status === "charged_back";
    });

    // Liberacion del dinero. /orders/search NO informa money_release_date: ese
    // dato vive en el detalle del pago, en api.mercadopago.com. Aca se guardan
    // los ids de los pagos aprobados para poder consultarlo despues; si por
    // casualidad ML ya lo mandara, se aprovecha.
    var aprobados = payments.filter(function (p) { return p.status === "approved"; });
    var liberacion = "";
    aprobados.forEach(function (p) {
      var d = p.money_release_date || p.date_released || "";
      // Se toma la mas TARDIA: la plata esta toda disponible recien ahi.
      if (d && (!liberacion || String(d) > liberacion)) liberacion = String(d);
    });
    var acreditado = aprobados.length > 0;
    var idsPago = aprobados.map(function (p) { return String(p.id || ""); }).filter(Boolean);

    return {
      id: String(mlOrder.id || "ML-" + index),
      customer: customer.trim(),
      product: product,
      status: status,
      total: total,
      margin: margin,
      sessions: 0,
      units: units,
      // Comision y envio van sueltos (ademas de restados en el margen) para
      // poder desglosar los costos, como hace el panel de ML.
      commission: commission,
      shipping: shipping,
      cancelled: mlOrder.status === "cancelled",
      refunded: refunded,
      itemId: itemId,
      thumbnail: "",
      stock: null,
      // Mercado Pago: cuando se libera la plata de esta venta y si ya se acredito.
      releaseDate: liberacion,
      credited: acreditado,
      paymentIds: idsPago,
      date: String(mlOrder.date_created || "").slice(0, 10) || toDateInput()
    };
  }

  // Trae foto (secure_thumbnail) y stock (available_quantity) de las
  // publicaciones vendidas y se los pega a cada pedido. Usa el multiget de ML
  // (/items?ids=...) que acepta hasta 20 ids por llamada. Best-effort: si
  // falla, los pedidos se muestran igual, sin foto.
  async function enrichMLOrdersWithItems(orders) {
    var ids = [];
    var vistos = {};
    orders.forEach(function (o) {
      if (o.itemId && !vistos[o.itemId]) { vistos[o.itemId] = true; ids.push(o.itemId); }
    });
    if (!ids.length) return orders;

    var api = S.requireSecureApi();
    var mapa = {};
    for (var i = 0; i < ids.length; i += 20) {
      var lote = ids.slice(i, i + 20);
      try {
        var endpoint = "/items?ids=" + lote.join(",") +
          "&attributes=id,secure_thumbnail,thumbnail,available_quantity";
        var result = await api.mlApi(endpoint, "GET", null, activeMLId());
        var rows = (result.payload || []);
        rows.forEach(function (row) {
          var body = row && row.body ? row.body : null;
          if (!body || !body.id) return;
          mapa[String(body.id)] = {
            thumbnail: body.secure_thumbnail || body.thumbnail || "",
            stock: (typeof body.available_quantity === "number") ? body.available_quantity : null
          };
        });
      } catch (e) {
        console.warn("No se pudieron traer fotos/stock de ML:", e && e.message);
      }
    }

    orders.forEach(function (o) {
      var info = mapa[o.itemId];
      if (info) { o.thumbnail = info.thumbnail; o.stock = info.stock; }
    });
    return orders;
  }

  // ---- Periodo (estilo panel de Mercado Libre) ---------------

  var PERIOD_PRESETS = ["7", "15", "30"];

  // Devuelve el rango elegido como fechas YYYY-MM-DD (inclusive).
  function getPeriodRange(config) {
    var cfg = config || getCommerceConfig(activeMLId());
    var preset = cfg.period || "30";
    var hoy = new Date();
    var to = toDateInput(hoy);
    var from;

    if (preset === "custom" && cfg.periodFrom && cfg.periodTo) {
      from = cfg.periodFrom;
      to = cfg.periodTo;
    } else {
      var dias = PERIOD_PRESETS.indexOf(preset) !== -1 ? Number(preset) : 30;
      var desde = new Date(hoy);
      // "Ultimos 7 dias" incluye hoy: 6 dias atras + hoy = 7.
      desde.setDate(desde.getDate() - (dias - 1));
      from = toDateInput(desde);
    }
    if (from > to) { var tmp = from; from = to; to = tmp; }
    return { from: from, to: to };
  }

  function periodLabel(range) {
    var f = range.from.split("-"), t = range.to.split("-");
    return f[2] + "/" + f[1] + " al " + t[2] + "/" + t[1];
  }

  // Dibuja el selector de cuentas de ML y marca la abierta. Solo se ve dentro
  // del panel de Mercado Libre (las otras plataformas no tienen cuentas).
  function renderMLAccountSelect() {
    // El selector solo existe con el panel de una cuenta de ML ABIERTO. El
    // chequeo de selectedApp va explicito: isMLApp(null) cae en activeApp (el
    // ultimo negocio usado), asi que en la pantalla de tarjetas daria true.
    var esML = Boolean(state.commerce.selectedApp) && isMLApp(state.commerce.selectedApp);
    elements.mlAccountField?.classList.toggle("is-hidden", !esML);
    if (!esML || !elements.mlAccountSelect) return;

    var actual = activeMLId();
    // Solo las cuentas de esta tarjeta: Mercado Livre (Brasil) es otra tarjeta
    // y no debe aparecer entre las de Uruguay.
    var cuentas = S.mlAccountsFor(actual);
    // Con una sola cuenta el selector no aporta nada.
    if (cuentas.length < 2) {
      elements.mlAccountField?.classList.add("is-hidden");
      return;
    }
    var html = cuentas.map(function (acc) {
      var cfg = getCommerceConfig(acc.id);
      var estado = cfg.hasToken ? "" : " (sin conectar)";
      return '<option value="' + acc.id + '">' + escapeHtml(acc.name + estado) + "</option>";
    }).join("");
    if (elements.mlAccountSelect.innerHTML !== html) elements.mlAccountSelect.innerHTML = html;
    elements.mlAccountSelect.value = actual;
  }

  // Cambia de cuenta: es entrar a otra "app", asi que reusa selectCommerceApp
  // (que ya trae los datos de esa cuenta y reprograma el auto-sync).
  function selectMLAccount(id) {
    if (!isMLApp(id) || id === activeMLId()) return;
    selectCommerceApp(id);
  }

  // Refleja en la UI el periodo guardado (y muestra las fechas solo si es custom).
  function renderPeriodBar(config, snapshot) {
    var cfg = config || getCommerceConfig(activeMLId());
    var preset = cfg.period || "30";
    var esCustom = preset === "custom";
    var range = getPeriodRange(cfg);

    if (elements.commercePeriod) elements.commercePeriod.value = preset;
    elements.commercePeriodFromField?.classList.toggle("is-hidden", !esCustom);
    elements.commercePeriodToField?.classList.toggle("is-hidden", !esCustom);
    if (elements.commercePeriodFrom) elements.commercePeriodFrom.value = cfg.periodFrom || range.from;
    if (elements.commercePeriodTo) elements.commercePeriodTo.value = cfg.periodTo || range.to;
    if (elements.commercePeriodLabel) elements.commercePeriodLabel.textContent = periodLabel(range);
  }

  // Guarda el periodo elegido y vuelve a traer los datos de ese rango.
  function applyPeriodChange() {
    var cfg = getCommerceConfig(activeMLId());
    var preset = elements.commercePeriod?.value || "30";
    var next = { ...cfg, period: preset };

    if (preset === "custom") {
      next.periodFrom = elements.commercePeriodFrom?.value || getPeriodRange(cfg).from;
      next.periodTo = elements.commercePeriodTo?.value || toDateInput();
    }
    state.commerce.configs[activeMLId()] = next;
    saveCommerceConfigs();
    renderCommerceDashboard();

    // Sin fechas completas todavia (custom recien elegido): no dispares el sync.
    if (preset === "custom" && (!next.periodFrom || !next.periodTo)) return;
    if (!next.hasToken) return;
    state.commerce.failCount = 0;
    syncMercadoLibre({ silent: false });
  }

  // ML espera ISO con zona; el dia "hasta" va completo (hasta las 23:59:59).
  function isoFrom(d) { return d + "T00:00:00.000-00:00"; }
  function isoTo(d) { return d + "T23:59:59.999-00:00"; }

  async function getMLUserId(api) {
    var config = getCommerceConfig(activeMLId());
    var userId = config.mlUserId || "";
    if (!userId) {
      var meResult = await api.mlApi("/users/me", "GET", null, activeMLId());
      userId = String((meResult.payload || {}).id || "");
      if (userId) {
        state.commerce.configs[activeMLId()].mlUserId = userId;
        saveCommerceConfigs();
      }
    }
    if (!userId) throw new Error("No se pudo obtener el user ID de ML.");
    return userId;
  }

  async function fetchMLOrders(range) {
    var api = S.requireSecureApi();
    var userId = await getMLUserId(api);
    var r = range || getPeriodRange();

    var allOrders = [];
    var offset = 0;
    var limit = 50;
    var maxPages = 8; // hasta 400 ordenes en el periodo

    for (var page = 0; page < maxPages; page++) {
      var endpoint = "/orders/search?seller=" + userId +
        "&order.date_created.from=" + encodeURIComponent(isoFrom(r.from)) +
        "&order.date_created.to=" + encodeURIComponent(isoTo(r.to)) +
        "&sort=date_desc&limit=" + limit + "&offset=" + offset;
      var result = await api.mlApi(endpoint, "GET", null, activeMLId());
      var payload = result.payload || {};
      var results = payload.results || [];
      allOrders = allOrders.concat(results);

      var paging = payload.paging || {};
      if (results.length === 0 || offset + limit >= (paging.total || 0)) break;
      offset += limit;
    }

    return allOrders.map(normalizeMLOrder);
  }

  // Visitas a las publicaciones del vendedor en el periodo.
  // Endpoint distinto al de ordenes: /users/{id}/items_visits.
  // Si falla (ML tarda 48h en consolidar, o el rango excede 150 dias) no
  // rompemos el sync: devolvemos 0 y las ventas igual se muestran.
  async function fetchMLVisits(range) {
    try {
      var api = S.requireSecureApi();
      var userId = await getMLUserId(api);
      var r = range || getPeriodRange();
      var endpoint = "/users/" + userId + "/items_visits" +
        "?date_from=" + encodeURIComponent(isoFrom(r.from)) +
        "&date_to=" + encodeURIComponent(isoTo(r.to));
      var result = await api.mlApi(endpoint, "GET", null, activeMLId());
      var payload = result.payload || {};
      return Number(payload.total_visits) || 0;
    } catch (e) {
      console.warn("No se pudieron traer las visitas de ML:", e && e.message);
      return 0;
    }
  }

  async function disconnectML() {
    // Frenar el "en vivo" primero: sin token, cada tick fallaria.
    window.clearInterval(state.commerce.mlRefreshTimer);
    state.commerce.mlRefreshTimer = 0;
    state.commerce.failCount = 0;
    state.commerce.configs[activeMLId()] = S.defaultCommerceConfig();
    delete state.commerce.snapshots[activeMLId()];
    saveCommerceConfigs();
    saveCommerceSnapshots();
    setMlMessage("Mercado Libre desconectado.", "success");
    renderCommerceDashboard();
  }

  // ---- Render ------------------------------------------------

  // Estado de una tarjeta: para un contenedor resume cuantas plataformas tiene
  // conectadas; para un negocio suelto, si tiene datos.
  function commerceCardStatus(app) {
    if (S.isCommerceGroup(app.id)) {
      const hijos = S.getCommerceChildren(app.id);
      const conectadas = hijos.filter((h) => {
        const c = getCommerceConfig(h.id);
        return c.hasToken || state.commerce.snapshots[h.id]?.source === "live";
      }).length;
      return conectadas
        ? `${conectadas} de ${hijos.length} conectadas`
        : `${hijos.length} plataformas`;
    }
    const snapshot = state.commerce.snapshots[app.id];
    const config = getCommerceConfig(app.id);
    if (isMLApp(app.id) && config.hasToken) return "Conectado (OAuth)";
    if (snapshot?.source === "live") return "Conectado";
    if (snapshot?.source === "demo") return "Demo activo";
    return "Sin datos";
  }

  // Muestra las plataformas del contenedor abierto, o los negocios de primer
  // nivel si no hay ninguno abierto.
  function renderCommerceSwitcher() {
    if (!elements.commerceAppSwitcher) return;
    const grupo = state.commerce.selectedGroup;
    const apps = grupo ? S.getCommerceChildren(grupo) : S.getCommerceRoots();

    elements.commerceAppSwitcher.innerHTML = apps.map((app) => `
      <button class="commerce-app-button ${state.commerce.selectedApp === app.id ? "is-active" : ""}" type="button" data-commerce-app="${app.id}">
        <i style="background:linear-gradient(90deg, ${app.accent}, var(--cyan))"></i>
        <b>${escapeHtml(app.name)}</b>
        <small>${escapeHtml(app.model)} · ${commerceCardStatus(app)}</small>
      </button>
    `).join("");

    // Volver al primer nivel solo tiene sentido dentro de un contenedor, y con
    // el panel de datos cerrado (si esta abierto manda su propio "volver").
    const enTarjetas = !state.commerce.selectedApp;
    elements.commerceGroupBack?.classList.toggle("is-hidden", !grupo || !enTarjetas);
  }

  function updateMLPanel() {
    var config = getCommerceConfig(activeMLId());
    var connected = Boolean(config.hasToken);

    elements.mlConnectButton?.classList.toggle("is-hidden", connected);
    elements.mlSyncButton?.classList.toggle("is-hidden", !connected);
    elements.mlDemoButton?.classList.toggle("is-hidden", connected);
    elements.mlDisconnectButton?.classList.toggle("is-hidden", !connected);

    if (elements.mlConnectStatus) {
      elements.mlConnectStatus.textContent = connected ? "Conectado" : "Desconectado";
      elements.mlConnectStatus.classList.toggle("commerce-status-live", connected);
    }
    // El nombre sale de la cuenta abierta: en Brasil es "Mercado Livre", y con
    // dos cuentas de Uruguay dice cual de las dos esta conectada.
    var nombreCuenta = S.mlAccountById(activeMLId())?.name || "Mercado Libre";
    if (elements.mlConnectTitle) {
      elements.mlConnectTitle.textContent = connected ? nombreCuenta + " conectado" : "Conectar cuenta";
    }
    if (elements.mlConnectDesc) {
      elements.mlConnectDesc.textContent = connected
        ? "Tu cuenta esta vinculada. Podes sincronizar ventas o desconectarla."
        : "Conecta tu cuenta de " + nombreCuenta + " para sincronizar ventas, pedidos y productos.";
    }
    if (elements.mlConnectButton) {
      elements.mlConnectButton.textContent = "Conectar con " + nombreCuenta;
    }

    // Auto-sync: solo tiene sentido con la cuenta conectada.
    elements.mlRefreshField?.classList.toggle("is-hidden", !connected);
    if (elements.mlRefreshInterval) {
      elements.mlRefreshInterval.value = config.refreshInterval || "0";
    }
  }

  function renderCommerceDashboard() {
    var hasApp = !!state.commerce.selectedApp;
    var ml = isMLApp(state.commerce.selectedApp);

    elements.commerceAppSwitcher?.classList.toggle("is-hidden", hasApp);
    elements.commerceWorkspace?.classList.toggle("is-hidden", !hasApp);

    elements.mlConnectPanel?.classList.toggle("is-hidden", !(hasApp && ml));
    elements.commerceConfigForm?.classList.toggle("is-hidden", !hasApp || ml);

    // Fuera de updateMLPanel a proposito: tiene que correr SIEMPRE, porque es
    // quien oculta el selector de cuentas al entrar a una plataforma que no es
    // Mercado Libre (si viviera adentro, solo correria cuando hay que mostrarlo).
    renderMLAccountSelect();
    if (ml) updateMLPanel();

    const app = getCommerceApp();
    const config = getCommerceConfig(app.id);
    const snapshot = getCommerceSnapshot(app.id);
    const totals = snapshot?.totals || { revenue: 0, orders: 0, aov: 0, conversion: 0, sessions: 0, margin: 0 };
    const sourceLabel = snapshot?.source === "live" ? "API real" : snapshot?.source === "demo" ? "Demo" : "Datos locales";

    renderCommerceSwitcher();
    if (!ml) populateCommerceConfigForm();

    if (elements.commerceDataSource) elements.commerceDataSource.textContent = sourceLabel;
    if (elements.commerceRevenueValue) elements.commerceRevenueValue.textContent = currency.format(totals.revenue || 0);
    if (elements.commerceRevenueHint) elements.commerceRevenueHint.textContent = snapshot ? `${snapshot.orders.length} pedido${snapshot.orders.length === 1 ? "" : "s"}` : "Sin datos sincronizados";
    if (elements.commerceOrdersValue) elements.commerceOrdersValue.textContent = integerNumber.format(totals.orders || 0);
    if (elements.commerceOrdersHint) elements.commerceOrdersHint.textContent = `${app.name} · periodo activo`;
    if (elements.commerceAovValue) elements.commerceAovValue.textContent = moneyWithCents.format(totals.aov || 0);
    if (elements.commerceConversionValue) elements.commerceConversionValue.textContent = `${(totals.conversion || 0).toFixed(1)}%`;
    if (elements.commerceTrafficHint) {
      elements.commerceTrafficHint.textContent = totals.sessions
        ? `${integerNumber.format(totals.orders || 0)} de ${integerNumber.format(totals.sessions)} visitas`
        : "Sin visitas informadas";
    }
    if (elements.commerceMarginValue) elements.commerceMarginValue.textContent = currency.format(totals.margin || 0);
    if (elements.commerceMarginHint) elements.commerceMarginHint.textContent = totals.revenue ? `${((totals.margin / totals.revenue) * 100).toFixed(1)}% sobre ventas` : "Rentabilidad estimada";

    // --- Metricas por periodo (estilo panel de Mercado Libre) ---
    if (elements.commerceUnitsValue) elements.commerceUnitsValue.textContent = integerNumber.format(totals.units || 0);
    if (elements.commerceUnitsHint) {
      elements.commerceUnitsHint.textContent = totals.orders
        ? `${(((totals.units || 0) / totals.orders) || 0).toFixed(1)} por venta`
        : "Items despachados";
    }
    if (elements.commerceVisitsValue) elements.commerceVisitsValue.textContent = integerNumber.format(totals.sessions || 0);
    if (elements.commerceVisitsHint) {
      elements.commerceVisitsHint.textContent = ml
        ? (totals.sessions ? "Visitas a tus publicaciones" : "ML tarda hasta 48 h en informarlas")
        : "Visitas a tus publicaciones";
    }
    if (elements.commerceUnitPriceValue) elements.commerceUnitPriceValue.textContent = moneyWithCents.format(totals.unitPrice || 0);
    if (elements.commerceCancelledCountValue) elements.commerceCancelledCountValue.textContent = integerNumber.format(totals.cancelledCount || 0);
    if (elements.commerceCancelledCountHint) {
      elements.commerceCancelledCountHint.textContent = totals.orders
        ? `${((((totals.cancelledCount || 0) / totals.orders) * 100) || 0).toFixed(1)}% de las ventas`
        : "Sin cancelaciones";
    }
    if (elements.commerceCancelledValue) elements.commerceCancelledValue.textContent = currency.format(totals.cancelledValue || 0);
    if (elements.commerceRefundedCountValue) elements.commerceRefundedCountValue.textContent = integerNumber.format(totals.refundedCount || 0);
    if (elements.commerceRefundedCountHint) {
      elements.commerceRefundedCountHint.textContent = totals.orders
        ? `${((((totals.refundedCount || 0) / totals.orders) * 100) || 0).toFixed(1)}% de las ventas`
        : "Pagos reembolsados";
    }
    if (elements.commerceRefundedValue) elements.commerceRefundedValue.textContent = currency.format(totals.refundedValue || 0);

    // Barra de periodo: solo tiene sentido con Mercado Libre (trae por rango).
    elements.commercePeriodBar?.classList.toggle("is-hidden", !ml);
    if (ml) renderPeriodBar(config, snapshot);
    if (elements.commerceStatusValue) {
      elements.commerceStatusValue.textContent = state.commerce.syncing ? "Sync" : snapshot?.source === "live" ? "Live" : snapshot?.source === "demo" ? "Demo" : "Offline";
      elements.commerceStatusValue.classList.toggle("commerce-status-live", snapshot?.source === "live");
      elements.commerceStatusValue.classList.toggle("commerce-status-demo", snapshot?.source === "demo");
    }
    if (elements.commerceStatusHint) elements.commerceStatusHint.textContent = snapshot ? `${sourceLabel} · ${formatMetaDate(snapshot.fetchedAt)}` : "Conecta datos o demo";
    if (elements.commerceActiveLabel) elements.commerceActiveLabel.textContent = app.name;
    if (elements.commercePixelLabel) elements.commercePixelLabel.textContent = ml ? (config.mlUserId || "OAuth") : (config.pixelId || "No configurado");
    if (elements.commerceEndpointLabel) elements.commerceEndpointLabel.textContent = ml ? "api.mercadolibre.com" : (config.apiUrl || "No configurado");
    if (elements.commerceLastSync) elements.commerceLastSync.textContent = formatMetaDate(snapshot?.fetchedAt);

    const orders = snapshot?.orders || [];
    if (elements.commerceOrdersTable) {
      elements.commerceOrdersTable.innerHTML = orders.slice(0, 12).map((order) => {
        var foto = order.thumbnail
          ? `<img class="order-thumb" src="${escapeHtml(order.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'" />`
          : `<span class="order-thumb order-thumb-empty" aria-hidden="true"></span>`;
        var stockLine = (order.stock === 0 || order.stock)
          ? `<small class="order-stock">Stock: ${integerNumber.format(order.stock)} u.</small>`
          : "";
        return `
        <tr data-order-id="${escapeHtml(order.id)}">
          <td>${escapeHtml(order.id)}</td>
          <td>${escapeHtml(order.customer)}</td>
          <td class="order-product">
            <div class="order-product-cell">
              ${foto}
              <div class="order-product-info">
                <b>${escapeHtml(order.product)}</b>
                ${stockLine}
              </div>
            </div>
          </td>
          <td><span class="type-pill income">${escapeHtml(order.status)}</span></td>
          <td>${moneyWithCents.format(order.total)}</td>
          <td class="${order.margin >= 0 ? "amount-income" : "amount-expense"}">${moneyWithCents.format(order.margin)}</td>
        </tr>
      `;
      }).join("");
    }
    elements.commerceEmptyState?.classList.toggle("is-visible", orders.length === 0);

    if (elements.commerceProductList) {
      const products = snapshot?.products || [];
      elements.commerceProductList.innerHTML = products.length
        ? products.map((product) => `<div><span>${escapeHtml(product.name)}</span><b>${moneyWithCents.format(product.revenue)} · ${product.orders} pedidos</b></div>`).join("")
        : `<div><span>Sin productos</span><b>Sincroniza ${escapeHtml(app.name)} para ver rendimiento.</b></div>`;
    }

    // Panel de costos: 3 numeros + dona (solo Mercado Libre trae comision/envio).
    elements.commerceCostsPanel?.classList.toggle("is-hidden", !ml);
    if (ml) {
      if (elements.commerceCostsRevenue) elements.commerceCostsRevenue.textContent = currency.format(totals.revenue || 0);
      if (elements.commerceCostsUnits) elements.commerceCostsUnits.textContent = `${integerNumber.format(totals.units || 0)} unidades`;
      if (elements.commerceCostsCharges) elements.commerceCostsCharges.textContent = "- " + currency.format(totals.costs || 0);
      if (elements.commerceCostsChargesPct) elements.commerceCostsChargesPct.textContent = `${(totals.costsPct || 0).toFixed(1)}% de las ventas`;
      if (elements.commerceCostsReceived) elements.commerceCostsReceived.textContent = currency.format(totals.received || 0);
      if (elements.commerceCostsReceivedPct) elements.commerceCostsReceivedPct.textContent = `${(totals.receivedPct || 0).toFixed(1)}% de las ventas`;
    }

    drawCommerceTrendChart();
    if (ml) S.drawCommerceCostsChart();
  }

  // ---- Deep-link desde la notificacion de venta --------------

  // Espera a que la fila del pedido aparezca en la tabla (el sync al entrar
  // al panel puede tardar unos segundos en traer la venta nueva).
  function waitForOrderRow(orderId, timeoutMs) {
    var safe = String(orderId).replace(/"/g, '\\"');
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var row = elements.commerceOrdersTable
          ? elements.commerceOrdersTable.querySelector('[data-order-id="' + safe + '"]')
          : null;
        if (row) return resolve(row);
        if (Date.now() - t0 > timeoutMs) return resolve(null);
        window.setTimeout(poll, 400);
      })();
    });
  }

  // Aterriza en la venta que disparo la notificacion: abre la cuenta, va a
  // Pedidos, espera a que el sync la traiga y la resalta. Funciona para
  // cualquier cuenta del modulo (ML 1, ML 2, Brasil y las que vengan).
  async function openSaleDeepLink(accountId, orderId, timeoutMs) {
    var app = getCommerceApp(accountId);
    if (!app) return; // cuenta desconocida: quedo la portada de E-Commerce
    selectCommerceApp(accountId);
    window.NexusPlatformNav?.setSection("pedidos");

    var row = await waitForOrderRow(orderId, timeoutMs || 12000);
    if (!row) {
      setMlMessage("La venta " + orderId + " todavia no aparece en el periodo actual.", "error");
      return;
    }
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("order-row-flash");
    window.setTimeout(function () { row.classList.remove("order-row-flash"); }, 7000);
  }

  // ---- Publicaciones (catalogo de ML con escritura) ----------

  function setListingsMessage(msg, type) {
    var el = elements.mlListingsMessage;
    if (!el) return;
    el.textContent = msg || "";
    el.className = "meta-message" + (type ? " is-" + type : "");
  }

  function mlListingsState() {
    var id = activeMLId();
    if (!state.commerce.mlListings[id]) {
      state.commerce.mlListings[id] = { items: null, loading: false, fetchedAt: null };
    }
    return state.commerce.mlListings[id];
  }

  var LISTING_STATUS = {
    active: "Activa", paused: "Pausada", closed: "Cerrada",
    under_review: "En revision", inactive: "Inactiva"
  };

  // Trae el catalogo: ids con /users/{uid}/items/search y detalle con el
  // multiget (20 por llamada). Hasta 200 publicaciones.
  async function loadMLListings(force) {
    if (!isMLApp(state.commerce.selectedApp)) return;
    var slot = mlListingsState();
    if (slot.loading) return;
    if (slot.items && !force) { renderMLListings(); return; }
    var config = getCommerceConfig(activeMLId());
    if (!config.hasToken) {
      setListingsMessage("Conecta tu cuenta de Mercado Libre para ver tus publicaciones.", "error");
      return;
    }

    slot.loading = true;
    renderMLListings();
    setListingsMessage("Cargando publicaciones...", "");
    try {
      var api = S.requireSecureApi();
      var userId = await getMLUserId(api);
      var cuenta = activeMLId();

      var ids = [];
      var offset = 0;
      for (var page = 0; page < 4; page++) {
        var res = await api.mlApi("/users/" + userId + "/items/search?limit=50&offset=" + offset, "GET", null, cuenta);
        var payload = res.payload || {};
        var lote = payload.results || [];
        ids = ids.concat(lote);
        var total = (payload.paging && payload.paging.total) || 0;
        offset += 50;
        if (!lote.length || offset >= total) break;
      }

      var items = [];
      for (var i = 0; i < ids.length; i += 20) {
        var grupo = ids.slice(i, i + 20);
        var det = await api.mlApi(
          "/items?ids=" + grupo.join(",") +
          "&attributes=id,title,price,currency_id,available_quantity,sold_quantity,status,secure_thumbnail,thumbnail,permalink,variations",
          "GET", null, cuenta
        );
        (det.payload || []).forEach(function (row) {
          var b = row && row.body ? row.body : null;
          if (!b || !b.id) return;
          items.push({
            id: String(b.id),
            title: String(b.title || ""),
            price: Number(b.price) || 0,
            stock: (typeof b.available_quantity === "number") ? b.available_quantity : null,
            sold: Number(b.sold_quantity) || 0,
            status: String(b.status || ""),
            thumbnail: b.secure_thumbnail || b.thumbnail || "",
            permalink: b.permalink || "",
            hasVariations: Array.isArray(b.variations) && b.variations.length > 0,
            expanded: false,
            // Detalle por variante: el stock de estos combos se edita ACA,
            // variante por variante (sabor por sabor), nunca por el total.
            variations: (b.variations || []).map(function (v) {
              var etiqueta = (v.attribute_combinations || [])
                .map(function (c) { return c.value_name; })
                .filter(Boolean).join(" / ");
              return {
                id: String(v.id),
                label: etiqueta || ("Variante " + v.id),
                price: Number(v.price) || 0,
                sold: Number(v.sold_quantity) || 0,
                stock: (typeof v.available_quantity === "number") ? v.available_quantity : null
              };
            })
          });
        });
      }

      slot.items = items;
      slot.fetchedAt = new Date().toISOString();
      setListingsMessage(items.length + " publicaciones cargadas.", "success");
    } catch (e) {
      setListingsMessage("No se pudieron cargar las publicaciones: " + (e.message || e), "error");
    } finally {
      slot.loading = false;
      renderMLListings();
    }
  }

  // Cambios pendientes (stock y estado) que todavia NO se mandaron a ML.
  // Nada toca la tienda real hasta que el titular aprieta "Guardar cambios".
  function pendingChanges() {
    var items = mlListingsState().items || [];
    var lista = [];
    items.forEach(function (item) {
      if (item.pendingStatus && item.pendingStatus !== item.status) {
        lista.push({ type: "status", item: item, value: item.pendingStatus });
      }
      if (!item.hasVariations && item.pendingStock !== undefined && item.pendingStock !== item.stock) {
        lista.push({ type: "stock", item: item, value: item.pendingStock });
      }
      (item.variations || []).forEach(function (v) {
        if (v.pendingStock !== undefined && v.pendingStock !== v.stock) {
          lista.push({ type: "varstock", item: item, variation: v, value: v.pendingStock });
        }
      });
    });
    return lista;
  }

  function renderSaveButton() {
    var btn = elements.mlListingsSave;
    if (!btn) return;
    var n = pendingChanges().length;
    btn.textContent = n ? "Guardar cambios (" + n + ")" : "Guardar cambios";
    btn.disabled = n === 0;
    btn.classList.toggle("has-pending", n > 0);
  }

  // Guarda en memoria lo que el titular escribe/togglea, sin llamar a ML.
  function markPendingStock(itemId, variantId, valor) {
    var item = findListing(itemId);
    if (!item) return;
    var num = String(valor).trim() === "" ? undefined : Number(valor);
    if (variantId) {
      var v = (item.variations || []).find(function (x) { return x.id === variantId; });
      if (v) v.pendingStock = num;
    } else {
      item.pendingStock = num;
    }
    renderSaveButton();
    marcarFilaSucia(itemId, variantId);
  }

  function marcarFilaSucia(itemId, variantId) {
    var sel = variantId
      ? '[data-variant-stock="' + itemId + '::' + variantId + '"]'
      : '[data-listing-stock="' + itemId + '"]';
    var input = elements.mlListingsTable?.querySelector(sel);
    if (!input) return;
    var item = findListing(itemId);
    var actual = variantId
      ? (item.variations || []).find(function (x) { return x.id === variantId; })
      : item;
    var sucio = actual && actual.pendingStock !== undefined && actual.pendingStock !== actual.stock;
    input.classList.toggle("is-dirty", Boolean(sucio));
  }

  function toggleListingStatus(itemId) {
    var item = findListing(itemId);
    if (!item) return;
    if (item.status !== "active" && item.status !== "paused") {
      setListingsMessage("Esta publicacion esta en estado '" + item.status + "': se gestiona desde Mercado Libre.", "error");
      return;
    }
    var actual = item.pendingStatus || item.status;
    item.pendingStatus = actual === "active" ? "paused" : "active";
    renderMLListings();
  }

  function renderMLListings() {
    if (!elements.mlListingsTable) return;
    var slot = mlListingsState();
    var items = slot.items || [];

    elements.mlListingsEmpty?.classList.toggle("is-visible", !slot.loading && items.length === 0);

    elements.mlListingsTable.innerHTML = items.map(function (item) {
      var foto = item.thumbnail
        ? '<img class="order-thumb" src="' + escapeHtml(item.thumbnail) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'" />'
        : '<span class="order-thumb order-thumb-empty" aria-hidden="true"></span>';

      // El stock de los combos con variantes se edita variante por variante:
      // el total es solo informativo y la flechita despliega la lista.
      var nVars = (item.variations || []).length;
      var stockVal = item.pendingStock !== undefined ? item.pendingStock : item.stock;
      var stockSucio = item.pendingStock !== undefined && item.pendingStock !== item.stock;
      var stockCell = item.hasVariations
        ? '<span class="listing-stock-ro">' + (item.stock === null ? "-" : integerNumber.format(item.stock)) + '</span><small class="listing-variants-note">' + nVars + ' variante' + (nVars === 1 ? "" : "s") + '</small>'
        : '<input type="number" min="0" step="1" class="listing-stock-input' + (stockSucio ? " is-dirty" : "") + '" value="' + (stockVal === null || stockVal === undefined ? "" : stockVal) + '" data-listing-stock="' + escapeHtml(item.id) + '" />';

      var chevron = item.hasVariations
        ? '<button class="listing-expand" type="button" data-action="expand" data-listing-id="' + escapeHtml(item.id) + '" aria-expanded="' + (item.expanded ? "true" : "false") + '" aria-label="Ver variantes">' + (item.expanded ? "\u25be" : "\u25b8") + '</button>'
        : '<span class="listing-expand-spacer" aria-hidden="true"></span>';

      // Interruptor de estado: prendido = activa, apagado = pausada. Refleja el
      // valor pendiente si lo hay, para que se vea el cambio antes de guardar.
      var estadoActual = item.pendingStatus || item.status;
      var activa = estadoActual === "active";
      var editable = item.status === "active" || item.status === "paused";
      var estadoCell = editable
        ? '<button class="listing-switch' + (activa ? " is-on" : "") + (item.pendingStatus && item.pendingStatus !== item.status ? " is-dirty" : "") + '" type="button" role="switch" aria-checked="' + (activa ? "true" : "false") + '" data-action="switch" data-listing-id="' + escapeHtml(item.id) + '" aria-label="' + (activa ? "Pausar publicacion" : "Activar publicacion") + '" title="' + (activa ? "Activa" : "Pausada") + '"><span class="listing-switch-knob"></span></button>'
        : '<span class="type-pill">' + escapeHtml(LISTING_STATUS[item.status] || item.status || "-") + '</span>';

      var fila = '<tr data-listing-row="' + escapeHtml(item.id) + '">' +
        '<td class="order-product"><div class="order-product-cell">' + chevron + foto +
          '<div class="order-product-info"><b>' + escapeHtml(item.title) + '</b>' +
          '<small class="order-stock">' + escapeHtml(item.id) + '</small></div></div></td>' +
        '<td>' + moneyWithCents.format(item.price) + '</td>' +
        '<td>' + integerNumber.format(item.sold) + '</td>' +
        '<td>' + stockCell + '</td>' +
        '<td>' + estadoCell + '</td>' +
      '</tr>';

      // Variantes desplegadas: una fila por sabor, con su stock editable.
      if (item.hasVariations && item.expanded) {
        fila += item.variations.map(function (v) {
          var vVal = v.pendingStock !== undefined ? v.pendingStock : v.stock;
          var vSucio = v.pendingStock !== undefined && v.pendingStock !== v.stock;
          return '<tr class="listing-variant-row" data-variant-of="' + escapeHtml(item.id) + '">' +
            '<td class="listing-variant-name">' + escapeHtml(v.label) + '</td>' +
            '<td>' + moneyWithCents.format(v.price) + '</td>' +
            '<td>' + integerNumber.format(v.sold) + '</td>' +
            '<td><input type="number" min="0" step="1" class="listing-stock-input' + (vSucio ? " is-dirty" : "") + '" value="' + (vVal === null || vVal === undefined ? "" : vVal) + '" data-variant-stock="' + escapeHtml(item.id) + '::' + escapeHtml(v.id) + '" /></td>' +
            '<td></td>' +
          '</tr>';
        }).join("");
      }
      return fila;
    }).join("");

    renderSaveButton();
  }

  function findListing(id) {
    var slot = mlListingsState();
    return (slot.items || []).find(function (i) { return i.id === id; }) || null;
  }

  function toggleListingExpand(itemId) {
    var item = findListing(itemId);
    if (!item) return;
    item.expanded = !item.expanded;
    renderMLListings();
  }

  // Aplica TODOS los cambios pendientes en Mercado Libre, con una sola
  // confirmacion que los lista. Cada publicacion es una llamada PUT; si una
  // falla, sigue con las demas y al final informa el detalle.
  async function saveMLListingChanges() {
    var cambios = pendingChanges();
    if (!cambios.length) return;

    // Validacion previa: nada se manda si hay un valor invalido.
    var invalidos = cambios.filter(function (c) {
      if (c.type === "status") return false;
      return c.value === undefined || !Number.isInteger(c.value) || c.value < 0;
    });
    if (invalidos.length) {
      setListingsMessage("Hay stocks invalidos: tienen que ser numeros enteros de 0 o mas.", "error");
      return;
    }

    var nombre = S.mlAccountById(activeMLId())?.name || "Mercado Libre";
    var detalle = cambios.map(function (c) {
      if (c.type === "status") {
        return "- " + c.item.title + ": " + (c.value === "paused" ? "PAUSAR" : "ACTIVAR");
      }
      if (c.type === "varstock") {
        return "- " + c.item.title + " (" + c.variation.label + "): stock " +
          (c.variation.stock === null ? "?" : c.variation.stock) + " -> " + c.value;
      }
      return "- " + c.item.title + ": stock " + (c.item.stock === null ? "?" : c.item.stock) + " -> " + c.value;
    }).join("\n");

    var ok = window.confirm(
      "Aplicar " + cambios.length + " cambio(s) en " + nombre + "?\n\n" + detalle +
      "\n\nSe aplican en tu tienda real."
    );
    if (!ok) return;

    // Una llamada por publicacion, juntando sus cambios (stock + estado + variantes).
    var porItem = new Map();
    cambios.forEach(function (c) {
      if (!porItem.has(c.item.id)) porItem.set(c.item.id, { item: c.item, body: {}, vars: [] });
      var entrada = porItem.get(c.item.id);
      if (c.type === "status") entrada.body.status = c.value;
      else if (c.type === "stock") entrada.body.available_quantity = c.value;
      else entrada.vars.push({ id: Number(c.variation.id), available_quantity: c.value, ref: c.variation });
    });

    var okCount = 0;
    var errores = [];
    setListingsMessage("Guardando " + cambios.length + " cambio(s) en Mercado Libre...", "");

    for (var entrada of porItem.values()) {
      var body = Object.assign({}, entrada.body);
      if (entrada.vars.length) {
        body.variations = entrada.vars.map(function (v) {
          return { id: v.id, available_quantity: v.available_quantity };
        });
      }
      try {
        await S.requireSecureApi().mlApi("/items/" + entrada.item.id, "PUT", body, activeMLId());
        // Confirmado en ML: el valor pendiente pasa a ser el real.
        if (body.status) { entrada.item.status = body.status; entrada.item.pendingStatus = undefined; }
        if (body.available_quantity !== undefined) {
          entrada.item.stock = body.available_quantity;
          entrada.item.pendingStock = undefined;
        }
        entrada.vars.forEach(function (v) { v.ref.stock = v.available_quantity; v.ref.pendingStock = undefined; });
        if (entrada.vars.length) {
          entrada.item.stock = (entrada.item.variations || []).reduce(function (a, v) { return a + (v.stock || 0); }, 0);
        }
        okCount += 1;
      } catch (e) {
        errores.push(entrada.item.title + ": " + (e.message || e));
      }
    }

    renderMLListings();
    if (errores.length) {
      setListingsMessage(
        okCount + " publicacion(es) actualizada(s). " + errores.length + " con error:\n" + errores.join("\n"),
        "error"
      );
    } else {
      setListingsMessage("Listo: " + okCount + " publicacion(es) actualizada(s) en Mercado Libre.", "success");
    }
  }

  // Espera a que el canvas tenga ancho real y recien ahi dibuja. Al mostrar una
  // seccion el navegador no aplica el layout en el mismo frame, asi que un solo
  // requestAnimationFrame llegaba con ancho 0 y el grafico no se dibujaba.
  function dibujarCuandoSeVea(canvas, dibujar, intentos) {
    if (!canvas || typeof dibujar !== "function") return;
    var quedan = intentos === undefined ? 12 : intentos;
    if (canvas.getBoundingClientRect().width > 0) { dibujar(); return; }
    if (quedan <= 0) return;
    requestAnimationFrame(function () { dibujarCuandoSeVea(canvas, dibujar, quedan - 1); });
  }

  // Lazy-load: recien al abrir la seccion Publicaciones se trae el catalogo.
  // Y al abrir Metricas hay que redibujar los graficos: mientras la seccion
  // estuvo oculta el canvas media 0 y no se pudo dibujar nada.
  window.addEventListener("nexus:section", function (event) {
    var d = (event && event.detail) || {};
    if (d.module !== "ecommerce") return;

    if (d.section === "publicaciones") {
      if (isMLApp(state.commerce.selectedApp)) loadMLListings(false);
      return;
    }

    if (d.section === "mercadopago") {
      if (isMLApp(state.commerce.selectedApp)) renderMercadoPago();
      return;
    }

    if (d.section === "resumen") {
      dibujarCuandoSeVea(elements.commerceTrendChart, drawCommerceTrendChart);
      if (isMLApp(state.commerce.selectedApp)) {
        dibujarCuandoSeVea(elements.commerceCostsChart, S.drawCommerceCostsChart);
      }
    }
  });

  /* ============================================================
     Mercado Pago — cobros y liberaciones de la cuenta abierta
     ------------------------------------------------------------
     Se arma con los pagos que ya vienen en /orders/search: cada pago
     informa su comision (marketplace_fee), el envio y CUANDO se libera
     la plata. Con eso alcanza para el panel de finanzas sin pedirle a
     Mercado Pago credenciales propias.

     El saldo global de la billetera (plata que no viene de ventas de
     ML, retiros, etc.) SI necesita credenciales de MP: se intenta leer
     y, si la cuenta no lo permite, se avisa en vez de fallar.
     ============================================================ */

  function hoyISO() {
    return new Date().toISOString().slice(0, 10);
  }

  // Reparte las ventas del periodo entre lo ya liberado y lo que falta.
  function resumenMercadoPago(orders) {
    var hoy = hoyISO();
    var res = {
      bruto: 0, comision: 0, envio: 0, neto: 0,
      disponible: 0, aLiberar: 0, sinFecha: 0,
      cobros: [], proximas: {}
    };

    (orders || []).forEach(function (o) {
      if (o.cancelled) return;                    // una venta caida no es plata
      var neto = (o.total || 0) - (o.commission || 0) - (o.shipping || 0);
      res.bruto += o.total || 0;
      res.comision += o.commission || 0;
      res.envio += o.shipping || 0;
      res.neto += neto;

      var fecha = String(o.releaseDate || "").slice(0, 10);
      if (o.refunded) {
        // Devuelta: no suma a disponible ni a liberar.
      } else if (!fecha) {
        res.sinFecha += neto;
      } else if (fecha <= hoy) {
        res.disponible += neto;
      } else {
        res.aLiberar += neto;
        res.proximas[fecha] = (res.proximas[fecha] || 0) + neto;
      }

      res.cobros.push({
        id: o.id, fecha: o.date, producto: o.product,
        bruto: o.total || 0, comision: o.commission || 0, envio: o.shipping || 0,
        neto: neto, libera: fecha, refunded: o.refunded, credited: o.credited
      });
    });

    res.cobros.sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
    return res;
  }

  function renderMercadoPago() {
    if (!elements.mpPanel) return;
    // S.mlAccountById en vez de destructurar: este archivo se ejecuta antes
    // de que el header pueda garantizar el simbolo, y por S.* es lazy.
    var cuenta = S.mlAccountById(activeMLId());
    if (elements.mpAccountName) {
      elements.mpAccountName.textContent = cuenta ? cuenta.name : "Mercado Libre";
    }

    var cuentaId = activeMLId();
    var cache = mpDatos(cuentaId);
    var snapshot = getCommerceSnapshot(state.commerce.selectedApp);
    // Se aplican las fechas de liberacion ya conseguidas del detalle de pagos.
    var orders = conLiberaciones((snapshot && snapshot.orders) || [], cache);

    if (!orders.length) {
      elements.mpEmpty?.classList.add("is-visible");
      if (elements.mpStats) elements.mpStats.innerHTML = "";
      if (elements.mpNextBody) elements.mpNextBody.innerHTML = "";
      if (elements.mpTableBody) elements.mpTableBody.innerHTML = "";
      return;
    }
    elements.mpEmpty?.classList.remove("is-visible");

    var r = resumenMercadoPago(orders);

    // Tarjetas: primero la plata, despues los cargos.
    // Disponible y "a liberar" salen del saldo REAL de Mercado Pago si se
    // pudo leer (incluye plata que no viene de ventas de ML). Si no, se cae a
    // la suma de las ventas del periodo, que es una aproximacion — y se dice.
    var usaSaldoReal = !!cache.saldo;
    var disponible = usaSaldoReal ? cache.saldo.disponible : r.disponible;
    var aLiberar = usaSaldoReal ? cache.saldo.aLiberar : r.aLiberar;
    var pieDisp = usaSaldoReal ? "saldo real en tu billetera" : "estimado por tus ventas";
    var pieLib = usaSaldoReal
      ? (aLiberar > 0 ? "saldo real pendiente" : "nada pendiente")
      : (aLiberar > 0 ? "estimado por tus ventas" : "nada pendiente");

    if (elements.mpStats) {
      elements.mpStats.innerHTML = [
        tarjetaMP("Disponible", moneyWithCents.format(disponible), pieDisp, "is-good"),
        tarjetaMP("A liberar", moneyWithCents.format(aLiberar), pieLib, ""),
        tarjetaMP("Facturacion bruta", moneyWithCents.format(r.bruto), "ventas del periodo", ""),
        tarjetaMP("Comisiones ML", "- " + moneyWithCents.format(r.comision), pct(r.comision, r.bruto), "is-bad"),
        tarjetaMP("Envios", "- " + moneyWithCents.format(r.envio), pct(r.envio, r.bruto), "is-bad"),
        tarjetaMP("Neto acreditado", moneyWithCents.format(r.neto), pct(r.neto, r.bruto), "is-good")
      ].join("");
    }

    // Proximas liberaciones, de la mas cercana a la mas lejana.
    if (elements.mpNextBody) {
      var fechas = Object.keys(r.proximas).sort();
      elements.mpNextBody.innerHTML = fechas.length
        ? fechas.map(function (f) {
            return "<tr><td>" + escapeHtml(S.formatDate(f)) + "</td>" +
              '<td class="num">' + moneyWithCents.format(r.proximas[f]) + "</td>" +
              "<td>" + escapeHtml(faltanDias(f)) + "</td></tr>";
          }).join("")
        : '<tr><td colspan="3" class="pub-quiet">No hay dinero pendiente de liberacion.</td></tr>';
    }

    // Detalle cobro por cobro.
    if (elements.mpTableBody) {
      elements.mpTableBody.innerHTML = r.cobros.map(function (c) {
        var estado = c.refunded
          ? '<span class="type-pill expense">Devuelto</span>'
          : (!c.libera
              ? '<span class="type-pill">Pendiente</span>'
              : (c.libera <= hoyISO()
                  ? '<span class="type-pill income">Disponible</span>'
                  : '<span class="type-pill pub-warn">A liberar</span>'));
        return "<tr>" +
          "<td>" + escapeHtml(S.formatDate(c.fecha)) + "</td>" +
          '<td><span class="mp-producto">' + escapeHtml(c.producto) + "</span></td>" +
          '<td class="num">' + moneyWithCents.format(c.bruto) + "</td>" +
          '<td class="num">' + moneyWithCents.format(c.comision + c.envio) + "</td>" +
          '<td class="num">' + moneyWithCents.format(c.neto) + "</td>" +
          "<td>" + (c.libera ? escapeHtml(S.formatDate(c.libera)) : "—") + "</td>" +
          "<td>" + estado + "</td>" +
        "</tr>";
      }).join("");
    }

    if (elements.mpNote) {
      elements.mpNote.textContent = r.sinFecha > 0
        ? "Hay " + moneyWithCents.format(r.sinFecha) + " de ventas cuya fecha de liberacion todavia no se consulto o Mercado Pago no informa."
        : "";
    }

    enriquecerMercadoPago(cuentaId, orders);
  }

  function tarjetaMP(titulo, valor, pie, clase) {
    return '<div class="metric-card mp-card ' + clase + '"><span>' + titulo + "</span>" +
      "<strong>" + valor + "</strong><small>" + escapeHtml(pie) + "</small></div>";
  }

  function pct(parte, total) {
    if (!total) return "";
    return (parte / total * 100).toFixed(1) + "% de las ventas";
  }

  function faltanDias(fechaISO) {
    var dias = Math.ceil((new Date(fechaISO + "T00:00:00") - new Date(hoyISO() + "T00:00:00")) / 86400000);
    if (dias <= 0) return "hoy";
    if (dias === 1) return "manana";
    return "en " + dias + " dias";
  }

  // Cache por cuenta: saldo real de MP y fechas de liberacion por pago.
  // Vive en memoria (traerlo son varias llamadas y cambia seguido).
  var mpCache = {};
  function mpDatos(cuenta) {
    if (!mpCache[cuenta]) mpCache[cuenta] = { saldo: null, liberaciones: {}, cargando: false };
    return mpCache[cuenta];
  }

  // Saldo REAL de la billetera. Es el numero autoritativo: reemplaza a la
  // suma de ventas para "disponible" y "a liberar". Vive en OTRO dominio
  // (api.mercadopago.com), por eso va con mpApi y no con mlApi.
  async function cargarSaldoMP(cuenta) {
    var api = S.requireSecureApi();
    var me = await api.mlApi("/users/me", "GET", null, cuenta);
    var userId = (me.payload || {}).id;
    if (!userId) throw new Error("No se pudo identificar la cuenta.");

    // Se prueban los endpoints conocidos en orden: no todas las cuentas
    // exponen el mismo. El primero que devuelva un numero, gana.
    var intentos = [
      { host: "mp", url: "/users/" + userId + "/mercadopago_account/balance" },
      { host: "mp", url: "/v1/account/balance" },
      { host: "ml", url: "/users/" + userId + "/mercadopago_account/balance" }
    ];
    var ultimoError = null;
    for (var i = 0; i < intentos.length; i++) {
      try {
        var t = intentos[i];
        var res = t.host === "mp"
          ? await api.mpApi(t.url, "GET", null, cuenta)
          : await api.mlApi(t.url, "GET", null, cuenta);
        var p = res.payload || {};
        var disponible = primerNumero([p.available_balance, p.available, p.balance]);
        if (disponible == null) continue;
        return {
          disponible: disponible,
          aLiberar: primerNumero([p.unavailable_balance, p.pending_balance, p.unavailable]) || 0,
          total: primerNumero([p.total_amount, p.total]) || null
        };
      } catch (e) { ultimoError = e; }
    }
    throw ultimoError || new Error("Mercado Pago no devolvio el saldo.");
  }

  function primerNumero(lista) {
    for (var i = 0; i < lista.length; i++) {
      if (lista[i] != null && !isNaN(Number(lista[i]))) return Number(lista[i]);
    }
    return null;
  }

  // Fecha de liberacion de cada pago. NO viene en /orders/search: hay que
  // pedir el detalle del pago a Mercado Pago. Se hace de a uno y con tope,
  // para no castigar la cuota de la API en periodos largos.
  async function cargarLiberaciones(cuenta, orders, cache) {
    var api = S.requireSecureApi();
    var ids = [];
    (orders || []).forEach(function (o) {
      (o.paymentIds || []).forEach(function (id) {
        if (id && !(id in cache.liberaciones) && ids.indexOf(id) === -1) ids.push(id);
      });
    });
    if (!ids.length) return false;

    var TOPE = 40;                      // no mas de 40 consultas por render
    var recortado = ids.length > TOPE;
    var lote = ids.slice(0, TOPE);
    for (var i = 0; i < lote.length; i++) {
      try {
        var res = await api.mpApi("/v1/payments/" + lote[i], "GET", null, cuenta);
        var p = res.payload || {};
        cache.liberaciones[lote[i]] = String(p.money_release_date || p.date_released || "");
      } catch (e) {
        cache.liberaciones[lote[i]] = "";   // se marca como consultado igual
      }
      await dormirMP(120);
    }
    return { recortado: recortado, faltan: Math.max(0, ids.length - TOPE) };
  }

  function dormirMP(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // Aplica al pedido la fecha de liberacion que se haya conseguido del pago.
  function conLiberaciones(orders, cache) {
    return (orders || []).map(function (o) {
      if (o.releaseDate) return o;
      var fecha = "";
      (o.paymentIds || []).forEach(function (id) {
        var d = cache.liberaciones[id];
        if (d && (!fecha || d > fecha)) fecha = d;
      });
      return fecha ? Object.assign({}, o, { releaseDate: fecha }) : o;
    });
  }

  // Trae saldo y liberaciones, y vuelve a pintar cuando llegan.
  async function enriquecerMercadoPago(cuenta, orders) {
    var cache = mpDatos(cuenta);
    if (cache.cargando) return;
    cache.cargando = true;
    try {
      try {
        cache.saldo = await cargarSaldoMP(cuenta);
        pintarSaldoMP(cache.saldo);
        // Repintar YA: las tarjetas tienen que mostrar el saldo real apenas
        // llega, no recien en el proximo render. El re-entry esta cubierto por
        // `cargando`, asi que esto no dispara otra consulta.
        renderMercadoPago();
      } catch (e) {
        pintarSaldoMP(null, e);
      }
      var r = await cargarLiberaciones(cuenta, orders, cache);
      if (r) {
        cache.recorte = r.recortado ? r.faltan : 0;
        renderMercadoPago();          // repintar con las fechas ya cargadas
      }
    } finally {
      cache.cargando = false;
    }
  }

  function pintarSaldoMP(saldo, error) {
    if (!elements.mpBalance) return;
    if (saldo) {
      elements.mpBalance.innerHTML = "Saldo real en tu billetera de Mercado Pago: <b>" +
        moneyWithCents.format(saldo.disponible) + "</b> disponible" +
        (saldo.aLiberar ? " · <b>" + moneyWithCents.format(saldo.aLiberar) + "</b> a liberar" : "");
      elements.mpBalance.className = "meta-message is-success";
      return;
    }
    elements.mpBalance.textContent =
      "No se pudo leer el saldo de la billetera (" + ((error && error.message) || "sin detalle") +
      "). Los importes de ventas de abajo si son exactos.";
    elements.mpBalance.className = "meta-message";
  }

  // ---- Sync genérico -----------------------------------------

  async function syncCommerce({ demo = false, silent = false } = {}) {
    const appId = state.commerce.activeApp;

    if (demo) {
      state.commerce.snapshots[appId] = buildDemoCommerceSnapshot(appId);
      saveCommerceSnapshots();
      var msg = isMLApp(appId) ? setMlMessage : setCommerceMessage;
      msg(`Demo cargada para ${getCommerceApp(appId).name}.`, "success");
      renderCommerceDashboard();
      return;
    }

    if (isMLApp(appId)) {
      await syncMercadoLibre({ silent });
      return;
    }

    state.commerce.configs[appId] = readCommerceConfigFromForm();
    saveCommerceConfigs();

    const config = getCommerceConfig(appId);
    if (!hasCommerceConnection(config)) {
      setCommerceMessage("Para traer datos reales necesitas Pixel ID, endpoint de datos y API Token.", "error");
      renderCommerceDashboard();
      return;
    }

    await S.runIntegrationSync({
      slice: () => state.commerce,
      silent,
      setMessage: setCommerceMessage,
      syncingMessage: `Sincronizando ${getCommerceApp(appId).name}...`,
      render: renderCommerceDashboard,
      errorFallback: "No se pudo sincronizar este negocio.",
      after: () => scheduleCommerceRefresh(),
      run: async () => {
        await S.persistProviderToken({
          config,
          field: "apiToken",
          provider: "commerce:" + appId,
          saveConfig: saveCommerceConfigs,
          populateForm: populateCommerceConfigForm
        });
        const orders = await fetchCommerceData(config);
        state.commerce.snapshots[appId] = createCommerceSnapshot(orders, "live");
        saveCommerceSnapshots();
        return orders.length
          ? "Datos reales sincronizados correctamente."
          : "El endpoint respondio sin pedidos para este periodo.";
      }
    });
  }

  // ---- Sync Mercado Libre ------------------------------------

  async function syncMercadoLibre({ silent = false } = {}) {
    var config = getCommerceConfig(activeMLId());
    if (!config.hasToken) {
      setMlMessage("Conecta tu cuenta de Mercado Libre primero.", "error");
      renderCommerceDashboard();
      return;
    }

    await S.runIntegrationSync({
      slice: () => state.commerce,
      silent: silent,
      setMessage: setMlMessage,
      syncingMessage: "Sincronizando Mercado Libre...",
      render: renderCommerceDashboard,
      errorFallback: "No se pudo sincronizar Mercado Libre.",
      after: () => scheduleMLRefresh(),
      run: async () => {
        var range = getPeriodRange();
        // Las visitas van en paralelo: es otra API y no debe demorar las ventas.
        var [orders, visits] = await Promise.all([
          fetchMLOrders(range),
          fetchMLVisits(range)
        ]);
        // Enriquecer solo los que se van a mostrar (la tabla corta en 12): la
        // foto y el stock salen de /items, no de la API de pedidos.
        await enrichMLOrdersWithItems(orders.slice(0, 12));
        var next = createCommerceSnapshot(orders, "live", { visits: visits, range: range });
        var mlId = activeMLId();
        var prev = state.commerce.snapshots[mlId];
        state.commerce.snapshots[mlId] = next;
        // Con el modo "en vivo" esto corre cada minuto: si no hay ventas
        // nuevas, no reescribir (evita subir lo mismo a Firestore sin parar).
        if (!prev || ordersSignature(prev.orders) !== ordersSignature(next.orders)) {
          saveCommerceSnapshots();
        }
        return orders.length
          ? orders.length + " ordenes sincronizadas desde Mercado Libre."
          : "No se encontraron ordenes en el periodo elegido.";
      }
    });
  }

  // Huella estable de las ventas: cambia solo si hay una orden nueva o si
  // alguna cambió de estado/monto. `fetchedAt` queda afuera a proposito.
  function ordersSignature(orders) {
    if (!Array.isArray(orders)) return "";
    return orders.map(function (o) {
      return [o.id, o.status, o.total, o.margin].join(":");
    }).join("|");
  }

  const scheduleCommerceRefresh = S.createRefreshScheduler({
    slice: () => state.commerce,
    getIntervalSeconds: () => getCommerceConfig().refreshInterval,
    // ML queda afuera a proposito: tiene su propio scheduler (scheduleMLRefresh).
    // Si no, al entrar al panel de ML habria dos timers pidiendo lo mismo.
    isEnabled: () => !isMLApp() && hasCommerceConnection(getCommerceConfig()),
    sync: (options) => syncCommerce(options)
  });

  // Mercado Libre "en vivo": scheduler propio, atado SIEMPRE a la config de
  // ML (no al negocio activo) y con su propio timer, para que el polling siga
  // aunque el titular esté en otra vista y no lo mate el router.
  const scheduleMLRefresh = S.createRefreshScheduler({
    slice: () => state.commerce,
    timerKey: "mlRefreshTimer",
    getIntervalSeconds: () => getCommerceConfig(activeMLId()).refreshInterval,
    isEnabled: () => Boolean(getCommerceConfig(activeMLId()).hasToken),
    sync: () => syncMercadoLibre({ silent: true })
  });

  // ---- Navegación nivel 2 ------------------------------------

  function selectCommerceApp(id) {
    const app = getCommerceApp(id);
    if (!app) return;

    // Contenedor (ej: Alpha Fitness): no abre panel, muestra sus plataformas.
    if (S.isCommerceGroup(id)) {
      state.commerce.selectedGroup = id;
      state.commerce.selectedApp = null;
      setCommerceMessage("", "");
      setMlMessage("", "");
      renderCommerceDashboard();
      S.updateTopbarForView("ecommerce");
      S.animateActivePanel();
      return;
    }

    // Plataforma dentro de un negocio: recordar el contenedor para el "volver".
    state.commerce.selectedGroup = app.parent || null;
    state.commerce.selectedApp = id;
    state.commerce.activeApp = id;
    S.safeSetItem("nexus.ecommerce.activeApp.v1", id);
    setCommerceMessage("", "");
    setMlMessage("", "");
    renderCommerceDashboard();
    S.updateTopbarForView("ecommerce");
    scheduleCommerceRefresh();
    // La barra lateral se enfoca en este negocio y muestra sus secciones.
    // El flag "ml" habilita las secciones exclusivas de Mercado Libre
    // (Publicaciones): Kairos/Amazon/Shopee no las muestran.
    window.NexusPlatformNav?.enterPlatform("ecommerce", app.name, isMLApp(id) ? { flags: ["ml"] } : undefined);
    S.animateActivePanel();
    // Mercado Libre "en vivo": al entrar al panel, traer las ventas solo,
    // sin esperar el proximo tick ni que el titular apriete Sincronizar.
    if (isMLApp(id) && getCommerceConfig(id).hasToken && !state.commerce.syncing) {
      syncMercadoLibre({ silent: true });
    }
  }

  // Cierra el panel abierto. Si la plataforma pertenece a un negocio, vuelve a
  // las plataformas de ese negocio (no al primer nivel).
  function clearSelectedCommerceApp() {
    state.commerce.selectedApp = null;
    window.NexusPlatformNav?.exitPlatform();
    window.clearInterval(state.commerce.refreshTimer);
    state.commerce.refreshTimer = 0;
    setCommerceMessage("", "");
    setMlMessage("", "");
    renderCommerceDashboard();
    S.updateTopbarForView("ecommerce");
    S.animateActivePanel();
  }

  // Sale del negocio contenedor y vuelve al listado de primer nivel.
  function clearSelectedCommerceGroup() {
    state.commerce.selectedGroup = null;
    state.commerce.selectedApp = null;
    window.NexusPlatformNav?.exitPlatform();
    setCommerceMessage("", "");
    setMlMessage("", "");
    renderCommerceDashboard();
    S.updateTopbarForView("ecommerce");
    S.animateActivePanel();
  }

  // Mercado Libre queda "en vivo" por defecto: si el titular nunca eligio
  // una frecuencia con el selector, arranca en 60 segundos. Si algun dia
  // elige "Manual" a proposito (refreshChoice=user), se respeta. Se llama
  // desde init() (app.js), DESPUES de rehydrateState, para que la config
  // bajada de la nube no pise el default.
  function ensureMLLiveDefaults() {
    var cfg = state.commerce.configs[activeMLId()];
    if (!cfg) return;
    if (!cfg.refreshChoice && (!cfg.refreshInterval || cfg.refreshInterval === "0")) {
      cfg.refreshInterval = "60";
      saveCommerceConfigs();
    }
  }

  Object.assign(S, {
    aggregateCommerceProducts, aggregateCommerceTrend, buildDemoCommerceSnapshot, buildMLAuthUrl,
    clearSelectedCommerceApp, clearSelectedCommerceGroup, createCommerceSnapshot, disconnectML, ensureMLLiveDefaults, fetchCommerceData, fetchMLOrders,
    handleMlOAuthReturn, normalizeCommerceOrder, normalizeMLOrder,
    populateCommerceConfigForm, readCommerceConfigFromForm, renderCommerceDashboard, renderCommerceSwitcher,
    applyPeriodChange, getPeriodRange, loadMLListings, markPendingStock, openSaleDeepLink, renderPeriodBar, saveMLListingChanges, selectMLAccount, toggleListingExpand, toggleListingStatus,
    scheduleCommerceRefresh, scheduleMLRefresh, selectCommerceApp, setCommerceMessage, setMlMessage,
    startMLOAuth, syncCommerce, syncMercadoLibre,
    renderMercadoPago, resumenMercadoPago,
  });
})();
