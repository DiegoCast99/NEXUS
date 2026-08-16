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

  // ---- Foto propia por marketplace (la que se muestra en el dashboard principal) ----
  var MKT_PHOTOS_KEY = "nexus.marketplacePhotos.v1";
  function getMktPhotos() { try { return JSON.parse(localStorage.getItem(MKT_PHOTOS_KEY)) || {}; } catch (e) { return {}; } }
  function saveMktPhotos(o) { try { S.safeSetItem(MKT_PHOTOS_KEY, JSON.stringify(o)); } catch (e) {} }
  function marketplacePhoto(id) { if (!id) return ""; return getMktPhotos()[id] || ""; }
  function setMarketplacePhoto(id, url) { if (!id) return; var o = getMktPhotos(); o[id] = url; saveMktPhotos(o); }
  function clearMarketplacePhotoId(id) { if (!id) return; var o = getMktPhotos(); delete o[id]; saveMktPhotos(o); }
  // Marketplace que se está viendo ahora en E-Commerce (ML1/ML2/ML Brasil/...).
  function activeMktId() { try { return S.activeMLId ? S.activeMLId() : ""; } catch (e) { return ""; } }
  // Sube y redimensiona (máx 240px, mantiene proporción, PNG para transparencia).
  function onMktPhotoFile(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || !/^image\//.test(file.type)) return;
    var id = activeMktId(); if (!id) return;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        try {
          var max = 240, scale = Math.min(1, max / Math.max(img.width, img.height));
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          setMarketplacePhoto(id, canvas.toDataURL("image/png"));
          renderMarketplacePhotoConfig();
          if (S.renderHome) S.renderHome();
        } catch (err) { /* canvas tainted / sin soporte */ }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  // Pinta el preview del panel de foto para el marketplace activo.
  function renderMarketplacePhotoConfig() {
    var prev = el("marketplacePhotoPreview");
    if (!prev) return;
    var url = marketplacePhoto(activeMktId());
    prev.innerHTML = url ? '<img src="' + esc(url) + '" alt="" />' : '<span class="mkt-photo-empty">Sin foto</span>';
    var clearBtn = el("marketplacePhotoClear");
    if (clearBtn) clearBtn.style.display = url ? "" : "none";
  }

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
    if (willOpen && id === "notifPop") { renderNotifs(); markNotifsSeen(); }
  }

  // ---- Notificaciones: ventas de TODAS las plataformas (ML1, ML2, ML Brasil,
  //      Amazon, etc. — todo lo que devuelva mlAccounts) ----
  var NOTIF_SEEN_KEY = "nexus.notifSeen.v1";
  function getNotifSeen() { try { return Number(localStorage.getItem(NOTIF_SEEN_KEY)) || 0; } catch (e) { return 0; } }
  function setNotifSeen(ts) { try { localStorage.setItem(NOTIF_SEEN_KEY, String(ts)); } catch (e) {} }

  function allSales() {
    var accounts = (S.mlAccounts && S.mlAccounts()) || [];
    var all = [];
    accounts.forEach(function (acc) {
      var snap = S.getCommerceSnapshot && S.getCommerceSnapshot(acc.id);
      (snap && snap.allOrders ? snap.allOrders : []).forEach(function (o) {
        all.push({ acc: acc.id, accName: acc.name, product: o.product, total: o.total, createdAt: o.createdAt || o.date, id: o.id, thumbnail: o.thumbnail || "", itemId: o.itemId || "" });
      });
    });
    all.sort(function (a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
    return all;
  }
  function recentSales() { return allSales().slice(0, 8); }

  var SALE_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l-1 11H7L6 8Z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>';
  function renderNotifs() {
    var box = el("notifPopBody");
    if (!box) return;
    var sales = recentSales();
    if (!sales.length) {
      box.innerHTML = '<div class="notif-empty">Todavía no hay ventas para mostrar. Cuando vendas en cualquier plataforma (Mercado Libre, Amazon...), aparece acá al instante.</div>';
      return;
    }
    box.innerHTML = sales.map(function (s) {
      var fecha = "";
      try { fecha = new Date(s.createdAt).toLocaleDateString("es-UY", { day: "2-digit", month: "short" }); } catch (e) {}
      var monto = "";
      try { monto = S.currency(Number(s.total) || 0); } catch (e) { monto = "$" + (s.total || 0); }
      // Foto del producto vendido montada sobre el tile naranja; si no hay/falla,
      // queda el icono de bolsa por detrás. Si el pedido no trae foto, se marca el
      // tile con su itemId para traerla después (cargarFotosNotif).
      var thumbAttr = s.itemId ? ' data-thumb-item="' + esc(s.itemId) + '" data-thumb-acc="' + esc(s.acc) + '"' : "";
      var media = '<span class="notif-ic"' + thumbAttr + '>' + SALE_IC +
        (s.thumbnail ? '<img class="notif-ic-img" src="' + esc(s.thumbnail) + '" alt="" loading="lazy" onerror="this.remove()"/>' : "") +
        '</span>';
      return '<button class="notif-item" type="button" data-notif-sale="ventas" data-notif-acc="' + esc(s.acc) + '" data-notif-order="' + esc(s.id) + '">' + media +
        '<span class="notif-main"><b>' + esc(s.product || "Venta") + " · " + monto + '</b>' +
        '<small>' + esc(s.accName) + (fecha ? " · " + esc(fecha) : "") + '</small></span></button>';
    }).join("");
    cargarFotosNotif(sales);
  }
  // Trae la foto (multiget ML) de las ventas que no la tienen y la inyecta en su
  // tile. Agrupa por cuenta. Así la campana muestra la foto aunque el pedido no
  // se haya enriquecido en la vista de E-Commerce.
  function cargarFotosNotif(sales) {
    if (!S.thumbsForItems) return;
    var porCuenta = {};
    sales.forEach(function (s) {
      if (s.thumbnail || !s.itemId || !s.acc) return;
      (porCuenta[s.acc] = porCuenta[s.acc] || []).push(String(s.itemId));
    });
    Object.keys(porCuenta).forEach(function (acc) {
      Promise.resolve(S.thumbsForItems(acc, porCuenta[acc])).then(function (map) {
        if (!map) return;
        var box = el("notifPopBody"); if (!box) return;
        Object.keys(map).forEach(function (itemId) {
          var url = map[itemId]; if (!url) return;
          var tile = box.querySelector('.notif-ic[data-thumb-item="' + itemId + '"]');
          if (tile && !tile.querySelector(".notif-ic-img")) {
            var img = document.createElement("img");
            img.className = "notif-ic-img"; img.alt = ""; img.loading = "lazy";
            img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
            img.src = url;
            tile.appendChild(img);
          }
        });
      }).catch(function () {});
    });
  }
  // Cantidad de ventas SIN VER (desde la última vez que abrió la campana). Si
  // nunca la abrió, cuenta las de los últimos 7 días para no arrancar en 0.
  function unseenCount() {
    var seen = getNotifSeen();
    var floor = seen || (Date.now() - 7 * 24 * 3600 * 1000);
    var n = 0;
    allSales().forEach(function (s) { var t = new Date(s.createdAt).getTime(); if (!isNaN(t) && t > floor) n += 1; });
    return n;
  }
  // Pinta el numerito de la campana (1, 2, 3... 9+).
  function updateNotifDot() {
    var badge = el("notifDot");
    if (!badge) return;
    var n = unseenCount();
    if (n > 0) { badge.hidden = false; badge.textContent = n > 9 ? "9+" : String(n); }
    else { badge.hidden = true; badge.textContent = ""; }
  }
  function markNotifsSeen() { setNotifSeen(Date.now()); updateNotifDot(); }

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

    // Foto propia del marketplace (dentro de Configuración de cada negocio).
    el("marketplacePhotoInput")?.addEventListener("change", onMktPhotoFile);
    el("marketplacePhotoUpload")?.addEventListener("click", function () { el("marketplacePhotoInput")?.click(); });
    el("marketplacePhotoClear")?.addEventListener("click", function () {
      var id = activeMktId(); if (!id) return;
      clearMarketplacePhotoId(id); renderMarketplacePhotoConfig();
      if (S.renderHome) S.renderHome();
    });
    el("diagFotosBtn")?.addEventListener("click", function () { if (S.diagnosticarFotos) S.diagnosticarFotos(); });
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
      var saleBtn = e.target.closest("[data-notif-sale]");
      if (saleBtn) {
        var acc = saleBtn.getAttribute("data-notif-acc");
        var orderId = saleBtn.getAttribute("data-notif-order");
        closePops(null);
        if (acc && orderId && S.openSaleDeepLink) {
          // Igual que el push: splash breve → E-Commerce → detalle de ESA venta
          // (instantáneo si ya está en el snapshot; si no, trae solo esa orden).
          try { document.documentElement.classList.add("booting-sale"); } catch (e2) {}
          if (S.setView) S.setView("ecommerce", false);
          S.openSaleDeepLink(acc, orderId);
        } else if (S.setView) {
          S.setView("ecommerce");
        }
        return;
      }
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

  Object.assign(S, { initShell: initShell, renderProfileChrome: renderProfileChrome, renderSettings: renderSettings, updateNotifDot: updateNotifDot, profileName: profileName, marketplacePhoto: marketplacePhoto, renderMarketplacePhotoConfig: renderMarketplacePhotoConfig });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initShell);
  else initShell();
})();
