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

  function activeML() { return S.state.commerce.selectedApp || S.state.commerce.activeApp || "mercadolibre"; }
  function dormir(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---- Persistencia ----
  async function invLoad() {
    var res = await S.requireSecureApi().inventory("get");
    var o = (res && res.inventory) || {};
    inv = {
      products: o.products || {}, compositions: o.compositions || {},
      listingState: o.listingState || {}, syncLog: Array.isArray(o.syncLog) ? o.syncLog : []
    };
    cargado = true;
  }
  async function invSave() {
    inv.updatedAt = new Date().toISOString();
    await S.requireSecureApi().inventory("save", { inventory: inv });
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
      var det = await api.mlApi("/items?ids=" + ids.slice(i, i + 20).join(",") + "&attributes=id,title", "GET", null, cuenta);
      (det.payload || []).forEach(function (row) {
        var b = row && row.body; if (b && b.id) catalogo[b.id] = { title: b.title || b.id };
      });
      await dormir(100);
    }
    catalogoCargado = true;
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function renderInventory() { renderProductos(); renderListings(); renderCompose(); renderLog(); }

  function renderProductos() {
    if (!elements.invProdBody) return;
    var ids = Object.keys(inv.products);
    elements.invProdBody.innerHTML = ids.map(function (id) {
      var p = inv.products[id];
      return "<tr data-prod='" + escapeHtml(id) + "'>" +
        "<td><input class='inv-in' data-f='sku' value='" + escapeHtml(p.sku || "") + "' placeholder='SKU' /></td>" +
        "<td><input class='inv-in' data-f='name' value='" + escapeHtml(p.name || "") + "' placeholder='Nombre' /></td>" +
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
      return "<tr>" +
        "<td>" + escapeHtml(tituloListing(mlbId)) + " <small class='inv-mlb'>" + escapeHtml(mlbId) + "</small></td>" +
        "<td>" + (resumen ? escapeHtml(resumen) : "<span class='pub-quiet'>Sin configurar</span>") + "</td>" +
        "<td class='num'>" + (computed == null ? "—" : integerNumber.format(computed)) + "</td>" +
        "<td class='num'>" + (st.published != null ? integerNumber.format(st.published) : "—") + "</td>" +
        "<td>" + estadoPill(st.status, resumen) + "</td>" +
        "<td><button class='table-action' type='button' data-inv-config='" + escapeHtml(mlbId) + "'>Configurar</button></td>" +
      "</tr>";
    }).join("");
  }
  function estadoPill(status, tieneComp) {
    if (!tieneComp) return '<span class="type-pill">—</span>';
    if (status === "synced") return '<span class="type-pill income">Sincronizado</span>';
    if (status === "error") return '<span class="type-pill expense">Error</span>';
    return '<span class="type-pill pub-warn">Pendiente</span>';
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
    var id = nuevoProductId();
    inv.products[id] = { sku: "", name: "", stock: 0 };
    renderProductos();
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

  function invConfigurar(mlbId) { composeSel = mlbId; renderCompose(); elements.invCompose?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  function invComposeCancelar() { composeSel = ""; renderCompose(); }
  function invComposeAgregar() {
    if (!composeSel) return;
    var firstProd = Object.keys(inv.products)[0];
    if (!firstProd) { if (elements.invComposeMsg) { elements.invComposeMsg.textContent = "Primero agregá productos físicos arriba."; elements.invComposeMsg.className = "meta-message is-error"; } return; }
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
      setInvMsg("");
    } catch (e) { setInvMsg("No se pudo cargar el inventario: " + ((e && e.message) || "error"), "error"); }
  }

  Object.assign(S, {
    abrirInventario, renderInventory,
    invAddProduct, invGuardarProductos, invDeleteProduct,
    invCargarPublicaciones, invResyncAll,
    invConfigurar, invComposeCancelar, invComposeAgregar, invComposeQuitar, invComposeGuardar
  });
})();
