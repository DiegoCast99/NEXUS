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
  var invExpanded = {};   // mlbId -> desplegado (variantes NATIVAS de ML de esa publicación)
  var famExpanded = {};   // baseKey -> desplegado (FAMILIA de publicaciones sueltas por sabor)
  var listFilter = "all"; // filtro del listado: "all" | "synced" | "unsynced"
  var stockFilter = "all"; // filtro de la Lista de productos: "all" | "out" | "low" (lo activa "Requiere atención")
  var compFiltro = "";    // filtro por COMPONENTE: productId → solo publicaciones que lo usan ("" = todas)
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
    // Las acciones "Cargar publicaciones / Sincronizar todo" solo aplican a la
    // pestaña Publicaciones: se muestran/ocultan según la pestaña activa.
    var acts = panel.querySelector("#invPubActions");
    if (acts) acts.classList.toggle("is-hidden", currentTab !== "publicaciones");
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
    // Pedimos tambien status/sub_status: regla de negocio -> si la publicacion tiene
    // stock, debe estar ACTIVA. Cuando ML la pauso por quedarse sin stock (o el vendedor
    // la pauso a mano), al reponer stock la reactivamos (ver mas abajo).
    var det = await api.mlApi("/items/" + mlbId + "?attributes=id,status,sub_status,variations", "GET", null, cuenta);
    var payload = det.payload || {};
    var vars = payload.variations || [];
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

    // Reactivar: SOLO si hay stock (>0) y la publicacion esta "paused". Otros estados
    // (closed / under_review / inactive) NO se fuerzan a activo (ML los rechazaria).
    // Es best-effort: si la reactivacion falla, el stock igual quedo sincronizado, asi
    // que no rompemos el sync; se registra en el log para que se vea.
    var reactivada = null;
    if (total > 0 && payload.status === "paused") {
      try {
        await api.mlApi("/items/" + mlbId, "PUT", { status: "active" }, cuenta);
        reactivada = true;
      } catch (e) {
        reactivada = false;
        console.warn("[inventario] " + mlbId + ": stock sincronizado pero no se pudo reactivar:", (e && e.message) || e);
      }
    }
    return { total: total, reactivada: reactivada };
  }

  async function invSyncListings(mlbIds, motivo) {
    var cambiadas = 0, errores = 0, reactivadas = 0;
    for (var i = 0; i < mlbIds.length; i++) {
      var mlbId = mlbIds[i];
      var computedApprox = computeListing(mlbId);
      if (computedApprox == null) continue;
      var st = inv.listingState[mlbId] || {};
      if (st.published === computedApprox && st.status === "synced") continue;
      try {
        var res = await invSyncOne(mlbId);
        if (res == null) continue;
        var publicado = res.total;
        inv.listingState[mlbId] = { computed: publicado, published: publicado, status: "synced", lastSyncAt: new Date().toISOString(), error: null };
        logSync({ listing: mlbId, antes: st.published != null ? st.published : "—", despues: publicado, motivo: motivo, resultado: "ok", reactivada: res.reactivada });
        cambiadas++;
        if (res.reactivada === true) reactivadas++;
      } catch (e) {
        inv.listingState[mlbId] = Object.assign({}, st, { computed: computedApprox, status: "error", lastSyncAt: new Date().toISOString(), error: (e && e.message) || "error" });
        logSync({ listing: mlbId, antes: st.published != null ? st.published : "—", despues: computedApprox, motivo: motivo, resultado: "error", error: (e && e.message) || "error" });
        errores++;
      }
      await dormir(120);
    }
    return { cambiadas: cambiadas, errores: errores, reactivadas: reactivadas };
  }

  function setInvMsg(txt, tipo) {
    if (!elements.invMessage) return;
    elements.invMessage.textContent = txt || "";
    elements.invMessage.className = "meta-message" + (tipo ? " is-" + tipo : "");
  }

  // Cuentas de ML del inventario: TODAS las cuentas de Mercado Libre conectadas
  // (ML1 + ML2 de Uruguay + Mercado Livre Brasil). Es un inventario CENTRAL: el
  // mismo stock físico controla las publicaciones de todas las cuentas. Las de
  // Brasil (ids MLB...) no colisionan con las de Uruguay (MLU...), y cada anuncio
  // guarda su cuenta (catalogo[mlbId].account) para sincronizar con SU token.
  function cuentasMLDelInventario() {
    var activa = activeML();
    var todas = (S.mlAccounts ? S.mlAccounts() : null) || [{ id: activa }];
    var ids = todas.map(function (a) { return a.id; }).filter(function (id) {
      try { return S.getCommerceConfig(id).hasToken; } catch (e) { return id === activa; }
    });
    return ids.length ? ids : [activa];
  }
  // Cuenta a la que pertenece una publicación (para filtrar por cuenta en la tabla).
  function cuentaDeListing(mlbId) {
    return inv.listingAccounts[mlbId] || (catalogo[mlbId] && catalogo[mlbId].account) || "";
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
    var candidatosVar = {};   // ids con variantes que el multiget NO trajo -> backfill por item
    function procesar(det) {
      (det && det.payload || []).forEach(function (row) {
        var b = row && row.body ? row.body : (row && row.id ? row : null); if (!b || !b.id) return;
        var variaciones = mapVariacionesML(b.variations || []);
        var prev = catalogo[b.id];
        // No perder variantes ya conocidas por una respuesta degradada del multiget
        // (ML a veces omite el array `variations` en el multiget): si antes tenía y
        // ahora vino vacío, se conservan las de antes.
        if (!variaciones.length && prev && prev.variations && prev.variations.length) {
          variaciones = prev.variations;
        }
        var stockML = variaciones.length
          ? variaciones.reduce(function (s, v) { return s + (Number(v.stock) || 0); }, 0)
          : (Number(b.available_quantity) || 0);
        catalogo[b.id] = {
          title: b.title || b.id, stock: stockML, thumbnail: thumbURL(b),
          variations: variaciones, account: cuenta, novar: prev && prev.novar
        };
        // Señal de ML: las publicaciones CON variantes traen available_quantity nulo
        // en el padre (el stock vive en cada variante). Si además el multiget no
        // incluyó el array, la pedimos por item para garantizar la flecha.
        if (!variaciones.length && b.available_quantity == null && !(prev && prev.novar)) {
          candidatosVar[b.id] = true;
        }
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
    await backfillVariaciones(api, cuenta, Object.keys(candidatosVar));
    catalogoCargado = true;
  }

  // Mapea el array `variations` crudo de ML al formato interno {id,label,stock}.
  function mapVariacionesML(vars) {
    return (vars || []).map(function (v) {
      var et = (v.attribute_combinations || []).map(function (a) { return a.value_name; }).filter(Boolean).join(" / ");
      return { id: String(v.id), label: et || ("Sabor " + v.id), stock: Number(v.available_quantity) || 0 };
    });
  }

  // Backfill de variantes: para las publicaciones que ML devolvió SIN el array de
  // variantes pese a tenerlas (señal: available_quantity nulo en el padre), las
  // consultamos por item con el endpoint dedicado. Garantiza que TODA publicación
  // con variantes muestre su flecha para configurar sabor por sabor. Las que
  // confirmadamente no tienen variantes se marcan (novar) para no reconsultar.
  async function backfillVariaciones(api, cuenta, mlbIds) {
    if (!mlbIds || !mlbIds.length) return;
    for (var i = 0; i < mlbIds.length; i += 6) {
      await Promise.all(mlbIds.slice(i, i + 6).map(function (id) {
        return api.mlApi("/items/" + id + "/variations", "GET", null, cuenta).then(function (r) {
          var c = catalogo[id]; if (!c) return;
          var vs = Array.isArray(r.payload) ? r.payload : [];
          if (vs.length) {
            c.variations = mapVariacionesML(vs);
            c.stock = c.variations.reduce(function (s, v) { return s + (Number(v.stock) || 0); }, 0);
            c.novar = false;
          } else {
            c.novar = true;   // confirmado sin variantes: no volver a consultarla
          }
        }).catch(function () {});
      }));
      renderListings();
      guardarCatalogoCache();
    }
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
    // Filtro por stock (desde "Requiere atención" en el Inicio): out = 0; low = 1..3.
    if (stockFilter === "out") ids = ids.filter(function (id) { return (Number(inv.products[id].stock) || 0) === 0; });
    else if (stockFilter === "low") ids = ids.filter(function (id) { var s = Number(inv.products[id].stock) || 0; return s > 0 && s <= 3; });
    var fb = document.getElementById("invStockFilter");
    if (fb) {
      if (stockFilter === "all") { fb.classList.add("is-hidden"); fb.innerHTML = ""; }
      else {
        var lbl = stockFilter === "out" ? "sin stock" : "con stock bajo";
        fb.classList.remove("is-hidden");
        fb.innerHTML = 'Mostrando <b>' + ids.length + '</b> producto(s) <b>' + lbl + '</b>.' +
          ' <button type="button" class="inv-stockfilter-clear" id="invStockFilterClear">Ver todos</button>';
      }
    }
    elements.invProdEmpty?.classList.toggle("is-visible", !ids.length);
    elements.invProdBody.innerHTML = ids.map(function (id) {
      var p = inv.products[id];
      return "<tr data-prod='" + escapeHtml(id) + "'>" +
        "<td><input class='inv-in' data-f='sku' value='" + escapeHtml(p.sku || "") + "' placeholder='SKU (opcional)' /></td>" +
        "<td><input class='inv-in' data-f='name' value='" + escapeHtml(p.name || "") + "' placeholder='Ej: Creatina 1kg Growth' /></td>" +
        "<td class='num'><input class='inv-in inv-stock' data-f='stock' inputmode='numeric' value='" + escapeHtml(String(p.stock != null ? p.stock : 0)) + "' /></td>" +
        "<td class='num'><input class='inv-in inv-cost' data-f='cost' inputmode='decimal' value='" + escapeHtml(p.cost != null && p.cost !== "" ? String(p.cost) : "") + "' placeholder='$0' title='Costo unitario (lo que te cuesta a vos). Se usa para calcular la rentabilidad.' /></td>" +
        "<td class='num'>" + listingsDeProducto(id).length + "</td>" +
        "<td><button class='table-action delete-action' type='button' data-inv-del='" + escapeHtml(id) + "'>Borrar</button></td>" +
      "</tr>";
    }).join("");
  }

  // --- Agrupación por sabor (familias de publicaciones sueltas) ---
  // Publicaciones SEPARADAS que son el mismo producto en distinto sabor se agrupan
  // bajo una flecha. La detección es por el SABOR al final del título; la unificación
  // es SOLO visual: cada sabor mantiene su publicación y su composición explícita
  // (no se deduce la composición del nombre, únicamente se agrupa la vista).
  function stripDiacritics(s) {
    return (s && s.normalize) ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : String(s || "");
  }
  function normTok(s) { return stripDiacritics(String(s || "").toLowerCase()).replace(/\s+/g, " ").trim(); }
  function capitalizar(s) { s = String(s || ""); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  // Base "corta"/genérica: no agrupar, para no unir productos distintos por un prefijo pobre.
  function esBaseCorta(base) { return !base || base.replace(/\s+/g, "").length < 6; }

  // Léxico de sabores (ES + PT). Las frases multi-palabra se prueban primero por
  // longitud de sufijo. Si un sabor tuyo no aparece acá, esa publicación queda suelta
  // (no se agrupa mal): se puede sumar el término a esta lista.
  var SABORES = [
    "dulce de leche", "doce de leite", "cookies and cream", "cookies & cream", "cookies cream",
    "frutos rojos", "frutas rojas", "frutos del bosque", "frutas del bosque", "frutos vermelhos",
    "chocolate blanco", "chocolate branco", "chocolate amargo", "chocolate con leche", "chocolate ao leite",
    "cafe con leche", "peanut butter", "salted caramel", "leite condensado", "crema de mani",
    "banana split", "red velvet", "frutilla con crema", "cookies e cream",
    "vainilla", "baunilha", "vanilla", "chocolate", "frutilla", "morango", "fresa", "strawberry",
    "cookies", "cookie", "banana", "platano", "coco", "mani", "amendoim", "peanut", "limon", "limao",
    "naranja", "laranja", "cappuccino", "capuccino", "cafe", "coffee", "menta", "mint", "sandia", "melancia",
    "durazno", "pessego", "melocoton", "mango", "manga", "pina", "abacaxi", "uva", "cereza", "cereja", "cherry",
    "avellana", "avela", "almendra", "amendoa", "yogur", "yogurt", "iogurte", "neutro", "natural", "tropical",
    "brigadeiro", "beijinho", "pacoca", "pacoquinha", "churros", "marshmallow", "caramelo", "caramel", "toffee", "canela",
    "cinnamon", "cheesecake", "acai", "maracuya", "maracuja", "kiwi", "frambuesa", "framboesa", "arandano",
    "blueberry", "guarana", "chicle", "bubblegum",
    // sabores/marcas muy comunes en whey brasileño-uruguayo
    "ovomaltine", "leite ninho", "ninho", "trufa", "nutella", "sensacao", "prestigio", "ferrero",
    "chocotine", "baru", "castanha", "pe de moleque", "torta de limao", "flan", "bombom", "bombon",
    "oreo", "ouro branco", "sonho de valsa", "matcha", "cha verde", "leite em po"
  ];
  var SABOR_SET = {};
  SABORES.forEach(function (s) { SABOR_SET[normTok(s)] = true; });

  // Detecta el sabor al final del título; devuelve la base (para agrupar) y textos
  // de display con el case original del título.
  function detectarSabor(titulo) {
    var original = String(titulo || "").replace(/\s+/g, " ").trim();
    var toksO = original.split(" ");
    var toksN = normTok(original).split(" ");
    for (var n = 3; n >= 1; n--) {
      var start = toksN.length - n;
      if (start < 1) continue;                       // debe quedar algo de base
      if (SABOR_SET[toksN.slice(start).join(" ")]) {
        return {
          base: toksN.slice(0, start).join(" ").trim(),
          baseDisplay: toksO.slice(0, start).join(" ").trim(),
          sabor: toksN.slice(start).join(" "),
          saborDisplay: toksO.slice(start).join(" ")
        };
      }
    }
    return { base: normTok(original), baseDisplay: original, sabor: null, saborDisplay: null };
  }

  // Palabras que al final de un título NO deben tomarse como "sabor" en el fallback
  // estructural (tamaños, packs, adjetivos comerciales).
  var NO_SABOR = {};
  ("kg gr grs ml lt lts un und uni unid unidad unidades pack kit combo caps softgel softgels tabs " +
   "tabletas capsulas capsula servicios porciones doses original importado nacional nuevo nueva oferta " +
   "promo edicion limitada").split(" ").forEach(function (w) { NO_SABOR[w] = true; });
  function esPalabraSabor(tok) {
    var n = normTok(tok);
    return /^[a-z]{3,}$/.test(n) && !NO_SABOR[n];   // palabra alfabética, no tamaño/pack/adjetivo
  }

  // Descriptor de familia de una publicación (sin variantes nativas). Devuelve
  // {base, baseDisplay, sabor} o null si no debe agruparse.
  //  - Nivel 1 (léxico): sabor reconocido al final del título.
  //  - Nivel 2 (estructural): mismo título salvo el ÚLTIMO token, y ese token es una
  //    PALABRA (no tamaño/pack). Exige base larga (4+ tokens, base >=6) para no unir
  //    productos distintos de nombre corto. Cubre sabores que no están en el léxico
  //    ("que no quede ninguna variante suelta") sin arriesgar mezclar productos.
  function descriptorFamilia(info, titulo) {
    if (info && info.sabor && !esBaseCorta(info.base)) {
      return { base: info.base, baseDisplay: info.baseDisplay, sabor: info.saborDisplay };
    }
    var original = String(titulo || "").replace(/\s+/g, " ").trim();
    var toksO = original.split(" ");
    if (toksO.length >= 4 && esPalabraSabor(toksO[toksO.length - 1])) {
      var baseDisp = toksO.slice(0, toksO.length - 1).join(" ").trim();
      var baseNorm = normTok(baseDisp);
      if (!esBaseCorta(baseNorm)) {
        return { base: baseNorm, baseDisplay: baseDisp, sabor: toksO[toksO.length - 1] };
      }
    }
    return null;
  }

  // Una publicación está "sincronizada" cuando su último push a ML fue OK.
  function esSincronizada(mlbId) { return (inv.listingState[mlbId] || {}).status === "synced"; }

  function renderListings() {
    if (!elements.invListingBody) return;
    // Mostrar: las que ya tienen composicion + (si se cargo el catalogo) todas las
    // del catalogo. Las claves de composición pueden ser por sabor ("MLB::var"):
    // se colapsan al id base de la publicación.
    var set = {};
    Object.keys(inv.compositions).forEach(function (m) { set[String(m).split("::")[0]] = true; });
    Object.keys(catalogo).forEach(function (m) { set[m] = true; });
    var mlbIds = Object.keys(set);
    // Filtrar por la cuenta ACTIVA del selector superior (ML1 / ML2 / Mercado
    // Livre). El stock físico es central; solo cambia qué publicaciones se listan.
    // Con una sola cuenta conectada no se filtra.
    var cuentas = cuentasMLDelInventario();
    if (cuentas.length > 1) {
      var actual = activeML();
      mlbIds = mlbIds.filter(function (m) { return (cuentaDeListing(m) || cuentas[0]) === actual; });
    }

    // Filtro por COMPONENTE: si hay un producto elegido, mostrar SOLO las
    // publicaciones cuya composición lo usa (para encontrar rápido qué editar).
    poblarCompFiltro();
    if (compFiltro) {
      var usaProd = {};
      listingsDeProducto(compFiltro).forEach(function (m) { usaProd[m] = true; });
      mlbIds = mlbIds.filter(function (m) { return usaProd[m]; });
    }
    actualizarCompFiltroUI(mlbIds.length);

    // Conteo por estado (a nivel publicación) para los botones del filtro.
    var syncedCount = 0;
    mlbIds.forEach(function (m) { if (esSincronizada(m)) syncedCount++; });
    actualizarFiltroUI(mlbIds.length, syncedCount, mlbIds.length - syncedCount);

    // Aplicar el filtro activo (sincronizadas / sin sincronizar).
    var visSet = {};
    mlbIds.forEach(function (m) {
      var ok = listFilter === "synced" ? esSincronizada(m)
             : listFilter === "unsynced" ? !esSincronizada(m) : true;
      if (ok) visSet[m] = true;
    });

    // Descriptor de familia por publicación (sin variantes NATIVAS de ML), una vez.
    // descDe[m] = {base, baseDisplay, sabor} o ausente si esa publicación no agrupa.
    var descDe = {};
    mlbIds.forEach(function (m) {
      if (variacionesDe(m).length) return;
      var d = descriptorFamilia(detectarSabor(tituloListing(m)), tituloListing(m));
      if (d) descDe[m] = d;
    });

    // Agrupar en FAMILIAS: publicaciones separadas que son el mismo producto en
    // distinto sabor (mismo "base" del título tras quitarle el sabor). El total
    // de la familia se calcula sobre TODAS (ignorando el filtro), así una familia
    // con un solo sabor visible se sigue mostrando agrupada.
    var famTot = {};   // base -> [mlbId...]  (todas)
    mlbIds.forEach(function (m) {
      if (!descDe[m]) return;
      (famTot[descDe[m].base] = famTot[descDe[m].base] || []).push(m);
    });
    var famBaseDe = {};   // mlbId -> base (solo familias de 2+)
    Object.keys(famTot).forEach(function (base) {
      if (famTot[base].length >= 2) famTot[base].forEach(function (m) { famBaseDe[m] = base; });
    });

    var html = "";
    var famDone = {};
    mlbIds.forEach(function (mlbId) {
      if (!visSet[mlbId]) return;                    // respeta el filtro activo
      var base = famBaseDe[mlbId];
      if (base) {                                    // pertenece a una familia
        if (famDone[base]) return;
        famDone[base] = true;
        // Miembros de la familia VISIBLES (según el filtro), en el orden del catálogo.
        var visibles = famTot[base].filter(function (m) { return visSet[m]; });
        html += renderFamilia(base, visibles, famTot[base], descDe);
        return;
      }
      if (variacionesDe(mlbId).length) html += renderVariantParent(mlbId);
      else html += renderSimpleRow(mlbId, null);
    });

    // Estado vacío / mensajes según el filtro.
    if (html) {
      elements.invListingEmpty?.classList.toggle("is-visible", false);
    } else if (listFilter === "synced") {
      elements.invListingEmpty?.classList.toggle("is-visible", false);
      html = filaMensaje("Todavía no hay publicaciones sincronizadas.");
    } else if (listFilter === "unsynced") {
      elements.invListingEmpty?.classList.toggle("is-visible", false);
      html = filaMensaje("Todo sincronizado: no hay publicaciones pendientes.");
    } else {
      elements.invListingEmpty?.classList.toggle("is-visible", true);
    }
    elements.invListingBody.innerHTML = html;
  }

  function filaMensaje(txt) {
    return "<tr class='inv-filter-empty-row'><td colspan='6'>" + escapeHtml(txt) + "</td></tr>";
  }

  function fotoDe(mlbId) {
    var cat = catalogo[mlbId] || {};
    return cat.thumbnail
      ? "<img class='order-thumb' src='" + escapeHtml(cat.thumbnail) + "' alt='' loading='lazy' onerror=\"this.style.display='none'\" />"
      : "<span class='order-thumb order-thumb-empty' aria-hidden='true'></span>";
  }

  // Fila de una publicación NATIVA con variantes de ML (una sola MLB, varios sabores
  // internos). Padre expandible + fila por variante (config por sabor).
  function renderVariantParent(mlbId) {
    var st = inv.listingState[mlbId] || {};
    var vars = variacionesDe(mlbId);
    var stockML = st.published != null ? st.published : ((catalogo[mlbId] || {}).stock != null ? catalogo[mlbId].stock : null);
    var exp = !!invExpanded[mlbId];
    var computed = computeListing(mlbId);
    var arrow = "<button class='inv-expand' type='button' data-inv-expand='" + escapeHtml(mlbId) + "' aria-expanded='" + exp + "' aria-label='Ver variantes'>" +
      "<svg viewBox='0 0 24 24' width='13' height='13' fill='none' stroke='currentColor' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='M9 6l6 6-6 6'/></svg></button>";
    var out = "<tr class='inv-parent" + (exp ? " is-open" : "") + "'>" +
      "<td class='order-product'><div class='order-product-cell'>" + arrow + fotoDe(mlbId) +
        "<div class='order-product-info'><b>" + escapeHtml(tituloListing(mlbId)) + "</b>" +
        "<small class='order-stock'>" + escapeHtml(mlbId) + "</small></div></div></td>" +
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
        out += "<tr class='inv-var-row'>" +
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
    return out;
  }

  // Fila simple. Si `child` viene, se renderiza como hijo de una familia (indentada,
  // con el sabor como título). Cada sabor conserva su MLB, su stock y su composición.
  function renderSimpleRow(mlbId, child) {
    var st = inv.listingState[mlbId] || {};
    var cat = catalogo[mlbId] || {};
    var stockML = st.published != null ? st.published : (cat.stock != null ? cat.stock : null);
    var computed = computeListing(mlbId);
    var resumen = resumenComposicion(mlbId);
    var rowClass, prodCell;
    if (child) {
      rowClass = " class='inv-var-row'";
      prodCell = "<td class='order-product'><div class='order-product-cell inv-var-cell'><span class='inv-var-dot' aria-hidden='true'></span>" + fotoDe(mlbId) +
        "<div class='order-product-info'><b>" + escapeHtml(capitalizar(child.sabor) || "Variante") + "</b>" +
        "<small class='order-stock'>" + escapeHtml(mlbId) + "</small></div></div></td>";
    } else {
      rowClass = "";
      prodCell = "<td class='order-product'><div class='order-product-cell'><span class='inv-expand-spacer' aria-hidden='true'></span>" + fotoDe(mlbId) +
        "<div class='order-product-info'><b>" + escapeHtml(tituloListing(mlbId)) + "</b>" +
        "<small class='order-stock'>" + escapeHtml(mlbId) + "</small></div></div></td>";
    }
    return "<tr" + rowClass + ">" + prodCell +
      "<td>" + (resumen ? escapeHtml(resumen) : "<span class='pub-quiet'>Sin configurar</span>") + "</td>" +
      "<td class='num'>" + (computed == null ? "—" : integerNumber.format(computed)) + "</td>" +
      "<td class='num'>" + (stockML != null ? integerNumber.format(stockML) : "—") + "</td>" +
      "<td>" + estadoPill(st.status, resumen, st.error) + "</td>" +
      "<td>" + (st.status === "error"
        ? "<button class='table-action' type='button' data-inv-retry='" + escapeHtml(mlbId) + "'>Reintentar</button>"
        : "<button class='table-action' type='button' data-inv-config='" + escapeHtml(mlbId) + "'>Configurar</button>") + "</td>" +
    "</tr>";
  }

  // Fila FAMILIA: agrupa varias publicaciones sueltas (mismo producto, distinto
  // sabor). Padre expandible con agregados sobre TODOS los sabores + fila por sabor.
  function renderFamilia(base, visibles, todosIds, descDe) {
    var enc = encodeURIComponent(base);
    // Tri-estado: por defecto se abre sola bajo filtro, pero si el usuario tocó la
    // flecha, su elección manda (así puede plegarla sin volver a "Todas").
    var exp = famExpanded.hasOwnProperty(base) ? !!famExpanded[base] : (listFilter !== "all");
    var nombre = (descDe[todosIds[0]] && descDe[todosIds[0]].baseDisplay) || base;

    var sumComp = 0, hayComp = false, sumStock = 0, hayStock = false;
    var anyConf = false, anyErr = false, allSynced = true;
    todosIds.forEach(function (id) {
      var c = computeListing(id);
      if (c != null) { sumComp += c; hayComp = true; }
      var st = inv.listingState[id] || {};
      if (resumenComposicion(id)) anyConf = true;
      if (st.status === "error") anyErr = true;
      if (st.status !== "synced") allSynced = false;
      var sm = st.published != null ? st.published : ((catalogo[id] || {}).stock);
      if (sm != null) { sumStock += Number(sm) || 0; hayStock = true; }
    });
    var estado = !anyConf ? '<span class="type-pill">—</span>'
      : anyErr ? '<span class="type-pill expense">Error</span>'
      : allSynced ? '<span class="type-pill income">Sincronizado</span>'
      : '<span class="type-pill pub-warn">Pendiente</span>';

    var subtitulo = listFilter === "all"
      ? (todosIds.length + " sabores")
      : (visibles.length + " de " + todosIds.length + " sabores");

    var arrow = "<button class='inv-expand' type='button' data-fam-expand='" + escapeHtml(enc) + "' aria-expanded='" + exp + "' aria-label='Ver sabores'>" +
      "<svg viewBox='0 0 24 24' width='13' height='13' fill='none' stroke='currentColor' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='M9 6l6 6-6 6'/></svg></button>";

    var out = "<tr class='inv-parent inv-family" + (exp ? " is-open" : "") + "'>" +
      "<td class='order-product'><div class='order-product-cell'>" + arrow + fotoDe(todosIds[0]) +
        "<div class='order-product-info'><b>" + escapeHtml(nombre) + "</b>" +
        "<small class='order-stock'>" + escapeHtml(subtitulo) + "</small></div></div></td>" +
      "<td><span class='pub-quiet'>Producto en " + todosIds.length + " sabores</span></td>" +
      "<td class='num'>" + (hayComp ? integerNumber.format(sumComp) : "—") + "</td>" +
      "<td class='num'>" + (hayStock ? integerNumber.format(sumStock) : "—") + "</td>" +
      "<td>" + estado + "</td>" +
      "<td></td>" +
    "</tr>";
    if (exp) {
      visibles.forEach(function (id) {
        out += renderSimpleRow(id, { sabor: (descDe[id] && descDe[id].sabor) || "Variante" });
      });
    }
    return out;
  }

  // Refleja el filtro activo y los contadores en la barra de filtros.
  function actualizarFiltroUI(tot, synced, unsynced) {
    var bar = document.getElementById("invListingFilter");
    if (!bar) return;
    bar.querySelectorAll("[data-inv-filter]").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-inv-filter") === listFilter);
    });
    var setC = function (k, v) { var el = bar.querySelector('[data-count="' + k + '"]'); if (el) el.textContent = v; };
    setC("all", tot); setC("synced", synced); setC("unsynced", unsynced);
  }

  // --- Filtro por COMPONENTE (producto físico → publicaciones que lo usan) ---
  // Rellena el <select> con los productos (orden alfabético), sin reconstruir si no
  // cambió (para no perder foco ni pisar la selección).
  function poblarCompFiltro() {
    var sel = document.getElementById("invCompFilter");
    if (!sel) return;
    var ids = Object.keys(inv.products).sort(function (a, b) {
      var na = (inv.products[a].name || inv.products[a].sku || a).toLowerCase();
      var nb = (inv.products[b].name || inv.products[b].sku || b).toLowerCase();
      return na < nb ? -1 : na > nb ? 1 : 0;
    });
    var firma = ids.map(function (id) { return id + ":" + (inv.products[id].name || inv.products[id].sku || ""); }).join("|") + "#" + compFiltro;
    if (sel.getAttribute("data-firma") === firma) return;
    sel.setAttribute("data-firma", firma);
    var html = '<option value="">Todos los productos</option>';
    ids.forEach(function (id) {
      var p = inv.products[id], nom = p.name || p.sku || id;
      html += '<option value="' + escapeHtml(id) + '"' + (id === compFiltro ? " selected" : "") + '>' + escapeHtml(nom) + "</option>";
    });
    sel.innerHTML = html;
    sel.value = compFiltro;
  }
  function actualizarCompFiltroUI(n) {
    var cnt = document.getElementById("invCompFilterCount");
    var clr = document.getElementById("invCompFilterClear");
    if (cnt) cnt.textContent = compFiltro ? (n + (n === 1 ? " publicación" : " publicaciones")) : "";
    if (clr) clr.classList.toggle("is-hidden", !compFiltro);
  }
  function invSetCompFiltro(v) { compFiltro = v || ""; renderListings(); }
  function invLimpiarCompFiltro() {
    compFiltro = "";
    var sel = document.getElementById("invCompFilter"); if (sel) sel.value = "";
    renderListings();
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
      // La regla "si hay stock, la publicacion va activa" puede reactivar una pausada:
      // lo mostramos junto al "ok" (reactivada = true OK / false = no se pudo).
      var okTxt = "ok";
      if (ok && e.reactivada === true) okTxt = "ok · reactivada";
      else if (ok && e.reactivada === false) okTxt = "ok · sin reactivar";
      return "<div class='inv-log-row'>" +
        "<span class='inv-log-when'>" + escapeHtml(String(e.ts).slice(0, 16).replace("T", " ")) + "</span>" +
        "<span class='inv-log-what'>" + escapeHtml(tituloListing(e.listing)) + " · " + escapeHtml(String(e.antes)) + "→" + escapeHtml(String(e.despues)) + "</span>" +
        "<span class='inv-log-why'>" + escapeHtml(e.motivo || "") + "</span>" +
        "<span class='" + (ok ? "inv-log-ok" : "inv-log-err") + "'>" + (ok ? escapeHtml(okTxt) : escapeHtml(e.error || "error")) + "</span>" +
      "</div>";
    }).join("") : "<p class='pub-quiet'>Sin sincronizaciones todavía.</p>";
  }

  // ============================================================
  //  ACCIONES (cableadas por app.js)
  // ============================================================
  function invAddProduct() {
    invTab("productos", true);         // asegura estar en la Lista de productos
    var id = nuevoProductId();
    inv.products[id] = { sku: "", name: "", stock: 0, cost: 0 };
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
      // Costo unitario (COGS) para la vista de Rentabilidad. Vacío = sin costo (0).
      var costRaw = (tr.querySelector("[data-f='cost']") || {}).value;
      var cost = Math.max(0, Number(String(costRaw == null ? "" : costRaw).replace(",", ".")) || 0);
      inv.products[id] = { sku: sku.trim(), name: name.trim(), stock: stock, cost: cost };
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
      setInvMsg("Guardado. " + r.cambiadas + " publicación(es) sincronizada(s)" + (r.reactivadas ? " · " + r.reactivadas + " reactivada" + (r.reactivadas > 1 ? "s" : "") : "") + (r.errores ? ", " + r.errores + " con error." : "."), r.errores ? "error" : "success");
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
      setInvMsg(r.cambiadas + " sincronizada(s)" + (r.reactivadas ? " · " + r.reactivadas + " reactivada" + (r.reactivadas > 1 ? "s" : "") : "") + (r.errores ? ", " + r.errores + " con error." : "."), r.errores ? "error" : "success");
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
      setInvMsg(r.errores ? "La publicación sigue con error." : ("Publicación sincronizada" + (r.reactivadas ? " y reactivada" : "") + "."), r.errores ? "error" : "success");
      renderInventory();
    } catch (e) { setInvMsg("Error al reintentar: " + ((e && e.message) || "error"), "error"); }
  }

  // El selector superior (ML1 / ML2 / Mercado Livre) cambió de cuenta: re-filtrar
  // las publicaciones y cerrar cualquier editor de composición abierto de la otra.
  function invRefiltrarPorCuenta() {
    composeSel = ""; composeVar = "";
    renderInventory();
  }

  function invConfigurar(mlbId, varId) { composeSel = mlbId; composeVar = varId || ""; renderCompose(); elements.invCompose?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  function invComposeCancelar() { composeSel = ""; composeVar = ""; renderCompose(); }
  function invToggleExpand(mlbId) { invExpanded[mlbId] = !invExpanded[mlbId]; renderListings(); }
  // Familia (publicaciones sueltas del mismo producto por sabor): desplegar/plegar.
  function invToggleFamilia(enc) {
    var base; try { base = decodeURIComponent(enc); } catch (e) { base = enc; }
    // Invierte el estado EFECTIVO actual (respeta el auto-abierto bajo filtro), así
    // el primer clic siempre hace lo contrario de lo que se ve.
    var cur = famExpanded.hasOwnProperty(base) ? !!famExpanded[base] : (listFilter !== "all");
    famExpanded[base] = !cur;
    renderListings();
  }
  // Filtro del listado: "all" | "synced" | "unsynced".
  function invSetFilter(f) {
    listFilter = (f === "synced" || f === "unsynced") ? f : "all";
    renderListings();
  }
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

  // Botón "Actualizar": refresco MANUAL y con feedback claro. Vuelve a bajar el
  // inventario del servidor Y re-consulta las publicaciones + stock de ML (fuerza
  // el re-pull), muestra el botón en "Actualizando…" y confirma al terminar. Antes
  // reusaba abrirInventario, que pintaba del cache al instante y refrescaba en
  // silencio → parecía "que no hacía nada".
  async function invActualizar() {
    if (!elements.invPanel) return;
    if (composeSel) { setInvMsg("Cerrá el editor de composición para actualizar.", "error"); return; }
    var btn = elements.invReload, prev = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Actualizando…"; }
    setInvMsg("Actualizando inventario y publicaciones…");
    try {
      catalogoCargado = false;          // fuerza el re-pull real desde ML
      await invLoad();                  // stock físico + composiciones (servidor)
      await cargarCatalogo();           // publicaciones + stock ML fresco
      renderInventory();
      setInvMsg("Inventario actualizado.", "success");
      setTimeout(function () { setInvMsg(""); }, 2500);
    } catch (e) {
      setInvMsg("No se pudo actualizar: " + ((e && e.message) || "error"), "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prev || "Actualizar"; }
    }
  }

  // ---- API para la vista de Rentabilidad ----
  // Costo unitario (COGS) de una publicación/variación: suma qty*costo de su
  // composición. null si no hay composición o si ningún componente tiene costo
  // cargado (la vista lo marca como "falta costo"). Reusa inv.compositions/products.
  function cogsUnit(mlbId, varId) {
    var comps = inv.compositions || {};
    var comp = null;
    if (varId != null && varId !== "") {
      var k = String(mlbId) + "::" + String(varId);
      if (Array.isArray(comps[k]) && comps[k].length) comp = comps[k];
    }
    if (!comp) comp = (Array.isArray(comps[mlbId]) && comps[mlbId].length) ? comps[mlbId] : null;
    if (!comp || !comp.length) return null;
    var total = 0, hayCosto = false;
    for (var i = 0; i < comp.length; i++) {
      var p = inv.products[comp[i].productId];
      var qty = Number(comp[i].qty) || 1;
      if (!p) continue;
      var c = Number(p.cost) || 0;
      if (c > 0) hayCosto = true;
      total += c * qty;
    }
    return hayCosto ? total : null;
  }
  function getInventory() { return inv; }
  async function ensureInventoryLoaded() {
    if (cargado) return true;
    try { await invLoad(); return true; } catch (e) { return false; }
  }
  // Desde "Requiere atención": abre la Lista de productos filtrada a los que están
  // sin stock ("out") o con stock bajo ("low"), y sube al inventario.
  function invShowStock(kind) {
    stockFilter = (kind === "out" || kind === "low") ? kind : "all";
    if (S.setView) S.setView("productos");   // E-Commerce → ML → Inventario
    Promise.resolve(ensureInventoryLoaded()).then(function () {
      invTab("productos", true);
      renderProductos();
      var p = elements.invPanel;
      if (p && p.scrollIntoView) { try { p.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {} }
    }).catch(function () {});
  }
  function invLimpiarStockFiltro() { stockFilter = "all"; renderProductos(); }

  Object.assign(S, {
    abrirInventario, invActualizar, renderInventory, invTab, detenerInvTiempoReal,
    cogsUnit: cogsUnit, getInventory: getInventory, ensureInventoryLoaded: ensureInventoryLoaded,
    invShowStock: invShowStock, invLimpiarStockFiltro: invLimpiarStockFiltro,
    invAddProduct, invGuardarProductos, invDeleteProduct,
    invCargarPublicaciones, invResyncAll, invReintentarUno,
    invConfigurar, invComposeCancelar, invComposeAddComponent, invComposeQuitar, invComposeGuardar, invToggleExpand,
    invToggleFamilia, invSetFilter, invSetCompFiltro, invLimpiarCompFiltro,
    invRefiltrarPorCuenta
  });
})();
