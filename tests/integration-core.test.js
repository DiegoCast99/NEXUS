/* NEXUS · Tests del núcleo de integraciones (Node puro, sin dependencias).
   Correr: node tests/run.js  (o node tests/integration-core.test.js) */
const { test, ok, done } = require("./helpers");
const path = require("path");

// El core exporta CommonJS cuando corre en Node.
const core = require(path.join(__dirname, "..", "js", "dashboard", "integration-core.js"));

function fakeElement() {
  const classes = new Set();
  return {
    textContent: "",
    classList: {
      toggle(name, on) { on ? classes.add(name) : classes.delete(name); },
      has(name) { return classes.has(name); }
    }
  };
}

test("createIntegrationMessenger escribe estado y elemento", () => {
  const slice = { message: "", messageType: "" };
  const el = fakeElement();
  const setMessage = core.createIntegrationMessenger({ slice: () => slice, getElement: () => el });
  setMessage("Hola", "error");
  ok("guarda message en el slice", slice.message === "Hola" && slice.messageType === "error");
  ok("refleja el texto en el elemento", el.textContent === "Hola");
  ok("clase is-error puesta", el.classList.has("is-error") && !el.classList.has("is-success"));
  setMessage("Listo", "success");
  ok("cambia a is-success y quita is-error", el.classList.has("is-success") && !el.classList.has("is-error"));
});

test("createIntegrationMessenger tolera elemento ausente", () => {
  const slice = { message: "", messageType: "" };
  const setMessage = core.createIntegrationMessenger({ slice: () => slice, getElement: () => null });
  setMessage("Sin DOM", "success");
  ok("no explota y guarda estado", slice.message === "Sin DOM");
});

test("runIntegrationSync: camino feliz", async () => {
  const slice = { syncing: false };
  const eventos = [];
  await core.runIntegrationSync({
    slice: () => slice,
    silent: false,
    setMessage: (m, t) => eventos.push(["msg", m, t]),
    syncingMessage: "Sincronizando...",
    render: () => eventos.push(["render", slice.syncing]),
    errorFallback: "Fallo genérico.",
    after: () => eventos.push(["after"]),
    run: async () => { eventos.push(["run"]); return "Éxito total."; }
  });
  ok("syncing quedó en false", slice.syncing === false);
  ok("mensaje de sincronizando primero", eventos[0][1] === "Sincronizando...");
  ok("render con syncing=true antes de run", eventos[1][0] === "render" && eventos[1][1] === true);
  ok("mensaje de éxito con type success", eventos.some((e) => e[0] === "msg" && e[1] === "Éxito total." && e[2] === "success"));
  ok("render final con syncing=false", eventos.filter((e) => e[0] === "render").pop()[1] === false);
  ok("after corre al final", eventos[eventos.length - 1][0] === "after");
});

test("runIntegrationSync: camino de error", async () => {
  const slice = { syncing: false };
  const mensajes = [];
  let afterCorrio = false;
  await core.runIntegrationSync({
    slice: () => slice,
    silent: true,
    setMessage: (m, t) => mensajes.push([m, t]),
    syncingMessage: "NO debería aparecer (silent)",
    render: () => {},
    errorFallback: "Fallo genérico.",
    after: () => { afterCorrio = true; },
    run: async () => { throw new Error("Se rompió la API."); }
  });
  ok("silent: no muestra mensaje de sincronizando", !mensajes.some((m) => m[0].includes("NO debería")));
  ok("muestra el error con type error", mensajes.some((m) => m[0] === "Se rompió la API." && m[1] === "error"));
  ok("syncing se resetea aunque falle", slice.syncing === false);
  ok("after corre aunque falle", afterCorrio);
});

test("runIntegrationSync: error sin message usa fallback", async () => {
  const slice = { syncing: false };
  const mensajes = [];
  await core.runIntegrationSync({
    slice: () => slice,
    silent: true,
    setMessage: (m, t) => mensajes.push([m, t]),
    syncingMessage: "",
    render: () => {},
    errorFallback: "Fallo genérico.",
    run: async () => { throw {}; } // error raro sin .message
  });
  ok("usa el fallback", mensajes.some((m) => m[0] === "Fallo genérico." && m[1] === "error"));
});

