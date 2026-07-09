/* ============================================================
   NEXUS Dashboard · Arranque: bindEvents + init (entry point)
   Parte de window.NexusDash — namespace compartido (sin build).
   ============================================================ */
(function () {
  const S = window.NexusDash;
  const { AUTH_KEY, CHART_VIEW_MODE_KEY, META_CONFIG_KEY, META_DATA_KEY, MONTH_FILTER_KEY, applyChartMode } = S;
  const { clearSelectedMetaPlatform, defaultCommerceConfig, defaultMetaConfig, defaultMetaPlatformState, deleteMovement, drawCashflowChart } = S;
  const { drawCategoryChart, elements, exportNexusData, getCommerceApp, getMetaPlatform, handleFormSubmit } = S;
  const { hideChartTooltip, importNexusData, populateCategoryFilter, populateCommerceConfigForm, populateMetaConfigForm, populateMonthFilter } = S;
  const { populateMovementCategories, readCommerceConfigFromForm, readMetaConfigFromForm, renderAll, renderCommerceDashboard, renderCommerceSwitcher } = S;
  const { renderMetaDashboard, resetForm, runDashboardReveal, safeSetItem, saveCommerceConfigs, saveCommerceSnapshots } = S;
  const { saveMetaConfig, saveMetaPlatforms, scheduleCommerceRefresh, scheduleMetaRefresh, seedData, selectMetaPlatform } = S;
  const { setCommerceMessage, setMetaMessage, setView, showChartTooltip, startEdit, state } = S;
  const { syncCommerce, syncMetaAds, toDateInput } = S;
  function bindEvents() {
    elements.navButtons.forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });

    elements.welcomeCards.forEach((card) => {
      card.addEventListener("click", () => setView(card.dataset.welcomeView));
    });

    elements.metaPlatformCards?.addEventListener("click", (event) => {
      const card = event.target.closest("[data-meta-platform]");
      if (!card) return;
      selectMetaPlatform(card.dataset.metaPlatform);
    });

    elements.metaBackButton?.addEventListener("click", () => {
      clearSelectedMetaPlatform();
    });

    elements.chartModeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.chartMode = button.dataset.chartMode === "3d" ? "3d" : "2d";
        safeSetItem(CHART_VIEW_MODE_KEY, state.chartMode);
        applyChartMode();
        if (state.activeView === "meta") renderMetaDashboard();
        else if (state.activeView === "ecommerce") renderCommerceDashboard();
        else {
          drawCashflowChart();
          drawCategoryChart();
        }
      });
    });

    elements.chartResetButton?.addEventListener("click", () => {
      if (state.activeView === "meta") renderMetaDashboard();
      else if (state.activeView === "ecommerce") renderCommerceDashboard();
      else {
        drawCashflowChart();
        drawCategoryChart();
      }
    });

    [elements.cashflowChart, elements.categoryChart, elements.metaTrendChart, elements.commerceTrendChart].forEach((canvas) => {
      canvas?.addEventListener("mousemove", (event) => showChartTooltip(canvas, event));
      canvas?.addEventListener("mouseleave", hideChartTooltip);
    });

    elements.monthFilter.addEventListener("change", () => {
      state.filters.month = elements.monthFilter.value;
      safeSetItem(MONTH_FILTER_KEY, state.filters.month);
      renderAll();
    });

    elements.typeFilter.addEventListener("change", () => {
      state.filters.type = elements.typeFilter.value;
      renderAll();
    });

    elements.categoryFilter.addEventListener("change", () => {
      state.filters.category = elements.categoryFilter.value;
      renderAll();
    });

    elements.movementType.addEventListener("change", populateMovementCategories);
    elements.form.addEventListener("submit", handleFormSubmit);
    elements.cancelEditButton.addEventListener("click", resetForm);
    elements.seedDataButton.addEventListener("click", seedData);
    elements.metaConfigForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!state.meta.selectedPlatform) {
        setMetaMessage("Selecciona Kairos, Billion o KiwiFi antes de guardar.", "error");
        return;
      }
      state.meta.config = readMetaConfigFromForm();
      saveMetaConfig();
      scheduleMetaRefresh();
      setMetaMessage(`Conexión guardada para ${getMetaPlatform().name}.`, "success");
      renderMetaDashboard();
    });
    elements.metaSyncButton?.addEventListener("click", () => {
      syncMetaAds();
    });
    elements.metaDemoButton?.addEventListener("click", () => {
      state.meta.config = readMetaConfigFromForm();
      saveMetaConfig();
      syncMetaAds({ demo: true });
    });
    elements.metaClearButton?.addEventListener("click", () => {
      const ok = window.confirm("Eliminar credenciales y datos locales de Meta Ads?");
      if (!ok) return;
      window.clearInterval(state.meta.refreshTimer);
      const platform = getMetaPlatform();
      state.meta.config = defaultMetaConfig();
      state.meta.snapshot = null;
      if (platform) {
        state.meta.platforms[platform.id] = defaultMetaPlatformState(platform);
        saveMetaPlatforms();
      } else {
        localStorage.removeItem(META_CONFIG_KEY);
        localStorage.removeItem(META_DATA_KEY);
      }
      populateMetaConfigForm();
      setMetaMessage(platform ? `${platform.name} fue limpiado.` : "Conexión de Meta Ads eliminada.", "success");
      renderMetaDashboard();
    });
    elements.metaRefreshInterval?.addEventListener("change", () => {
      state.meta.config = readMetaConfigFromForm();
      saveMetaConfig();
      scheduleMetaRefresh();
      renderMetaDashboard();
    });
    elements.commerceAppSwitcher?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-commerce-app]");
      if (!button) return;
      state.commerce.activeApp = button.dataset.commerceApp;
      safeSetItem("nexus.ecommerce.activeApp.v1", state.commerce.activeApp);
      setCommerceMessage("", "");
      scheduleCommerceRefresh();
      renderCommerceDashboard();
    });
    elements.commerceConfigForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      state.commerce.configs[state.commerce.activeApp] = readCommerceConfigFromForm();
      saveCommerceConfigs();
      scheduleCommerceRefresh();
      setCommerceMessage(`${getCommerceApp().name} guardado en este navegador.`, "success");
      renderCommerceDashboard();
    });
    elements.commerceSyncButton?.addEventListener("click", () => {
      syncCommerce();
    });
    elements.commerceDemoButton?.addEventListener("click", () => {
      syncCommerce({ demo: true });
    });
    elements.commerceClearButton?.addEventListener("click", () => {
      const app = getCommerceApp();
      const ok = window.confirm(`Eliminar conexion y datos locales de ${app.name}?`);
      if (!ok) return;
      window.clearInterval(state.commerce.refreshTimer);
      state.commerce.configs[app.id] = defaultCommerceConfig();
      delete state.commerce.snapshots[app.id];
      saveCommerceConfigs();
      saveCommerceSnapshots();
      populateCommerceConfigForm();
      setCommerceMessage(`${app.name} fue limpiado.`, "success");
      renderCommerceDashboard();
    });
    elements.commerceRefreshInterval?.addEventListener("change", () => {
      state.commerce.configs[state.commerce.activeApp] = readCommerceConfigFromForm();
      saveCommerceConfigs();
      scheduleCommerceRefresh();
      renderCommerceDashboard();
    });
    elements.logoutButton?.addEventListener("click", () => {
      localStorage.removeItem(AUTH_KEY);
      window.location.href = "./index.html";
    });

    elements.exportButton?.addEventListener("click", exportNexusData);
    elements.importButton?.addEventListener("click", () => elements.importInput?.click());
    elements.importInput?.addEventListener("change", (event) => {
      const file = event.target.files && event.target.files[0];
      importNexusData(file);
      event.target.value = "";
    });

    elements.movementsTable.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "edit") startEdit(button.dataset.id);
      if (button.dataset.action === "delete") deleteMovement(button.dataset.id);
    });

    window.addEventListener("resize", () => {
      if (state.activeView === "meta") renderMetaDashboard();
      else if (state.activeView === "ecommerce") renderCommerceDashboard();
      else if (state.activeView === "finance") {
        drawCashflowChart();
        drawCategoryChart();
      }
    });

    window.addEventListener("hashchange", () => {
      setView(location.hash.replace("#", ""), false);
    });
  }

  function init() {
    try {
      elements.movementDate.value = toDateInput();
      populateMovementCategories();
      populateMonthFilter();
      populateCategoryFilter();
      populateMetaConfigForm();
      renderCommerceSwitcher();
      populateCommerceConfigForm();
      bindEvents();
      applyChartMode();
      renderAll();
      renderMetaDashboard();
      renderCommerceDashboard();
      scheduleMetaRefresh();
      scheduleCommerceRefresh();
      const initial = location.hash.replace("#", "");
      setView(initial || "welcome", false);
    } catch (error) {
      console.error("Nexus dashboard init error:", error);
    } finally {
      // Garantiza que el sidebar/topbar siempre se revelen, incluso si algo
      // de lo anterior falla — de lo contrario quedan invisibles para siempre.
      runDashboardReveal();
    }
  }

  if (!window.NexusAuth.hasSession()) {
    window.location.replace("./index.html");
    return;
  }
  init();

  Object.assign(S, {
    bindEvents, init,
  });
})();
