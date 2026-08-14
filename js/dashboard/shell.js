/* ============================================================
   NEXUS Dashboard · Chrome del shell (rediseño 2026-08)
   Perfil + avatar (subida/persistencia), topbar (buscador,
   campana de notificaciones, ayuda, menu de perfil) y la
   vista Configuracion. Parte de window.NexusDash.
   ============================================================ */
(function () {
  const S = window.NexusDash;
  if (!S) return;
  var PROFILE_KEY = "nexus.profile.v1";

  function el(id) { return document.getElementById(id); }
  function setText(id, txt) { var n = el(id); if (n) n.textContent = txt; }
  function esc(s) { try { return S.escapeHtml(String(s == null ? "" : s)); } catch (e) { return String(s == null ? "" : s); } }

  function readProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; } catch (e) { return {}; } }
  function saveProfile(p) { try { S.safeSetItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) {} }

  function authEmail() {
    try {
      var u = window.NexusFirebaseAuth && window.NexusFirebaseAuth.getCurrentUser && window.NexusFirebaseAuth.getCurrentUser();
      return (u && u.email) || "";
    } catch (e) { return ""; }
  }
  function profileName() {
    var p = readProfile();
    if (p.name) return p.name;
    var email = authEmail();
    if (email) return email.split("@")[0];
    return "Diego";
  }
  function firstName(n) { return String(n || "").trim().split(/\s+/)[0] || "Diego"; }
  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "NX";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  function applyAvatar(node, photo, name) {
    if (!node) return;
    if (photo) {
      node.style.backgroundImage = "url('" + photo + "')";
      node.classList.add("has-photo");
      node.textContent = "";
    } else {
      node.style.backgroundImage = "";
      node.classList.remove("has-photo");
      node.textContent = initials(name);
    }
  }

  // ---- Render de la identidad en todos los puntos del shell ----
  function renderProfileChrome() {
    var p = readProfile();
    var name = profileName();
    var email = authEmail() || "Cuenta";
    var photo = p.photo || "";
    setText("sidebarName", name);
    setText("sidebarEmail", email);
    applyAvatar(el("sidebarAvatar"), photo, name);
    setText("topbarName", firstName(name));
    applyAvatar(el("topbarAvatar"), photo, name);
    setText("profilePopName", name);
    setText("profilePopEmail", email);
    applyAvatar(el("profilePopAvatar"), photo, name);
    applyAvatar(el("settingsAvatar"), photo, name);
    var nameInput = el("settingsName");
    if (nameInput && document.activeElement !== nameInput) nameInput.value = p.name || "";
    var emailInput = el("settingsEmail");
    if (emailInput) emailInput.value = email;
    var clearBtn = el("settingsAvatarClear");
    if (clearBtn) clearBtn.style.display = photo ? "" : "none";
  }

  // ---- Subida de foto (redimensiona a 160px cuadrado, guarda dataURL) ----
  function pickAvatar() { var input = el("avatarInput"); if (input) input.click(); }
  function onAvatarFile(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || !/^image\//.test(file.type)) return;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        try {
          var size = 160;
          var canvas = document.createElement("canvas");
          canvas.width = size; canvas.height = size;
          var ctx = canvas.getContext("2d");
          var m = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
          var dataUrl = canvas.toDataURL("image/jpeg", 0.82);
          var p = readProfile(); p.photo = dataUrl; saveProfile(p);
          renderProfileChrome();
        } catch (err) { /* canvas tainted o sin soporte */ }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  function clearAvatar() { var p = readProfile(); delete p.photo; saveProfile(p); renderProfileChrome(); }

  // ---- Popovers de la topbar ----
  function closePops(except) {
    ["notifPop", "profilePop", "helpPop"].forEach(function (id) {
      var n = el(id); if (n && id !== except) n.hidden = true;
    });
    if (except !== "profilePop") el("profileChip")?.setAttribute("aria-expanded", "false");
    if (except !== "notifPop") el("notifBell")?.setAttribute("aria-expanded", "false");
  }
  function togglePop(id, anchorBtn) {
    var pop = el(id);
    if (!pop) return;
    var willOpen = pop.hidden;
    closePops(willOpen ? id : null);
    pop.hidden = !willOpen;
    if (anchorBtn) anchorBtn.setAttribute("aria-expanded", String(willOpen));
    if (willOpen && id === "notifPop") renderNotifs();
  }

  // ---- Notificaciones: ventas recientes de todas las cuentas ML ----
  function recentSales() {
    var accounts = (S.mlAccounts && S.mlAccounts()) || [];
    var all = [];
    accounts.forEach(function (acc) {
      var snap = S.getCommerceSnapshot && S.getCommerceSnapshot(acc.id);
      (snap && snap.allOrders ? snap.allOrders : []).forEach(function (o) {
        all.push({ acc: acc.id, accName: acc.name, product: o.product, total: o.total, createdAt: o.createdAt || o.date, id: o.id });
      });
    });
    all.sort(function (a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
    return all.slice(0, 6);
  }
  function renderNotifs() {
    var box = el("notifPopBody");
    if (!box) return;
    var sales = recentSales();
    if (!sales.length) {
      box.innerHTML = '<div class="notif-empty">No hay ventas recientes para mostrar. Cuando vendas en Mercado Libre, aparecen acá.</div>';
      return;
    }
    box.innerHTML = sales.map(function (s) {
      var fecha = "";
      try { fecha = new Date(s.createdAt).toLocaleDateString("es-UY", { day: "2-digit", month: "short" }); } catch (e) {}
      var monto = "";
      try { monto = S.currency(Number(s.total) || 0); } catch (e) { monto = "$" + (s.total || 0); }
      return '<button class="notif-item" type="button" data-notif-sale="ventas">' +
        '<b>' + esc(s.product || "Venta") + " · " + monto + '</b>' +
        '<small>' + esc(s.accName) + (fecha ? " · " + esc(fecha) : "") + '</small></button>';
    }).join("");
  }
  function updateNotifDot() {
    var dot = el("notifDot");
    if (!dot) return;
    var since = Date.now() - 36 * 3600 * 1000;
    var has = recentSales().some(function (s) { var t = new Date(s.createdAt).getTime(); return !isNaN(t) && t >= since; });
    dot.hidden = !has;
  }

  // ---- Ayuda (popover creado al vuelo) ----
  function ensureHelpPop() {
    var pop = el("helpPop");
    if (pop) return pop;
    var host = document.querySelector(".topbar");
    if (!host) return null;
    pop = document.createElement("div");
    pop.className = "topbar-pop help-pop";
    pop.id = "helpPop";
    pop.setAttribute("role", "dialog");
    pop.hidden = true;
    pop.innerHTML =
      '<div class="topbar-pop-head"><b>Ayuda rapida</b>' +
      '<button class="topbar-pop-x" type="button" data-pop-close aria-label="Cerrar">&#10005;</button></div>' +
      '<div class="notif-pop-body">' +
      '<div class="notif-item"><b>Ventas y Productos</b><small>Entran directo a tu cuenta de Mercado Libre.</small></div>' +
      '<div class="notif-item"><b>Marketing</b><small>Campañas de Meta Ads, ROAS e inversion.</small></div>' +
      '<div class="notif-item"><b>Buscador</b><small>Escribi una seccion (ej: inventario) y saltá ahí.</small></div>' +
      '<div class="notif-item"><b>Foto de perfil</b><small>Menu de perfil (arriba a la derecha) &#8594; Cambiar foto.</small></div>' +
      '</div>';
    host.appendChild(pop);
    return pop;
  }

  // ---- Buscador global ----
  function searchIndex() {
    var idx = [
      { label: "Inicio", hint: "Resumen general", view: "welcome" },
      { label: "Ventas", hint: "Pedidos y facturacion", view: "ventas" },
      { label: "Productos", hint: "Stock e inventario", view: "productos" },
      { label: "Inventario", hint: "Stock central y sync", view: "productos" },
      { label: "Marketing", hint: "Meta Ads y ROAS", view: "marketing" },
      { label: "Finanzas", hint: "Balance, gastos y ahorro", view: "finance" },
      { label: "Herramientas", hint: "Publicador masivo", view: "tools" },
      { label: "Configuracion", hint: "Perfil y conexiones", view: "settings" }
    ];
    // Productos reales (llevan a Productos)
    try {
      (S.mlAccounts() || []).forEach(function (acc) {
        var snap = S.getCommerceSnapshot(acc.id);
        (snap && snap.products ? snap.products : []).slice(0, 6).forEach(function (p) {
          if (p && p.name) idx.push({ label: p.name, hint: "Producto · " + acc.name, view: "productos" });
        });
      });
    } catch (e) {}
    return idx;
  }
  function renderSearch(q) {
    var box = el("globalSearchResults");
    if (!box) return;
    q = String(q || "").trim().toLowerCase();
    if (!q) { box.hidden = true; box.innerHTML = ""; return; }
    var hits = searchIndex().filter(function (it) {
      return (it.label + " " + it.hint).toLowerCase().indexOf(q) !== -1;
    }).slice(0, 8);
    if (!hits.length) { box.hidden = false; box.innerHTML = '<div class="search-empty">Sin resultados para "' + esc(q) + '"</div>'; return; }
    box.hidden = false;
    box.innerHTML = hits.map(function (it) {
      return '<button class="search-result" type="button" data-search-view="' + esc(it.view) + '"><span><b>' + esc(it.label) + '</b><small>' + esc(it.hint) + '</small></span></button>';
    }).join("");
  }

  // ---- Configuracion: lista de conexiones ----
  function renderSettings() {
    renderProfileChrome();
    var box = el("settingsConnections");
    if (!box) return;
    var rows = [];
    (S.mlAccounts && S.mlAccounts() || []).forEach(function (acc) {
      var on = !!(S.getCommerceConfig && S.getCommerceConfig(acc.id).hasToken);
      rows.push(connRow(acc.name, "Mercado Libre", "mercadolibre", on));
    });
    (S.metaPlatforms || []).forEach(function (p) {
      var st = S.getMetaPlatformState && S.getMetaPlatformState(p.id);
      var on = !!(st && st.config && (st.config.accessToken || st.config.hasToken));
      rows.push(connRow(p.name || p.id, "Meta Ads", "meta", on));
    });
    rows.push(connRow("Amazon", "Marketplace · en evaluacion", "amazon", false));
    rows.push(connRow("Tienda Mia", "Marketplace · pendiente", "tiendamia", false));
    rows.push(connRow("Shopee", "Marketplace · pendiente", "shopee", false));
    box.innerHTML = rows.join("");
  }
  function connRow(name, sub, slug, on) {
    var lg = S.platformLogo ? S.platformLogo(slug, 34) : '<span class="home-biz-logo">' + esc(String(name || "?").slice(0, 2).toUpperCase()) + "</span>";
    return '<div class="settings-conn-row">' + lg +
      '<div><b>' + esc(name) + '</b><small>' + esc(sub) + '</small></div>' +
      '<span class="settings-conn-status ' + (on ? "on" : "off") + '">' + (on ? "Conectado" : "Sin conectar") + '</span></div>';
  }

  function triggerLogout() {
    var b = document.querySelector("aside.sidebar [data-logout]");
    if (b) b.click();
  }

  // ---- Init ----
  function initShell() {
    if (initShell._done) { renderProfileChrome(); return; }
    initShell._done = true;

    el("avatarInput")?.addEventListener("change", onAvatarFile);
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-avatar-pick]")) { pickAvatar(); }
    });
    el("settingsAvatarClear")?.addEventListener("click", clearAvatar);
    el("settingsSaveProfile")?.addEventListener("click", function () {
      var p = readProfile();
      p.name = (el("settingsName")?.value || "").trim();
      if (!p.name) delete p.name;
      saveProfile(p);
      renderProfileChrome();
      if (S.updateTopbarForView && S.state) S.updateTopbarForView(S.state.activeView || "welcome");
      var msg = el("settingsProfileMsg");
      if (msg) { msg.textContent = "Perfil guardado."; setTimeout(function () { if (msg) msg.textContent = ""; }, 2500); }
    });

    // Export / import / logout de Configuracion (reusan los botones ya cableados)
    el("settingsExport")?.addEventListener("click", function () { try { S.exportNexusData(); } catch (e) {} });
    el("settingsImport")?.addEventListener("click", function () { S.elements?.importButton?.click(); });
    el("settingsLogout")?.addEventListener("click", triggerLogout);
    // Cerrar sesion desde el menu de perfil (su [data-logout] no lo cablea app.js)
    document.querySelector("#profilePop [data-logout]")?.addEventListener("click", triggerLogout);

    // Topbar: campana / perfil / ayuda
    el("notifBell")?.addEventListener("click", function () { togglePop("notifPop", el("notifBell")); });
    el("profileChip")?.addEventListener("click", function () { togglePop("profilePop", el("profileChip")); });
    el("sideUser")?.addEventListener("click", function () { if (S.setView) S.setView("settings"); });
    el("helpBtn")?.addEventListener("click", function () { ensureHelpPop(); togglePop("helpPop", el("helpBtn")); });
    // Mobile: la hamburguesa de la topbar abre la hoja "Mas" (perfil/respaldo/sesion).
    el("mMenuBtn")?.addEventListener("click", function () { document.querySelector("#moduleNav [data-more]")?.click(); });

    // Cerrar popovers al elegir una opcion, con la X, click afuera o Escape
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-pop-close]")) { closePops(null); return; }
      if (e.target.closest("[data-notif-sale]")) { closePops(null); if (S.setView) S.setView("ventas"); return; }
      if (e.target.closest("#profilePop [data-view], #profilePop [data-avatar-pick]")) { closePops(null); return; }
      var inTop = e.target.closest(".topbar-pop, #notifBell, #profileChip, #helpBtn");
      if (!inTop) closePops(null);
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closePops(null); var sr = el("globalSearchResults"); if (sr) sr.hidden = true; } });

    // Buscador
    var search = el("globalSearch");
    if (search) {
      search.addEventListener("input", function () { renderSearch(search.value); });
      search.addEventListener("focus", function () { if (search.value) renderSearch(search.value); });
    }
    el("globalSearchResults")?.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-search-view]");
      if (!btn) return;
      if (S.setView) S.setView(btn.getAttribute("data-search-view"));
      if (search) search.value = "";
      el("globalSearchResults").hidden = true;
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".topbar-search")) { var sr = el("globalSearchResults"); if (sr) sr.hidden = true; }
    });

    S.initHome?.();
    renderProfileChrome();
    updateNotifDot();
  }

  Object.assign(S, { initShell: initShell, renderProfileChrome: renderProfileChrome, renderSettings: renderSettings, updateNotifDot: updateNotifDot, profileName: profileName });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initShell);
  else initShell();
})();
