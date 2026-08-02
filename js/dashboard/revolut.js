/* ============================================================
   NEXUS Dashboard · Finanzas · Integracion Revolut (Open Banking)
   ------------------------------------------------------------
   Frontend de la conexion con Revolut via GoCardless. Habla con la
   funcion serverless /revolut (NexusSecureAPI.revolut) y vuelca las
   transacciones a los movimientos de Finanzas.

   - Los movimientos de Revolut se guardan como movimientos normales
     con source:"revolut" -> aparecen en el grafico general solos.
   - La seccion "Revolut" (dentro de Finanzas) filtra source==="revolut".
   - Dedup por externalId: una transaccion nunca se duplica.
   - Moneda base LIBRA (£); toggle para VER en pesos (cotizacion cacheada).
   Parte de window.NexusDash — namespace compartido.
   ============================================================ */
(function () {
  var S = window.NexusDash;
  var RATE_KEY = "nexus.personalFinance.gbpUyuRate.v1";   // cache de cotizacion (por-dispositivo)
  var LAST_SYNC_KEY = "nexus.personalFinance.revolutLastSync.v1";

  var estado = { hasKeys: false, accounts: [], sincronizando: false, ultimoError: "" };

  function api() { return window.NexusSecureAPI; }
  function disponible() { return !!(api() && api().available && api().available()); }
  function el(id) { return document.getElementById(id); }

  // ---- Mensajes en el panel -----------------------------------
  function msg(texto, tipo) {
    var box = el("revolutMessage");
    if (!box) return;
    box.textContent = texto || "";
    box.className = "revolut-message" + (tipo ? " is-" + tipo : "");
  }

  // ---- Cotizacion GBP -> UYU (API gratis, cacheada por dia) ----
  function cargarCotizacion() {
    // Cache del dia para no pegarle a la API en cada carga.
    try {
      var cached = JSON.parse(localStorage.getItem(RATE_KEY) || "null");
      var hoy = new Date().toISOString().slice(0, 10);
      if (cached && cached.date === hoy && cached.rate > 0) {
        S.setGbpUyuRate(cached.rate);
        return Promise.resolve(cached.rate);
      }
    } catch (e) {}
    // open.er-api.com: gratis, sin API key, con CORS habilitado.
    return fetch("https://open.er-api.com/v6/latest/GBP")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var rate = d && d.rates && Number(d.rates.UYU);
        if (rate > 0) {
          S.setGbpUyuRate(rate);
          try { localStorage.setItem(RATE_KEY, JSON.stringify({ date: new Date().toISOString().slice(0, 10), rate: rate })); } catch (e) {}
        }
        return rate;
      })
      .catch(function () { return null; });
  }

  // ---- Merge de transacciones a movimientos (dedup por externalId) ----
  function mergear(movs) {
    if (!Array.isArray(movs) || !movs.length) return { added: 0 };
    var vistos = {};
    S.state.movements.forEach(function (m) { if (m.externalId) vistos[m.externalId] = true; });
    var added = 0;
    movs.forEach(function (m) {
      if (!m || !m.externalId || vistos[m.externalId]) return;   // ya existe -> no duplicar
      if (!m.date || !(Number(m.amount) > 0)) return;
      vistos[m.externalId] = true;
      S.state.movements.unshift({
        id: "rev-" + m.externalId,
        date: m.date,
        type: m.type === "income" ? "income" : "expense",
        amount: Number(m.amount),
        category: m.category || (m.type === "income" ? "Otros ingresos" : "Otros gastos"),
        description: m.description || "Movimiento Revolut",
        currency: m.currency || "GBP",
        originalAmount: m.originalAmount,
        originalCurrency: m.originalCurrency,
        source: "revolut",
        externalId: m.externalId
      });
      added += 1;
    });
    if (added) S.saveMovements();   // persiste + dispara la sync a la nube
    return { added: added };
  }

  // ---- Acciones ------------------------------------------------
  function guardarClaves() {
    if (!disponible()) { msg("Esto solo funciona en el sitio deployado (con sesion).", "error"); return; }
    var secretId = (el("revolutSecretId") && el("revolutSecretId").value || "").trim();
    var secretKey = (el("revolutSecretKey") && el("revolutSecretKey").value || "").trim();
    if (secretId.length < 8 || secretKey.length < 8) { msg("Pega el secret_id y el secret_key de GoCardless.", "error"); return; }
    msg("Validando credenciales...", "");
    api().revolut("save-keys", { secretId: secretId, secretKey: secretKey })
      .then(function () {
        if (el("revolutSecretId")) el("revolutSecretId").value = "";
        if (el("revolutSecretKey")) el("revolutSecretKey").value = "";
        estado.hasKeys = true;
        msg("Credenciales guardadas. Ahora autoriza Revolut.", "success");
        return conectar();
      })
      .catch(function (e) { msg("No se pudieron guardar: " + (e.message || e), "error"); });
  }

  function conectar() {
    if (!disponible()) { msg("Necesitas sesion iniciada.", "error"); return; }
    msg("Generando el enlace de autorizacion...", "");
    return api().revolut("link", {})
      .then(function (res) {
        if (res && res.link) {
          msg("Te llevo a Revolut para autorizar...", "");
          window.location.href = res.link;   // el usuario autoriza y vuelve a #finanzas-revolut
        } else {
          msg("No se recibio el enlace de autorizacion.", "error");
        }
      })
      .catch(function (e) { msg("Error al conectar: " + (e.message || e), "error"); });
  }

  // Al volver del OAuth (#finanzas-revolut): confirmar las cuentas y sincronizar.
  function confirmarRetorno() {
    if (!disponible()) return;
    msg("Confirmando la conexion con Revolut...", "");
    api().revolut("confirm", {})
      .then(function (res) {
        estado.accounts = (res && res.accounts) || [];
        if (estado.accounts.length) {
          msg("Conectado. Trayendo tus movimientos...", "success");
          return sincronizar(true);
        }
        msg("La autorizacion no devolvio cuentas. Proba de nuevo.", "error");
      })
      .catch(function (e) { msg("No se pudo confirmar: " + (e.message || e), "error"); })
      .then(function () {
        // limpiar el hash para no re-confirmar en cada carga
        try { history.replaceState(null, "", "#finanzas-personales"); } catch (e) {}
        render();
      });
  }

  function sincronizar(silencioso) {
    if (!disponible()) { if (!silencioso) msg("Necesitas sesion iniciada.", "error"); return Promise.resolve(); }
    if (estado.sincronizando) return Promise.resolve();
    estado.sincronizando = true;
    render();
    if (!silencioso) msg("Sincronizando con Revolut...", "");
    return api().revolut("sync", {})
      .then(function (res) {
        var movs = (res && res.movimientos) || [];
        var r = mergear(movs);
        try { localStorage.setItem(LAST_SYNC_KEY, String(Date.now())); } catch (e) {}
        estado.ultimoError = "";
        msg(r.added ? ("Listo: " + r.added + " movimiento" + (r.added === 1 ? "" : "s") + " nuevo" + (r.added === 1 ? "" : "s") + " de Revolut.") : "Al dia, sin movimientos nuevos.", "success");
        if (S.renderAll) S.renderAll();   // refresca metricas, historial y grafico general
      })
      .catch(function (e) {
        estado.ultimoError = e.message || String(e);
        if (e.code === "sin_cuentas") msg("Todavia no autorizaste Revolut. Toca Conectar.", "error");
        else if (e.httpStatus === 429 || /rate/i.test(estado.ultimoError)) msg("Revolut limita a ~4 sincronizaciones por dia. Proba mas tarde.", "error");
        else msg("Error al sincronizar: " + estado.ultimoError, "error");
      })
      .then(function () { estado.sincronizando = false; render(); });
  }

  function desconectar() {
    if (!disponible()) return;
    if (!window.confirm("Desconectar Revolut? Los movimientos ya importados quedan; deja de sincronizar.")) return;
    api().revolut("disconnect", {}).then(function () {
      estado.hasKeys = false; estado.accounts = [];
      msg("Revolut desconectado.", "");
      render();
    }).catch(function (e) { msg("Error: " + (e.message || e), "error"); });
  }

  function toggleMoneda() {
    var nueva = S.financeCurrency() === "GBP" ? "UYU" : "GBP";
    if (nueva === "UYU" && !S.gbpUyuRate()) {
      cargarCotizacion().then(function (rate) {
        if (!rate) { msg("No se pudo traer la cotizacion GBP/UYU ahora.", "error"); return; }
        S.setFinanceCurrency("UYU");
        if (S.renderAll) S.renderAll();
        render();
      });
      return;
    }
    S.setFinanceCurrency(nueva);
    if (S.renderAll) S.renderAll();
    render();
  }

  // ---- Render de la seccion Revolut ---------------------------
  function movimientosRevolut() {
    return (S.state.movements || []).filter(function (m) { return m.source === "revolut"; });
  }

  function render() {
    var panel = el("revolutPanel");
    if (!panel) return;
    var revs = movimientosRevolut();
    var conectado = estado.accounts.length > 0 || revs.length > 0;
    var ccy = S.financeCurrency();
    var lastSync = 0;
    try { lastSync = Number(localStorage.getItem(LAST_SYNC_KEY)) || 0; } catch (e) {}

    // Barra de acciones
    var acciones = el("revolutActions");
    if (acciones) {
      if (conectado || estado.hasKeys) {
        acciones.innerHTML =
          '<button class="ghost-button" type="button" data-revolut-sync' + (estado.sincronizando ? " disabled" : "") + '>' +
          (estado.sincronizando ? "Sincronizando..." : "Sincronizar ahora") + '</button>' +
          '<button class="ghost-button" type="button" data-revolut-ccy>Ver en ' + (ccy === "GBP" ? "$ pesos" : "£ libras") + '</button>' +
          '<button class="ghost-button danger" type="button" data-revolut-disconnect>Desconectar</button>';
      } else {
        acciones.innerHTML = "";
      }
    }

    // Cuerpo: form de conexion o lista de movimientos
    var body = el("revolutBody");
    if (!body) return;
    if (!conectado && !estado.hasKeys) {
      body.innerHTML =
        '<p class="revolut-help">Conecta tu Revolut para traer automaticamente tus gastos e ingresos a Finanzas. ' +
        'Necesitas un <b>secret_id</b> y un <b>secret_key</b> de <a href="https://bankaccountdata.gocardless.com" target="_blank" rel="noopener">GoCardless</a> (gratis).</p>' +
        '<label class="field"><span>secret_id</span><input id="revolutSecretId" type="text" autocomplete="off" autocapitalize="none" placeholder="tu secret_id" /></label>' +
        '<label class="field"><span>secret_key</span><input id="revolutSecretKey" type="password" autocomplete="off" placeholder="tu secret_key" /></label>' +
        '<button class="primary-button" type="button" data-revolut-connect>Conectar Revolut</button>';
    } else {
      var lastTxt = lastSync ? ("Ultima sincronizacion: " + S.formatDate(new Date(lastSync).toISOString().slice(0, 10))) : "Sin sincronizar todavia";
      var total = revs.reduce(function (s, m) { return s + (m.type === "expense" ? -m.amount : m.amount); }, 0);
      var rows = revs.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 40).map(function (m) {
        var signo = m.type === "income" ? "+" : "-";
        var orig = (m.originalAmount && m.originalCurrency && m.originalCurrency !== (m.currency || "GBP"))
          ? '<small class="revolut-orig">' + S.decimalNumber.format(m.originalAmount) + ' ' + S.escapeHtml(m.originalCurrency) + '</small>' : "";
        return '<div class="revolut-row">' +
          '<div class="revolut-row-main"><b>' + S.escapeHtml(m.description) + '</b>' +
          '<small>' + S.escapeHtml(S.formatDate(m.date)) + ' · ' + S.escapeHtml(m.category) + '</small></div>' +
          '<div class="revolut-row-amt ' + (m.type === "income" ? "amount-income" : "amount-expense") + '">' +
          signo + S.financeMoney(m.amount, true) + orig + '</div></div>';
      }).join("");
      body.innerHTML =
        '<p class="revolut-status"><span class="revolut-dot"></span>' +
        (estado.accounts.length ? (estado.accounts.length + " cuenta(s) conectada(s). ") : "") +
        S.escapeHtml(lastTxt) + '</p>' +
        (revs.length
          ? ('<p class="revolut-total">' + revs.length + ' movimientos de Revolut · neto ' + S.financeMoney(total, false) + '</p>' + '<div class="revolut-list">' + rows + '</div>')
          : '<p class="revolut-help">Conectado. Toca "Sincronizar ahora" para traer tus movimientos.</p>');
    }
  }

  // ---- Init / API pública -------------------------------------
  function init() {
    // Cotizacion en segundo plano (para el toggle de pesos).
    cargarCotizacion();
    // Delegacion de eventos del panel (los botones se re-renderizan).
    var panel = el("revolutPanel");
    if (panel) {
      panel.addEventListener("click", function (e) {
        var t = e.target.closest("[data-revolut-connect],[data-revolut-sync],[data-revolut-disconnect],[data-revolut-ccy]");
        if (!t) return;
        if (t.hasAttribute("data-revolut-connect")) guardarClaves();
        else if (t.hasAttribute("data-revolut-sync")) sincronizar(false);
        else if (t.hasAttribute("data-revolut-disconnect")) desconectar();
        else if (t.hasAttribute("data-revolut-ccy")) toggleMoneda();
      });
    }
    // Estado inicial + retorno del OAuth.
    if (disponible()) {
      api().revolut("status", {}).then(function (res) {
        estado.hasKeys = !!(res && res.hasKeys);
        estado.accounts = (res && res.accounts) || [];
        render();
        // Auto-sync al abrir si hay cuentas y paso >5h desde la ultima (≈4/dia).
        var last = 0; try { last = Number(localStorage.getItem(LAST_SYNC_KEY)) || 0; } catch (e) {}
        if (estado.accounts.length && Date.now() - last > 5 * 3600 * 1000) sincronizar(true);
      }).catch(function () { render(); });
    } else {
      render();
    }
    // Si volvimos autorizando desde Revolut.
    if (location.hash.indexOf("finanzas-revolut") !== -1) confirmarRetorno();
  }

  S.renderRevolut = render;
  S.revolutInit = init;
  S.revolutSync = function () { return sincronizar(false); };
})();
