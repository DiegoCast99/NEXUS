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
  const { selectCommerceApp, clearSelectedCommerceApp, disconnectML, handleMlOAuthReturn, startMLOAuth, syncMercadoLibre } = S;
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
      selectCommerceApp(button.dataset.commerceApp);
    });
    elements.commerceBackButton?.addEventListener("click", () => {
      clearSelectedCommerceApp();
    });
    // Volver del negocio (Alpha Fitness) al listado de negocios.
    elements.commerceGroupBack?.addEventListener("click", () => {
      S.clearSelectedCommerceGroup();
    });
    elements.mlConnectButton?.addEventListener("click", startMLOAuth);
    elements.mlSyncButton?.addEventListener("click", () => syncMercadoLibre());
    elements.mlDemoButton?.addEventListener("click", () => syncCommerce({ demo: true }));
    elements.mlDisconnectButton?.addEventListener("click", () => {
      if (window.confirm("Desconectar Mercado Libre? Se eliminan tokens y datos locales.")) disconnectML();
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
    // Mercado Libre usa su propio panel, asi que su intervalo se guarda aparte.
    // refreshChoice=user marca que el titular eligio a proposito (no pisar el default).
    elements.mlRefreshInterval?.addEventListener("change", () => {
      const seconds = elements.mlRefreshInterval.value || "0";
      state.commerce.configs.mercadolibre = {
        ...S.getCommerceConfig("mercadolibre"),
        refreshInterval: seconds,
        refreshChoice: "user"
      };
      saveCommerceConfigs();
      state.commerce.failCount = 0;
      S.scheduleMLRefresh();
      S.setMlMessage(
        Number(seconds)
          ? `Sincronizacion automatica cada ${Number(seconds) >= 60 ? Number(seconds) / 60 + " min" : seconds + " s"}. Solo corre con Nexus abierto.`
          : "Sincronizacion automatica desactivada.",
        "success"
      );
    });
    // Publicaciones de ML: recargar catalogo y acciones de escritura
    // (aplicar stock / pausar / activar), delegadas en la tabla.
    elements.mlListingsReload?.addEventListener("click", () => S.loadMLListings(true));
    elements.mlListingsTable?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-action]");
      if (!btn) return;
      const id = btn.dataset.listingId;
      if (btn.dataset.action === "stock") S.updateMLStock(id);
      else if (btn.dataset.action === "toggle") S.toggleMLListing(id);
    });
    // Cambiar de cuenta de Mercado Libre desde el panel.
    elements.mlAccountSelect?.addEventListener("change", () => S.selectMLAccount(elements.mlAccountSelect.value));
    // Si la PWA ya estaba abierta al tocar la notificacion, el Service Worker
    // no puede navegarla: manda el destino por postMessage y navegamos aca.
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        const msg = event.data || {};
        if (msg.type !== "nexus-open-url" || !msg.url) return;
        const hash = String(msg.url).split("#")[1] || "";
        const saleLink = hash.match(/^venta-([a-z0-9]+)-(.+)$/);
        if (saleLink) {
          setView("ecommerce", false);
          S.openSaleDeepLink(saleLink[1], saleLink[2]);
        } else if (hash) {
          setView(hash, false);
        }
      });
    }
    // Periodo de las metricas de ML: al cambiarlo se re-consulta ese rango.
    elements.commercePeriod?.addEventListener("change", () => S.applyPeriodChange());
    elements.commercePeriodFrom?.addEventListener("change", () => S.applyPeriodChange());
    elements.commercePeriodTo?.addEventListener("change", () => S.applyPeriodChange());
    elements.logoutButton?.addEventListener("click", async () => {
      if (window.NexusFirebaseAuth) {
        await window.NexusFirebaseAuth.logout();
      }
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

    // Mercado Libre "en vivo": cuando la PWA vuelve del background (el caso
    // tipico en iPhone: se abre Nexus tras una venta), refrescar solo.
    // Throttle de 30s para no disparar rafagas si se alterna rapido de app.
    let lastMlVisibilitySync = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (!S.getCommerceConfig("mercadolibre").hasToken) return;
      if (state.commerce.syncing) return;
      if (!window.NexusSecureAPI || !window.NexusSecureAPI.available()) return;
      const now = Date.now();
      if (now - lastMlVisibilitySync < 30000) return;
      lastMlVisibilitySync = now;
      syncMercadoLibre({ silent: true });
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
      S.ensureMLLiveDefaults();
      scheduleCommerceRefresh();
      // El "en vivo" de ML arranca aunque el negocio activo sea otro.
      S.scheduleMLRefresh();
      const initial = location.hash.replace("#", "");
      // Deep-link de la notificacion de venta: #venta-<cuenta>-<orden>.
      const saleLink = initial.match(/^venta-([a-z0-9]+)-(.+)$/);
      if (initial === "ml-connect") {
        setView("ecommerce", false);
        handleMlOAuthReturn();
      } else if (saleLink) {
        setView("ecommerce", false);
        S.openSaleDeepLink(saleLink[1], saleLink[2]);
      } else {
        setView(initial || "welcome", false);
        // Mercado Libre "en vivo": al abrir Nexus con la cuenta conectada,
        // traer las ventas de entrada (sin apretar Sincronizar). El caso
        // ml-connect se excluye porque handleMlOAuthReturn ya sincroniza.
        if (S.getCommerceConfig("mercadolibre").hasToken) {
          syncMercadoLibre({ silent: true });
        }
      }
    } catch (error) {
      console.error("Nexus dashboard init error:", error);
    } finally {
      // Garantiza que el sidebar/topbar siempre se revelen, incluso si algo
      // de lo anterior falla — de lo contrario quedan invisibles para siempre.
      runDashboardReveal();
    }
  }

  Object.assign(S, {
    bindEvents, init,
  });

  // Guard de sesión:
  // - Con Firebase: onAuthStateChanged espera a que se restaure la sesión (async)
  //   y arranca el dashboard; si no hay usuario, vuelve al login.
  // - Sin Firebase (preview local sin CDN): chequeo síncrono de localStorage.
  if (window.NexusFirebaseAuth) {
    let started = false;
    window.NexusFirebaseAuth.onAuthStateChanged(async function (user) {
      if (user) {
        if (!started) {
          started = true;
          // Bajar los datos del usuario desde Firestore ANTES de renderizar,
          // para que el dashboard muestre lo que hay en la nube (multi-dispositivo).
          if (window.NexusFirestore) {
            const loaded = await window.NexusFirestore.loadUserData(user.uid);
            // Si bajó datos, re-hidratar el state (se armó con el localStorage
            // vacío en un dispositivo nuevo) antes de renderizar.
            if (loaded) S.rehydrateState();
          }
          init();
        }
      } else {
        window.location.replace("./index.html");
      }
    });
  } else if (!window.NexusAuth.hasSession()) {
    window.location.replace("./index.html");
  } else {
    init();
  }
})();
