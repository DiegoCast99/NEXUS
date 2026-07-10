/* ============================================================
   NEXUS Dashboard · Núcleo de integraciones (Ola 5 · refactor)
   ------------------------------------------------------------
   Piezas de flujo COMPARTIDAS entre integraciones (Meta Ads,
   E-Commerce, y las que vengan): mensajería de estado, ciclo de
   vida del sync, persistencia segura del token, scheduler de
   auto-refresh y guard del proxy. La lógica de dominio (normalizar,
   agregar, renderizar) vive en cada módulo.

   Sin DOM ni estado propios: todo entra por hooks. Eso lo hace
   reutilizable y testeable en Node (tests/).
   ============================================================ */
(function (root) {
  // Mensajería de estado de una integración: guarda message/messageType en el
  // slice de estado y refleja en el elemento (si existe).
  function createIntegrationMessenger(hooks) {
    return function setMessage(message = "", type = "") {
      const slice = hooks.slice();
      slice.message = message;
      slice.messageType = type;
      const el = hooks.getElement();
      if (!el) return;
      el.textContent = message;
      el.classList.toggle("is-error", type === "error");
      el.classList.toggle("is-success", type === "success");
    };
  }

  // Guard del proxy serverless: las integraciones solo hablan con las APIs a
  // través de window.NexusSecureAPI (los tokens nunca tocan el navegador).
  function requireSecureApi() {
    if (!root.NexusSecureAPI) {
      throw new Error("El proxy seguro no está disponible en este entorno.");
    }
    return root.NexusSecureAPI;
  }

  // Si el usuario ingresó un token nuevo en el formulario, lo guarda cifrado
  // server-side y lo saca de memoria/DOM (queda solo el flag hasToken).
  async function persistProviderToken(options) {
    const config = options.config;
    const field = options.field;
    if (!config || !config[field]) return false;
    const api = requireSecureApi();
    await api.saveProviderToken(options.provider, config[field]);
    config[field] = "";
    config.hasToken = true;
    if (options.saveConfig) options.saveConfig();
    if (options.populateForm) options.populateForm();
    return true;
  }

  // Ciclo de vida estándar de una sincronización "live":
  // syncing=true → mensaje → render → run() → mensaje éxito/error →
  // syncing=false → render → after() (p.ej. re-programar el refresh).
  async function runIntegrationSync(hooks) {
    const slice = hooks.slice();
    slice.syncing = true;
    if (!hooks.silent) hooks.setMessage(hooks.syncingMessage, "");
    hooks.render();
    try {
      const successMessage = await hooks.run();
      hooks.setMessage(successMessage, "success");
    } catch (error) {
      hooks.setMessage((error && error.message) || hooks.errorFallback, "error");
    } finally {
      slice.syncing = false;
      hooks.render();
      if (hooks.after) hooks.after();
    }
  }

  // Auto-refresh: reinicia el timer del slice; si el intervalo y las
  // credenciales están, programa sync({silent:true}) cada N segundos.
  function createRefreshScheduler(hooks) {
    return function scheduleRefresh() {
      const slice = hooks.slice();
      root.clearInterval(slice.refreshTimer);
      slice.refreshTimer = 0;
      const seconds = Number(hooks.getIntervalSeconds());
      if (!seconds || !hooks.isEnabled()) return;
      slice.refreshTimer = root.setInterval(function () {
        hooks.sync({ silent: true });
      }, seconds * 1000);
    };
  }

  const core = {
    createIntegrationMessenger,
    requireSecureApi,
    persistProviderToken,
    runIntegrationSync,
    createRefreshScheduler
  };

  // Navegador: colgar de NexusDash (namespace compartido del dashboard).
  if (root.NexusDash) Object.assign(root.NexusDash, core);
  root.NexusIntegrationCore = core;

  // Node (tests): exportar como módulo CommonJS.
  if (typeof module !== "undefined" && module.exports) module.exports = core;
})(typeof window !== "undefined" ? window : globalThis);
