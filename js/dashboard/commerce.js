/* ============================================================
   NEXUS Dashboard · Módulo · E-Commerce
   Parte de window.NexusDash — namespace compartido (sin build).
   ============================================================ */
(function () {
  const S = window.NexusDash;
  const { commerceApps, currency, demoCommerceData, drawCommerceTrendChart, elements, escapeHtml } = S;
  const { formatMetaDate, getCommerceApp, getCommerceConfig, getCommerceSnapshot, hasCommerceConnection, integerNumber } = S;
  const { moneyWithCents, saveCommerceConfigs, saveCommerceSnapshots, state, toDateInput } = S;
  function setCommerceMessage(message = "", type = "") {
    state.commerce.message = message;
    state.commerce.messageType = type;
    if (!elements.commerceMessage) return;
    elements.commerceMessage.textContent = message;
    elements.commerceMessage.classList.toggle("is-error", type === "error");
    elements.commerceMessage.classList.toggle("is-success", type === "success");
  }

  function readCommerceConfigFromForm() {
    return {
      pixelId: String(elements.commercePixelId?.value || "").trim(),
      apiUrl: String(elements.commerceApiUrl?.value || "").trim(),
      apiToken: String(elements.commerceApiToken?.value || "").trim(),
      refreshInterval: elements.commerceRefreshInterval?.value || "0"
    };
  }

  function populateCommerceConfigForm() {
    const app = getCommerceApp();
    const config = getCommerceConfig(app.id);
    if (elements.commerceConfigTitle) elements.commerceConfigTitle.textContent = `Configurar ${app.name}`;
    if (elements.commercePixelId) elements.commercePixelId.value = config.pixelId || "";
    if (elements.commerceApiUrl) elements.commerceApiUrl.value = config.apiUrl || "";
    if (elements.commerceApiToken) elements.commerceApiToken.value = config.apiToken || "";
    if (elements.commerceRefreshInterval) elements.commerceRefreshInterval.value = config.refreshInterval || "0";
  }

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

  async function fetchCommerceData(config) {
    const response = await fetch(config.apiUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiToken}`,
        "X-Nexus-Pixel": config.pixelId
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "El endpoint del negocio no respondio correctamente.");
    }
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.orders)
        ? payload.orders
        : Array.isArray(payload.data)
          ? payload.data
          : [];
    return rows.map(normalizeCommerceOrder);
  }

  function renderCommerceSwitcher() {
    if (!elements.commerceAppSwitcher) return;
    elements.commerceAppSwitcher.innerHTML = commerceApps.map((app) => {
      const snapshot = state.commerce.snapshots[app.id];
      const source = snapshot?.source === "live" ? "Conectado" : snapshot?.source === "demo" ? "Demo activo" : "Sin datos";
      return `
        <button class="commerce-app-button ${state.commerce.activeApp === app.id ? "is-active" : ""}" type="button" data-commerce-app="${app.id}">
          <i style="background:linear-gradient(90deg, ${app.accent}, var(--cyan))"></i>
          <b>${escapeHtml(app.name)}</b>
          <small>${escapeHtml(app.model)} · ${source}</small>
        </button>
      `;
    }).join("");
  }

  function renderCommerceDashboard() {
    const app = getCommerceApp();
    const config = getCommerceConfig(app.id);
    const snapshot = getCommerceSnapshot(app.id);
    const totals = snapshot?.totals || { revenue: 0, orders: 0, aov: 0, conversion: 0, sessions: 0, margin: 0 };
    const sourceLabel = snapshot?.source === "live" ? "API real" : snapshot?.source === "demo" ? "Demo" : "Datos locales";

    renderCommerceSwitcher();
    populateCommerceConfigForm();

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
    if (elements.commercePixelLabel) elements.commercePixelLabel.textContent = config.pixelId || "No configurado";
    if (elements.commerceEndpointLabel) elements.commerceEndpointLabel.textContent = config.apiUrl || "No configurado";
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

  async function syncCommerce({ demo = false, silent = false } = {}) {
    const appId = state.commerce.activeApp;
    state.commerce.configs[appId] = readCommerceConfigFromForm();
    saveCommerceConfigs();

    if (demo) {
      state.commerce.snapshots[appId] = buildDemoCommerceSnapshot(appId);
      saveCommerceSnapshots();
      setCommerceMessage(`Demo cargada para ${getCommerceApp(appId).name}.`, "success");
      renderCommerceDashboard();
      return;
    }

    const config = getCommerceConfig(appId);
    if (!hasCommerceConnection(config)) {
      setCommerceMessage("Para traer datos reales necesitas Pixel ID, endpoint de datos y API Token.", "error");
      renderCommerceDashboard();
      return;
    }

    state.commerce.syncing = true;
    if (!silent) setCommerceMessage(`Sincronizando ${getCommerceApp(appId).name}...`, "");
    renderCommerceDashboard();

    try {
      const orders = await fetchCommerceData(config);
      state.commerce.snapshots[appId] = createCommerceSnapshot(orders, "live");
      saveCommerceSnapshots();
      setCommerceMessage(orders.length ? "Datos reales sincronizados correctamente." : "El endpoint respondio sin pedidos para este periodo.", "success");
    } catch (error) {
      setCommerceMessage(error.message || "No se pudo sincronizar este negocio.", "error");
    } finally {
      state.commerce.syncing = false;
      renderCommerceDashboard();
      scheduleCommerceRefresh();
    }
  }

  function scheduleCommerceRefresh() {
    window.clearInterval(state.commerce.refreshTimer);
    state.commerce.refreshTimer = 0;
    const config = getCommerceConfig();
    const seconds = Number(config.refreshInterval);
    if (!seconds || !hasCommerceConnection(config)) return;
    state.commerce.refreshTimer = window.setInterval(() => {
      syncCommerce({ silent: true });
    }, seconds * 1000);
  }


  Object.assign(S, {
    aggregateCommerceProducts, aggregateCommerceTrend, buildDemoCommerceSnapshot, createCommerceSnapshot, fetchCommerceData, normalizeCommerceOrder,
    populateCommerceConfigForm, readCommerceConfigFromForm, renderCommerceDashboard, renderCommerceSwitcher, scheduleCommerceRefresh, setCommerceMessage,
    syncCommerce,
  });
})();
