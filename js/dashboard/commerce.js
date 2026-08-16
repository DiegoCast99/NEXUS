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
      // Detalle de la venta (vista estilo ML): idem, explicitos.
      unitPrice: Number(order.unitPrice ?? order.unit_price ?? 0) || 0,
      variation: String(order.variation || ""),
      shippingId: String(order.shippingId || ""),
      paymentId: String(order.paymentId || ""),
      createdAt: String(order.createdAt || order.date_created || order.date || ""),
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

  // Totales del periodo (mismo cálculo de siempre, extraído para poder recomputar
  // la vista al cambiar de periodo sin volver a pedir a ML).
  function computeCommerceTotals(normalizedOrders, visits) {
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
    if (typeof visits === "number" && visits > 0) totals.sessions = visits;
    // Costos al estilo del panel de ML: cargos+envio es lo que te descuentan,
    // "recibiste" es lo que queda. Publicidad NO sale de la API de ordenes.
    totals.costs = totals.commission + totals.shipping;
    totals.received = totals.revenue - totals.costs;
    totals.costsPct = totals.revenue ? (totals.costs / totals.revenue) * 100 : 0;
    totals.receivedPct = totals.revenue ? (totals.received / totals.revenue) * 100 : 0;
    totals.aov = totals.orders ? totals.revenue / totals.orders : 0;
    totals.unitPrice = totals.units ? totals.revenue / totals.units : 0;
    totals.conversion = totals.sessions ? (totals.orders / totals.sessions) * 100 : 0;
    return totals;
  }

  function ordenEnRango(o, range) {
    if (!range || !range.from || !range.to) return true;
    var d = String(o.date || o.createdAt || "").slice(0, 10);
    return d >= range.from && d <= range.to;
  }

  // Recalcula la "vista" (periodo seleccionado) filtrando el superset ya traído.
  // Esto es lo que hace INSTANTÁNEO el cambio de periodo: no vuelve a pedir a ML,
  // solo re-filtra y re-calcula totales/tendencia/productos en el navegador.
  function aplicarVistaComercio(snap, range) {
    var all = snap.allOrders || snap.orders || [];
    var orders = all.filter(function (o) { return ordenEnRango(o, range); });
    snap.range = range || null;
    snap.orders = orders;
    snap.totals = computeCommerceTotals(orders, snap.visits);
    snap.products = aggregateCommerceProducts(orders);
    snap.trend = aggregateCommerceTrend(orders, range);
    return snap;
  }

  // `extra` trae: visitas (API aparte), `range` (ventana amplia traída) y
  // `viewRange` (periodo a mostrar). El snapshot guarda TODAS las órdenes de la
  // ventana (allOrders) y la vista del periodo se deriva con aplicarVistaComercio.
  function createCommerceSnapshot(orders, source, extra) {
    const info = extra || {};
    const normalizedOrders = orders.map(normalizeCommerceOrder)
      .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
    const snap = {
      source,
      fetchedAt: new Date().toISOString(),
      appId: state.commerce.activeApp,
      allOrders: normalizedOrders,                                   // superset traído
      fetchedRange: info.range || null,                             // rango de allOrders
      visits: (typeof info.visits === "number") ? info.visits : 0,
      range: null, orders: [], totals: {}, products: [], trend: []
    };
    aplicarVistaComercio(snap, info.viewRange || info.range || null);
    return snap;
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

    if (!encBundle) {
      // Volvimos del OAuth pero el token no llego. Caso tipico en la PWA
      // instalada de iOS: el login abre un navegador in-app con sessionStorage
      // separado que se pierde al volver. Antes esto quedaba en silencio total.
      selectCommerceApp(mlConnectingAccount());
      setMlMessage("No se pudo completar la conexion con Mercado Libre. Proba de nuevo desde el navegador (Safari), no desde la app instalada en la pantalla de inicio.", "error");
      return;
    }

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
    // "Precio del producto" = SOLO los productos (order_items), sin el envio que
    // pago el comprador. total_paid_amount lo INCLUYE y por eso inflaba el precio
    // (ML muestra $875, Nexus mostraba $1.120 = 875 + 245 de envio del comprador).
    var itemsTotal = orderItems.reduce(function (s, i) {
      return s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 1);
    }, 0);
    var total = Number(mlOrder.total_amount) || itemsTotal ||
      payments.reduce(function (s, p) { return s + (p.total_paid_amount || 0); }, 0);

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

    // Envio que paga el VENDEDOR: NO sale de aca. payments[].shipping_cost es lo
    // que pago el COMPRADOR (ej $245), no tu costo. El costo real del vendedor
    // (0 si lo pago el comprador, o X en envio gratis) lo trae despues
    // enrichMLOrdersWithShipping desde /shipments/{id}/costs. Arranca en 0.
    var shipping = 0;

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

    // Detalle para la vista de venta (estilo ML): precio unitario, variacion
    // (Sabor / Tipo de envase...), id del envio (para traer la direccion aparte)
    // y el id del pago (el "#..." que muestra ML arriba del desglose).
    var primerOI = orderItems[0] || {};
    var unitPrice = Number(primerOI.unit_price) || (units ? total / units : total);
    var variAttrs = (firstItem && firstItem.variation_attributes) || [];
    var variation = variAttrs
      .map(function (a) { return (a.name || "") + ": " + (a.value_name || ""); })
      .filter(function (s) { return s !== ": " && s.indexOf(": ") !== s.length - 2; })
      .join(" · ");
    var shippingId = (mlOrder.shipping && mlOrder.shipping.id) ? String(mlOrder.shipping.id) : "";
    var paymentId = idsPago[0] || (payments[0] && payments[0].id ? String(payments[0].id) : "");

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
      unitPrice: unitPrice,
      variation: variation,
      shippingId: shippingId,
      paymentId: paymentId,
      // Timestamp COMPLETO (con hora): para ordenar por el orden real en que
      // cayeron, no solo por dia. `date` (solo dia) queda para agrupar/graficar.
      createdAt: String(mlOrder.date_created || ""),
      date: String(mlOrder.date_created || "").slice(0, 10) || toDateInput()
    };
  }

  // Saca la mejor URL de foto del body de un item ML, robusta:
  // secure_thumbnail (https) → thumbnail → pictures[0].secure_url. SIEMPRE fuerza
  // https (si `thumbnail` viene http, el navegador lo bloquea como mixed content
  // en el sitio https y la foto queda vacía → esa era la causa de "no aparece").
  function thumbFromItemBody(b) {
    if (!b) return "";
    var t = b.secure_thumbnail || b.thumbnail || "";
    if (!t && b.pictures && b.pictures[0]) t = b.pictures[0].secure_url || b.pictures[0].url || "";
    if (t && t.indexOf("http://") === 0) t = "https://" + t.slice(7);
    // La miniatura -I.jpg de ML es chica y a veces borrosa; -O/-V da mejor foto.
    return t;
  }

  // Trae foto y stock (available_quantity) de las publicaciones vendidas y se los
  // pega a cada pedido. Multiget de ML (/items?ids=...), hasta 20 ids por llamada.
  // Best-effort: si falla, los pedidos se muestran igual (y el render carga la
  // foto on-demand). Se pide `pictures` además de secure_thumbnail por si la
  // proyección de atributos no devuelve la miniatura.
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
          "&attributes=id,secure_thumbnail,thumbnail,pictures,available_quantity";
        var result = await api.mlApi(endpoint, "GET", null, activeMLId());
        var rows = (result.payload || []);
        rows.forEach(function (row) {
          var body = row && row.body ? row.body : (row && row.id ? row : null);
          if (!body || !body.id) return;
          var url = thumbFromItemBody(body);
          mapa[String(body.id)] = {
            thumbnail: url,
            stock: (typeof body.available_quantity === "number") ? body.available_quantity : null
          };
          if (url) { _thumbCache[String(body.id)] = url; }
        });
      } catch (e) {
        console.warn("No se pudieron traer fotos/stock de ML:", e && e.message);
      }
    }

    orders.forEach(function (o) {
      var info = mapa[o.itemId];
      if (info) { if (info.thumbnail) o.thumbnail = info.thumbnail; if (info.stock != null) o.stock = info.stock; }
    });
    return orders;
  }

  // Costo de envio que ML te COBRA a vos (el vendedor). NO viene en
  // /orders/search: vive en el envio. /shipments/{id}/costs devuelve lo que paga
  // cada parte; el costo del vendedor esta en senders[].cost (fallback:
  // gross_amount menos lo que puso el comprador). Best-effort: si ML lo
  // restringe, devuelve null y la venta queda sin costo de envio (como antes).
  async function fetchSellerShipping(shippingId) {
    if (!shippingId) return null;
    var api = S.requireSecureApi();
    try {
      var res = await api.mlApi("/shipments/" + shippingId + "/costs", "GET", null, activeMLId());
      var c = res.payload || {};
      // SOLO el costo del VENDEDOR (senders[].cost). Si no hay dato de sender, el
      // vendedor NO paga envio (0). NO usar gross_amount: incluye lo que pago el
      // comprador, y ese era el bug (mostraba el envio del comprador como costo).
      var senders = c.senders || [];
      if (senders.length && typeof senders[0].cost === "number") return senders[0].cost;
      return 0;
    } catch (e) { /* ML puede restringirlo: se deja sin envio */ }
    return null;
  }

  // Le pega a cada venta reciente el costo de envio real y recalcula el lucro.
  // Acotado y con pausa: es una llamada por envio (no se puede batchear).
  async function enrichMLOrdersWithShipping(orders) {
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (!o || !o.shippingId || o.cancelled) continue;
      var costo = await fetchSellerShipping(o.shippingId);
      if (costo != null && costo > 0) {
        o.shipping = costo;
        o.margin = (o.total || 0) - (o.commission || 0) - costo;
      }
      await dormirMP(120);
    }
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

  // Rango a TRAER de ML: una ventana amplia (≥30 días, o el custom si es más
  // grande) para poder cambiar entre 7/15/30 filtrando en el navegador, sin volver
  // a pedir. Así el cambio de periodo es instantáneo.
  function getFetchRange() {
    var cfg = getCommerceConfig(activeMLId());
    var selected = getPeriodRange(cfg);
    var hoy = new Date();
    var desde = new Date(hoy); desde.setDate(desde.getDate() - 29); // 30 días incluido hoy
    var wideFrom = toDateInput(desde), wideTo = toDateInput(hoy);
    return {
      from: selected.from < wideFrom ? selected.from : wideFrom,
      to: selected.to > wideTo ? selected.to : wideTo
    };
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

  // Cambia el periodo. Si el rango pedido ya está dentro de lo traído, recalcula
  // la vista al INSTANTE (sin red) y anima la gráfica. Solo pide a ML si el rango
  // se sale de la ventana ya cacheada (ej. un custom más viejo).
  function applyPeriodChange() {
    var mlId = activeMLId();
    var cfg = getCommerceConfig(mlId);
    var preset = elements.commercePeriod?.value || "30";
    var next = { ...cfg, period: preset };

    if (preset === "custom") {
      next.periodFrom = elements.commercePeriodFrom?.value || getPeriodRange(cfg).from;
      next.periodTo = elements.commercePeriodTo?.value || toDateInput();
    }
    state.commerce.configs[mlId] = next;
    saveCommerceConfigs();

    var selected = getPeriodRange(next);
    var snap = state.commerce.snapshots[mlId];
    // Camino RÁPIDO: el rango pedido cae dentro de lo ya traído → re-filtrar y listo.
    if (snap && snap.allOrders && snap.fetchedRange && snap.fetchedRange.from && snap.fetchedRange.to &&
        selected.from >= snap.fetchedRange.from && selected.to <= snap.fetchedRange.to) {
      aplicarVistaComercio(snap, selected);
      animarProximoTrend();
      renderCommerceDashboard();
      return;
    }

    // Fuera de la ventana cacheada: hay que traer de ML.
    renderCommerceDashboard();
    if (preset === "custom" && (!next.periodFrom || !next.periodTo)) return;
    if (!next.hasToken) return;
    state.commerce.failCount = 0;
    animarProximoTrend();
    syncMercadoLibre({ silent: false });
  }

  function animarProximoTrend() { if (S.animarProximoTrend) S.animarProximoTrend(); }

  // ML espera ISO con zona; el dia "hasta" va completo (hasta las 23:59:59).
  // Uruguay es UTC-3: con "-00:00" (UTC) una venta hecha hoy despues de las ~21h
  // caia FUERA del rango y no se traia. Con "-03:00" el rango coincide con el dia
  // local y entran todas las ventas del dia, incluida la ultima.
  function isoFrom(d) { return d + "T00:00:00.000-03:00"; }
  function isoTo(d) { return d + "T23:59:59.999-03:00"; }

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
    // Shopee tiene su propio panel de conexion (OAuth Open Platform), no el
    // panel generico de pixel/endpoint. Se estructura ya; el backend se activa
    // cuando el titular carga las credenciales de Shopee Open Platform.
    var shopee = state.commerce.selectedApp === "shopee";

    elements.commerceAppSwitcher?.classList.toggle("is-hidden", hasApp);
    elements.commerceWorkspace?.classList.toggle("is-hidden", !hasApp);

    elements.mlConnectPanel?.classList.toggle("is-hidden", !(hasApp && ml));
    elements.shopeeConnectPanel?.classList.toggle("is-hidden", !(hasApp && shopee));
    elements.commerceConfigForm?.classList.toggle("is-hidden", !hasApp || ml || shopee);
    // Refresca el preview de la foto propia del negocio para el marketplace activo.
    if (S.renderMarketplacePhotoConfig) S.renderMarketplacePhotoConfig();

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
    if (!ml && !shopee) populateCommerceConfigForm();

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
      const visibles = orders.slice(0, 300);
      elements.commerceOrdersTable.innerHTML = visibles.map((order) => {
        // Foto: la del pedido o la cacheada (precargada). Si no hay, un slot vacío
        // marcado con el itemId para inyectarla apenas la traiga el loader on-demand.
        var thumbUrl = order.thumbnail || (order.itemId ? _thumbCache[order.itemId] : "");
        if (thumbUrl && !order.thumbnail) order.thumbnail = thumbUrl;
        var foto = thumbUrl
          ? `<img class="order-thumb" src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" onerror="this.style.display='none'" />`
          : `<span class="order-thumb order-thumb-empty" data-thumb-item="${escapeHtml(order.itemId || "")}" aria-hidden="true"></span>`;
        var stockLine = (order.stock === 0 || order.stock)
          ? `<small class="order-stock">Stock: ${integerNumber.format(order.stock)} u.</small>`
          : "";
        return `
        <tr class="venta-row" data-order-id="${escapeHtml(order.id)}" title="Ver detalle de la venta">
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
      cargarFotosOrdenesTabla(visibles);   // trae las fotos que falten y las inyecta
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

  // Trae UNA sola orden directo de ML (/orders/{id}) y la normaliza. Es lo que
  // permite abrir el detalle al toque, sin esperar el sync completo del periodo.
  async function fetchSingleOrder(accountId, orderId) {
    var api = S.requireSecureApi();
    var res = await api.mlApi("/orders/" + orderId, "GET", null, accountId);
    var mlOrder = res && res.payload;
    if (!mlOrder || !mlOrder.id) return null;
    return normalizeMLOrder(mlOrder, 0);
  }

  // Cache de fotos por itemId (dura la sesión): una vez traída una foto, abrir el
  // detalle de esa venta la muestra al instante, sin volver a pegarle a ML.
  var _thumbCache = {};
  function _precargar(url) { if (url) { try { var im = new Image(); im.decoding = "async"; im.src = url; } catch (e) {} } }

  // Foto de UNA publicacion, robusto: pide el item COMPLETO (/items/{id} sin
  // proyeccion de atributos, que a veces omitia la miniatura) y saca la mejor
  // URL en https. Cachea.
  async function fetchOrderThumb(accountId, itemId) {
    if (!itemId) return "";
    itemId = String(itemId);
    if (_thumbCache[itemId]) return _thumbCache[itemId];
    try {
      var res = await S.requireSecureApi().mlApi("/items/" + itemId, "GET", null, accountId);
      var url = thumbFromItemBody(res && res.payload);
      if (url) { _thumbCache[itemId] = url; _precargar(url); }
      return url;
    } catch (e) { return ""; }
  }

  // Fotos de varios itemIds de UNA cuenta. BULLETPROOF: intenta el multiget
  // (/items?ids=…, rapido) y para cualquier id que NO devuelva foto cae al item
  // individual (/items/{id} completo). Fuerza https (mixed-content). Cachea +
  // precarga. Devuelve { itemId: url }.
  async function thumbsForItems(accountId, itemIds) {
    var out = {}, faltan = [];
    (itemIds || []).forEach(function (id) {
      if (!id) return; id = String(id);
      if (_thumbCache[id]) out[id] = _thumbCache[id];
      else if (faltan.indexOf(id) === -1) faltan.push(id);
    });
    if (!faltan.length || !accountId) return out;
    var api;
    try { api = S.requireSecureApi(); } catch (e) { return out; }

    var pendientes = faltan.slice();
    // 1) Multiget (barato). Los que resuelvan salen de `pendientes`.
    for (var i = 0; i < faltan.length; i += 20) {
      var lote = faltan.slice(i, i + 20);
      try {
        var res = await api.mlApi("/items?ids=" + lote.join(",") + "&attributes=id,secure_thumbnail,thumbnail,pictures", "GET", null, accountId);
        var rows = (res && res.payload && res.payload.length) ? res.payload : [];
        rows.forEach(function (row) {
          var b = row && row.body ? row.body : (row && row.id ? row : null); if (!b || !b.id) return;
          var url = thumbFromItemBody(b);
          if (url) {
            var k = String(b.id);
            _thumbCache[k] = url; out[k] = url; _precargar(url);
            var p = pendientes.indexOf(k); if (p !== -1) pendientes.splice(p, 1);
          }
        });
      } catch (e) { /* el multiget puede estar restringido → van al fallback */ }
    }
    // 2) Fallback item por item (en paralelo, cap 8) para lo que falte.
    for (var j = 0; j < pendientes.length; j += 8) {
      var grupo = pendientes.slice(j, j + 8);
      await Promise.all(grupo.map(function (id) {
        return api.mlApi("/items/" + id, "GET", null, accountId).then(function (r) {
          var url = thumbFromItemBody(r && r.payload);
          if (url) { _thumbCache[id] = url; out[id] = url; _precargar(url); }
        }).catch(function () {});
      }));
    }
    return out;
  }

  // Carga on-demand las fotos que falten en la tabla de Ventas y las inyecta en
  // su fila apenas llegan (multiget, cacheado). Así las fotos aparecen al ver la
  // tabla, sin depender del enriquecimiento en segundo plano.
  function cargarFotosOrdenesTabla(orders) {
    if (!elements.commerceOrdersTable) return;
    var acc = state.commerce.selectedApp;
    if (!acc || !isMLApp(acc)) return;
    var ids = [];
    orders.forEach(function (o) {
      if (ids.length >= 60) return;   // tope: no floodear ML por 300 filas
      if (!o.thumbnail && o.itemId && ids.indexOf(o.itemId) === -1) ids.push(o.itemId);
    });
    if (!ids.length) return;
    Promise.resolve(thumbsForItems(acc, ids)).then(function (map) {
      if (!map || !elements.commerceOrdersTable) return;
      Object.keys(map).forEach(function (itemId) {
        var url = map[itemId]; if (!url) return;
        orders.forEach(function (o) { if (String(o.itemId) === itemId && !o.thumbnail) o.thumbnail = url; });
        var slots = elements.commerceOrdersTable.querySelectorAll('.order-thumb-empty[data-thumb-item="' + itemId + '"]');
        Array.prototype.forEach.call(slots, function (slot) {
          var img = document.createElement("img");
          img.className = "order-thumb"; img.alt = ""; img.loading = "lazy";
          img.onerror = function () { img.style.display = "none"; };
          img.src = url;
          if (slot.parentNode) slot.parentNode.replaceChild(img, slot);
        });
      });
    }).catch(function () {});
  }

  // Diagnóstico VISIBLE de por qué no cargan las fotos (sin consola). Prueba una
  // orden real: reporta si tiene itemId, y qué devuelve ML (single + multiget).
  async function diagnosticarFotos() {
    var box = document.getElementById("diagFotosResult");
    if (!box) return;
    var L = [];
    function pinta() { box.textContent = L.join("\n"); }
    L.push("Probando…"); pinta();
    var acc = activeMLId();
    var snap = getCommerceSnapshot(acc);
    var orders = (snap && (snap.allOrders || snap.orders)) || [];
    var conId = orders.filter(function (o) { return o.itemId; });
    L = [];
    L.push("Cuenta activa: " + acc);
    L.push("Órdenes en snapshot: " + orders.length + "  ·  con itemId: " + conId.length);
    if (!orders.length) { L.push("⚠️ No hay órdenes cargadas. Entrá a Ventas y esperá el sync."); pinta(); return; }
    if (!conId.length) { L.push("⚠️ CAUSA: ninguna orden trae itemId (datos viejos en caché). Solución: forzar re-sync."); pinta(); return; }
    var id = conId[0].itemId;
    L.push("Item de prueba: " + id);
    L.push("thumbnail guardado en la orden: " + (conId[0].thumbnail || "(vacío)"));
    pinta();
    // 1) single /items/{id}
    try {
      var r1 = await S.requireSecureApi().mlApi("/items/" + id, "GET", null, acc);
      var b = r1 && r1.payload;
      L.push("");
      L.push("[/items/{id}] OK");
      L.push("  secure_thumbnail: " + ((b && b.secure_thumbnail) || "(vacío)"));
      L.push("  thumbnail: " + ((b && b.thumbnail) || "(vacío)"));
      L.push("  pictures: " + ((b && b.pictures && b.pictures.length) || 0) + ((b && b.pictures && b.pictures[0]) ? "  [0].secure_url=" + b.pictures[0].secure_url : ""));
      L.push("  → URL resultante: " + (thumbFromItemBody(b) || "(vacío)"));
    } catch (e) {
      L.push("");
      L.push("[/items/{id}] ERROR: " + ((e && e.message) || "?") + "  status=" + ((e && (e.mlStatus || e.httpStatus)) || "?") + "  code=" + ((e && e.code) || "?"));
    }
    pinta();
    // 2) multiget
    try {
      var r2 = await S.requireSecureApi().mlApi("/items?ids=" + id + "&attributes=id,secure_thumbnail,thumbnail,pictures", "GET", null, acc);
      var arr = r2 && r2.payload;
      L.push("");
      L.push("[/items?ids=] tipo=" + (Array.isArray(arr) ? "array(" + arr.length + ")" : typeof arr));
      var b2 = Array.isArray(arr) && arr[0] ? (arr[0].body || arr[0]) : null;
      L.push("  → URL resultante: " + (thumbFromItemBody(b2) || "(vacío)"));
    } catch (e2) {
      L.push("");
      L.push("[/items?ids=] ERROR: " + ((e2 && e2.message) || "?") + "  status=" + ((e2 && (e2.mlStatus || e2.httpStatus)) || "?"));
    }
    pinta();
  }

  // Mete/actualiza una orden en el snapshot para que "volver" muestre la lista
  // con ella y ventaPorId la encuentre. Best-effort: si no hay snapshot todavia,
  // el refresh en segundo plano lo arma.
  function mergeOrderIntoSnapshot(accountId, order) {
    try {
      var snap = getCommerceSnapshot(accountId);
      if (!snap || !Array.isArray(snap.orders)) return;
      var idx = -1;
      for (var i = 0; i < snap.orders.length; i++) {
        if (String(snap.orders[i].id) === String(order.id)) { idx = i; break; }
      }
      if (idx === -1) snap.orders.unshift(order); else snap.orders[idx] = order;
    } catch (e) { /* best-effort */ }
  }

  // Saca el splash "Cargando tu venta…" del deep-link (si estaba puesto).
  function ocultarSplashVenta() {
    try { document.documentElement.classList.remove("booting-sale"); } catch (e) {}
  }

  // Abre el panel del detalle YA, con un esqueleto, mientras se trae la orden.
  function mostrarVentaCargando(orderId) {
    if (!elements.ventaDetail) return;
    ocultarSplashVenta();
    txtVenta(elements.ventaTitulo, "Cargando venta…");
    txtVenta(elements.ventaId, "Venta #" + orderId);
    txtVenta(elements.ventaFecha, "");
    if (elements.ventaFoto) { elements.ventaFoto.removeAttribute("src"); elements.ventaFoto.style.display = "none"; }
    txtVenta(elements.ventaProductoTitulo, "");
    if (elements.ventaEnvioDatos) elements.ventaEnvioDatos.textContent = "";
    elements.ventaLista?.classList.add("is-hidden");
    elements.ventaDetail.classList.remove("is-hidden");
    elements.ventaDetail.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Aterriza en la venta que disparo la notificacion. VELOCIDAD: no espera el
  // sync completo del periodo; muestra el detalle al toque trayendo SOLO esa
  // orden de ML, y llena la foto/direccion despues (progresivo). Funciona para
  // cualquier cuenta del modulo (ML 1, ML 2, Brasil y las que vengan).
  async function openSaleDeepLink(accountId, orderId, timeoutMs) {
    var app = getCommerceApp(accountId);
    if (!app) { ocultarSplashVenta(); return; } // cuenta desconocida: quedo la portada
    selectCommerceApp(accountId);
    window.NexusPlatformNav?.setSection("pedidos");

    // 1) Si el sync ya la trajo (app caliente), detalle instantaneo.
    if (ventaPorId(orderId)) { renderVentaDetail(orderId); return; }

    // 2) Camino rapido: abrir el detalle YA y traer SOLO esa orden directo de ML.
    mostrarVentaCargando(orderId);
    try {
      var o = await fetchSingleOrder(accountId, orderId);
      if (o) {
        mergeOrderIntoSnapshot(accountId, o);
        renderVentaDetail(orderId, o);
        return;
      }
    } catch (e) { /* si /orders/{id} falla, cae al fallback por sync */ }

    // 3) Fallback: esperar a que el sync la traiga (como antes).
    var row = await waitForOrderRow(orderId, timeoutMs || 12000);
    if (row) renderVentaDetail(orderId);
    else setMlMessage("La venta " + orderId + " todavia no aparece en el periodo actual.", "error");
  }

  // ---- Detalle de una venta (vista estilo Mercado Libre) -----

  var ventaActual = null;

  function ventaPorId(orderId) {
    var snap = getCommerceSnapshot(state.commerce.selectedApp);
    var orders = (snap && snap.orders) || [];
    for (var i = 0; i < orders.length; i++) {
      if (String(orders[i].id) === String(orderId)) return orders[i];
    }
    return null;
  }

  function txtVenta(el, value) { if (el) el.textContent = value; }

  function renderVentaDetail(orderId, preOrder) {
    if (!elements.ventaDetail) return;
    ocultarSplashVenta();
    var o = preOrder || ventaPorId(orderId);
    if (!o) { setMlMessage("No se encontro esa venta en el periodo actual.", "error"); return; }
    ventaActual = o;

    // Encabezado
    txtVenta(elements.ventaTitulo, o.product || "Venta");
    txtVenta(elements.ventaId, "Venta #" + o.id);
    txtVenta(elements.ventaFecha, S.formatDate(o.date));

    // Izquierda: foto + producto + unidades. Si vino sin foto (camino rapido de
    // la notificacion), se trae aparte y se rellena sin bloquear el render.
    if (elements.ventaFoto) {
      // Foto al instante: la del pedido o la cacheada (precargada en memoria).
      var fotoYa = o.thumbnail || (o.itemId ? _thumbCache[o.itemId] : "");
      if (fotoYa) { o.thumbnail = fotoYa; elements.ventaFoto.src = fotoYa; elements.ventaFoto.style.display = ""; }
      else {
        elements.ventaFoto.removeAttribute("src"); elements.ventaFoto.style.display = "none";
        if (o.itemId) {
          fetchOrderThumb(state.commerce.selectedApp, o.itemId).then(function (thumb) {
            if (thumb && ventaActual && String(ventaActual.id) === String(o.id) && elements.ventaFoto) {
              o.thumbnail = thumb;
              elements.ventaFoto.src = thumb; elements.ventaFoto.style.display = "";
            }
          });
        }
      }
    }
    txtVenta(elements.ventaProductoTitulo, o.product || "");
    txtVenta(elements.ventaVariacion, o.variation || "");
    if (elements.ventaVariacion) elements.ventaVariacion.style.display = o.variation ? "" : "none";
    txtVenta(elements.ventaUnidades, (o.units || 1) + ((o.units || 1) === 1 ? " unidad" : " unidades"));

    // Derecha: desglose (a cuanto vendiste, cargos, lucro liquido)
    var estado = o.refunded ? "Cobro devuelto"
      : (o.credited ? "Cobro aprobado" : "Cobro " + String(o.status || "").toLowerCase());
    txtVenta(elements.ventaCobroEstado, estado);
    txtVenta(elements.ventaPagoId, o.paymentId ? "#" + o.paymentId : "");
    txtVenta(elements.ventaPrecio, moneyWithCents.format(o.total || 0));
    txtVenta(elements.ventaCargos, "- " + moneyWithCents.format(o.commission || 0));
    txtVenta(elements.ventaEnvio, moneyWithCents.format(o.shipping || 0));
    txtVenta(elements.ventaTotal, moneyWithCents.format(o.margin || 0));
    txtVenta(elements.ventaLiberacion, o.releaseDate
      ? "El dinero se libera el " + S.formatDate(o.releaseDate) + "."
      : "El dinero se libera unos días después de la entrega del paquete.");

    // Datos del comprador
    txtVenta(elements.ventaComprador, o.customer || "Comprador");

    // Datos del producto
    if (elements.ventaProductoDatos) {
      var precioU = moneyWithCents.format(o.unitPrice || (o.units ? (o.total || 0) / o.units : o.total || 0));
      elements.ventaProductoDatos.innerHTML =
        "<div class='venta-dato'><span>Producto</span><b>" + escapeHtml(o.product || "") + "</b></div>" +
        (o.variation ? "<div class='venta-dato'><span>Variacion</span><b>" + escapeHtml(o.variation) + "</b></div>" : "") +
        "<div class='venta-dato'><span>Unidades</span><b>" + (o.units || 1) + "</b></div>" +
        "<div class='venta-dato'><span>Precio unitario</span><b>" + precioU + "</b></div>";
    }

    // Datos del envio: best-effort (necesita otra llamada a ML)
    if (elements.ventaEnvioDatos) {
      elements.ventaEnvioDatos.textContent = o.shippingId ? "Cargando direccion..." : "Sin datos de envio para esta venta.";
    }
    cargarEnvioVenta(o.shippingId);

    // Mostrar el detalle, ocultar la lista
    elements.ventaLista?.classList.add("is-hidden");
    elements.ventaDetail.classList.remove("is-hidden");
    elements.ventaDetail.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cerrarVentaDetail() {
    ventaActual = null;
    elements.ventaDetail?.classList.add("is-hidden");
    elements.ventaLista?.classList.remove("is-hidden");
  }

  // Direccion de envio: /shipments/{id} trae receiver_address. Best-effort: si
  // ML lo restringe o no hay id, se avisa y no rompe nada. Con guard por si el
  // titular cambio de venta mientras cargaba.
  async function cargarEnvioVenta(shippingId) {
    if (!shippingId) return;
    var pedido = shippingId;

    // En paralelo con la direccion: asegurar el costo de envio real en el
    // desglose (por si esta venta no entro en el enriquecido del sync). Corrige
    // Envios y recalcula el Lucro liquido en vivo, para que coincida con ML.
    fetchSellerShipping(shippingId).then(function (costo) {
      if (costo == null || costo <= 0) return;
      if (!ventaActual || ventaActual.shippingId !== pedido) return;
      ventaActual.shipping = costo;
      ventaActual.margin = (ventaActual.total || 0) - (ventaActual.commission || 0) - costo;
      txtVenta(elements.ventaEnvio, moneyWithCents.format(costo));
      txtVenta(elements.ventaTotal, moneyWithCents.format(ventaActual.margin));
    });

    if (!elements.ventaEnvioDatos) return;
    try {
      var api = S.requireSecureApi();
      var res = await api.mlApi("/shipments/" + shippingId, "GET", null, activeMLId());
      if (!ventaActual || ventaActual.shippingId !== pedido) return;
      var p = res.payload || {};
      var addr = p.receiver_address || {};
      var linea1 = [addr.street_name, addr.street_number].filter(Boolean).join(" ");
      var ciudad = [addr.city && addr.city.name, addr.state && addr.state.name].filter(Boolean).join(", ");
      var nombre = addr.receiver_name || (ventaActual && ventaActual.customer) || "";
      var filas = [];
      if (nombre) filas.push("<div class='venta-dato'><span>Destinatario</span><b>" + escapeHtml(nombre) + "</b></div>");
      if (linea1) filas.push("<div class='venta-dato'><span>Direccion</span><b>" + escapeHtml(linea1) + "</b></div>");
      if (ciudad) filas.push("<div class='venta-dato'><span>Ciudad</span><b>" + escapeHtml(ciudad) + "</b></div>");
      if (addr.zip_code) filas.push("<div class='venta-dato'><span>Codigo postal</span><b>" + escapeHtml(String(addr.zip_code)) + "</b></div>");
      if (addr.comment) filas.push("<div class='venta-dato'><span>Referencia</span><b>" + escapeHtml(String(addr.comment)) + "</b></div>");
      elements.ventaEnvioDatos.innerHTML = filas.length ? filas.join("") : "Mercado Libre no devolvio la direccion de esta venta.";
    } catch (e) {
      if (!ventaActual || ventaActual.shippingId !== pedido) return;
      elements.ventaEnvioDatos.textContent = "No se pudo traer la direccion de envio (Mercado Libre la restringe para esta cuenta).";
    }
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
          "&attributes=id,title,price,currency_id,available_quantity,sold_quantity,status,secure_thumbnail,thumbnail,pictures,permalink,variations",
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
            thumbnail: thumbFromItemBody(b),
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

    // Al salir de Inventario, cortar su auto-refresh (lo reinicia abrirInventario).
    if (d.section !== "inventario" && S.detenerInvTiempoReal) S.detenerInvTiempoReal();

    if (d.section === "pedidos") {
      cerrarVentaDetail();   // al entrar a Ventas, siempre se ve la lista
      return;
    }

    if (d.section === "publicaciones") {
      if (isMLApp(state.commerce.selectedApp)) loadMLListings(false);
      return;
    }

    if (d.section === "publicidad") {
      // Al entrar a Publicidad: siempre a la lista (no a un detalle viejo). Si no
      // se trajeron las campañas todavia, traerlas (lazy). Si ya estan, repintar.
      if (isMLApp(state.commerce.selectedApp)) {
        adsCerrarDetail();
        var ca = adsDatos(activeMLId());
        if (!ca.campaigns && !ca.error && !ca.cargando) cargarAds(activeMLId());
        else renderAdsPanel();
        iniciarAdsTiempoReal();   // refresco automatico mientras se ve la seccion
      }
      return;
    }
    detenerAdsTiempoReal();       // al salir de Publicidad, cortar el polling

    if (d.section === "inventario") {
      if (isMLApp(state.commerce.selectedApp) && S.abrirInventario) S.abrirInventario();
      return;
    }

    if (d.section === "resumen") {
      // Al ENTRAR a Métricas, animar la gráfica desde 0 (barras suben + línea traza).
      animarProximoTrend();
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
      disponible: 0, aLiberar: 0, sinFecha: 0, hoyNeto: 0,
      cobros: [], proximas: {}
    };

    (orders || []).forEach(function (o) {
      if (o.cancelled) return;                    // una venta caida no es plata
      var neto = (o.total || 0) - (o.commission || 0) - (o.shipping || 0);
      res.bruto += o.total || 0;
      res.comision += o.commission || 0;
      res.envio += o.shipping || 0;
      res.neto += neto;

      // "Crecio hoy": neto de las ventas registradas hoy (aproxima el numero
      // que MP muestra arriba del saldo). No es el delta de la billetera, que
      // vive en su API bloqueada; es lo que entro hoy por ventas.
      if (!o.refunded && String(o.date || "").slice(0, 10) === hoy) res.hoyNeto += neto;

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
      if (elements.mpActivityList) elements.mpActivityList.innerHTML = "";
      if (elements.mpHeroBalance) elements.mpHeroBalance.textContent = moneyWithCents.format(0);
      if (elements.mpHeroGrowth) elements.mpHeroGrowth.textContent = "";
      if (elements.mpReleaseAmount) elements.mpReleaseAmount.textContent = moneyWithCents.format(0);
      return;
    }
    elements.mpEmpty?.classList.remove("is-visible");

    var r = resumenMercadoPago(orders);

    // De donde salen los numeros del dinero:
    //  - "A liberar" (lo pendiente de liberar): PREFERIMOS los pagos reales de
    //    MP (cache.pagos, via /v1/payments/search). Si no hay, caemos al
    //    estimado por las ventas de ML.
    //  - "Ya liberado de tus ventas": idem.
    //  - El SALDO DISPONIBLE de la billetera (ej $0,28) NO se puede traer: MP no
    //    lo expone por API y depende de tus retiros (que la API tampoco muestra).
    //    Por eso el hero muestra "a liberar", no el saldo, y lo decimos claro.
    var pagosReal = cache.pagos;                       // {aLiberar, liberado, contados} o null
    var usaPagos = !!(pagosReal && pagosReal.contados > 0);
    var usaSaldoReal = !!cache.saldo;                  // el balance de billetera, SI MP lo da
    var aLiberar = usaPagos ? pagosReal.aLiberar : (usaSaldoReal ? cache.saldo.aLiberar : r.aLiberar);
    var liberado = usaPagos ? pagosReal.liberado : r.disponible;
    var fuente = usaPagos ? "de tus pagos reales de MP" : "estimado por tus ventas";
    var pieLib = usaPagos ? "de tus pagos reales" : (aLiberar > 0 ? "estimado por tus ventas" : "nada pendiente");

    // --- Hero GRANDE = "A liberar de tus ventas": el numero REAL que si tenemos.
    // El SALDO DISPONIBLE ($0,28) no se puede ni traer (403) ni CALCULAR: seria
    // (liberado - retiros), y los retiros MP tampoco los da por API. Calcular
    // solo con lo liberado daria un numero inflado (todo lo que entro, sin
    // descontar lo retirado), asi que no se muestra ahi: para el saldo exacto,
    // "Ir a tu dinero". La fila de abajo lleva lo ya liberado. ---
    if (elements.mpHeroBalance) {
      elements.mpHeroBalance.textContent = usaSaldoReal ? moneyWithCents.format(cache.saldo.disponible) : moneyWithCents.format(aLiberar);
    }
    if (elements.mpHeroGrowth) {
      elements.mpHeroGrowth.classList.remove("is-up");
      elements.mpHeroGrowth.textContent = usaSaldoReal
        ? "Saldo disponible real en tu billetera"
        : "Pendiente de liberar · tu saldo disponible exacto: tocá “Ir a tu dinero”";
    }
    // Fila de abajo: PROXIMA liberacion (fecha + monto de lo proximo que se
    // libera). Numero chico y con fecha: no se confunde con un saldo.
    if (elements.mpReleaseAmount) {
      if (usaPagos && pagosReal.proxFecha) {
        elements.mpReleaseAmount.textContent = moneyWithCents.format(pagosReal.proxMonto) + " · " + S.formatDate(pagosReal.proxFecha);
      } else {
        var fp = Object.keys(r.proximas).sort();
        elements.mpReleaseAmount.textContent = fp.length
          ? moneyWithCents.format(r.proximas[fp[0]]) + " · " + S.formatDate(fp[0])
          : "sin fecha próxima";
      }
    }

    // --- Últimas actividades: los cobros como lista, estilo MP ---
    if (elements.mpActivityList) {
      elements.mpActivityList.innerHTML = r.cobros.slice(0, 12).map(function (c) {
        var devuelto = !!c.refunded;
        var disp = c.libera && c.libera <= hoyISO();
        var estado = devuelto ? "Devuelto" : (!c.libera ? "Pendiente" : (disp ? "Disponible" : "A liberar"));
        var iconClase = devuelto ? "is-back" : "is-in";
        var icono = devuelto ? "↩" : "↓";
        var signo = devuelto ? "- " : "+ ";
        var montoClase = devuelto ? "is-back" : "is-in";
        return '<li class="mp-act">' +
            '<span class="mp-act-icon ' + iconClase + '" aria-hidden="true">' + icono + "</span>" +
            '<span class="mp-act-body">' +
              '<span class="mp-act-title">' + escapeHtml(c.producto || "Cobro") + "</span>" +
              '<span class="mp-act-sub">' + (devuelto ? "Devolución" : "Cobro de venta") + " · " + escapeHtml(S.formatDate(c.fecha)) + "</span>" +
            "</span>" +
            '<span class="mp-act-side">' +
              '<span class="mp-act-amount ' + montoClase + '">' + signo + moneyWithCents.format(c.neto) + "</span>" +
              '<span class="mp-act-status">' + estado + "</span>" +
            "</span>" +
          "</li>";
      }).join("");
    }

    if (elements.mpStats) {
      elements.mpStats.innerHTML = [
        tarjetaMP("A liberar", moneyWithCents.format(aLiberar), pieLib, "is-good"),
        tarjetaMP("Ya liberado de ventas", moneyWithCents.format(liberado), fuente, ""),
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
      // Con pagos reales de MP el "a liberar" ya es exacto: la nota de ventas
      // "sin fecha" (que sale del estimado por ordenes de ML) solo confunde.
      elements.mpNote.textContent = (!usaPagos && r.sinFecha > 0)
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
    return "en " + dias + " días";
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
    var faltaToken = null;
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
      } catch (e) {
        // "Falta conectar MP" gana sobre cualquier otro error: es la causa
        // real y la unica accionable por el titular.
        if (e && e.code === "sin_token_mp") faltaToken = e;
        ultimoError = e;
      }
    }
    throw faltaToken || ultimoError || new Error("Mercado Pago no devolvio el saldo.");
  }

  function primerNumero(lista) {
    for (var i = 0; i < lista.length; i++) {
      if (lista[i] != null && !isNaN(Number(lista[i]))) return Number(lista[i]);
    }
    return null;
  }

  // "Dinero a liberar" REAL: los pagos aprobados cuya plata todavia no se
  // libero. Sale de /v1/payments/search, que trae money_release_date, el estado
  // de liberacion y el neto EN CADA resultado (no hace falta una llamada por
  // pago). Se acota a los pagos recientes: los pendientes de liberar son de las
  // ultimas semanas, los viejos ya estan liberados.
  //
  // OJO — lo que NO se puede: el SALDO DISPONIBLE de la billetera (ej $0,28)
  // no lo expone MP por API y ademas depende de tus retiros, que la API no
  // muestra. Por eso el hero muestra "a liberar" (esto), no el saldo.
  async function cargarPagosMP(cuenta) {
    var api = S.requireSecureApi();
    var pagos = [];
    var LIMITE = 50, offset = 0, guard = 0;
    var corteISO = new Date(Date.now() - 60 * 86400000).toISOString();  // 60 dias atras
    while (guard < 12) {
      var url = "/v1/payments/search?sort=date_created&criteria=desc&limit=" + LIMITE + "&offset=" + offset;
      var res = await api.mpApi(url, "GET", null, cuenta);
      var p = res.payload || {};
      var batch = p.results || [];
      if (!batch.length) break;
      pagos = pagos.concat(batch);
      var total = (p.paging && p.paging.total) || pagos.length;
      var ultimo = batch[batch.length - 1] || {};
      var fechaUlt = String(ultimo.date_created || ultimo.date_approved || "");
      if (fechaUlt && fechaUlt < corteISO) break;   // ya son viejos: cortar
      if (pagos.length >= total) break;
      offset += LIMITE;
      guard++;
      await dormirMP(150);
    }
    return pagos;
  }

  // De los pagos crudos saca: lo pendiente de liberar (a liberar) y lo ya
  // liberado (de tus ventas). El neto sale de transaction_details.net_received_amount;
  // si no viniera, se estima con transaction_amount menos las comisiones.
  function resumenPagosMP(pagos) {
    var ahora = new Date().toISOString();
    var aLiberar = 0, liberado = 0, pendientes = 0, contados = 0;
    var proximas = {};                 // fecha (YYYY-MM-DD) -> neto que se libera ese dia
    (pagos || []).forEach(function (pg) {
      if (!pg || pg.status !== "approved") return;
      var td = pg.transaction_details || {};
      var neto = td.net_received_amount;
      if (neto == null) {
        var fees = (pg.fee_details || []).reduce(function (s, f) { return s + (Number(f.amount) || 0); }, 0);
        neto = (Number(pg.transaction_amount) || 0) - fees;
      }
      neto = Number(neto) || 0;
      contados++;
      var rel = String(pg.money_release_date || "");
      var pendiente = pg.money_release_status === "pending" || (rel && rel > ahora);
      if (pendiente) {
        aLiberar += neto; pendientes++;
        if (rel) { var d = rel.slice(0, 10); proximas[d] = (proximas[d] || 0) + neto; }
      } else {
        liberado += neto;
      }
    });
    var fechasP = Object.keys(proximas).sort();
    return {
      aLiberar: aLiberar, liberado: liberado, pendientes: pendientes, contados: contados,
      proxFecha: fechasP[0] || null, proxMonto: fechasP.length ? proximas[fechasP[0]] : 0
    };
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
    var ok = 0, fallos = 0, primerError = null;
    for (var i = 0; i < lote.length; i++) {
      try {
        var res = await api.mpApi("/v1/payments/" + lote[i], "GET", null, cuenta);
        var p = res.payload || {};
        cache.liberaciones[lote[i]] = String(p.money_release_date || p.date_released || "");
        ok++;
        // Si el primer pago responde bien, no hace falta ir de a poco: se
        // sigue. Pero si el PRIMERO falla, se corta: es un problema de
        // permisos, no de ese pago puntual, y no tiene sentido quemar 40
        // llamadas para confirmar lo mismo.
      } catch (e) {
        cache.liberaciones[lote[i]] = "";   // se marca como consultado igual
        fallos++;
        if (!primerError) primerError = (e && e.message) || "error";
        if (i === 0) break;
      }
      await dormirMP(120);
    }
    return { recortado: recortado, faltan: Math.max(0, ids.length - TOPE), ok: ok, fallos: fallos, primerError: primerError };
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
    var errorSaldo = null;
    try {
      try {
        cache.saldo = await cargarSaldoMP(cuenta);
        pintarSaldoMP(cache.saldo);
        // Repintar YA: las tarjetas tienen que mostrar el saldo real apenas
        // llega, no recien en el proximo render. El re-entry esta cubierto por
        // `cargando`, asi que esto no dispara otra consulta.
        renderMercadoPago();
      } catch (e) {
        errorSaldo = e;
        pintarSaldoMP(null, e);
      }
      // Dinero a liberar REAL, de los pagos de MP (no del estimado por ventas).
      // Si falla (sin token o error), se cae al estimado y no rompe nada.
      try {
        cache.pagos = resumenPagosMP(await cargarPagosMP(cuenta));
        renderMercadoPago();
      } catch (ep) {
        cache.pagos = null;
      }
      var r = await cargarLiberaciones(cuenta, orders, cache);
      if (r) {
        cache.recorte = r.recortado ? r.faltan : 0;
        cache.liberacionesOK = r.ok;
        cache.liberacionesError = r.ok === 0 && r.fallos > 0 ? r.primerError : null;
        renderMercadoPago();          // repintar con las fechas ya cargadas
        // Recien AHORA se sabe si las fechas funcionan: se rehace el mensaje
        // del saldo con esa informacion (antes no se podia saber).
        if (!cache.saldo) pintarSaldoMP(null, errorSaldo);
      }
    } finally {
      cache.cargando = false;
    }
  }

  // Tres estados posibles, y hay que distinguirlos porque la accion del
  // titular es distinta en cada uno:
  //   1. falta el token        -> conectar Mercado Pago
  //   2. token puesto pero MP no da el saldo de billetera (permisos del
  //      token de aplicacion) -> no hay nada que hacer, pero las fechas de
  //      liberacion SI pueden funcionar
  //   3. todo anda             -> saldo real
  function pintarSaldoMP(saldo, error) {
    if (!elements.mpBalance) return;
    var cache = mpDatos(activeMLId());

    if (saldo) {
      elements.mpBalance.innerHTML = "Saldo real en tu billetera de Mercado Pago: <b>" +
        moneyWithCents.format(saldo.disponible) + "</b> disponible" +
        (saldo.aLiberar ? " · <b>" + moneyWithCents.format(saldo.aLiberar) + "</b> a liberar" : "");
      elements.mpBalance.className = "meta-message is-success";
      mostrarConexionMP(false);
      return;
    }

    var sinToken = error && error.code === "sin_token_mp";
    if (sinToken) {
      elements.mpBalance.textContent =
        "Para ver el saldo real y las fechas de liberacion hay que conectar Mercado Pago (abajo). " +
        "Los importes de ventas si son exactos.";
      elements.mpBalance.className = "meta-message";
      mostrarConexionMP(true);
      return;
    }

    // Token puesto pero el saldo no salio. Si las liberaciones SI funcionan,
    // el titular igual tiene lo importante: se lo decimos con precision en
    // vez de dejar un "forbidden" que no explica nada.
    var fechasOK = cache.liberacionesOK > 0;
    elements.mpBalance.innerHTML = fechasOK
      ? "Mercado Pago <b>conectado</b>. El total de la billetera no lo expone su API para tokens de aplicacion, " +
        "pero las fechas de liberacion y los importes de tus ventas si son exactos."
      : "Mercado Pago conectado, pero rechaza las consultas (" +
        escapeHtml((error && error.message) || "sin detalle") + "). " +
        "Los importes de ventas de abajo si son exactos.";
    elements.mpBalance.className = fechasOK ? "meta-message is-success" : "meta-message";
    // Si las fechas andan, el token sirve: no tiene sentido pedir reconectar.
    mostrarConexionMP(!fechasOK);
  }

  function mostrarConexionMP(mostrar) {
    if (!elements.mpConnect) return;
    elements.mpConnect.classList.toggle("is-hidden", !mostrar);
    if (elements.mpConnectState) {
      elements.mpConnectState.textContent = mostrar ? "Sin conectar" : "Conectado";
      elements.mpConnectState.className = mostrar ? "" : "mp-ok";
    }
  }

  // Guarda el access token de Mercado Pago (cifrado, server-side) y prueba
  // enseguida que sirva, para no dejar al titular con la duda.
  async function guardarTokenMP() {
    var input = elements.mpToken;
    var msg = elements.mpConnectMsg;
    if (!input || !msg) return;
    var token = String(input.value || "").trim();
    if (token.length < 20) {
      msg.textContent = "Pega el access token completo (empieza con APP_USR-).";
      msg.className = "meta-message is-error";
      return;
    }

    var cuenta = activeMLId();
    elements.mpSaveToken.disabled = true;
    msg.textContent = "Guardando y probando...";
    msg.className = "meta-message";
    try {
      var api = S.requireSecureApi();
      await api.saveProviderToken("mp_" + cuenta, token);
      input.value = "";
      mpCache[cuenta] = null;

      // Validar el token con /users/me: un token de aplicacion SIEMPRE puede con
      // este endpoint. NO se valida con el saldo de billetera: MP lo bloquea con
      // 403 para tokens de app, y eso rechazaba tokens perfectamente validos (el
      // "forbidden" era del saldo, no del token). Lo que Nexus de verdad usa
      // —las fechas de liberacion via /v1/payments/{id}— si funciona con el token.
      var meMp = await api.mpApi("/users/me", "GET", null, cuenta);
      var mpId = (meMp.payload || {}).id;

      // Chequear que el token sea de la MISMA cuenta que Mercado Libre: si es de
      // otra, las fechas de liberacion de estos pagos tambien darian 403.
      var mlId = null;
      try {
        var meMl = await api.mlApi("/users/me", "GET", null, cuenta);
        mlId = (meMl.payload || {}).id;
      } catch (e) { /* si ML no responde, el token de MP ya quedo validado */ }

      if (mpId && mlId && String(mpId) !== String(mlId)) {
        msg.innerHTML = "El token es valido pero es de <b>otra cuenta</b> (Mercado Pago #" +
          escapeHtml(String(mpId)) + " ≠ Mercado Libre #" + escapeHtml(String(mlId)) +
          "). Pega el Access Token de produccion de la <b>misma cuenta</b> de esta aplicacion.";
        msg.className = "meta-message is-error";
      } else {
        msg.textContent = "Token validado y guardado. La seccion se conecta sola: si MP no expone el saldo de billetera (normal en tokens de app), igual traes las fechas de liberacion y el disponible reales.";
        msg.className = "meta-message is-success";
      }
      // renderMercadoPago dispara enriquecerMercadoPago, que intenta el saldo
      // (best-effort) y las fechas de liberacion, y pinta el estado preciso.
      renderMercadoPago();
    } catch (error) {
      var st = (error && (error.mlStatus || error.httpStatus)) || 0;
      var detalle;
      if (st === 401) {
        detalle = "el token no es valido (401). Copia el Access Token de PRODUCCION completo (empieza con APP_USR-), no el de prueba (TEST-).";
      } else if (st === 403) {
        detalle = "el token no tiene permiso (403). Verifica que sea de la MISMA cuenta de esta aplicacion.";
      } else {
        detalle = ((error && error.message) || "error") + ". Revisa que sea el de produccion de esta misma cuenta.";
      }
      msg.textContent = "Mercado Pago rechazo el token: " + detalle;
      msg.className = "meta-message is-error";
    } finally {
      elements.mpSaveToken.disabled = false;
    }
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
        // Ventana AMPLIA (30 días) para poder cambiar de periodo sin re-pedir.
        var fetchRange = getFetchRange();
        // Las visitas van en paralelo: es otra API y no debe demorar las ventas.
        var [orders, visits] = await Promise.all([
          fetchMLOrders(fetchRange),
          fetchMLVisits(fetchRange)
        ]);
        // Snapshot + primer render YA, con los datos crudos (facturación, cantidad,
        // gráfica). El enriquecido (fotos + costo de envío real) va DESPUÉS en
        // segundo plano, para no demorar el render — corrige margen/envío al llegar.
        var next = createCommerceSnapshot(orders, "live", { visits: visits, range: fetchRange, viewRange: getPeriodRange() });
        var mlId = activeMLId();
        var prev = state.commerce.snapshots[mlId];
        state.commerce.snapshots[mlId] = next;
        // Con el modo "en vivo" esto corre cada minuto: si no hay ventas
        // nuevas, no reescribir (evita subir lo mismo a Firestore sin parar).
        if (!prev || ordersSignature(prev.allOrders || prev.orders) !== ordersSignature(next.allOrders)) {
          saveCommerceSnapshots();
        }
        enriquecerVentasEnFondo(next, mlId); // no se await: enriquece en paralelo
        return orders.length
          ? orders.length + " ordenes sincronizadas desde Mercado Libre."
          : "No se encontraron ordenes en el periodo elegido.";
      }
    });
  }

  // Enriquecimiento en segundo plano: fotos (de /items) + costo de envío real (de
  // /shipments/{id}/costs). NO bloquea el primer render; al terminar recalcula la
  // vista y repinta (corrige margen/envío/fotos) sin animar.
  async function enriquecerVentasEnFondo(snapshot, mlId) {
    try {
      // 1) FOTOS primero (multiget: ~1 llamada cada 20 items) y REPINTAR YA.
      //    Antes se esperaba tambien al envio (~30 llamadas sueltas y lentas)
      //    ANTES de repintar, por eso las fotos "demoraban muchisimo". Ahora
      //    salen apenas llega el multiget, y ademas se precargan en memoria para
      //    que el detalle de la venta abra la foto al instante.
      await enrichMLOrdersWithItems((snapshot.allOrders || []).slice(0, 60));
      if (state.commerce.snapshots[mlId] === snapshot) {
        aplicarVistaComercio(snapshot, getPeriodRange());
        saveCommerceSnapshots();
        renderCommerceDashboard();
        precargarFotosVentas(snapshot);
      }
      // 2) Envio real (lento): recien despues, y segundo repintado para el margen.
      await enrichMLOrdersWithShipping((snapshot.allOrders || []).slice(0, 30));
      if (state.commerce.snapshots[mlId] === snapshot) {
        aplicarVistaComercio(snapshot, getPeriodRange());
        saveCommerceSnapshots();
        renderCommerceDashboard();
      }
    } catch (e) { /* best-effort: el primer render ya se mostró */ }
  }

  // Precarga en memoria las fotos de las ventas (new Image()) para que al abrir
  // el detalle la foto ya esté en cache del navegador y aparezca al instante.
  function precargarFotosVentas(snapshot) {
    try {
      var vistos = {};
      (snapshot.allOrders || []).slice(0, 50).forEach(function (o) {
        if (o.thumbnail && !vistos[o.thumbnail]) {
          vistos[o.thumbnail] = 1;
          if (o.itemId) _thumbCache[o.itemId] = o.thumbnail;
          var im = new Image(); im.decoding = "async"; im.src = o.thumbnail;
        }
      });
    } catch (e) { /* no-op */ }
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

  function selectCommerceApp(id, opts) {
    const app = getCommerceApp(id);
    if (!app) return;

    // Reflejar el negocio abierto en el hash (#ecommerce-<id>) para que el gesto
    // atras del iPhone vuelva al selector y reabrir la PWA recuerde donde estabas.
    // Con opts.fromHash no se apila (estamos justamente restaurando desde el hash).
    if (!(opts && opts.fromHash) && location.hash !== "#ecommerce-" + id) {
      try { history.pushState(null, "", "#ecommerce-" + id); } catch (e) { /* sin history */ }
    }

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
    // Sincronizar la URL: si la cuenta pertenecia a un negocio, la vista vuelve a
    // ese negocio (#ecommerce-<grupo>); si no, al selector de primer nivel
    // (#ecommerce). Se reemplaza, no se apila.
    var destino = state.commerce.selectedGroup ? "#ecommerce-" + state.commerce.selectedGroup : "#ecommerce";
    if (location.hash !== destino) {
      try { history.replaceState(null, "", destino); } catch (e) { /* sin history */ }
    }
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

  /* ============================================================
     Publicidad — campañas de Product Ads (Mercado Ads)
     Solo LECTURA (fase 1): trae campañas + metricas + gasto. La API es la
     misma de ML (host "ml"), con el header Api-Version que agrega el proxy.
     Los nombres de campos de metricas se leen defensivo (varian por version)
     y hay que verificarlos contra la respuesta real de la cuenta.
     ============================================================ */
  var adsCache = {};
  function adsDatos(cuenta) {
    if (!adsCache[cuenta]) adsCache[cuenta] = { campaigns: null, totals: null, error: null, cargando: false };
    return adsCache[cuenta];
  }

  function adsNum(o, campos) {
    for (var i = 0; i < campos.length; i++) {
      var v = o ? o[campos[i]] : null;
      if (v != null && !isNaN(Number(v))) return Number(v);
    }
    return 0;
  }

  function adsDesdeISO(dias) {
    var d = new Date(); d.setDate(d.getDate() - dias);
    return d.toISOString().slice(0, 10);
  }

  // Mapeo de campos de metricas de la API de Mercado Ads a lo que muestra el
  // panel de ML. OJO: total_amount es INGRESOS (revenue), NO el costo — el costo
  // es `cost`. units_quantity = ventas atribuidas; organic_units_quantity = otras.
  function normalizeAdsCampaign(c) {
    var m = c.metrics || c;
    var gasto = adsNum(m, ["cost", "spend"]);                                   // lo gastado
    var ingresos = adsNum(m, ["total_amount", "amount"]) ||                     // revenue de ads
      (adsNum(m, ["direct_amount"]) + adsNum(m, ["indirect_amount"]));
    var atribuidas = adsNum(m, ["units_quantity"]) ||                           // ventas atribuidas (u.)
      (adsNum(m, ["direct_items_quantity"]) + adsNum(m, ["indirect_items_quantity"])) ||
      (adsNum(m, ["direct_units_quantity"]) + adsNum(m, ["indirect_units_quantity"]));
    var otras = adsNum(m, ["organic_units_quantity", "organic_items_quantity"]); // ventas organicas
    var clicks = adsNum(m, ["clicks"]);
    var prints = adsNum(m, ["prints", "impressions"]);
    var cpc = adsNum(m, ["cpc"]) || (clicks ? gasto / clicks : 0);
    var acos = adsNum(m, ["acos"]) || (ingresos ? gasto / ingresos * 100 : 0);
    var roas = adsNum(m, ["roas"]);
    if (!roas && gasto && ingresos) roas = ingresos / gasto;
    if (!roas && acos) roas = 100 / acos;
    return {
      id: String(c.id || c.campaign_id || ""),
      name: String(c.name || c.campaign_name || "Campaña"),
      status: String(c.status || "").toLowerCase(),
      budget: adsNum(c, ["budget", "daily_budget"]) || adsNum(m, ["budget"]),
      // roasTarget = objetivo configurado (lo que se EDITA). roas = el logrado.
      roasTarget: adsNum(c, ["roas_target"]) || adsNum(m, ["roas_target"]),
      anuncios: adsNum(c, ["ads_quantity", "total_ads", "ads_count", "items_quantity"]),
      gasto: gasto, ingresos: ingresos, atribuidas: atribuidas, otras: otras,
      clicks: clicks, prints: prints, cpc: cpc, acos: acos, roas: roas
    };
  }

  function estadoAdsPill(status) {
    if (status === "active" || status === "enabled") return '<span class="type-pill income">Activa</span>';
    if (status === "paused") return '<span class="type-pill pub-warn">Pausada</span>';
    if (status) return '<span class="type-pill expense">' + escapeHtml(status) + "</span>";
    return '<span class="type-pill">—</span>';
  }

  function tarjetaAds(titulo, valor, pie, clase) {
    return '<div class="metric-card ' + (clase || "") + '"><span>' + titulo + "</span>" +
      "<strong>" + valor + "</strong><small>" + escapeHtml(pie || "") + "</small></div>";
  }

  async function fetchMLAds(cuenta) {
    var api = S.requireSecureApi();
    // 1) advertiser habilitado para Product Ads
    var advRes = await api.mlApi("/advertising/advertisers?product_id=PADS", "GET", null, cuenta);
    var advertisers = (advRes.payload && (advRes.payload.advertisers || advRes.payload)) || [];
    if (!Array.isArray(advertisers) || !advertisers.length) {
      throw Object.assign(new Error("Sin Product Ads."), { code: "sin_ads" });
    }
    var adv = advertisers[0];
    var advertiserId = adv.advertiser_id || adv.id;
    var siteId = adv.site_id || "MLU";
    // Guardar advertiser+site: los necesitan las operaciones de escritura
    // (pausar, presupuesto, items) sin volver a pedir el advertiser.
    var cc = adsDatos(cuenta);
    cc.advertiserId = advertiserId;
    cc.siteId = siteId;
    // 2) campañas con el set COMPLETO de metricas (para replicar el panel de ML),
    // rango 30 dias como el default de ML.
    var METRICS = "clicks,prints,ctr,cost,cpc,acos,roas,cvr,total_amount,direct_amount,indirect_amount," +
      "units_quantity,direct_items_quantity,indirect_items_quantity,organic_units_quantity,organic_items_quantity";
    var qs = "/marketplace/advertising/" + siteId + "/advertisers/" + advertiserId +
      "/product_ads/campaigns/search?limit=100&date_from=" + adsDesdeISO(29) + "&date_to=" + hoyISO() +
      "&metrics=" + METRICS;
    var campRes = await api.mlApi(qs, "GET", null, cuenta);
    var results = (campRes.payload && (campRes.payload.results || campRes.payload)) || [];
    return (Array.isArray(results) ? results : []).map(normalizeAdsCampaign);
  }

  async function cargarAds(cuenta) {
    var cache = adsDatos(cuenta);
    if (cache.cargando) return;
    cache.cargando = true;
    if (elements.adsMessage) { elements.adsMessage.textContent = "Cargando campañas..."; elements.adsMessage.className = "meta-message"; }
    try {
      var campaigns = await fetchMLAds(cuenta);
      // Resumen agregado, igual que arriba del panel de ML.
      var s = { gasto: 0, ingresos: 0, atribuidas: 0, otras: 0, clicks: 0, prints: 0, presupuesto: 0 };
      campaigns.forEach(function (c) {
        s.gasto += c.gasto; s.ingresos += c.ingresos; s.atribuidas += c.atribuidas;
        s.otras += c.otras; s.clicks += c.clicks; s.prints += c.prints; s.presupuesto += c.budget || 0;
      });
      s.roas = s.gasto ? s.ingresos / s.gasto : 0;
      s.acos = s.ingresos ? s.gasto / s.ingresos * 100 : 0;
      s.cpc = s.clicks ? s.gasto / s.clicks : 0;
      var totalVentas = s.atribuidas + s.otras;
      s.aporte = totalVentas ? s.atribuidas / totalVentas * 100 : 0;   // "Aporte por publicidad"
      cache.campaigns = campaigns;
      cache.totals = s;
      cache.error = null;
      cargarAdsGrafico(cuenta);   // la grafica diaria va en paralelo (no bloquea)
      if (elements.adsMessage) elements.adsMessage.textContent = campaigns.length ? "" : "No hay campañas en los últimos 30 días.";
    } catch (e) {
      cache.error = e; cache.campaigns = null; cache.totals = null;
      if (elements.adsMessage) {
        var st = (e && (e.mlStatus || e.httpStatus)) || 0;
        elements.adsMessage.textContent = (e && e.code === "sin_ads")
          ? "Tu cuenta no tiene Product Ads habilitado. Activalo en Mercado Libre (Publicidad) y reconectá tu cuenta."
          : (st === 403 || st === 404)
            ? "La conexión de Mercado Libre no incluye permiso de publicidad (o Product Ads no está activo). Reconectá tu cuenta e intentá de nuevo."
            : "No se pudieron traer las campañas: " + ((e && e.message) || "error") + ".";
        elements.adsMessage.className = "meta-message is-error";
      }
    } finally {
      cache.cargando = false;
      renderAdsPanel();
    }
  }

  function reloadAds() { cargarAds(activeMLId()); }

  // --- Grafica diaria (barras atribuidas+organicas + linea ROAS), como en ML ---
  async function cargarAdsGrafico(cuenta) {
    if (!elements.adsChart) return;
    try {
      var api = S.requireSecureApi();
      var cache = adsDatos(cuenta);
      if (!cache.advertiserId) return;
      var METRICS = "units_quantity,organic_units_quantity,cost,total_amount,roas,direct_items_quantity,indirect_items_quantity";
      // Serie diaria: MISMO endpoint /campaigns/search que las métricas de arriba
      // (el que ML soporta), pero con aggregation_type=DAILY para el desglose por
      // día. El base de gestión (/advertising/.../campaigns) NO devuelve la serie.
      var url = adsMktBase(cache) + "/campaigns/search?date_from=" + adsDesdeISO(29) + "&date_to=" + hoyISO() +
        "&metrics=" + METRICS + "&aggregation_type=DAILY&limit=100";
      var res = await api.mlApi(url, "GET", null, cuenta);
      var p = res.payload || {};
      var raw = p.results || p.metrics || (Array.isArray(p) ? p : []);
      var serie = adsSerieDiaria(raw);
      cache.serie = serie;
      cache.serieRaw = raw;   // crudo por-campaña, para la gráfica del detalle
      drawAdsChart(serie);
    } catch (e) { adsDatos(cuenta).serie = null; drawAdsChart([]); }
  }

  // Normaliza la respuesta DAILY (varios formatos posibles) a
  // [{date, atribuidas, otras, roas}] ordenado por fecha.
  function adsSerieDiaria(raw) {
    if (!Array.isArray(raw)) return [];
    var porDia = {};
    function sumarDia(dObj) {
      if (!dObj) return;
      var fecha = String(dObj.date || dObj.date_from || dObj.day || "").slice(0, 10);
      if (!fecha) return;
      // Los números pueden venir en el propio objeto o dentro de .metrics (objeto).
      var m = (dObj.metrics && !Array.isArray(dObj.metrics)) ? dObj.metrics : dObj;
      var d = porDia[fecha] || { date: fecha, atribuidas: 0, otras: 0, ingresos: 0, gasto: 0 };
      d.atribuidas += adsNum(m, ["units_quantity"]) || (adsNum(m, ["direct_items_quantity"]) + adsNum(m, ["indirect_items_quantity"]));
      d.otras += adsNum(m, ["organic_units_quantity", "organic_items_quantity"]);
      d.ingresos += adsNum(m, ["total_amount"]);
      d.gasto += adsNum(m, ["cost"]);
      porDia[fecha] = d;
    }
    raw.forEach(function (r) {
      // Dos formas posibles del DAILY: (1) el item YA es un día; (2) el item es una
      // campaña que trae su serie por día en .metrics (array). Se suman todas las
      // campañas por fecha para el total diario, como muestra ML.
      if (r && Array.isArray(r.metrics)) r.metrics.forEach(sumarDia);
      else sumarDia(r);
    });
    return Object.keys(porDia).sort().map(function (k) {
      var d = porDia[k];
      d.roas = d.gasto ? d.ingresos / d.gasto : 0;
      return d;
    });
  }

  // Serie diaria de UNA campaña (para la gráfica del detalle). La respuesta DAILY
  // trae, por campaña, su array .metrics por día; se filtra por id. Si ML devolvió
  // el DAILY ya agregado (sin id de campaña), no se puede aislar → [] (fallback).
  function serieDeCampaign(raw, campId) {
    if (!Array.isArray(raw) || !campId) return [];
    var id = String(campId), porDia = {};
    raw.forEach(function (r) {
      if (!r) return;
      var rid = String(r.id || r.campaign_id || (r.campaign && r.campaign.id) || "");
      if (rid !== id) return;
      var dias = Array.isArray(r.metrics) ? r.metrics : [r];
      dias.forEach(function (dObj) {
        var fecha = String(dObj.date || dObj.date_from || dObj.day || "").slice(0, 10);
        if (!fecha) return;
        var m = (dObj.metrics && !Array.isArray(dObj.metrics)) ? dObj.metrics : dObj;
        var d = porDia[fecha] || { date: fecha, atribuidas: 0, otras: 0, ingresos: 0, gasto: 0 };
        d.atribuidas += adsNum(m, ["units_quantity"]) || (adsNum(m, ["direct_items_quantity"]) + adsNum(m, ["indirect_items_quantity"]));
        d.otras += adsNum(m, ["organic_units_quantity", "organic_items_quantity"]);
        d.ingresos += adsNum(m, ["total_amount"]);
        d.gasto += adsNum(m, ["cost"]);
        porDia[fecha] = d;
      });
    });
    return Object.keys(porDia).sort().map(function (k) {
      var d = porDia[k]; d.roas = d.gasto ? d.ingresos / d.gasto : 0; return d;
    });
  }

  function drawAdsChart(serie, canvas, key) {
    canvas = canvas || elements.adsChart;
    key = key || "adschart";
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var W = canvas.width = canvas.clientWidth || 900;
    var H = canvas.height = 240;
    ctx.clearRect(0, 0, W, H);
    if (!serie || !serie.length) return;
    var padL = 6, padR = 6, padT = 12, padB = 8;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var n = serie.length;
    var maxU = 1, maxR = 1;
    serie.forEach(function (d) { maxU = Math.max(maxU, d.atribuidas + d.otras); maxR = Math.max(maxR, d.roas); });
    var slot = plotW / n, barW = Math.max(2, slot * 0.55);
    var azul = "#ff6a3d", azulClaro = "rgba(245,166,35,0.5)", roasCol = "#34d399";
    var baseY = padT + plotH;
    // Barras (ventas) suben desde la base y la línea de ROAS se traza subiendo.
    function paint(p) {
      ctx.clearRect(0, 0, W, H);
      serie.forEach(function (d, i) {
        var x = padL + i * slot + (slot - barW) / 2;
        var hAtr = (d.atribuidas / maxU) * plotH * p;
        var hOtr = (d.otras / maxU) * plotH * p;
        ctx.fillStyle = azulClaro; ctx.fillRect(x, baseY - hAtr - hOtr, barW, hOtr);
        ctx.fillStyle = azul; ctx.fillRect(x, baseY - hAtr, barW, hAtr);
      });
      ctx.beginPath();
      ctx.strokeStyle = roasCol; ctx.lineWidth = 2; ctx.lineJoin = "round";
      serie.forEach(function (d, i) {
        var x = padL + i * slot + slot / 2;
        var fy = baseY - (d.roas / maxR) * plotH;
        var y = baseY - (baseY - fy) * p;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    var sig = serie.map(function (d) { return (d.atribuidas + d.otras) + "/" + d.roas; }).join(",");
    if (S.paintChart) S.paintChart(key, paint, 1700, sig); else paint(1);
  }

  // Tiempo real: mientras la seccion Publicidad esta visible, refresca sola cada
  // 45s (ML tambien es polling). No refresca si hay un detalle abierto (para no
  // pisar lo que el titular esta editando) ni si el panel no se ve.
  var adsPollTimer = null;
  function iniciarAdsTiempoReal() {
    if (adsPollTimer) return;
    adsPollTimer = setInterval(function () {
      if (!elements.adsPanel || elements.adsPanel.offsetParent === null) return;
      if (adsCampActual) return;
      var c = adsDatos(activeMLId());
      if (c.cargando) return;
      if (isMLApp(state.commerce.selectedApp)) cargarAds(activeMLId());
    }, 45000);
  }
  function detenerAdsTiempoReal() {
    if (adsPollTimer) { clearInterval(adsPollTimer); adsPollTimer = null; }
  }

  function renderAdsPanel() {
    if (!elements.adsPanel) return;
    var cache = adsDatos(activeMLId());
    var campaigns = cache.campaigns;
    var hay = Array.isArray(campaigns) && campaigns.length > 0;

    elements.adsEmpty?.classList.toggle("is-visible", !hay && !cache.error && !cache.cargando);

    var t = cache.totals;
    // Presupuesto diario total + aporte por publicidad (como arriba en ML).
    if (elements.adsBudgetTotal) elements.adsBudgetTotal.textContent = (hay && t) ? moneyWithCents.format(t.presupuesto) : "—";
    if (elements.adsAporte) {
      elements.adsAporte.textContent = (hay && t)
        ? "Tus anuncios generaron el " + Math.round(t.aporte) + "% de las ventas de tus publicaciones promocionadas."
        : "";
    }

    // Las 6 metricas del panel de ML (últimos 30 días).
    if (elements.adsStats) {
      elements.adsStats.innerHTML = (hay && t) ? [
        tarjetaAds("Ventas atribuidas", integerNumber.format(t.atribuidas), "por tus anuncios", "ads-pos"),
        tarjetaAds("Otras ventas", integerNumber.format(t.otras), "orgánicas", ""),
        tarjetaAds("ROAS", (t.roas ? t.roas.toFixed(2) : "0") + "x", "ingresos / gasto", "ads-pos"),
        tarjetaAds("Ingresos", moneyWithCents.format(t.ingresos), "por publicidad", ""),
        tarjetaAds("ACOS", (t.acos ? t.acos.toFixed(2) : "0") + "%", "gasto / ingresos", "ads-neg"),
        tarjetaAds("Clics", integerNumber.format(t.clicks), t.prints ? integerNumber.format(t.prints) + " impresiones" : "", "")
      ].join("") : "";
    }

    // Repintar la grafica desde el cache (en re-renders sin fetch nuevo).
    if (elements.adsChart && cache.serie) drawAdsChart(cache.serie);

    // Tabla de campañas (columnas del panel de ML).
    if (elements.adsTableBody) {
      elements.adsTableBody.innerHTML = hay ? campaigns.map(function (c) {
        return '<tr class="ads-row" data-ads-campaign="' + escapeHtml(c.id) + '" title="Gestionar campaña">' +
          "<td>" + escapeHtml(c.name) + (c.anuncios ? ' <small class="ads-cnt">' + integerNumber.format(c.anuncios) + " anuncios</small>" : "") + "</td>" +
          "<td>" + estadoAdsPill(c.status) + "</td>" +
          '<td class="num">' + (c.budget ? moneyWithCents.format(c.budget) : "—") + "</td>" +
          '<td class="num">' + (c.roasTarget ? c.roasTarget.toFixed(1) + "x" : "—") + "</td>" +
          '<td class="num">' + integerNumber.format(c.atribuidas) + "</td>" +
          '<td class="num">' + (c.roas ? c.roas.toFixed(2) + "x" : "—") + "</td>" +
          '<td class="num">' + (c.acos ? c.acos.toFixed(2) + "%" : "—") + "</td>" +
        "</tr>";
      }).join("") : "";
    }
  }

  /* ---- Fase 2: ESCRITURA (pausar, presupuesto, ROAS, anuncios) ----
     ML no publica los paths de escritura abiertamente y no se pudieron probar
     en vivo: van CENTRALIZADOS aca (un solo lugar para corregir si la respuesta
     real difiere) y SIEMPRE con confirmacion del titular antes de tocar la
     publicidad real. */
  var adsCampActual = null;

  // Dos bases distintas en la API de Mercado Ads (confirmado en la doc):
  //  - BUSQUEDA (search de campañas/anuncios): /marketplace/advertising/{site}/advertisers/{adv}/product_ads
  //  - GESTION/METRICAS (detalle, update, items): /advertising/advertisers/{adv}/product_ads
  function adsMktBase(cache) {
    return "/marketplace/advertising/" + cache.siteId + "/advertisers/" + cache.advertiserId + "/product_ads";
  }
  function adsAdvBase(cache) {
    return "/advertising/advertisers/" + cache.advertiserId + "/product_ads";
  }
  function adsParseNum(v) {
    var n = Number(String(v == null ? "" : v).replace(/[^\d.,]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  }
  function adsErr(e) {
    var st = (e && (e.mlStatus || e.httpStatus)) || 0;
    return ((e && e.message) ? e.message : "error") + (st ? " (" + st + ")" : "");
  }
  function setAdsDetailMsg(txt, tipo) {
    if (!elements.adsDetailMsg) return;
    elements.adsDetailMsg.textContent = txt || "";
    elements.adsDetailMsg.className = "meta-message" + (tipo ? " is-" + tipo : "");
  }
  function adsCampaignById(id) {
    var c = adsDatos(activeMLId()).campaigns || [];
    for (var i = 0; i < c.length; i++) if (String(c[i].id) === String(id)) return c[i];
    return null;
  }
  function adsEsActiva(status) { return status === "active" || status === "enabled"; }

  async function adsUpdateCampaign(cuenta, campaignId, patch) {
    var api = S.requireSecureApi();
    var cache = adsDatos(cuenta);
    if (!cache.siteId || !cache.advertiserId) throw new Error("Recargá la sección de Publicidad primero.");
    return api.mlApi(adsAdvBase(cache) + "/campaigns/" + campaignId, "PUT", patch, cuenta);
  }

  function renderAdsDetail(campaignId) {
    var camp = adsCampaignById(campaignId);
    if (!camp || !elements.adsDetail) return;
    adsCampActual = camp;
    txtVenta(elements.adsDetailName, camp.name);
    if (elements.adsNameInput) elements.adsNameInput.value = camp.name || "";
    if (elements.adsDetailStatus) elements.adsDetailStatus.innerHTML = estadoAdsPill(camp.status);
    if (elements.adsToggleBtn) elements.adsToggleBtn.textContent = adsEsActiva(camp.status) ? "Pausar campaña" : "Activar campaña";
    if (elements.adsBudgetInput) elements.adsBudgetInput.value = camp.budget || "";
    // El input es el ROAS OBJETIVO (config), redondeado. Si la campaña no lo
    // trae, queda vacio para que el titular lo ponga.
    if (elements.adsRoasInput) elements.adsRoasInput.value = camp.roasTarget ? (Math.round(camp.roasTarget * 100) / 100) : "";
    setAdsDetailMsg("");
    if (elements.adsItemList) elements.adsItemList.innerHTML = '<li class="ads-item-empty">Cargando anuncios…</li>';
    elements.adsLista?.classList.add("is-hidden");
    elements.adsDetail.classList.remove("is-hidden");
    elements.adsDetail.scrollIntoView({ behavior: "smooth", block: "start" });
    // Gráfica independiente de ESTA campaña (delay para que el canvas ya tenga ancho).
    window.setTimeout(function () { dibujarAdsDetailChart(campaignId); }, 40);
    cargarAdsItems(campaignId);
  }
  // Dibuja la serie diaria de una campaña puntual en el canvas del detalle.
  function dibujarAdsDetailChart(campaignId) {
    if (!elements.adsDetailChart) return;
    var cache = adsDatos(activeMLId());
    var serie = serieDeCampaign(cache && cache.serieRaw, campaignId);
    if (serie && serie.length) {
      drawAdsChart(serie, elements.adsDetailChart, "adsdetail");
      if (elements.adsDetailChartMsg) elements.adsDetailChartMsg.textContent = "";
    } else {
      drawAdsChart([], elements.adsDetailChart, "adsdetail");
      if (elements.adsDetailChartMsg) elements.adsDetailChartMsg.textContent = "Todavía no hay serie diaria para esta campaña. Aparece cuando Mercado Libre reporta métricas por día.";
    }
  }
  function adsCerrarDetail() {
    adsCampActual = null;
    elements.adsDetail?.classList.add("is-hidden");
    elements.adsLista?.classList.remove("is-hidden");
  }

  async function adsToggleCampaign() {
    if (!adsCampActual) return;
    var activar = !adsEsActiva(adsCampActual.status);
    if (!window.confirm((activar ? "¿Activar" : "¿Pausar") + ' la campaña "' + adsCampActual.name + '" en Mercado Libre?')) return;
    var cuenta = activeMLId(), id = adsCampActual.id;
    setAdsDetailMsg((activar ? "Activando" : "Pausando") + "…");
    try {
      await adsUpdateCampaign(cuenta, id, { status: activar ? "active" : "paused" });
      setAdsDetailMsg(activar ? "Campaña activada." : "Campaña pausada.", "success");
      await cargarAds(cuenta);
      renderAdsDetail(id);
    } catch (e) { setAdsDetailMsg("No se pudo cambiar el estado: " + adsErr(e), "error"); }
  }

  async function adsGuardarCampaign() {
    if (!adsCampActual) return;
    var cuenta = activeMLId(), id = adsCampActual.id;
    var budget = adsParseNum(elements.adsBudgetInput ? elements.adsBudgetInput.value : "");
    var roas = adsParseNum(elements.adsRoasInput ? elements.adsRoasInput.value : "");
    var nombre = (elements.adsNameInput ? elements.adsNameInput.value : "").trim();
    var patch = {};
    if (nombre && nombre !== adsCampActual.name) patch.name = nombre;   // renombrar
    if (Number.isFinite(budget) && budget > 0) patch.budget = budget;
    if (Number.isFinite(roas) && roas > 0) patch.roas_target = roas;
    if (!Object.keys(patch).length) { setAdsDetailMsg("No hay cambios para guardar.", "error"); return; }
    if (!window.confirm("¿Guardar estos cambios en la campaña en Mercado Libre?")) return;
    setAdsDetailMsg("Guardando…");
    try {
      await adsUpdateCampaign(cuenta, id, patch);
      setAdsDetailMsg("Cambios guardados.", "success");
      await cargarAds(cuenta);
      renderAdsDetail(id);
    } catch (e) { setAdsDetailMsg("No se pudo guardar: " + adsErr(e), "error"); }
  }

  // Eliminar campaña: reusa el PUT que YA funciona (status "deleted", como lo
  // marca ML). Doble confirmacion porque no se puede reactivar una eliminada.
  async function adsEliminarCampaign() {
    if (!adsCampActual) return;
    var cuenta = activeMLId(), id = adsCampActual.id, nombre = adsCampActual.name;
    if (!window.confirm('¿ELIMINAR la campaña "' + nombre + '"? Esto no se puede deshacer.')) return;
    setAdsDetailMsg("Eliminando…");
    try {
      await adsUpdateCampaign(cuenta, id, { status: "deleted" });
      setAdsDetailMsg("Campaña eliminada.", "success");
      await cargarAds(cuenta);
      adsCerrarDetail();
    } catch (e) { setAdsDetailMsg("No se pudo eliminar: " + adsErr(e), "error"); }
  }

  // Crear campaña: POST al recurso de campañas del advertiser (base de gestion).
  async function adsCrearCampaign() {
    var cuenta = activeMLId();
    var nombre = (elements.adsNewName ? elements.adsNewName.value : "").trim();
    var budget = adsParseNum(elements.adsNewBudget ? elements.adsNewBudget.value : "");
    var roas = adsParseNum(elements.adsNewRoas ? elements.adsNewRoas.value : "");
    if (!nombre) { setAdsCreateMsg("Poné un nombre para la campaña.", "error"); return; }
    if (!Number.isFinite(budget) || budget <= 0) { setAdsCreateMsg("Poné un presupuesto diario válido.", "error"); return; }
    if (!window.confirm('¿Crear la campaña "' + nombre + '" en Mercado Libre con presupuesto ' + moneyWithCents.format(budget) + "?")) return;
    var body = { name: nombre, budget: budget, status: "active" };
    if (Number.isFinite(roas) && roas > 0) body.roas_target = roas;
    setAdsCreateMsg("Creando campaña…");
    try {
      var api = S.requireSecureApi();
      var cache = adsDatos(cuenta);
      if (!cache.advertiserId) throw new Error("Recargá la sección de Publicidad primero.");
      await api.mlApi(adsAdvBase(cache) + "/campaigns", "POST", body, cuenta);
      if (elements.adsNewName) elements.adsNewName.value = "";
      if (elements.adsNewBudget) elements.adsNewBudget.value = "";
      if (elements.adsNewRoas) elements.adsNewRoas.value = "";
      setAdsCreateMsg("Campaña creada.", "success");
      adsToggleCreateForm(false);
      await cargarAds(cuenta);
    } catch (e) { setAdsCreateMsg("No se pudo crear: " + adsErr(e), "error"); }
  }
  function setAdsCreateMsg(txt, tipo) {
    if (!elements.adsCreateMsg) return;
    elements.adsCreateMsg.textContent = txt || "";
    elements.adsCreateMsg.className = "meta-message" + (tipo ? " is-" + tipo : "");
  }
  function adsToggleCreateForm(mostrar) {
    if (!elements.adsCreateForm) return;
    var abrir = mostrar === undefined ? elements.adsCreateForm.classList.contains("is-hidden") : mostrar;
    elements.adsCreateForm.classList.toggle("is-hidden", !abrir);
    if (abrir) { setAdsCreateMsg(""); elements.adsNewName?.focus(); }
  }

  // Anuncios (items) de una campaña
  async function cargarAdsItems(campaignId) {
    if (!elements.adsItemList) return;
    var cuenta = activeMLId();
    try {
      var api = S.requireSecureApi();
      var cache = adsDatos(cuenta);
      // Los anuncios de una campaña salen del search de ads, filtrando por campaign_id.
      var res = await api.mlApi(adsMktBase(cache) + "/ads/search?campaign_id=" + campaignId + "&limit=100", "GET", null, cuenta);
      var results = (res.payload && (res.payload.results || res.payload)) || [];
      renderAdsItems(Array.isArray(results) ? results : []);
    } catch (e) {
      elements.adsItemList.innerHTML = '<li class="ads-item-empty">No se pudieron traer los anuncios (' + escapeHtml(adsErr(e)) + ").</li>";
    }
  }
  function renderAdsItems(items) {
    if (!elements.adsItemList) return;
    if (!items.length) { elements.adsItemList.innerHTML = '<li class="ads-item-empty">Esta campaña no tiene anuncios. Agregá uno arriba.</li>'; return; }
    elements.adsItemList.innerHTML = items.map(function (it) {
      var id = it.item_id || it.id || "";
      var titulo = it.title || it.item_id || id;
      var st = String(it.status || "").toLowerCase();
      var activo = adsEsActiva(st);
      return '<li class="ads-item">' +
        '<span class="ads-item-title">' + escapeHtml(String(titulo)) + "</span>" +
        '<span class="ads-item-status">' + estadoAdsPill(st) + "</span>" +
        '<button class="ghost-button ads-item-btn" type="button" data-ads-item="' + escapeHtml(String(id)) +
          '" data-activar="' + (activo ? "0" : "1") + '">' + (activo ? "Pausar" : "Activar") + "</button>" +
      "</li>";
    }).join("");
  }
  async function adsToggleItem(itemId, activar) {
    if (!adsCampActual || !itemId) return;
    var cuenta = activeMLId(), campId = adsCampActual.id;
    if (!window.confirm((activar ? "¿Activar" : "¿Pausar") + " el anuncio " + itemId + "?")) return;
    setAdsDetailMsg((activar ? "Activando" : "Pausando") + " anuncio…");
    try {
      var api = S.requireSecureApi();
      var cache = adsDatos(cuenta);
      await api.mlApi(adsAdvBase(cache) + "/items/" + itemId, "PUT", { status: activar ? "active" : "paused" }, cuenta);
      setAdsDetailMsg("Anuncio actualizado.", "success");
      cargarAdsItems(campId);
    } catch (e) { setAdsDetailMsg("No se pudo actualizar el anuncio: " + adsErr(e), "error"); }
  }
  async function adsAgregarItem() {
    if (!adsCampActual) return;
    var cuenta = activeMLId(), campId = adsCampActual.id;
    var itemId = (elements.adsAddInput ? elements.adsAddInput.value : "").trim().toUpperCase();
    if (!itemId) { setAdsDetailMsg("Poné el ID de la publicación (ej: MLB123...).", "error"); return; }
    if (!window.confirm("¿Agregar la publicación " + itemId + " a esta campaña?")) return;
    setAdsDetailMsg("Agregando anuncio…");
    try {
      var api = S.requireSecureApi();
      var cache = adsDatos(cuenta);
      await api.mlApi(adsAdvBase(cache) + "/items", "POST", { campaign_id: campId, item_id: itemId }, cuenta);
      if (elements.adsAddInput) elements.adsAddInput.value = "";
      setAdsDetailMsg("Anuncio agregado.", "success");
      cargarAdsItems(campId);
    } catch (e) { setAdsDetailMsg("No se pudo agregar: " + adsErr(e), "error"); }
  }

  // ---- Agente publicitario: gasto del MES EN CURSO (para el techo mensual) ----
  // Requiere que cargarAds haya corrido antes (necesita site+advertiser).
  function primerDiaMesISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
  }
  async function cargarAdsMTD(cuenta) {
    cuenta = cuenta || activeMLId();
    var cache = adsDatos(cuenta);
    if (!cache.advertiserId || !cache.siteId) return null;
    try {
      var api = S.requireSecureApi();
      var qs = "/marketplace/advertising/" + cache.siteId + "/advertisers/" + cache.advertiserId +
        "/product_ads/campaigns/search?limit=100&date_from=" + primerDiaMesISO() + "&date_to=" + hoyISO() + "&metrics=cost";
      var res = await api.mlApi(qs, "GET", null, cuenta);
      var results = (res.payload && (res.payload.results || res.payload)) || [];
      var spent = 0;
      (Array.isArray(results) ? results : []).forEach(function (c) {
        var m = c.metrics || c.metrics_summary || {};
        spent += Number(m.cost != null ? m.cost : (c.cost || 0)) || 0;
      });
      cache.spentMTD = spent;
      cache.spentMTDAt = Date.now();
      return spent;
    } catch (e) { return null; }
  }

  Object.assign(S, {
    adsDatos, activeMLId, adsUpdateCampaign, cargarAdsMTD, thumbsForItems, diagnosticarFotos,
    aggregateCommerceProducts, aggregateCommerceTrend, buildDemoCommerceSnapshot, buildMLAuthUrl,
    clearSelectedCommerceApp, clearSelectedCommerceGroup, createCommerceSnapshot, disconnectML, ensureMLLiveDefaults, fetchCommerceData, fetchMLOrders,
    handleMlOAuthReturn, normalizeCommerceOrder, normalizeMLOrder,
    populateCommerceConfigForm, readCommerceConfigFromForm, renderCommerceDashboard, renderCommerceSwitcher,
    applyPeriodChange, getPeriodRange, loadMLListings, markPendingStock, openSaleDeepLink, renderPeriodBar, saveMLListingChanges, selectMLAccount, toggleListingExpand, toggleListingStatus,
    scheduleCommerceRefresh, scheduleMLRefresh, selectCommerceApp, setCommerceMessage, setMlMessage,
    startMLOAuth, syncCommerce, syncMercadoLibre,
    renderMercadoPago, resumenMercadoPago, guardarTokenMP,
    renderVentaDetail, cerrarVentaDetail,
    renderAdsPanel, cargarAds, reloadAds,
    renderAdsDetail, adsCerrarDetail, adsToggleCampaign, adsGuardarCampaign, adsAgregarItem, adsToggleItem,
    adsEliminarCampaign, adsCrearCampaign, adsToggleCreateForm,
  });
})();
