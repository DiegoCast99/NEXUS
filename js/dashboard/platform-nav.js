/* ============================================================
   NEXUS Dashboard · Navegacion contextual de plataformas
   ------------------------------------------------------------
   Dos responsabilidades:

   1. Sub-secciones: al entrar a una plataforma (Mercado Libre,
      Kairos, la que sea) la barra lateral deja de mostrar los
      modulos y pasa a mostrar las secciones de ESA plataforma.
      Cada seccion se corresponde con los bloques marcados con
      data-section="..." dentro del panel del modulo.

   2. Barra plegable: el titular puede ocultar/mostrar la barra.
      La preferencia se recuerda entre sesiones.

   El mapa de secciones es data-driven: agregar una plataforma
   nueva no requiere tocar esta logica, solo marcar sus bloques
   con data-section y sumar su modulo a SECTIONS.
   ============================================================ */
(function (root) {
  var SIDEBAR_KEY = "nexus.sidebar.collapsed.v1";
  var SECTION_KEY = "nexus.platform.section.v1";

  // Secciones por modulo. El orden es el que se ve en la barra.
  // `id` tiene que coincidir con los data-section del HTML.
  var SECTIONS = {
    ecommerce: [
      { id: "resumen", label: "Resumen", hint: "Ventas y tendencia" },
      { id: "pedidos", label: "Pedidos", hint: "Operaciones recientes" },
      { id: "productos", label: "Productos", hint: "Top rendimiento" },
      { id: "config", label: "Configuracion", hint: "Conexion y avisos" }
    ],
    meta: [
      { id: "resumen", label: "Resumen", hint: "Inversion y ROAS" },
      { id: "campanas", label: "Campanas", hint: "Vista operacional" },
      { id: "pixel", label: "Pixel", hint: "Eventos y conversiones" },
      { id: "config", label: "Configuracion", hint: "Credenciales" }
    ]
  };

  var MODULE_LABEL = { ecommerce: "E-Commerce", meta: "Meta Ads" };
  var BACK_LABEL = { ecommerce: "Volver a negocios", meta: "Volver a plataformas" };

  // Modulo cuya plataforma esta abierta ahora (null = menu de modulos).
  var current = null;

  function el(id) { return document.getElementById(id); }

  function readSections() {
    try { return JSON.parse(localStorage.getItem(SECTION_KEY)) || {}; }
    catch (e) { return {}; }
  }

  function saveSection(module, section) {
    try {
      var all = readSections();
      all[module] = section;
      localStorage.setItem(SECTION_KEY, JSON.stringify(all));
    } catch (e) { /* almacenamiento lleno o bloqueado */ }
  }

  function sectionsFor(module) { return SECTIONS[module] || []; }

  function defaultSection(module) {
    var saved = readSections()[module];
    var known = sectionsFor(module).some(function (s) { return s.id === saved; });
    return known ? saved : (sectionsFor(module)[0] || {}).id;
  }

  // ---- Secciones ---------------------------------------------

  // Muestra solo los bloques de la seccion pedida dentro del panel del modulo.
  function applySection(module, section) {
    var panel = document.querySelector('.view-panel[data-panel="' + module + '"]');
    if (!panel) return;
    panel.querySelectorAll("[data-section]").forEach(function (node) {
      var mine = node.getAttribute("data-section") === section;
      node.classList.toggle("section-hidden", !mine);
    });
    var links = el("platformNavLinks");
    if (links) {
      links.querySelectorAll("[data-section-link]").forEach(function (btn) {
        btn.classList.toggle("is-active", btn.getAttribute("data-section-link") === section);
      });
    }
  }

  function setSection(section) {
    if (!current) return;
    saveSection(current, section);
    applySection(current, section);
  }

  // ---- Barra contextual --------------------------------------

  function renderLinks(module) {
    var box = el("platformNavLinks");
    if (!box) return;
    box.innerHTML = sectionsFor(module).map(function (s) {
      return '<button class="platform-nav-link" type="button" data-section-link="' + s.id + '">' +
        "<b>" + s.label + "</b><small>" + s.hint + "</small></button>";
    }).join("");
  }

  // Entra al modo "plataforma": la barra se enfoca en ese negocio.
  function enterPlatform(module, platformName) {
    if (!sectionsFor(module).length) return;
    current = module;
    renderLinks(module);
    var title = el("platformNavTitle");
    var mod = el("platformNavModule");
    var back = el("platformNavBackLabel");
    if (title) title.textContent = platformName || "Plataforma";
    if (mod) mod.textContent = MODULE_LABEL[module] || module;
    if (back) back.textContent = BACK_LABEL[module] || "Volver";
    el("platformNav")?.classList.remove("is-hidden");
    el("moduleNav")?.classList.add("is-hidden");
    applySection(module, defaultSection(module));
  }

  // Vuelve al menu de modulos y deja el panel entero visible otra vez
  // (la pantalla de seleccion de plataforma no usa secciones).
  function exitPlatform() {
    var module = current;
    current = null;
    el("platformNav")?.classList.add("is-hidden");
    el("moduleNav")?.classList.remove("is-hidden");
    if (!module) return;
    var panel = document.querySelector('.view-panel[data-panel="' + module + '"]');
    if (!panel) return;
    panel.querySelectorAll("[data-section]").forEach(function (node) {
      node.classList.remove("section-hidden");
    });
  }

  // ---- Barra plegable ----------------------------------------

  function setCollapsed(collapsed) {
    var shell = el("dashboardShell");
    if (shell) shell.classList.toggle("sidebar-collapsed", collapsed);
    var toggle = el("sidebarToggle");
    if (toggle) toggle.setAttribute("aria-expanded", String(!collapsed));
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0"); } catch (e) {}
  }

  function toggleSidebar() {
    var shell = el("dashboardShell");
    setCollapsed(!(shell && shell.classList.contains("sidebar-collapsed")));
  }

  function restoreSidebar() {
    var saved = null;
    try { saved = localStorage.getItem(SIDEBAR_KEY); } catch (e) {}
    setCollapsed(saved === "1");
  }

  // ---- Init --------------------------------------------------

  function init() {
    restoreSidebar();
    el("sidebarToggle")?.addEventListener("click", toggleSidebar);
    el("platformNavLinks")?.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-section-link]");
      if (btn) setSection(btn.getAttribute("data-section-link"));
    });
    el("platformNavBack")?.addEventListener("click", function () {
      // Delegar en el modulo: cada uno sabe como volver a su selector.
      if (current === "ecommerce") root.NexusDash?.clearSelectedCommerceApp?.();
      else if (current === "meta") root.NexusDash?.clearSelectedMetaPlatform?.();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  root.NexusPlatformNav = {
    enterPlatform: enterPlatform,
    exitPlatform: exitPlatform,
    setSection: setSection,
    toggleSidebar: toggleSidebar,
    sectionsFor: sectionsFor,
    defaultSection: defaultSection
  };
})(typeof window !== "undefined" ? window : globalThis);
