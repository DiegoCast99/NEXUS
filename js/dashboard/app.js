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

    const chartCanvases = [elements.cashflowChart, elements.categoryChart, elements.metaTrendChart, elements.commerceTrendChart, elements.adsChart, elements.adsDetailChart];
    chartCanvases.forEach((canvas) => {
      canvas?.addEventListener("mousemove", (event) => showChartTooltip(canvas, event));
      canvas?.addEventListener("mouseleave", hideChartTooltip);
      // Tactil: en el iPhone no hay mousemove, asi que el tooltip era inalcanzable
      // (los graficos eran mudos). Un tap sobre una barra muestra su valor.
      // pointerdown trae clientX/clientY igual que mousemove; el mouse se ignora
      // aca porque ya lo cubre mousemove.
      canvas?.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse") return;
        showChartTooltip(canvas, event);
      });
    });
    // Tocar fuera de un grafico cierra el tooltip abierto por tap.
    document.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      if (!chartCanvases.includes(event.target)) hideChartTooltip();
    });

    // Rango de meses (Desde–Hasta). setMonthRange ordena solo si quedan al reves
    // y persiste; despues reflejamos el orden normalizado en los selects.
    function onMonthRangeChange() {
      S.setMonthRange(elements.monthFrom.value, elements.monthTo.value);
      elements.monthFrom.value = state.filters.monthFrom;
      elements.monthTo.value = state.filters.monthTo;
      renderAll();
    }
    elements.monthFrom?.addEventListener("change", onMonthRangeChange);
    elements.monthTo?.addEventListener("change", onMonthRangeChange);

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
    // Reconectar = renovar el permiso (mismo flujo OAuth, ahora con scope de
    // escritura) SIN desconectar: el callback pisa el token viejo por uno nuevo y
    // NO borra snapshots ni inventario. Ideal para habilitar la escritura de
    // publicidad/stock sin perder datos.
    elements.mlReconnectButton?.addEventListener("click", () => {
      if (window.confirm("Reconectar Mercado Libre para renovar permisos (habilita escritura de publicidad y stock)? No se pierde nada: tus ventas, inventario y sincronizaciones quedan igual. Vas a ver la pantalla de permisos de Mercado Libre.")) startMLOAuth();
    });
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
    elements.mlListingsSave?.addEventListener("click", () => S.saveMLListingChanges());
    // Tocar una fila de Ventas abre el detalle de esa venta (estilo ML). Va por
    // delegacion en el tbody porque las filas se re-renderizan en cada sync.
    elements.commerceOrdersTable?.addEventListener("click", (event) => {
      const row = event.target.closest("tr[data-order-id]");
      if (!row) return;
      S.renderVentaDetail(row.getAttribute("data-order-id"));
    });
    elements.ventaBack?.addEventListener("click", () => S.cerrarVentaDetail());
    elements.adsReload?.addEventListener("click", () => S.reloadAds());
    // Tocar una campaña abre su detalle con los controles (pausar, presupuesto, anuncios).
    elements.adsTableBody?.addEventListener("click", (event) => {
      const row = event.target.closest("tr[data-ads-campaign]");
      if (!row) return;
      S.renderAdsDetail(row.getAttribute("data-ads-campaign"));
    });
    elements.adsBack?.addEventListener("click", () => S.adsCerrarDetail());
    elements.adsToggleBtn?.addEventListener("click", () => S.adsToggleCampaign());
    elements.adsSaveBtn?.addEventListener("click", () => S.adsGuardarCampaign());
    elements.adsDeleteBtn?.addEventListener("click", () => S.adsEliminarCampaign());
    elements.adsAddBtn?.addEventListener("click", () => S.adsAgregarItem());
    // Crear campaña (abrir/cerrar el formulario + crear)
    elements.adsCreateToggle?.addEventListener("click", () => S.adsToggleCreateForm());
    elements.adsCreateCancel?.addEventListener("click", () => S.adsToggleCreateForm(false));
    elements.adsCreateBtn?.addEventListener("click", () => S.adsCrearCampaign());
    // Pausar/activar un anuncio dentro de la campaña (delegado, se re-renderiza).
    elements.adsItemList?.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-ads-item]");
      if (!btn) return;
      S.adsToggleItem(btn.getAttribute("data-ads-item"), btn.getAttribute("data-activar") === "1");
    });
    // ---- Inventario central (stock + sync a ML) ----
    // Pestañas: Lista de productos / Publicaciones y enlaces (delegado en el panel).
    elements.invPanel?.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-inv-tab]");
      if (tab) { S.invTab(tab.getAttribute("data-inv-tab"), true); return; }
      const flt = event.target.closest("[data-inv-filter]");
      if (flt) { S.invSetFilter(flt.getAttribute("data-inv-filter")); return; }
      if (event.target.closest("#invCompFilterClear")) S.invLimpiarCompFiltro();
    });
    // Filtro por componente (select): filtra las publicaciones por producto físico.
    elements.invPanel?.addEventListener("change", (event) => {
      const sel = event.target.closest("#invCompFilter");
      if (sel) S.invSetCompFiltro(sel.value);
    });
    elements.invReload?.addEventListener("click", () => S.abrirInventario());
    elements.invAddProd?.addEventListener("click", () => S.invAddProduct());
    elements.invSaveProds?.addEventListener("click", () => S.invGuardarProductos());
    elements.invLoadListings?.addEventListener("click", () => S.invCargarPublicaciones());
    elements.invResync?.addEventListener("click", () => S.invResyncAll());
    // Borrar producto (delegado: la tabla se re-renderiza).
    elements.invProdBody?.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-inv-del]");
      if (btn) S.invDeleteProduct(btn.getAttribute("data-inv-del"));
    });
    // Configurar la composición, o reintentar el sync de una publicación en error.
    elements.invListingBody?.addEventListener("click", (event) => {
      const fam = event.target.closest("[data-fam-expand]");
      if (fam) { S.invToggleFamilia(fam.getAttribute("data-fam-expand")); return; }
      const exp = event.target.closest("[data-inv-expand]");
      if (exp) { S.invToggleExpand(exp.getAttribute("data-inv-expand")); return; }
      const cfg = event.target.closest("button[data-inv-config]");
      if (cfg) { S.invConfigurar(cfg.getAttribute("data-inv-config"), cfg.getAttribute("data-inv-var") || ""); return; }
      const retry = event.target.closest("button[data-inv-retry]");
      if (retry) S.invReintentarUno(retry.getAttribute("data-inv-retry"));
    });
    elements.invComposeAdd?.addEventListener("click", () => S.invComposeAddComponent(""));
    elements.invComposeSave?.addEventListener("click", () => S.invComposeGuardar());
    elements.invComposeCancel?.addEventListener("click", () => S.invComposeCancelar());
    // Agregar/quitar componentes por sabor (delegado en las filas de la composición).
    elements.invComposeRows?.addEventListener("click", (event) => {
      const del = event.target.closest("button[data-comp-del]");
      if (del) { S.invComposeQuitar(del.getAttribute("data-var") || "", parseInt(del.getAttribute("data-idx"), 10)); return; }
      const add = event.target.closest("button[data-comp-add]");
      if (add) S.invComposeAddComponent(add.getAttribute("data-comp-add") || "");
    });
    // Lo tipeado queda pendiente en memoria: recien se manda a ML al Guardar.
    elements.mlListingsTable?.addEventListener("input", (event) => {
      const inp = event.target.closest("input[data-listing-stock], input[data-variant-stock]");
      if (!inp) return;
      if (inp.dataset.listingStock) S.markPendingStock(inp.dataset.listingStock, null, inp.value);
      else {
        const [itemId, varId] = inp.dataset.variantStock.split("::");
        S.markPendingStock(itemId, varId, inp.value);
      }
    });
    elements.mlListingsTable?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-action]");
      if (!btn) return;
      const id = btn.dataset.listingId;
      if (btn.dataset.action === "expand") S.toggleListingExpand(id);
      else if (btn.dataset.action === "switch") S.toggleListingStatus(id);
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
          // App ya abierta (quizás en la portada): tapamos con el splash para ir
          // directo al detalle, y openSaleDeepLink lo saca al mostrar la venta.
          document.documentElement.classList.add("booting-sale");
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

    // Redibuja los canvas de la vista activa. Los charts miden su ancho real
    // con getBoundingClientRect, asi que basta con volver a llamarlos cuando
    // el area de contenido cambia de tamano.
    function redrawActiveCharts() {
      if (state.activeView === "meta") renderMetaDashboard();
      else if (state.activeView === "ecommerce") renderCommerceDashboard();
      else if (state.activeView === "finance") {
        drawCashflowChart();
        drawCategoryChart();
      }
    }

    window.addEventListener("resize", redrawActiveCharts);

    // La barra lateral se pliega/despliega cambiando SOLO una clase: la ventana
    // no cambia de tamano, asi que el 'resize' de arriba no dispara y los charts
    // quedarian estirados. Un ResizeObserver sobre el area de contenido si ve
    // ese cambio de ancho (y tambien el de la transicion CSS) y redibuja. Se
    // agenda con rAF para colapsar la rafaga de la animacion en un solo redibujo.
    var mainArea = document.querySelector(".dashboard-main");
    if (mainArea && typeof ResizeObserver !== "undefined") {
      var lastMainWidth = Math.round(mainArea.getBoundingClientRect().width);
      var redrawTimer = 0;
      var mainObserver = new ResizeObserver(function (entries) {
        var width = Math.round(entries[0].contentRect.width);
        if (width === lastMainWidth) return;
        lastMainWidth = width;
        // Debounce de cola: durante la transicion CSS de la barra (0.22s) el
        // observer dispara muchas veces; reprogramamos y redibujamos UNA sola
        // vez cuando el ancho se asienta, para no re-renderizar en cada frame.
        clearTimeout(redrawTimer);
        redrawTimer = setTimeout(redrawActiveCharts, 240);
      });
      mainObserver.observe(mainArea);
    }

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

    // Sincronizacion a la nube: subir YA lo pendiente cuando la app pasa a
    // segundo plano o se cierra. En el celular, cerrar/cambiar de app mata el
    // debounce y el ultimo cambio se perdia. pagehide cubre el cierre real;
    // visibilitychange->hidden cubre el "mandar la app atras" del iPhone.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") S.flushCloudSync();
    });
    window.addEventListener("pagehide", () => S.flushCloudSync());
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
      S.bindTools();
      applyChartMode();
      renderAll();
      renderMetaDashboard();
      renderCommerceDashboard();
      S.renderToolsDashboard();
      // Rediseño: identidad del perfil (email real de Firebase) + campana.
      S.initShell?.();
      S.renderProfileChrome?.();
      S.updateNotifDot?.();
      if (S.revolutInit) S.revolutInit();   // conexion Revolut (Open Banking)
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
        // Red de seguridad: si algo falla y el detalle nunca aparece, sacar el
        // splash igual (openSaleDeepLink normalmente lo saca al mostrar la venta).
        setTimeout(function () { document.documentElement.classList.remove("booting-sale"); }, 10000);
      } else {
        // Boot normal (no venta): por las dudas, nunca dejar el splash puesto.
        document.documentElement.classList.remove("booting-sale");
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
  // Aplica datos que llegan del listener EN VIVO de Firestore (cambios hechos en
  // otro dispositivo). Escribe localStorage DIRECTO (no safeSetItem) para no
  // re-disparar la subida a la nube, y solo re-renderiza si algo cambio de verdad
  // (evita el eco de nuestras propias escrituras). La clave de sesion se protege
  // por las dudas: nunca debe pisarla un dispositivo remoto.
  function applyRemoteData(blobs) {
    if (!blobs || typeof blobs !== "object") return;
    // Si TENEMOS cambios locales sin subir, no aplicamos el remoto ahora: seria la
    // carrera donde el eco de una subida anterior pisa una edicion mas nueva. El
    // flush sube lo local y el proximo snapshot ya viene consistente.
    if (S.hasPendingCloudSync && S.hasPendingCloudSync()) return;
    let changed = false;
    Object.keys(blobs).forEach(function (key) {
      // Solo claves de DATOS: isCloudSyncKey excluye la sesion y las preferencias
      // de vista por dispositivo (mes mirado, modo de grafico).
      if (!S.isCloudSyncKey(key)) return;
      const incoming = blobs[key];
      if (typeof incoming !== "string") return;
      if (localStorage.getItem(key) !== incoming) {
        try { localStorage.setItem(key, incoming); changed = true; } catch (e) { /* cuota */ }
      }
    });
    if (!changed) return;
    S.rehydrateState();
    // Repintar desde el state ya re-hidratado. Si el titular esta tipeando en un
    // input, NO repintamos el panel de e-commerce: su render repuebla el form de
    // config y le borraria lo escrito. El de finanzas no toca inputs (seguro).
    const active = document.activeElement;
    const typing = !!active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName || "");
    try { S.renderAll(); } catch (e) {}
    try { if (S.renderHome) S.renderHome(); } catch (e) {}   // Inicio: KPIs + gráficas con datos frescos de la nube
    try { S.renderMetaDashboard(); } catch (e) {}
    if (!typing) { try { S.renderCommerceDashboard(); } catch (e) {} }
  }

  if (window.NexusFirebaseAuth) {
    let started = false;
    window.NexusFirebaseAuth.onAuthStateChanged(async function (user) {
      if (user) {
        if (!started) {
          started = true;
          // CARGA FLUIDA: renderizamos YA desde el cache local (el state ya se
          // hidrató con localStorage al cargar los módulos). En recargas del mismo
          // dispositivo el dashboard aparece al instante, sin esperar a la red.
          init();
          // La nube llega por la suscripción EN VIVO: su primer snapshot trae los
          // datos actuales de Firestore y applyRemoteData re-renderiza si algo
          // difiere (cubre multi-dispositivo y el dispositivo nuevo con cache
          // vacío). Reemplaza al await bloqueante que antes demoraba el primer paint.
          if (window.NexusFirestore && window.NexusFirestore.watchUserData) {
            let primerCloud = true;
            window.NexusFirestore.watchUserData(user.uid, function (blobs) {
              applyRemoteData(blobs);
              // Dispositivo nuevo: si la nube recién trajo la conexión de ML y no
              // hay snapshot local, arrancar el "en vivo" (init no pudo, no había token).
              if (primerCloud) {
                primerCloud = false;
                try {
                  if (S.getCommerceConfig && S.getCommerceConfig("mercadolibre").hasToken &&
                      S.getCommerceSnapshot && !S.getCommerceSnapshot("mercadolibre")) {
                    syncMercadoLibre({ silent: true });
                  }
                } catch (e) {}
              }
            });
          } else if (window.NexusFirestore) {
            // Sin suscripción en vivo: bajar una vez y refrescar (fallback).
            window.NexusFirestore.loadUserData(user.uid).then(function (loaded) {
              if (loaded) { S.rehydrateState(); try { S.renderAll(); S.renderMetaDashboard(); S.renderCommerceDashboard(); } catch (e) {} }
            }).catch(function () {});
          }
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
