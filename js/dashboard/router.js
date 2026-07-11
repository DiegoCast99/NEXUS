/* ============================================================
   NEXUS Dashboard · Router de vistas (hash <-> setView)
   Parte de window.NexusDash — namespace compartido (sin build).
   ============================================================ */
(function () {
  const S = window.NexusDash;
  const { META_ACTIVE_PLATFORM_KEY, animateActivePanel, applyChartMode, defaultMetaConfig, drawCashflowChart, drawCategoryChart } = S;
  const { elements, loadActiveMetaPlatform, renderCommerceDashboard, renderMetaDashboard, safeSetItem, scheduleMetaRefresh } = S;
  const { state, updateTopbarForView } = S;
  function normalizeView(rawView = "") {
    const view = String(rawView || "").toLowerCase();
    const metaMatch = view.match(/^meta(?:-ads)?-(kairos|billion|kiwifi)$/);
    if (metaMatch) return { view: "meta", metaPlatform: metaMatch[1] };
    if (view === "meta" || view === "meta-ads") return { view: "meta", metaPlatform: null };
    if (view === "ecommerce" || view === "e-commerce") return { view: "ecommerce", metaPlatform: null };
    if (view === "finance" || view === "finanzas" || view === "finanzas-personales") return { view: "finance", metaPlatform: null };
    return { view: "welcome", metaPlatform: null };
  }

  function setView(rawView, shouldPushHash = true) {
    const normalized = normalizeView(rawView);
    const nextView = normalized.view;
    state.activeView = nextView;

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

    elements.navButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.view === nextView));
    elements.panels.forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === nextView));
    updateTopbarForView(nextView);
    applyChartMode();

    if (nextView === "meta") {
      window.setTimeout(() => {
        renderMetaDashboard();
        if (state.meta.selectedPlatform) scheduleMetaRefresh();
      }, 30);
      if (shouldPushHash) history.replaceState(null, "", normalized.metaPlatform ? `#meta-ads-${normalized.metaPlatform}` : "#meta-ads");
      animateActivePanel();
      return;
    }

    if (nextView === "ecommerce") {
      // Entrar a E-Commerce siempre muestra el selector de negocios (las tarjetas).
      state.commerce.selectedApp = null;
      window.clearInterval(state.commerce.refreshTimer);
      state.commerce.refreshTimer = 0;
      window.setTimeout(renderCommerceDashboard, 30);
      if (shouldPushHash) history.replaceState(null, "", "#ecommerce");
      animateActivePanel();
      return;
    }

    if (nextView === "finance") {
      if (shouldPushHash) history.replaceState(null, "", "#finanzas-personales");
      window.setTimeout(() => {
        drawCashflowChart();
        drawCategoryChart();
      }, 30);
      animateActivePanel();
      return;
    }

    if (shouldPushHash) history.replaceState(null, "", "#welcome");
    animateActivePanel();
  }


  Object.assign(S, {
    normalizeView, setView,
  });
})();
