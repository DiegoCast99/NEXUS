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
  // `flag` marca secciones que solo aplican a ciertas plataformas: el caller
  // de enterPlatform decide que flags incluir (ej: "ml" solo en Mercado Libre).
  var SECTIONS = {
    ecommerce: [
      { id: "resumen", label: "Metricas", hint: "Ventas, costos y tendencia" },
      { id: "pedidos", label: "Ventas", hint: "Detalle de tus ventas" },
      { id: "publicaciones", label: "Publicaciones", hint: "Stock y estado", flag: "ml" },
      { id: "inventario", label: "Inventario", hint: "Stock central y sync", flag: "ml" },
      { id: "publicidad", label: "Publicidad", hint: "Campañas y ROAS", flag: "ml" },
      { id: "config", label: "Configuracion", hint: "Conexion y avisos" }
    ],
    meta: [
      { id: "resumen", label: "Resumen", hint: "Inversion y ROAS" },
      { id: "campanas", label: "Campanas", hint: "Vista operacional" },
      { id: "pixel", label: "Pixel", hint: "Eventos y conversiones" },
      { id: "config", label: "Configuracion", hint: "Credenciales" }
    ],
    tools: [
      { id: "publicador", label: "Publicador", hint: "Clonar entre cuentas" },
      { id: "historial", label: "Historial", hint: "Importaciones previas" }
    ]
  };

  var MODULE_LABEL = { ecommerce: "E-Commerce", meta: "Meta Ads", tools: "Herramientas" };
  var BACK_LABEL = {
    ecommerce: "Volver a negocios",
    meta: "Volver a plataformas",
    tools: "Volver a herramientas"
  };

  // Modulo cuya plataforma esta abierta ahora (null = menu de modulos).
  var current = null;
  // Flags de la plataforma abierta (ej: ["ml"]): filtran las secciones con flag.
  var currentFlags = [];

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

  function sectionsFor(module, flags) {
    var lista = SECTIONS[module] || [];
    var activos = flags || currentFlags || [];
    return lista.filter(function (s) { return !s.flag || activos.indexOf(s.flag) !== -1; });
  }

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
    // Aviso para los modulos: permite cargar datos recien cuando la seccion
    // se abre (ej: Publicaciones trae el catalogo de ML bajo demanda).
    try {
      root.dispatchEvent(new CustomEvent("nexus:section", { detail: { module: module, section: section } }));
    } catch (e) { /* CustomEvent no disponible: sin lazy-load */ }
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
  function enterPlatform(module, platformName, opts) {
    currentFlags = (opts && opts.flags) || [];
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
    // Mobile: el shell sabe que hay una plataforma abierta para reservar el
    // alto del strip de secciones sobre la tab bar (ver mobile.css).
    el("dashboardShell")?.classList.add("platform-open");
    applySection(module, defaultSection(module));
  }

  // Vuelve al menu de modulos y deja el panel entero visible otra vez
  // (la pantalla de seleccion de plataforma no usa secciones).
  function exitPlatform() {
    var module = current;
    current = null;
    currentFlags = [];
    el("platformNav")?.classList.add("is-hidden");
    el("moduleNav")?.classList.remove("is-hidden");
    el("dashboardShell")?.classList.remove("platform-open");
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
      else if (current === "tools") root.NexusDash?.clearSelectedTool?.();
    });

    // ---- Hoja "Mas" (solo mobile) ----------------------------
    // La tab bar inferior muestra los 5 modulos + un boton "Mas" que abre una
    // hoja deslizable con el resto del sidebar (respaldo, cerrar sesion, etc.).
    // En desktop el boton "Mas" no existe (display:none) y esto queda inerte.
    initMoreSheet();
  }

  function setSheet(open) {
    var shell = el("dashboardShell");
    if (shell) shell.classList.toggle("sidebar-sheet-open", open);
    var bd = document.querySelector(".mobile-sheet-backdrop");
    if (bd) bd.hidden = !open;
    var more = document.querySelector("[data-more]");
    if (more) more.setAttribute("aria-expanded", String(open));
  }

  function initMoreSheet() {
    document.querySelector("[data-more]")?.addEventListener("click", function () {
      var shell = el("dashboardShell");
      setSheet(!(shell && shell.classList.contains("sidebar-sheet-open")));
    });
    // Tocar el fondo oscuro cierra la hoja.
    document.querySelectorAll("[data-sheet-close]").forEach(function (node) {
      node.addEventListener("click", function () { setSheet(false); });
    });
    // Tocar una accion dentro de la hoja (cerrar sesion, exportar...) o cambiar
    // de modulo desde la tab bar tambien la cierra.
    el("sidebar")?.addEventListener("click", function (event) {
      if (event.target.closest("[data-logout], .landing-link, [data-export], [data-import]")) setSheet(false);
    });
    el("moduleNav")?.addEventListener("click", function (event) {
      if (event.target.closest("[data-view]")) setSheet(false);
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
