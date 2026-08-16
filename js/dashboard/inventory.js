/* ============================================================
   NEXUS · Inventario central de Mercado Libre (Fase 1 + 2)
   ------------------------------------------------------------
   Fuente de verdad del stock FISICO. El titular cambia el stock de un producto
   UNA vez y Nexus propaga a todas las publicaciones que lo usan.

   Capas (punto 19): INVENTARIO CENTRAL (products) -> MOTOR DE REGLAS
   (compositions + calc MIN/floor) -> CONECTOR ML (invPutMLStock).
   Persistencia server-side en Firestore (funcion ml-inventory), separada de
   nexusData para que el navegador no la pise (Fase 3 la mutara transaccional).
   ============================================================ */
(function () {
  const S = window.NexusDash;
  const { elements, escapeHtml, integerNumber } = S;

  var inv = { products: {}, compositions: {}, listingState: {}, syncLog: [] };
  var cargado = false;
  var catalogo = {};      // mlbId -> { title }  (publicaciones de ML)
  var catalogoCargado = false;
  var composeSel = "";    // publicacion en edicion de composicion
  var composeVar = "";    // sabor/variación en edición ("" = composición simple)
  var invExpanded = {};   // mlbId -> desplegado (mostrar sus variantes) en la lista
  var serverStock = {};   // Fase 4: stock por producto tal como se cargó del servidor
                          // (baseline para el merge 3-way al guardar).
  var currentTab = "productos"; // pestaña activa: "productos" | "publicaciones"
  var tabTocado = false;        // el usuario ya eligió pestaña (no forzar default)
  var refreshTimer = null;      // intervalo de auto-actualización (mientras se ve la sección)
  var refrescando = false;      // evita solapar refrescos si uno tarda
  var REFRESH_MS = 90000;       // cada 90s: trae publicaciones nuevas + stock de ML

  // Cambia de pestaña dentro del panel de Inventario (Lista de productos /
  // Publicaciones y enlaces). Es lo que separa CREAR productos de ENLAZARLOS.
  function invTab(tab, porUsuario) {
    currentTab = tab === "publicaciones" ? "publicaciones" : "productos";
    if (porUsuario) tabTocado = true;
    var panel = elements.invPanel;
    if (!panel) return;
    panel.querySelectorAll("[data-inv-view]").forEach(function (v) {
      v.classList.toggle("is-hidden", v.getAttribute("data-inv-view") !== currentTab);
    });
    panel.querySelectorAll("[data-inv-tab]").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-inv-tab") === currentTab);
    });
  }

  function activeML() { return S.state.commerce.selectedApp || S.state.commerce.activeApp || "mercadolibre"; }
  function dormir(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function snapshotServerStock() {
    serverStock = {};
    Object.keys(inv.products).forEach(function (id) { serverStock[id] = Number(inv.products[id].stock) || 0; });
  }
  function adoptInv(o) {
    inv = {
      products: (o && o.products) || {}, compositions: (o && o.compositions) || {},
      listingAccounts: (o && o.listingAccounts) || {},
      listingState: (o && o.listingState) || {}, syncLog: (o && Array.isArray(o.syncLog)) ? o.syncLog : []
    };
    snapshotServerStock();
  }

  // Registra a qué cuenta pertenece cada publicación configurada (para el sync
  // multi-cuenta), tomándolo del catálogo ya cargado. Se llama antes de guardar.
  function tagearCuentas() {
    Object.keys(inv.compositions).forEach(function (k) {
      var mlbId = String(k).split("::")[0];
      if (!inv.listingAccounts[mlbId] && catalogo[mlbId] && catalogo[mlbId].account) {
        inv.listingAccounts[mlbId] = catalogo[mlbId].account;
      }
    });
  }

  // ---- Persistencia ----
  async function invLoad() {
    var res = await S.requireSecureApi().inventory("get");
    adoptInv((res && res.inventory) || {});
    cargado = true;
  }
  // Fase 4: guardado con merge server-side. Manda cada producto con su baseStock
  // (lo que valía al cargar) para que el servidor sepa cuáles tocó el usuario y
  // cuáles preservar (posible descuento por venta). Adopta el inv ya fusionado.
  async function invSave() {
    tagearCuentas();
    var productos = {};
    Object.keys(inv.products).forEach(function (id) {
      var p = inv.products[id];
      productos[id] = {
        sku: p.sku || "", name: p.name || "", stock: Number(p.stock) || 0,
        baseStock: Object.prototype.hasOwnProperty.call(serverStock, id) ? serverStock[id] : null
      };
    });
    var res = await S.requireSecureApi().inventory("save", {
      products: productos, compositions: inv.compositions, listingAccounts: inv.listingAccounts,
      listingState: inv.listingState, syncLog: inv.syncLog
    });
    if (res && res.inventory) adoptInv(res.inventory); // reflejar el estado real fusionado
  }

  // ---- Motor de reglas (con soporte de sabores/variaciones) ----
  // Composición simple: clave "MLB123". Por sabor: "MLB123::<varId>".
  function compKey(mlbId, varId) { return (varId != null && varId !== "") ? (mlbId + "::" + varId) : String(mlbId); }
  function computeComp(comp) {
    if (!comp || !comp.length) return null;
    var min = Infinity;
    for (var i = 0; i < comp.length; i++) {
      var p = inv.products[comp[i].productId];
      var qty = Number(comp[i].qty) || 1;
      if (!p || qty <= 0) return 0;
      var posibles = Math.floor((Number(p.stock) || 0) / qty);
      if (posibles < min) min = posibles;
    }
    return min === Infinity ? null : Math.max(0, min);
  }
  // Composición aplicable a un sabor (con fallback a la de la publicación entera).
  function compFor(mlbId, varId) {
    var c = inv.compositions;
    if (varId != null && varId !== "") {
      var k = compKey(mlbId, varId);
      if (Array.isArray(c[k]) && c[k].length) return c[k];
    }
    return (Array.isArray(c[mlbId]) && c[mlbId].length) ? c[mlbId] : null;
  }
  function computeVariation(mlbId, varId) { return computeComp(compFor(mlbId, varId)); }
  // Stock a MOSTRAR: suma de sabores configurados, o el de la composición simple.
  function computeListing(mlbId) {
    var c = inv.compositions, pref = mlbId + "::";
    var varKeys = Object.keys(c).filter(function (k) { return k.indexOf(pref) === 0; });
    if (varKeys.length) {
      var total = 0, algo = false;
      varKeys.forEach(function (k) { var v = computeComp(c[k]); if (v != null) { total += v; algo = true; } });
      return algo ? total : null;
    }
    return Array.isArray(c[mlbId]) ? computeComp(c[mlbId]) : null;
  }
  // Claves de composición (simple + por sabor) de una publicación.
  function compKeysDe(mlbId) {
    var pref = mlbId + "::";
    return Object.keys(inv.compositions).filter(function (k) { return k === mlbId || k.indexOf(pref) === 0; });
  }
  function listingsDeProducto(productId) {
    var set = {};
    Object.keys(inv.compositions).forEach(function (key) {
      if ((inv.compositions[key] || []).some(function (c) { return c.productId === productId; })) set[String(key).split("::")[0]] = true;
    });
    return Object.keys(set);
  }
  function nuevoProductId() {
    var n = 1;
    while (inv.products["PROD-" + String(n).padStart(6, "0")]) n++;
    return "PROD-" + String(n).padStart(6, "0");
  }
  function tituloListing(mlbId) { return (catalogo[mlbId] && catalogo[mlbId].title) || mlbId; }
  function variacionesDe(mlbId) { return (catalogo[mlbId] && catalogo[mlbId].variations) || []; }
  function varLabel(mlbId, varId) {
    var vs = variacionesDe(mlbId);
    for (var i = 0; i < vs.length; i++) if (String(vs[i].id) === String(varId)) return vs[i].label;
    return "Sabor " + varId;
  }
  function compArrTexto(comp) {
    return (comp || []).map(function (c) {
      var p = inv.products[c.productId];
      return (p ? (p.name || p.sku || c.productId) : c.productId) + " ×" + (Number(c.qty) || 1);
    }).join(" · ");
  }
  function resumenComposicion(mlbId) {
    var c = inv.compositions, pref = mlbId + "::";
    var varKeys = Object.keys(c).filter(function (k) { return k.indexOf(pref) === 0; });
    if (varKeys.length) {
      return varKeys.map(function (k) {
        return varLabel(mlbId, k.slice(pref.length)) + ": " + compArrTexto(c[k]);
      }).join(" · ");
    }
    return (Array.isArray(c[mlbId]) && c[mlbId].length) ? compArrTexto(c[mlbId]) : "";
  }
  function logSync(entry) {
    inv.syncLog.unshift(Object.assign({ ts: new Date().toISOString() }, entry));
    if (inv.syncLog.length > 200) inv.syncLog.length = 200;
  }

  // ---- Conector ML: sincroniza UNA publicación (por variación si tiene sabores) ----
  // Devuelve el total publicado (suma de sabores gestionados), o null si nada.
  function cuentaDe(mlbId) {
    return inv.listingAccounts[mlbId] || (catalogo[mlbId] && catalogo[mlbId].account) || activeML();
  }
  async function invSyncOne(mlbId) {
    var api = S.requireSecureApi(), cuenta = cuentaDe(mlbId); // multi-cuenta: cada anuncio con SU token
    var det = await api.mlApi("/items/" + mlbId + "?attributes=id,variations", "GET", null, cuenta);
    var vars = (det.payload || {}).variations || [];
    var body, total;
    if (vars.length) {
      var varsBody = []; total = 0;
      vars.forEach(function (v) {
        var c = computeVariation(mlbId, v.id);
        if (c != null) { varsBody.push({ id: v.id, available_quantity: c }); total += c; }
      });
      if (!varsBody.length) return null;   // ninguna variación gestionada
      body = { variations: varsBody };
    } else {
      var cs = computeVariation(mlbId, null);
      if (cs == null) return null;
      body = { available_quantity: cs }; total = cs;
    }
    await api.mlApi("/items/" + mlbId, "PUT", body, cuenta);
    return total;
  }

  async function invSyncListings(mlbIds, motivo) {
    var cambiadas = 0, errores = 0;
    for (var i = 0; i < mlbIds.length; i++) {
      var mlbId = mlbIds[i];
      var computedApprox = computeListing(mlbId);
      if (computedApprox == null) continue;
      var st = inv.listingState[mlbId] || {};
      if (st.published === computedApprox && st.status === "synced") continue;
      try {
        var publicado = await invSyncOne(mlbId);
        if (publicado == null) continue;
        inv.listingState[mlbId] = { computed: publicado, published: publicado, status: "synced", lastSyncAt: new Date().toISOString(), error: null };
        logSync({ listing: mlbId, antes: st.published != null ? st.published : "—", despues: publicado, motivo: motivo, resultado: "ok" });
        cambiadas++;
      } catch (e) {
        inv.listingState[mlbId] = Object.assign({}, st, { computed: computedApprox, status: "error", lastSyncAt: new Date().toISOString(), error: (e && e.message) || "error" });
        logSync({ listing: mlbId, antes: st.published != null ? st.published : "—", despues: computedApprox, motivo: motivo, resultado: "error", error: (e && e.message) || "error" });
        errores++;
      }
      await dormir(120);
    }
    return { cambiadas: cambiadas, errores: errores };
  }

  function setInvMsg(txt, tipo) {
    if (!elements.invMessage) return;
    elements.invMessage.textContent = txt || "";
    elements.invMessage.className = "meta-message" + (tipo ? " is-" + tipo : "");
  }

  // Cuentas de ML del inventario: todas las conectadas que comparten tarjeta con la
  // activa (ML1 + ML2 de Uruguay). Comparten la MISMA tabla de stock.
  function cuentasMLDelInventario() {
    var activa = activeML();
    var hermanas = (S.mlAccountsFor ? S.mlAccountsFor(activa) : null) || [{ id: activa }];
    var ids = hermanas.map(function (a) { return a.id; }).filter(function (id) {
      try { return S.getCommerceConfig(id).hasToken; } catch (e) { return id === activa; }
    });
    return ids.length ? ids : [activa];
  }

  // ---- Catalogo de publicaciones de ML (de TODAS las cuentas del inventario) ----
  // Cache LOCAL del catálogo (clave SIN prefijo nexus → no sincroniza a Firestore).
  // Al entrar se pinta al instante desde cache y se refresca en segundo plano.
  var CATALOGO_CACHE_KEY = "nx_inv_catalogo_v1";
  function cargarCatalogoCache() {
    try {
      var raw = localStorage.getItem(CATALOGO_CACHE_KEY);
      if (!raw) return false;
      var obj = JSON.parse(raw);
      if (obj && typeof obj === "object") { catalogo = obj; return Object.keys(obj).length > 0; }
    } catch (e) {}
    return false;
  }
  function guardarCatalogoCache() { try { localStorage.setItem(CATALOGO_CACHE_KEY, JSON.stringify(catalogo)); } catch (e) {} }
  // Mejor URL de foto (https forzado + fallback a pictures).
  function thumbURL(b) {
    if (!b) return "";
    var t = b.secure_thumbnail || b.thumbnail || "";
    if (!t && b.pictures && b.pictures[0]) t = b.pictures[0].secure_url || b.pictures[0].url || "";
    if (t && t.indexOf("http://") === 0) t = "https://" + t.slice(7);
    return t;
  }

  async function cargarCatalogo() {
    var api = S.requireSecureApi();
    var cuentas = cuentasMLDelInventario();
    // Cuentas en paralelo (cada una hace sus lotes en paralelo también).
    await Promise.all(cuentas.map(function (c) { return cargarCatalogoCuenta(api, c).catch(function () {}); }));
    catalogoCargado = true;
    guardarCatalogoCache();
  }

  async function cargarCatalogoCuenta(api, cuenta) {
    var me = await api.mlApi("/users/me", "GET", null, cuenta);
    var userId = (me.payload || {}).id;
    var ids = [], offset = 0;
    for (var pg = 0; pg < 6; pg++) {
      var r = await api.mlApi("/users/" + userId + "/items/search?limit=50&offset=" + offset, "GET", null, cuenta);
      var res = r.payload || {}, lote = res.results || [];
      ids = ids.concat(lote);
      var total = (res.paging && res.paging.total) || ids.length;
      offset += 50;
      if (!lote.length || offset >= total) break;
    }
    // Lotes de 20 ids en PARALELO (cap 6 concurrentes), SIN sleeps. Se repinta por
    // tanda (render incremental) para que las fotos aparezcan apenas llegan.
    var batches = [];
    for (var i = 0; i < ids.length; i += 20) batches.push(ids.slice(i, i + 20));
    function procesar(det) {
      (det && det.payload || []).forEach(function (row) {
        var b = row && row.body ? row.body : (row && row.id ? row : null); if (!b || !b.id) return;
        var vars = b.variations || [];
        var stockML = vars.length
          ? vars.reduce(function (s, v) { return s + (Number(v.available_quantity) || 0); }, 0)
          : (Number(b.available_quantity) || 0);
        var variaciones = vars.map(function (v) {
          var et = (v.attribute_combinations || []).map(function (a) { return a.value_name; }).filter(Boolean).join(" / ");
          return { id: String(v.id), label: et || ("Sabor " + v.id), stock: Number(v.available_quantity) || 0 };
        });
        catalogo[b.id] = { title: b.title || b.id, stock: stockML, thumbnail: thumbURL(b), variations: variaciones, account: cuenta };
      });
    }
    for (var g = 0; g < batches.length; g += 6) {
      await Promise.all(batches.slice(g, g + 6).map(function (lote) {
        return api.mlApi("/items?ids=" + lote.join(",") + "&attributes=id,title,available_quantity,variations,secure_thumbnail,thumbnail,pictures", "GET", null, cuenta)
          .then(procesar).catch(function () {});
      }));
      renderListings();          // incremental: cada tanda muestra sus fotos
      guardarCatalogoCache();    // ir persistiendo lo traído
    }
    catalogoCargado = true;
  }

  // Auto-carga del catálogo al entrar (sin tocar el botón). Silencioso: si falla,
  // el botón "Cargar publicaciones de ML" sigue disponible como respaldo.
  async function cargarCatalogoAuto() {
    try {
      // 1) Pintar YA desde el cache local (fotos al instante en la re-entrada).
      var hayCache = cargarCatalogoCache();
      if (hayCache) { renderListings(); setInvMsg(""); }
      else if (!catalogoCargado) setInvMsg("Cargando publicaciones de Mercado Libre…");
      // 2) Refrescar desde ML en segundo plano (repinta por tanda).
      await cargarCatalogo();
      renderListings();
      setInvMsg("");
    } catch (e) { /* queda el estado vacío + botón manual */ }
  }

  // Auto-refresh mientras se ve la sección: trae publicaciones nuevas y el stock
  // actual de ML. Reflejar ventas (recargar el blob) SOLO si el usuario no está
  // editando productos ni una composición, para no pisar cambios en curso.
  function iniciarInvTiempoReal() {
    if (refreshTimer) return;
    refreshTimer = setInterval(invRefreshTick, REFRESH_MS);
  }
  function detenerInvTiempoReal() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }
  async function invRefreshTick() {
    if (refrescando) return;
    if (typeof document !== "undefined" && document.hidden) return; // en segundo plano: no gastar API
    refrescando = true;
    var seguro = currentTab !== "productos" && !composeSel; // no hay edición en curso
    try {
      if (seguro) { try { await invLoad(); } catch (e) {} } // refleja ventas/descuentos
      await cargarCatalogo();
      renderListings();
      if (seguro) { renderProductos(); renderLog(); }
    } catch (e) { /* silencioso: es un refresco de fondo */ }
    finally { refrescando = false; }
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function renderInventory() { renderProductos(); renderListings(); renderCompose(); renderLog(); }

  function renderProductos() {
    if (!elements.invProdBody) return;
    var ids = Object.keys(inv.products);
    elements.invProdEmpty?.classList.toggle("is-visible", !ids.length);
    elements.invProdBody.innerHTML = ids.map(function (id) {
      var p = inv.products[id];
      return "<tr data-prod='" + escapeHtml(id) + "'>" +
        "<td><input class='inv-in' data-f='sku' value='" + escapeHtml(p.sku || "") + "' placeholder='SKU (opcional)' /></td>" +
        "<td><input class='inv-in' data-f='name' value='" + escapeHtml(p.name || "") + "' placeholder='Ej: Creatina 1kg Growth' /></td>" +
        "<td class='num'><input class='inv-in inv-stock' data-f='stock' inputmode='numeric' value='" + escapeHtml(String(p.stock != null ? p.stock : 0)) + "' /></td>" +
        "<td class='num'>" + listingsDeProducto(id).length + "</td>" +
        "<td><button class='table-action delete-action' type='button' data-inv-del='" + escapeHtml(id) + "'>Borrar</button></td>" +
      "</tr>";
    }).join("");
  }

  function renderListings() {
    if (!elements.invListingBody) return;
    // Mostrar: las que ya tienen composicion + (si se cargo el catalogo) todas las
    // del catalogo. Las claves de composición pueden ser por sabor ("MLB::var"):
    // se colapsan al id base de la publicación.
    var set = {};
    Object.keys(inv.compositions).forEach(function (m) { set[String(m).split("::")[0]] = true; });
    Object.keys(catalogo).forEach(function (m) { set[m] = true; });
    var mlbIds = Object.keys(set);
    elements.invListingEmpty?.classList.toggle("is-visible", !mlbIds.length);
    var html = "";
    mlbIds.forEach(function (mlbId) {
      var st = inv.listingState[mlbId] || {};
      var cat = catalogo[mlbId] || {};
      var vars = variacionesDe(mlbId);
      // "Stock ML" = lo que hay AHORA en Mercado Libre (o el de la última carga).
      var stockML = st.published != null ? st.published : (cat.stock != null ? cat.stock : null);
      var foto = cat.thumbnail
        ? "<img class='order-thumb' src='" + escapeHtml(cat.thumbnail) + "' alt='' loading='lazy' onerror=\"this.style.display='none'\" />"
        : "<span class='order-thumb order-thumb-empty' aria-hidden='true'></span>";
      var accId = inv.listingAccounts[mlbId] || cat.account || "";
      var accName = accId && S.mlAccountById ? (S.mlAccountById(accId) || {}).name : "";
      var accBadge = accName ? " <span class='inv-acct-badge'>" + escapeHtml(accName) + "</span>" : "";

      if (vars.length) {
        // Publicación CON sabores/variaciones: fila padre expandible.
        var exp = !!invExpanded[mlbId];
        var computed = computeListing(mlbId);
        var arrow = "<button class='inv-expand' type='button' data-inv-expand='" + escapeHtml(mlbId) + "' aria-expanded='" + exp + "' aria-label='Ver variantes'>" +
          "<svg viewBox='0 0 24 24' width='13' height='13' fill='none' stroke='currentColor' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='M9 6l6 6-6 6'/></svg></button>";
        html += "<tr class='inv-parent" + (exp ? " is-open" : "") + "'>" +
          "<td class='order-product'><div class='order-product-cell'>" + arrow + foto +
            "<div class='order-product-info'><b>" + escapeHtml(tituloListing(mlbId)) + "</b>" +
            "<small class='order-stock'>" + escapeHtml(mlbId) + accBadge + "</small></div></div></td>" +
          "<td><span class='pub-quiet'>" + vars.length + " variantes</span></td>" +
          "<td class='num'>" + (computed == null ? "—" : integerNumber.format(computed)) + "</td>" +
          "<td class='num'>" + (stockML != null ? integerNumber.format(stockML) : "—") + "</td>" +
          "<td>" + estadoPill(st.status, resumenComposicion(mlbId), st.error) + "</td>" +
          "<td></td>" +
        "</tr>";
        if (exp) {
          vars.forEach(function (v) {
            var propia = inv.compositions[compKey(mlbId, v.id)];
            var resumenV = (propia && propia.length) ? compArrTexto(propia) : "";
            var compV = computeVariation(mlbId, v.id);
            html += "<tr class='inv-var-row'>" +
              "<td class='order-product'><div class='order-product-cell inv-var-cell'><span class='inv-var-dot' aria-hidden='true'></span>" +
                "<div class='order-product-info'><b>" + escapeHtml(v.label) + "</b>" +
                (v.stock != null ? "<small class='order-stock'>Stock ML: " + integerNumber.format(v.stock) + "</small>" : "") + "</div></div></td>" +
              "<td>" + (resumenV ? escapeHtml(resumenV) : "<span class='pub-quiet'>Sin configurar</span>") + "</td>" +
              "<td class='num'>" + (compV == null ? "—" : integerNumber.format(compV)) + "</td>" +
              "<td class='num'>—</td>" +
              "<td></td>" +
              "<td><button class='table-action' type='button' data-inv-config='" + escapeHtml(mlbId) + "' data-inv-var='" + escapeHtml(String(v.id)) + "'>Configurar</button></td>" +
            "</tr>";
          });
        }
      } else {
        // Publicación SIN variantes: fila simple.
        var computed2 = computeListing(mlbId);
        var resumen = resumenComposicion(mlbId);
        html += "<tr>" +
          "<td class='order-product'><div class='order-product-cell'><span class='inv-expand-spacer' aria-hidden='true'></span>" + foto +
            "<div class='order-product-info'><b>" + escapeHtml(tituloListing(mlbId)) + "</b>" +
            "<small class='order-stock'>" + escapeHtml(mlbId) + accBadge + "</small></div></div></td>" +
          "<td>" + (resumen ? escapeHtml(resumen) : "<span class='pub-quiet'>Sin configurar</span>") + "</td>" +
          "<td class='num'>" + (computed2 == null ? "—" : integerNumber.format(computed2)) + "</td>" +
          "<td class='num'>" + (stockML != null ? integerNumber.format(stockML) : "—") + "</td>" +
          "<td>" + estadoPill(st.status, resumen, st.error) + "</td>" +
          "<td>" + (st.status === "error"
            ? "<button class='table-action' type='button' data-inv-retry='" + escapeHtml(mlbId) + "'>Reintentar</button>"
            : "<button class='table-action' type='button' data-inv-config='" + escapeHtml(mlbId) + "'>Configurar</button>") + "</td>" +
        "</tr>";
      }
    });
    elements.invListingBody.innerHTML = html;
  }
  function estadoPill(status, tieneComp, error) {
    if (!tieneComp) return '<span class="type-pill">—</span>';
    if (status === "synced") return '<span class="type-pill income">Sincronizado</span>';
    if (status === "error") return '<span class="type-pill expense" title="' + escapeHtml(error || "Error al sincronizar") + '">Error</span>';
    return '<span class="type-pill pub-warn">Pendiente</span>';
  }
  function listingsConError() {
    return Object.keys(inv.listingState).filter(function (m) { return (inv.listingState[m] || {}).status === "error"; });
  }

  function renderCompose() {
    if (!elements.invCompose) return;
    elements.invCompose.classList.toggle("is-hidden", !composeSel);
    if (!composeSel) return;
    if (elements.invComposeTitle) elements.invComposeTitle.textContent = "Composición · " + tituloListing(composeSel);
    // El botón global "+ Componente" se reemplaza por uno por bloque (cada sabor
    // o la composición simple tiene el suyo).
    if (elements.invComposeAdd) elements.invComposeAdd.style.display = "none";
    if (!elements.invComposeRows) return;

    var prodOpts = Object.keys(inv.products).map(function (id) {
      return { id: id, name: inv.products[id].name || inv.products[id].sku || id };
    });
    function rowHtml(varId, c, idx) {
      var sel = prodOpts.map(function (o) {
        return "<option value='" + escapeHtml(o.id) + "'" + (o.id === c.productId ? " selected" : "") + ">" + escapeHtml(o.name) + "</option>";
      }).join("");
      return "<div class='inv-comp-row' data-var='" + escapeHtml(String(varId)) + "' data-idx='" + idx + "'>" +
        "<select class='inv-comp-prod'>" + sel + "</select>" +
        "<input class='inv-comp-qty' type='text' inputmode='numeric' value='" + escapeHtml(String(Number(c.qty) || 1)) + "' />" +
        "<button class='table-action delete-action' type='button' data-comp-del='1' data-var='" + escapeHtml(String(varId)) + "' data-idx='" + idx + "'>Quitar</button>" +
      "</div>";
    }
    function blockHtml(varId, titulo, stockML) {
      var comp = inv.compositions[compKey(composeSel, varId)] || [];
      var rows = comp.map(function (c, idx) { return rowHtml(varId, c, idx); }).join("") || "<p class='pub-quiet'>Sin componentes.</p>";
      var head = titulo
        ? "<div class='inv-comp-flavor'><b>" + escapeHtml(titulo) + "</b>" + (stockML != null ? "<small>Stock ML: " + integerNumber.format(stockML) + "</small>" : "") + "</div>"
        : "";
      return "<div class='inv-comp-block' data-comp-block='" + escapeHtml(String(varId)) + "'>" + head + rows +
        "<button class='ghost-button inv-comp-add' type='button' data-comp-add='" + escapeHtml(String(varId)) + "'>+ Componente</button></div>";
    }

    var vars = variacionesDe(composeSel);
    if (vars.length && composeVar) {
      // Configurando UN sabor puntual (desde la lista desplegada).
      var v = null;
      for (var i = 0; i < vars.length; i++) { if (String(vars[i].id) === String(composeVar)) { v = vars[i]; break; } }
      var label = v ? v.label : composeVar;
      if (elements.invComposeTitle) elements.invComposeTitle.textContent = "Composición · " + tituloListing(composeSel) + " · " + label;
      elements.invComposeRows.innerHTML =
        "<p class='inv-hint'>Definí los productos físicos (y cuántos) que consume el sabor <b>" + escapeHtml(label) + "</b>.</p>" +
        blockHtml(composeVar, label, v ? v.stock : null);
    } else if (vars.length) {
      elements.invComposeRows.innerHTML =
        "<p class='inv-hint'>Esta publicación tiene <b>sabores/variaciones</b>: enlazá cada uno con su producto. Al vender un sabor, se descuenta ese.</p>" +
        vars.map(function (v) { return blockHtml(v.id, v.label, v.stock); }).join("");
    } else {
      elements.invComposeRows.innerHTML = blockHtml("", "", null);
    }
  }

  function renderLog() {
    if (!elements.invLog) return;
    var log = inv.syncLog || [];
    elements.invLog.innerHTML = log.length ? log.slice(0, 30).map(function (e) {
      var ok = e.resultado === "ok";
      return "<div class='inv-log-row'>" +
        "<span class='inv-log-when'>" + escapeHtml(String(e.ts).slice(0, 16).replace("T", " ")) + "</span>" +
        "<span class='inv-log-what'>" + escapeHtml(tituloListing(e.listing)) + " · " + escapeHtml(String(e.antes)) + "→" + escapeHtml(String(e.despues)) + "</span>" +
        "<span class='inv-log-why'>" + escapeHtml(e.motivo || "") + "</span>" +
        "<span class='" + (ok ? "inv-log-ok" : "inv-log-err") + "'>" + (ok ? "ok" : escapeHtml(e.error || "error")) + "</span>" +
      "</div>";
    }).join("") : "<p class='pub-quiet'>Sin sincronizaciones todavía.</p>";
  }

  // ============================================================
  //  ACCIONES (cableadas por app.js)
  // ============================================================
  function invAddProduct() {
    invTab("productos", true);         // asegura estar en la Lista de productos
    var id = nuevoProductId();
    inv.products[id] = { sku: "", name: "", stock: 0 };
    renderProductos();
    // Enfoca el campo Nombre de la fila nueva para escribir al toque.
    var fila = elements.invProdBody?.querySelector("tr[data-prod='" + id + "'] input[data-f='name']");
    if (fila) { fila.focus(); fila.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }

  // Lee los inputs de la tabla, guarda, y sincroniza las publicaciones de los
  // productos cuyo STOCK cambio (el corazon: cambiar stock una vez -> propagar).
  async function invGuardarProductos() {
    if (!elements.invProdBody) return;
    var filas = elements.invProdBody.querySelectorAll("tr[data-prod]");
    var cambiaronStock = [];
    filas.forEach(function (tr) {
      var id = tr.getAttribute("data-prod");
      var prev = inv.products[id] || { stock: 0 };
      var sku = (tr.querySelector("[data-f='sku']") || {}).value || "";
      var name = (tr.querySelector("[data-f='name']") || {}).value || "";
      var stock = Math.max(0, Math.floor(Number((tr.querySelector("[data-f='stock']") || {}).value) || 0));
      inv.products[id] = { sku: sku.trim(), name: name.trim(), stock: stock };
      if ((Number(prev.stock) || 0) !== stock) cambiaronStock.push(id);
    });
    setInvMsg("Guardando y sincronizando…");
    try {
      await invSave();
      // Publicaciones afectadas por los productos cuyo stock cambio (sin repetir).
      var afectadas = {};
      cambiaronStock.forEach(function (pid) { listingsDeProducto(pid).forEach(function (m) { afectadas[m] = true; }); });
      var r = await invSyncListings(Object.keys(afectadas), "Ajuste manual de stock");
      await invSave();
      setInvMsg("Guardado. " + r.cambiadas + " publicación(es) sincronizada(s)" + (r.errores ? ", " + r.errores + " con error." : "."), r.errores ? "error" : "success");
      renderInventory();
    } catch (e) { setInvMsg("Error al guardar/sincronizar: " + ((e && e.message) || "error"), "error"); }
  }

  function invDeleteProduct(id) {
    var p = inv.products[id]; if (!p) return;
    if (!window.confirm('¿Borrar "' + (p.name || id) + '" del inventario? (No toca Mercado Libre.)')) return;
    delete inv.products[id];
    invSave().then(function () { renderInventory(); });
  }

  async function invCargarPublicaciones() {
    setInvMsg("Cargando publicaciones de Mercado Libre…");
    try { await cargarCatalogo(); renderListings(); setInvMsg("Publicaciones cargadas.", "success"); }
    catch (e) { setInvMsg("No se pudieron cargar las publicaciones: " + ((e && e.message) || "error"), "error"); }
  }

  async function invResyncAll() {
    setInvMsg("Sincronizando todas las publicaciones con composición…");
    try {
      // Colapsar claves por sabor ("MLB::var") al id base, sin repetir.
      var bases = {};
      Object.keys(inv.compositions).forEach(function (k) { bases[String(k).split("::")[0]] = true; });
      var r = await invSyncListings(Object.keys(bases), "Sincronización manual (todas)");
      await invSave();
      setInvMsg(r.cambiadas + " sincronizada(s)" + (r.errores ? ", " + r.errores + " con error." : "."), r.errores ? "error" : "success");
      renderInventory();
    } catch (e) { setInvMsg("Error: " + ((e && e.message) || "error"), "error"); }
  }

  // Fase 4: reintento de una publicación cuyo PUT a ML quedó en error. invSyncListings
  // no la saltea (su estado no es "synced"), así que recalcula y reintenta el PUT.
  async function invReintentarUno(mlbId) {
    setInvMsg("Reintentando sincronización de la publicación…");
    try {
      var r = await invSyncListings([mlbId], "Reintento manual");
      await invSave();
      setInvMsg(r.errores ? "La publicación sigue con error." : "Publicación sincronizada.", r.errores ? "error" : "success");
      renderInventory();
    } catch (e) { setInvMsg("Error al reintentar: " + ((e && e.message) || "error"), "error"); }
  }

  function invConfigurar(mlbId, varId) { composeSel = mlbId; composeVar = varId || ""; renderCompose(); elements.invCompose?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  function invComposeCancelar() { composeSel = ""; composeVar = ""; renderCompose(); }
  function invToggleExpand(mlbId) { invExpanded[mlbId] = !invExpanded[mlbId]; renderListings(); }
  // Agrega un componente al bloque de un sabor (varId "" = composición simple).
  function invComposeAddComponent(varId) {
    if (!composeSel) return;
    var firstProd = Object.keys(inv.products)[0];
    if (!firstProd) { if (elements.invComposeMsg) { elements.invComposeMsg.textContent = "Primero creá productos en la pestaña “Lista de productos”."; elements.invComposeMsg.className = "meta-message is-error"; } return; }
    var k = compKey(composeSel, varId);
    var comp = inv.compositions[k] || [];
    comp.push({ productId: firstProd, qty: 1 });
    inv.compositions[k] = comp;
    renderCompose();
  }
  function invComposeQuitar(varId, idx) {
    if (!composeSel) return;
    var k = compKey(composeSel, varId);
    var comp = inv.compositions[k] || [];
    comp.splice(idx, 1);
    if (comp.length) inv.compositions[k] = comp; else delete inv.compositions[k];
    renderCompose();
  }
  async function invComposeGuardar() {
    if (!composeSel || !elements.invComposeRows) return;
    // Guardar SOLO los bloques presentes en el editor (cada uno = un sabor o la
    // composición simple). Así editar un sabor NO borra los otros que no se tocaron.
    var tocoVariante = false;
    elements.invComposeRows.querySelectorAll(".inv-comp-block").forEach(function (blk) {
      var varId = blk.getAttribute("data-comp-block") || "";
      var comp = [];
      blk.querySelectorAll(".inv-comp-row").forEach(function (r) {
        var pid = (r.querySelector(".inv-comp-prod") || {}).value;
        var qty = Math.max(1, Math.floor(Number((r.querySelector(".inv-comp-qty") || {}).value) || 1));
        if (pid) comp.push({ productId: pid, qty: qty });
      });
      var k = compKey(composeSel, varId);
      if (comp.length) inv.compositions[k] = comp; else delete inv.compositions[k];
      if (varId) tocoVariante = true;
    });
    // Si configuramos por sabor, borrar la base legacy a nivel publicación (no doble).
    if (tocoVariante) delete inv.compositions[composeSel];
    if (elements.invComposeMsg) { elements.invComposeMsg.textContent = "Guardando…"; elements.invComposeMsg.className = "meta-message"; }
    try {
      await invSave();
      if (elements.invComposeMsg) { elements.invComposeMsg.textContent = "Composición guardada."; elements.invComposeMsg.className = "meta-message is-success"; }
      renderInventory();
    } catch (e) { if (elements.invComposeMsg) { elements.invComposeMsg.textContent = "Error: " + ((e && e.message) || "error"); elements.invComposeMsg.className = "meta-message is-error"; } }
  }

  // Siempre recarga del servidor: las ventas (Fase 3) descuentan stock del lado
  // servidor, así que mostrar una copia vieja en memoria sería peligroso para una
  // herramienta de stock. Entrar a la sección o tocar "Actualizar" trae lo vigente.
  async function abrirInventario() {
    if (!elements.invPanel) return;
    if (composeSel) return; // no pisar un editor de composición abierto a medias
    setInvMsg("Cargando inventario…");
    try {
      await invLoad();
      renderInventory();
      // Primera vez: si todavía no hay productos, arrancá en "Lista de productos"
      // (el paso lógico inicial); si ya hay, en Publicaciones. Si el usuario ya
      // eligió pestaña, se respeta.
      if (!tabTocado) invTab(Object.keys(inv.products).length ? "publicaciones" : "productos");
      else invTab(currentTab);
      setInvMsg("");
      // Publicaciones automáticas: se cargan solas al entrar y se refrescan solas.
      cargarCatalogoAuto();
      iniciarInvTiempoReal();
    } catch (e) { setInvMsg("No se pudo cargar el inventario: " + ((e && e.message) || "error"), "error"); }
  }

  Object.assign(S, {
    abrirInventario, renderInventory, invTab, detenerInvTiempoReal,
    invAddProduct, invGuardarProductos, invDeleteProduct,
    invCargarPublicaciones, invResyncAll, invReintentarUno,
    invConfigurar, invComposeCancelar, invComposeAddComponent, invComposeQuitar, invComposeGuardar, invToggleExpand
  });
})();
