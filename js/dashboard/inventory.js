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
      listingState: (o && o.listingState) || {}, syncLog: (o && Array.isArray(o.syncLog)) ? o.syncLog : []
    };
    snapshotServerStock();
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
    var productos = {};
    Object.keys(inv.products).forEach(function (id) {
      var p = inv.products[id];
      productos[id] = {
        sku: p.sku || "", name: p.name || "", stock: Number(p.stock) || 0,
        baseStock: Object.prototype.hasOwnProperty.call(serverStock, id) ? serverStock[id] : null
      };
    });
    var res = await S.requireSecureApi().inventory("save", {
      products: productos, compositions: inv.compositions,
      listingState: inv.listingState, syncLog: inv.syncLog
    });
    if (res && res.inventory) adoptInv(res.inventory); // reflejar el estado real fusionado
  }

  // ---- Motor de reglas ----
  function computeListing(mlbId) {
    var comp = inv.compositions[mlbId];
    if (!comp || !comp.length) return null;               // sin composicion: no la gestiona el inventario
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
  function listingsDeProducto(productId) {
    return Object.keys(inv.compositions).filter(function (mlbId) {
      return (inv.compositions[mlbId] || []).some(function (c) { return c.productId === productId; });
    });
  }
  function nuevoProductId() {
    var n = 1;
    while (inv.products["PROD-" + String(n).padStart(6, "0")]) n++;
    return "PROD-" + String(n).padStart(6, "0");
  }
  function tituloListing(mlbId) { return (catalogo[mlbId] && catalogo[mlbId].title) || mlbId; }
  function resumenComposicion(mlbId) {
    var comp = inv.compositions[mlbId] || [];
    if (!comp.length) return "";
    return comp.map(function (c) {
      var p = inv.products[c.productId];
      return (p ? (p.name || p.sku || c.productId) : c.productId) + " ×" + (Number(c.qty) || 1);
    }).join(" · ");
  }
  function logSync(entry) {
    inv.syncLog.unshift(Object.assign({ ts: new Date().toISOString() }, entry));
    if (inv.syncLog.length > 200) inv.syncLog.length = 200;
  }

  // ---- Conector ML: PUT del stock de UNA publicacion ----
  async function invPutMLStock(mlbId, qty) {
    var api = S.requireSecureApi(), cuenta = activeML();
    var det = await api.mlApi("/items/" + mlbId + "?attributes=id,variations,available_quantity", "GET", null, cuenta);
    var vars = (det.payload || {}).variations || [];
    var body = vars.length
      ? { variations: vars.map(function (v) { return { id: v.id, available_quantity: qty }; }) }
      : { available_quantity: qty };
    await api.mlApi("/items/" + mlbId, "PUT", body, cuenta);
  }

  async function invSyncListings(mlbIds, motivo) {
    var cambiadas = 0, errores = 0;
    for (var i = 0; i < mlbIds.length; i++) {
      var mlbId = mlbIds[i];
      var computed = computeListing(mlbId);
      if (computed == null) continue;
      var st = inv.listingState[mlbId] || {};
      if (st.published === computed && st.status === "synced") continue;
      try {
        await invPutMLStock(mlbId, computed);
        inv.listingState[mlbId] = { computed: computed, published: computed, status: "synced", lastSyncAt: new Date().toISOString(), error: null };
        logSync({ listing: mlbId, antes: st.published != null ? st.published : "—", despues: computed, motivo: motivo, resultado: "ok" });
        cambiadas++;
      } catch (e) {
        inv.listingState[mlbId] = Object.assign({}, st, { computed: computed, status: "error", lastSyncAt: new Date().toISOString(), error: (e && e.message) || "error" });
        logSync({ listing: mlbId, antes: st.published != null ? st.published : "—", despues: computed, motivo: motivo, resultado: "error", error: (e && e.message) || "error" });
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

  // ---- Catalogo de publicaciones de ML ----
  async function cargarCatalogo() {
    var api = S.requireSecureApi(), cuenta = activeML();
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
    for (var i = 0; i < ids.length; i += 20) {
      var det = await api.mlApi("/items?ids=" + ids.slice(i, i + 20).join(",") + "&attributes=id,title,available_quantity,variations", "GET", null, cuenta);
      (det.payload || []).forEach(function (row) {
        var b = row && row.body; if (!b || !b.id) return;
        // Stock real actual en ML: con variaciones, la suma; si no, el del item.
        var vars = b.variations || [];
        var stockML = vars.length
          ? vars.reduce(function (s, v) { return s + (Number(v.available_quantity) || 0); }, 0)
          : (Number(b.available_quantity) || 0);
        catalogo[b.id] = { title: b.title || b.id, stock: stockML };
      });
      await dormir(100);
    }
    catalogoCargado = true;
  }

  // Auto-carga del catálogo al entrar (sin tocar el botón). Silencioso: si falla,
  // el botón "Cargar publicaciones de ML" sigue disponible como respaldo.
  async function cargarCatalogoAuto() {
    try {
      if (!catalogoCargado) setInvMsg("Cargando publicaciones de Mercado Libre…");
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
    // Mostrar: las que ya tienen composicion + (si se cargo el catalogo) todas las del catalogo.
    var set = {};
    Object.keys(inv.compositions).forEach(function (m) { set[m] = true; });
    Object.keys(catalogo).forEach(function (m) { set[m] = true; });
    var mlbIds = Object.keys(set);
    elements.invListingEmpty?.classList.toggle("is-visible", !mlbIds.length);
    elements.invListingBody.innerHTML = mlbIds.map(function (mlbId) {
      var computed = computeListing(mlbId);
      var st = inv.listingState[mlbId] || {};
      var resumen = resumenComposicion(mlbId);
      // "Stock ML" = lo que hay AHORA en Mercado Libre. Si Nexus ya sincronizó (o
      // una venta lo actualizó), ese valor es el más fresco; si no, el stock real
      // que trajo la última carga de publicaciones.
      var stockML = st.published != null ? st.published
        : (catalogo[mlbId] && catalogo[mlbId].stock != null ? catalogo[mlbId].stock : null);
      return "<tr>" +
        "<td>" + escapeHtml(tituloListing(mlbId)) + " <small class='inv-mlb'>" + escapeHtml(mlbId) + "</small></td>" +
        "<td>" + (resumen ? escapeHtml(resumen) : "<span class='pub-quiet'>Sin configurar</span>") + "</td>" +
        "<td class='num'>" + (computed == null ? "—" : integerNumber.format(computed)) + "</td>" +
        "<td class='num'>" + (stockML != null ? integerNumber.format(stockML) : "—") + "</td>" +
        "<td>" + estadoPill(st.status, resumen, st.error) + "</td>" +
        "<td>" + (st.status === "error"
          ? "<button class='table-action' type='button' data-inv-retry='" + escapeHtml(mlbId) + "'>Reintentar</button>"
          : "<button class='table-action' type='button' data-inv-config='" + escapeHtml(mlbId) + "'>Configurar</button>") + "</td>" +
      "</tr>";
    }).join("");
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
    var comp = inv.compositions[composeSel] || [];
    if (elements.invComposeRows) {
      var prodOpts = Object.keys(inv.products).map(function (id) {
        return { id: id, name: inv.products[id].name || inv.products[id].sku || id };
      });
      elements.invComposeRows.innerHTML = comp.map(function (c, idx) {
        var sel = prodOpts.map(function (o) {
          return "<option value='" + escapeHtml(o.id) + "'" + (o.id === c.productId ? " selected" : "") + ">" + escapeHtml(o.name) + "</option>";
        }).join("");
        return "<div class='inv-comp-row' data-idx='" + idx + "'>" +
          "<select class='inv-comp-prod'>" + sel + "</select>" +
          "<input class='inv-comp-qty' type='text' inputmode='numeric' value='" + escapeHtml(String(Number(c.qty) || 1)) + "' />" +
          "<button class='table-action delete-action' type='button' data-comp-del='" + idx + "'>Quitar</button>" +
        "</div>";
      }).join("") || "<p class='pub-quiet'>Sin componentes. Agregá uno.</p>";
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
      var r = await invSyncListings(Object.keys(inv.compositions), "Sincronización manual (todas)");
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

  function invConfigurar(mlbId) { composeSel = mlbId; renderCompose(); elements.invCompose?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  function invComposeCancelar() { composeSel = ""; renderCompose(); }
  function invComposeAgregar() {
    if (!composeSel) return;
    var firstProd = Object.keys(inv.products)[0];
    if (!firstProd) { if (elements.invComposeMsg) { elements.invComposeMsg.textContent = "Primero creá productos en la pestaña “Lista de productos”."; elements.invComposeMsg.className = "meta-message is-error"; } return; }
    var comp = inv.compositions[composeSel] || [];
    comp.push({ productId: firstProd, qty: 1 });
    inv.compositions[composeSel] = comp;
    renderCompose();
  }
  function invComposeQuitar(idx) {
    if (!composeSel) return;
    var comp = inv.compositions[composeSel] || [];
    comp.splice(idx, 1);
    if (comp.length) inv.compositions[composeSel] = comp; else delete inv.compositions[composeSel];
    renderCompose();
  }
  async function invComposeGuardar() {
    if (!composeSel || !elements.invComposeRows) return;
    var rows = elements.invComposeRows.querySelectorAll(".inv-comp-row");
    var comp = [];
    rows.forEach(function (r) {
      var pid = (r.querySelector(".inv-comp-prod") || {}).value;
      var qty = Math.max(1, Math.floor(Number((r.querySelector(".inv-comp-qty") || {}).value) || 1));
      if (pid) comp.push({ productId: pid, qty: qty });
    });
    if (comp.length) inv.compositions[composeSel] = comp; else delete inv.compositions[composeSel];
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
    invConfigurar, invComposeCancelar, invComposeAgregar, invComposeQuitar, invComposeGuardar
  });
})();