test("persistProviderToken: guarda, limpia y marca hasToken", async () => {
  const llamadas = [];
  globalThis.NexusSecureAPI = {
    saveProviderToken: async (provider, token) => { llamadas.push([provider, token]); }
  };
  const config = { apiToken: "tok_123", hasToken: false };
  let saved = false, populated = false;
  const hubo = await core.persistProviderToken({
    config, field: "apiToken", provider: "commerce:kairos",
    saveConfig: () => { saved = true; }, populateForm: () => { populated = true; }
  });
  ok("devuelve true cuando había token", hubo === true);
  ok("llamó al proxy con provider+token", llamadas.length === 1 && llamadas[0][0] === "commerce:kairos" && llamadas[0][1] === "tok_123");
  ok("limpió el token de memoria", config.apiToken === "");
  ok("marcó hasToken", config.hasToken === true);
  ok("persistió y repobló el form", saved && populated);
  delete globalThis.NexusSecureAPI;
});

test("persistProviderToken: no-op sin token", async () => {
  let llamado = false;
  globalThis.NexusSecureAPI = { saveProviderToken: async () => { llamado = true; } };
  const config = { apiToken: "", hasToken: true };
  const hubo = await core.persistProviderToken({ config, field: "apiToken", provider: "x" });
  ok("devuelve false sin token", hubo === false);
  ok("no llama al proxy", !llamado);
  ok("hasToken intacto", config.hasToken === true);
  delete globalThis.NexusSecureAPI;
});

test("persistProviderToken: si el guardado falla, NO limpia el token (seguridad)", async () => {
  let saved = false, populated = false;
  globalThis.NexusSecureAPI = {
    saveProviderToken: async () => { throw new Error("Red caída."); }
  };
  const config = { apiToken: "tok_secreto", hasToken: false };
  let propago = null;
  try {
    await core.persistProviderToken({
      config, field: "apiToken", provider: "commerce:kairos",
      saveConfig: () => { saved = true; }, populateForm: () => { populated = true; }
    });
  } catch (e) { propago = e; }
  ok("propaga el error del guardado", !!propago && /Red caída/.test(propago.message));
  ok("el token QUEDA en memoria (no se pierde)", config.apiToken === "tok_secreto");
  ok("no marca hasToken en falso positivo", config.hasToken === false);
  ok("no persiste ni repobla el form", !saved && !populated);
  delete globalThis.NexusSecureAPI;
});

test("requireSecureApi lanza si no hay proxy", () => {
  delete globalThis.NexusSecureAPI;
  let error = null;
  try { core.requireSecureApi(); } catch (e) { error = e; }
  ok("lanza con mensaje claro", !!error && /proxy seguro/.test(error.message));
});

// Guarda los timers reales para restaurarlos: los tests del scheduler mockean
// globalThis.setInterval/clearInterval y no deben filtrarlos a otros tests.
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;

test("createRefreshScheduler programa y limpia", () => {
  try {
    const timers = [];
    globalThis.setInterval = (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; };
    globalThis.clearInterval = (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; };
    const slice = { refreshTimer: 0 };
    const syncs = [];
    const schedule = core.createRefreshScheduler({
      slice: () => slice,
      getIntervalSeconds: () => 30,
      isEnabled: () => true,
      sync: (opts) => syncs.push(opts)
    });
    schedule();
    ok("programó un intervalo de 30s", slice.refreshTimer === 1 && timers[0].ms === 30000);
    timers[0].fn();
    ok("el tick dispara sync silencioso", syncs.length === 1 && syncs[0].silent === true);
    schedule();
    ok("re-programar limpia el timer anterior", timers[0].cleared === true && slice.refreshTimer === 2);
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
});

test("createRefreshScheduler: deshabilitado no programa", () => {
  try {
    globalThis.setInterval = () => { throw new Error("no debería programar"); };
    globalThis.clearInterval = () => {};
    const slice = { refreshTimer: 99 };
    const schedule = core.createRefreshScheduler({
      slice: () => slice,
      getIntervalSeconds: () => 0,
      isEnabled: () => true,
      sync: () => {}
    });
    schedule();
    ok("con intervalo 0 resetea el timer y no programa", slice.refreshTimer === 0);
    const schedule2 = core.createRefreshScheduler({
      slice: () => slice,
      getIntervalSeconds: () => 60,
      isEnabled: () => false,
      sync: () => {}
    });
    schedule2();
    ok("sin credenciales no programa", slice.refreshTimer === 0);
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
});

done();
