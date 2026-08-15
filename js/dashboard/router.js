/* ============================================================
   NEXUS Dashboard · Router de vistas (hash <-> setView)
   Parte de window.NexusDash — namespace compartido (sin build).
   ============================================================ */
(function () {
  const S = window.NexusDash;
  const { META_ACTIVE_PLATFORM_KEY, animateActivePanel, applyChartMode, defaultMetaConfig, drawCashflowChart, drawCategoryChart } = S;
  const { elements, loadActiveMetaPlatform, renderCommerceDashboard, renderMetaDashboard, safeSetItem, scheduleMetaRefresh } = S;
  const { state, updateTopbarForView } = S;
  // `nav` = qué item del sidebar se resalta (el rediseño promueve Ventas/
  // Productos/Marketing a items propios que caen sobre modulos existentes).
  function normalizeView(rawView = "") {
    const view = String(rawView || "").toLowerCase();
    const metaMatch = view.match(/^meta(?:-ads)?-(kairos|billion|kiwifi)$/);
    if (metaMatch) return { view: "meta", metaPlatform: metaMatch[1], nav: "marketing" };
    if (view === "meta" || view === "meta-ads" || view === "marketing") return { view: "meta", metaPlatform: null, nav: "marketing" };
    // Deep-link a una cuenta/negocio de e-commerce: #ecommerce-<id> (ej:
    // #ecommerce-mercadolibre). Permite que el gesto atras vuelva al selector y
    // que reabrir la PWA recuerde el negocio abierto. Los ids son slugs lowercase.
    const ecomMatch = view.match(/^(?:ecommerce|e-commerce)-([a-z0-9]+)$/);
    if (ecomMatch) return { view: "ecommerce", metaPlatform: null, commerceApp: ecomMatch[1], nav: "ventas" };
    if (view === "ecommerce" || view === "e-commerce") return { view: "ecommerce", metaPlatform: null, nav: "ventas" };
    // Accesos directos del sidebar: abren el negocio ML directo a su seccion.
    if (view === "ventas") return { view: "ecommerce", metaPlatform: null, commerceApp: "mercadolibre", section: "resumen", nav: "ventas" };
    if (view === "productos") return { view: "ecommerce", metaPlatform: null, commerceApp: "mercadolibre", section: "inventario", nav: "productos" };
    if (view === "finance" || view === "finanzas" || view === "finanzas-personales") return { view: "finance", metaPlatform: null };
    // Deep-link a una herramienta: #herramientas-<tool> (ej: #herramientas-publicador).
    const toolMatch = view.match(/^(?:tools|herramientas)-([a-z0-9]+)$/);
    if (toolMatch) return { view: "tools", metaPlatform: null, tool: toolMatch[1] };
    if (view === "tools" || view === "herramientas") return { view: "tools", metaPlatform: null };
    if (view === "settings" || view === "config" || view === "configuracion" || view === "ajustes") return { view: "settings", metaPlatform: null, nav: "settings" };
    return { view: "welcome", metaPlatform: null };
  }

  // pushState (no replaceState) para que el gesto "atras" del iPhone tenga a
  // donde volver: cada navegacion del titular deja una entrada en el historial.
  // Antes todo usaba replaceState, el historial nunca crecia y volver atras
  // saltaba directo al login. Solo se apila si el hash cambia (no repetir).
  function applyViewHash(hash) {
    if (location.hash === hash) return;
    try { history.pushState(null, "", hash); }
    catch (e) { location.hash = hash; }
  }

  function setView(rawView, shouldPushHash = true) {
    const normalized = normalizeView(rawView);
    const nextView = normalized.view;
    state.activeView = nextView;
    // Entrar a una vista dispara la animación de entrada de sus gráficas (una vez).
    if (S.bumpChartGen) S.bumpChartGen();

    if (nextView !== "meta") {
      state.meta.selectedPlatform = null;
      state.meta.config = defaultMetaConfig();
      state.meta.snapshot = null;
      localStorage.removeItem(META_ACTIVE_PLATFORM_KEY);
      window.clearInterval(state.meta.refreshTimer);
      state.meta.refreshTimer = 0;
    } else if (normalized.metaPlatform) {
      state.meta.selectedPlatform = normalized.metaPlatform;
      safeSetItem(META_ACTIVE_PLATFORM_KEY, normalized.metaPlatform);
      loadActiveMetaPlatform();
    } else {
      state.meta.selectedPlatform = null;
      state.meta.config = defaultMetaConfig();
      state.meta.snapshot = null;
      localStorage.removeItem(META_ACTIVE_PLATFORM_KEY);
    }

    if (nextView !== "ecommerce") {
      window.clearInterval(state.commerce.refreshTimer);
      state.commerce.refreshTimer = 0;
    }

    // El item resaltado usa la clave `nav` (para Ventas/Productos/Marketing que
    // caen sobre ecommerce/meta); si no hay, el propio modulo (welcome/finance/...).
    const navKey = normalized.nav || nextView;
    elements.navButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.view === navKey));
    elements.panels.forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === nextView));
    updateTopbarForView(nextView);
    applyChartMode();

    // Barra lateral contextual: solo queda "enfocada" en una plataforma si hay
    // una abierta. Entrar a E-Commerce siempre muestra el selector, y cualquier
    // otro modulo vuelve al menu principal.
    const nav = window.NexusPlatformNav;
    if (nav) {
      if (nextView === "meta" && normalized.metaPlatform) {
        const platform = S.getMetaPlatform(normalized.metaPlatform);
        nav.enterPlatform("meta", platform ? platform.name : normalized.metaPlatform);
      } else {
        nav.exitPlatform();
      }
    }

    if (nextView === "meta") {
      window.setTimeout(() => {
        renderMetaDashboard();
        if (state.meta.selectedPlatform) scheduleMetaRefresh();
      }, 30);
      if (shouldPushHash) applyViewHash(normalized.metaPlatform ? `#meta-ads-${normalized.metaPlatform}` : "#meta-ads");
      animateActivePanel();
      return;
    }

    if (nextView === "ecommerce") {
      // Validar el id del hash: getCommerceApp nunca devuelve null (cae al primero),
      // asi que se compara el .id resultante. Si un hash quedo obsoleto (cuenta
      // renombrada/eliminada), no se abre otra cuenta: cae al selector de abajo.
      const wantApp = normalized.commerceApp;
      const app = wantApp ? S.getCommerceApp(wantApp) : null;
      if (wantApp && app && app.id === wantApp) {
        // Restaurar el negocio/cuenta abierto desde el hash (atras/adelante/reabrir).
        if (shouldPushHash) applyViewHash("#ecommerce-" + wantApp);
        state.commerce.selectedApp = null;
        state.commerce.selectedGroup = null;
        window.setTimeout(() => {
          renderCommerceDashboard();
          S.selectCommerceApp(wantApp, { fromHash: true });
          // Accesos directos Ventas/Productos: saltar a la seccion pedida.
          if (normalized.section) window.NexusPlatformNav?.setSection(normalized.section);
        }, 30);
        animateActivePanel();
        return;
      }
      // Entrar a E-Commerce sin sufijo muestra el selector de negocios (las tarjetas
      // de primer nivel): se cierra tanto el panel como el negocio abierto.
      state.commerce.selectedApp = null;
      state.commerce.selectedGroup = null;
      window.clearInterval(state.commerce.refreshTimer);
      state.commerce.refreshTimer = 0;
      window.setTimeout(renderCommerceDashboard, 30);
      if (shouldPushHash) applyViewHash("#ecommerce");
      animateActivePanel();
      return;
    }

    if (nextView === "tools") {
      if (normalized.tool === "publicador") {
        // Restaurar el Publicador abierto desde el hash (atras/adelante/reabrir).
        if (shouldPushHash) applyViewHash("#herramientas-publicador");
        window.setTimeout(() => {
          S.renderToolsDashboard();
          S.abrirPublicador?.({ fromHash: true });
        }, 30);
        animateActivePanel();
        return;
      }
      // Igual que E-Commerce: entrar al modulo siempre muestra las tarjetas.
      // Volver a abrir la herramienta retoma donde estaba (el bucle de
      // clonado sigue vivo aunque cambies de vista).
      state.tools.pub.abierta = false;
      window.setTimeout(S.renderToolsDashboard, 30);
      if (shouldPushHash) applyViewHash("#herramientas");
      animateActivePanel();
      return;
    }

    if (nextView === "finance") {
      if (shouldPushHash) applyViewHash("#finanzas-personales");
      window.setTimeout(() => {
        drawCashflowChart();
        drawCategoryChart();
      }, 30);
      animateActivePanel();
      return;
    }

    if (nextView === "settings") {
      if (shouldPushHash) applyViewHash("#configuracion");
      window.setTimeout(() => S.renderSettings?.(), 30);
      animateActivePanel();
      return;
    }

    // welcome (default): el nuevo home "Resumen general".
    if (shouldPushHash) applyViewHash("#welcome");
    window.setTimeout(() => S.renderHome?.(), 30);
    animateActivePanel();
  }


  Object.assign(S, {
    normalizeView, setView,
  });
})();
