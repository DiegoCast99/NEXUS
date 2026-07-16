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

  // Cuántos fallos seguidos tolera el auto-refresh antes de frenarse.
  // Evita machacar la API (y el banner rojo) si el token se vencio.
  const MAX_SILENT_FAILS = 3;

  // Ciclo de vida estándar de una sincronización:
  // syncing=true → mensaje → render → run() → mensaje éxito/error →
  // syncing=false → render → after() (p.ej. re-programar el refresh).
  //
  // En modo `silent` (los ticks del auto-refresh y los syncs de apertura) NO
  // toca la UI salvo el render final: sin "Sincronizando...", sin mensaje de
  // éxito y sin el parpadeo Live→Sync→Live. El titular solo ve los datos
  // aparecer. Los errores sí se muestran, pero una sola vez.
  async function runIntegrationSync(hooks) {
    const slice = hooks.slice();
    slice.syncing = true;
    if (!hooks.silent) {
      hooks.setMessage(hooks.syncingMessage, "");
      hooks.render();
    }
    try {
      const successMessage = await hooks.run();
      slice.failCount = 0;
      if (!hooks.silent) hooks.setMessage(successMessage, "success");
    } catch (error) {
      slice.failCount = (slice.failCount || 0) + 1;
      const text = (error && error.message) || hooks.errorFallback;
      // Silencioso: no repetir el mismo banner rojo en cada tick.
      if (!hooks.silent || slice.messageType !== "error") {
        hooks.setMessage(text, "error");
      }
      if (hooks.silent) console.warn("sync silencioso fallo:", text);
    } finally {
      slice.syncing = false;
      hooks.render();
      if (hooks.after) hooks.after();
    }
  }

  // Auto-refresh: reinicia el timer del slice; si el intervalo y las
  // credenciales están, programa sync({silent:true}) cada N segundos.
  // Se frena solo tras MAX_SILENT_FAILS fallos seguidos (token vencido,
  // API caida): sin eso quedaria pidiendo y fallando para siempre.
  // `timerKey` permite que una integración tenga su propio timer dentro del
  // mismo slice (ej: Mercado Libre "en vivo" usa mlRefreshTimer, para no
  // depender del negocio activo ni morir cuando el router limpia refreshTimer).
  function createRefreshScheduler(hooks) {
    const timerKey = hooks.timerKey || "refreshTimer";
    return function scheduleRefresh() {
      const slice = hooks.slice();
      root.clearInterval(slice[timerKey]);
      slice[timerKey] = 0;
      const seconds = Number(hooks.getIntervalSeconds());
      if (!seconds || !hooks.isEnabled()) return;
      if ((slice.failCount || 0) >= MAX_SILENT_FAILS) return;
      slice[timerKey] = root.setInterval(function () {
        if ((slice.failCount || 0) >= MAX_SILENT_FAILS) {
          root.clearInterval(slice[timerKey]);
          slice[timerKey] = 0;
          return;
        }
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
