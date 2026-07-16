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

  function aggregateCommerceTrend(orders) {
    const days = new Map();
    orders.forEach((order) => {
      const current = days.get(order.date) || { date: order.date, revenue: 0, orders: 0 };
      current.revenue += order.total;
      current.orders += 1;
      days.set(order.date, current);
    });
    return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-10);
  }

  function createCommerceSnapshot(orders, source) {
    const normalizedOrders = orders.map(normalizeCommerceOrder);
    const totals = normalizedOrders.reduce((total, order) => ({
      revenue: total.revenue + order.total,
      margin: total.margin + order.margin,
      sessions: total.sessions + order.sessions,
      orders: total.orders + 1
    }), { revenue: 0, margin: 0, sessions: 0, orders: 0 });
    totals.aov = totals.orders ? totals.revenue / totals.orders : 0;
    totals.conversion = totals.sessions ? (totals.orders / totals.sessions) * 100 : 0;

    return {
      source,
      fetchedAt: new Date().toISOString(),
      appId: state.commerce.activeApp,
      totals,
      orders: normalizedOrders.sort((a, b) => b.date.localeCompare(a.date)),
      products: aggregateCommerceProducts(normalizedOrders),
      trend: aggregateCommerceTrend(normalizedOrders)
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
    return ML_AUTH_URL
      + "?response_type=code"
      + "&client_id=" + encodeURIComponent(ML_APP_ID)
      + "&redirect_uri=" + encodeURIComponent(redirectUri)
      + "&state=" + encodeURIComponent(mlState);
  }

  function startMLOAuth() {
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
      var result = await api.mlSaveTokens(encBundle);
      state.commerce.configs.mercadolibre = Object.assign(
        state.commerce.configs.mercadolibre || S.defaultCommerceConfig(),
        { hasToken: true, mlUserId: (result && result.userId) || "" }
      );
      saveCommerceConfigs();
      selectCommerceApp("mercadolibre");
      setMlMessage("Cuenta de Mercado Libre conectada exitosamente.", "success");
    } catch (err) {
      console.error("ML OAuth save error:", err);
      selectCommerceApp("mercadolibre");
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

    var statusMap = {
      paid: "Pagado", cancelled: "Cancelado", pending: "Pendiente",
      confirmed: "Confirmado", payment_required: "Pago requerido",
      payment_in_process: "En proceso"
    };
    var status = statusMap[mlOrder.status] || mlOrder.status || "Desconocido";

    var buyer = mlOrder.buyer || {};
    var customer = (buyer.first_name || "") + " " + (buyer.last_name || "");
    if (customer.trim().length === 0) customer = "Comprador ML";

    return {
      id: String(mlOrder.id || "ML-" + index),
      customer: customer.trim(),
      product: product,
      status: status,
      total: total,
      margin: margin,
      sessions: 0,
      date: String(mlOrder.date_created || "").slice(0, 10) || toDateInput()
    };
  }

  async function fetchMLOrders() {
    var api = S.requireSecureApi();
    var config = getCommerceConfig("mercadolibre");
    var userId = config.mlUserId || "";

    if (!userId) {
      var meResult = await api.mlApi("/users/me");
      userId = String((meResult.payload || {}).id || "");
      if (userId) {
        state.commerce.configs.mercadolibre.mlUserId = userId;
        saveCommerceConfigs();
      }
    }

    if (!userId) throw new Error("No se pudo obtener el user ID de ML.");

    var allOrders = [];
    var offset = 0;
    var limit = 50;
    var maxPages = 4;

    for (var page = 0; page < maxPages; page++) {
      var endpoint = "/orders/search?seller=" + userId + "&sort=date_desc&limit=" + limit + "&offset=" + offset;
      var result = await api.mlApi(endpoint);
      var payload = result.payload || {};
      var results = payload.results || [];
      allOrders = allOrders.concat(results);

      var paging = payload.paging || {};
      if (offset + limit >= (paging.total || 0)) break;
      offset += limit;
    }

    return allOrders.map(normalizeMLOrder);
  }

  async function disconnectML() {
    // Frenar el "en vivo" primero: sin token, cada tick fallaria.
    window.clearInterval(state.commerce.mlRefreshTimer);
    state.commerce.mlRefreshTimer = 0;
    state.commerce.failCount = 0;
    state.commerce.configs.mercadolibre = S.defaultCommerceConfig();
    delete state.commerce.snapshots.mercadolibre;
    saveCommerceConfigs();
    saveCommerceSnapshots();
    setMlMessage("Mercado Libre desconectado.", "success");
    renderCommerceDashboard();
  }

  // ---- Render ------------------------------------------------

  function renderCommerceSwitcher() {
    if (!elements.commerceAppSwitcher) return;
    elements.commerceAppSwitcher.innerHTML = commerceApps.map((app) => {
      const snapshot = state.commerce.snapshots[app.id];
      const config = getCommerceConfig(app.id);
      var source;
      if (app.id === "mercadolibre" && config.hasToken) source = "Conectado (OAuth)";
      else if (snapshot?.source === "live") source = "Conectado";
      else if (snapshot?.source === "demo") source = "Demo activo";
      else source = "Sin datos";
      return `
        <button class="commerce-app-button ${state.commerce.selectedApp === app.id ? "is-active" : ""}" type="button" data-commerce-app="${app.id}">
          <i style="background:linear-gradient(90deg, ${app.accent}, var(--cyan))"></i>
          <b>${escapeHtml(app.name)}</b>
          <small>${escapeHtml(app.model)} · ${source}</small>
        </button>
      `;
    }).join("");
  }

  function updateMLPanel() {
    var config = getCommerceConfig("mercadolibre");
    var connected = Boolean(config.hasToken);

    elements.mlConnectButton?.classList.toggle("is-hidden", connected);
    elements.mlSyncButton?.classList.toggle("is-hidden", !connected);
    elements.mlDemoButton?.classList.toggle("is-hidden", connected);
    elements.mlDisconnectButton?.classList.toggle("is-hidden", !connected);

    if (elements.mlConnectStatus) {
      elements.mlConnectStatus.textContent = connected ? "Conectado" : "Desconectado";
      elements.mlConnectStatus.classList.toggle("commerce-status-live", connected);
    }
    if (elements.mlConnectTitle) {
      elements.mlConnectTitle.textContent = connected ? "Mercado Libre conectado" : "Conectar cuenta";
    }
    if (elements.mlConnectDesc) {
      elements.mlConnectDesc.textContent = connected
        ? "Tu cuenta esta vinculada. Podes sincronizar ventas o desconectarla."
        : "Conecta tu cuenta de Mercado Libre para sincronizar ventas, pedidos y productos.";
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
    if (elements.commerceTrafficHint) elements.commerceTrafficHint.textContent = `${integerNumber.format(totals.sessions || 0)} sesiones`;
    if (elements.commerceMarginValue) elements.commerceMarginValue.textContent = currency.format(totals.margin || 0);
    if (elements.commerceMarginHint) elements.commerceMarginHint.textContent = totals.revenue ? `${((totals.margin / totals.revenue) * 100).toFixed(1)}% sobre ventas` : "Rentabilidad estimada";
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
      elements.commerceOrdersTable.innerHTML = orders.slice(0, 12).map((order) => `
        <tr>
          <td>${escapeHtml(order.id)}</td>
          <td>${escapeHtml(order.customer)}</td>
          <td>${escapeHtml(order.product)}</td>
          <td><span class="type-pill income">${escapeHtml(order.status)}</span></td>
          <td>${moneyWithCents.format(order.total)}</td>
          <td class="${order.margin >= 0 ? "amount-income" : "amount-expense"}">${moneyWithCents.format(order.margin)}</td>
        </tr>
      `).join("");
    }
    elements.commerceEmptyState?.classList.toggle("is-visible", orders.length === 0);

    if (elements.commerceProductList) {
      const products = snapshot?.products || [];
      elements.commerceProductList.innerHTML = products.length
        ? products.map((product) => `<div><span>${escapeHtml(product.name)}</span><b>${moneyWithCents.format(product.revenue)} · ${product.orders} pedidos</b></div>`).join("")
        : `<div><span>Sin productos</span><b>Sincroniza ${escapeHtml(app.name)} para ver rendimiento.</b></div>`;
    }

    drawCommerceTrendChart();
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
    var config = getCommerceConfig("mercadolibre");
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
        var orders = await fetchMLOrders();
        var next = createCommerceSnapshot(orders, "live");
        var prev = state.commerce.snapshots.mercadolibre;
        state.commerce.snapshots.mercadolibre = next;
        // Con el modo "en vivo" esto corre cada minuto: si no hay ventas
        // nuevas, no reescribir (evita subir lo mismo a Firestore sin parar).
        if (!prev || ordersSignature(prev.orders) !== ordersSignature(next.orders)) {
          saveCommerceSnapshots();
        }
        return orders.length
          ? orders.length + " ordenes sincronizadas desde Mercado Libre."
          : "No se encontraron ordenes en tu cuenta de ML.";
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
    getIntervalSeconds: () => getCommerceConfig("mercadolibre").refreshInterval,
    isEnabled: () => Boolean(getCommerceConfig("mercadolibre").hasToken),
    sync: () => syncMercadoLibre({ silent: true })
  });

  // ---- Navegación nivel 2 ------------------------------------

  function selectCommerceApp(id) {
    const app = getCommerceApp(id);
    if (!app) return;
    state.commerce.selectedApp = id;
    state.commerce.activeApp = id;
    S.safeSetItem("nexus.ecommerce.activeApp.v1", id);
    setCommerceMessage("", "");
    setMlMessage("", "");
    renderCommerceDashboard();
    S.updateTopbarForView("ecommerce");
    scheduleCommerceRefresh();
    S.animateActivePanel();
    // Mercado Libre "en vivo": al entrar al panel, traer las ventas solo,
    // sin esperar el proximo tick ni que el titular apriete Sincronizar.
    if (isMLApp(id) && getCommerceConfig(id).hasToken && !state.commerce.syncing) {
      syncMercadoLibre({ silent: true });
    }
  }

  function clearSelectedCommerceApp() {
    state.commerce.selectedApp = null;
    window.clearInterval(state.commerce.refreshTimer);
    state.commerce.refreshTimer = 0;
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
    var cfg = state.commerce.configs.mercadolibre;
    if (!cfg) return;
    if (!cfg.refreshChoice && (!cfg.refreshInterval || cfg.refreshInterval === "0")) {
      cfg.refreshInterval = "60";
      saveCommerceConfigs();
    }
  }

  Object.assign(S, {
    aggregateCommerceProducts, aggregateCommerceTrend, buildDemoCommerceSnapshot, buildMLAuthUrl,
    clearSelectedCommerceApp, createCommerceSnapshot, disconnectML, ensureMLLiveDefaults, fetchCommerceData, fetchMLOrders,
    handleMlOAuthReturn, normalizeCommerceOrder, normalizeMLOrder,
    populateCommerceConfigForm, readCommerceConfigFromForm, renderCommerceDashboard, renderCommerceSwitcher,
    scheduleCommerceRefresh, scheduleMLRefresh, selectCommerceApp, setCommerceMessage, setMlMessage,
    startMLOAuth, syncCommerce, syncMercadoLibre,
  });
})();
