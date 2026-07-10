/* ============================================================
   NEXUS Dashboard · Estado, datos, formato y persistencia (fuente compartida)
   Parte de window.NexusDash — namespace compartido (sin build).
   ============================================================ */
(function () {
  window.NexusDash = window.NexusDash || {};
  const S = window.NexusDash;
  const AUTH_KEY = window.NexusAuth.KEY;
  const AUTH_USER = window.NexusAuth.USER;
  const DASHBOARD_REVEAL_KEY = "nexus.dashboard.reveal.v1";
  const STORAGE_KEY = "nexus.personalFinance.movements.v1";
  const MONTH_FILTER_KEY = "nexus.personalFinance.monthFilter.v1";
  const META_CONFIG_KEY = "nexus.metaAds.config.v1";
  const META_DATA_KEY = "nexus.metaAds.snapshot.v1";
  const META_PLATFORMS_KEY = "nexus_meta_ads_platforms";
  const META_ACTIVE_PLATFORM_KEY = "nexus.metaAds.activePlatform.v1";
  const COMMERCE_CONFIG_KEY = "nexus.ecommerce.config.v1";
  const COMMERCE_DATA_KEY = "nexus.ecommerce.snapshot.v1";
  const CHART_VIEW_MODE_KEY = "nexus_chart_view_mode";

  // === Persistencia segura + respaldo (Ola 0) ================================
  // Claves que NO entran al respaldo: sesión y flags transitorios de UI.
  const NON_DATA_KEYS = new Set([AUTH_KEY, DASHBOARD_REVEAL_KEY]);

  // Escribe en localStorage capturando el error de cuota llena (~5MB), para que
  // el usuario nunca pierda datos en silencio creyendo que se guardaron.
  // Sincronización a la nube (Firestore), debounced. Si NexusFirestore no está
  // cargado (SDK ausente), es un no-op y el dashboard sigue solo con localStorage.
  let _cloudSyncTimer = null;
  function scheduleCloudSync(key) {
    if (!window.NexusFirestore) return;
    if (NON_DATA_KEYS.has(key) || String(key).indexOf("nexus") !== 0) return;
    if (_cloudSyncTimer) clearTimeout(_cloudSyncTimer);
    _cloudSyncTimer = setTimeout(function () {
      window.NexusFirestore.saveUserData(collectNexusData());
    }, 1500);
  }

  function safeSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
      scheduleCloudSync(key);
      return true;
    } catch (error) {
      console.error("Nexus: no se pudo guardar en localStorage:", key, error);
      if (error && (error.name === "QuotaExceededError" || error.code === 22)) {
        window.alert(
          "El almacenamiento local está lleno y no se pudo guardar el último cambio.\n\n" +
          'Usá "Exportar datos" para respaldar y liberá espacio para no perder información.'
        );
      }
      return false;
    }
  }

  // Junta todas las claves de datos de Nexus (finanzas, Meta, e-commerce).
  function collectNexusData() {
    const data = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || NON_DATA_KEYS.has(key) || key.indexOf("nexus") !== 0) continue;
      data[key] = localStorage.getItem(key);
    }
    return data;
  }

  // Descarga un respaldo JSON con todos los datos.
  function exportNexusData() {
    const payload = {
      app: "nexus",
      type: "backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: collectNexusData()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const link = document.createElement("a");
    link.href = url;
    link.download = "nexus-backup-" + stamp + ".json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Restaura un respaldo JSON previamente exportado y recarga la app.
  function importNexusData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result || "null"));
      } catch (error) {
        window.alert("El archivo no es un respaldo válido de Nexus (no es JSON).");
        return;
      }
      const data = parsed && typeof parsed.data === "object" && parsed.data ? parsed.data : null;
      const keys = data
        ? Object.keys(data).filter((k) => k.indexOf("nexus") === 0 && !NON_DATA_KEYS.has(k))
        : [];
      if (!keys.length) {
        window.alert("El archivo no tiene el formato de respaldo de Nexus.");
        return;
      }
      const ok = window.confirm(
        "Se van a restaurar " + keys.length + " conjuntos de datos y se REEMPLAZARÁN los actuales.\n\n¿Continuar?"
      );
      if (!ok) return;
      keys.forEach((k) => {
        if (typeof data[k] === "string") safeSetItem(k, data[k]);
      });
      window.alert("Datos restaurados. La página se va a recargar.");
      window.location.reload();
    };
    reader.onerror = () => window.alert("No se pudo leer el archivo.");
    reader.readAsText(file);
  }

  const mainSections = [
    {
      id: "finance",
      hash: "finanzas-personales",
      title: "Finanzas Personales",
      description: "Registra movimientos, entiende tu flujo mensual y controla tu ahorro disponible desde una sola interfaz."
    },
    {
      id: "meta",
      hash: "meta-ads",
      title: "Meta Ads",
      description: "Campañas, pixel, inversión, conversiones y ROAS por plataforma."
    },
    {
      id: "ecommerce",
      hash: "ecommerce",
      title: "E-Commerce",
      description: "Kairos, Billion, KiwiFi y plataformas de venta."
    }
  ];

  const metaPlatforms = [
    { id: "kairos", name: "Kairos", description: "Campañas, pixel y rentabilidad de Kairos.", accent: "#ff1a9d" },
    { id: "billion", name: "Billion", description: "Campañas, pixel y rentabilidad de Billion.", accent: "#52e1ff" },
    { id: "kiwifi", name: "KiwiFi", description: "Campañas, pixel y rentabilidad de KiwiFi.", accent: "#31e6ad" }
  ];

  function runDashboardReveal() {
    let shouldReveal = false;
    try {
      shouldReveal = sessionStorage.getItem(DASHBOARD_REVEAL_KEY) === "soft";
      sessionStorage.removeItem(DASHBOARD_REVEAL_KEY);
    } catch (error) {
      shouldReveal = document.documentElement.classList.contains("nexus-dashboard-reveal-pending");
    }

    if (!shouldReveal) return;

    document.documentElement.classList.add("nexus-dashboard-reveal-pending");
    requestAnimationFrame(() => {
      document.documentElement.classList.add("nexus-dashboard-reveal-active");
    });

    window.setTimeout(() => {
      document.documentElement.classList.remove("nexus-dashboard-reveal-pending", "nexus-dashboard-reveal-active");
    }, 1950);
  }

  const currency = new Intl.NumberFormat("es-419", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
  const moneyWithCents = new Intl.NumberFormat("es-419", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const compactNumber = new Intl.NumberFormat("es-419", {
    notation: "compact",
    maximumFractionDigits: 1
  });
  const integerNumber = new Intl.NumberFormat("es-419", {
    maximumFractionDigits: 0
  });
  const decimalNumber = new Intl.NumberFormat("es-419", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const categories = {
    income: ["Sueldo", "Ventas digitales", "Afiliados", "Freelance", "Rendimientos", "Otros ingresos"],
    expense: ["Vivienda", "Alimentación", "Transporte", "Marketing", "Suscripciones", "Salud", "Educación", "Ocio", "Impuestos", "Otros gastos"]
  };

  const categoryColors = [
    "#ff1a9d",
    "#b24dff",
    "#52e1ff",
    "#31e6ad",
    "#ffc85a",
    "#ff6b93",
    "#7aa8ff",
    "#ffffff",
    "#8b8b94",
    "#6df2d1"
  ];

  const sampleMovements = [
    ["income", "Ventas digitales", "Ventas Alpha Fitness", 4280, -1],
    ["income", "Afiliados", "Comisiones Hotmart", 940, -1],
    ["expense", "Vivienda", "Alquiler", 1350, -1],
    ["expense", "Marketing", "Creatividades y pauta", 620, -1],
    ["expense", "Suscripciones", "Herramientas SaaS", 184, -1],
    ["expense", "Alimentación", "Supermercado", 420, -1],
    ["income", "Freelance", "Proyecto automatizacion", 1800, -2],
    ["expense", "Educación", "Curso analítica", 290, -2],
    ["income", "Sueldo", "Ingreso mensual", 3200, -3],
    ["expense", "Transporte", "Movilidad", 210, -3],
    ["income", "Rendimientos", "Intereses", 160, -4],
    ["expense", "Salud", "Seguro medico", 250, -4],
    ["income", "Ventas digitales", "Venta e-commerce", 3650, -5],
    ["expense", "Ocio", "Viaje corto", 530, -5]
  ];

  const demoMetaRecords = [
    ["Alpha Fitness / Prospecting", "cmp-101", -6, 1140, 182400, 4920, 84, 6420, 5.63],
    ["Alpha Fitness / Prospecting", "cmp-101", -5, 980, 168200, 4380, 72, 5110, 5.21],
    ["Remarketing / Carritos", "cmp-102", -4, 620, 74600, 2960, 98, 7310, 11.79],
    ["Infoproducto / Lanzamiento", "cmp-103", -3, 1380, 221900, 5310, 64, 5180, 3.75],
    ["Dropshipping / Testing", "cmp-104", -2, 740, 116300, 2460, 28, 1490, 2.01],
    ["Remarketing / Carritos", "cmp-102", -1, 710, 82200, 3320, 116, 8690, 12.24],
    ["Alpha Fitness / Prospecting", "cmp-101", 0, 1220, 194100, 5120, 91, 7120, 5.84]
  ];

  const commerceApps = [
    { id: "kairos", name: "Kairos", model: "E-commerce operativo", accent: "#ff1a9d" },
    { id: "billion", name: "Billion", model: "Marca digital", accent: "#52e1ff" },
    { id: "kiwifi", name: "KiwiFi", model: "Tienda / checkout", accent: "#31e6ad" }
  ];

  const demoCommerceData = {
    kairos: [
      ["KR-1042", "Diego M.", "Kit premium", "Pagado", 248, 92, 312, -6],
      ["KR-1048", "Laura S.", "Pack mensual", "Enviado", 134, 48, 228, -5],
      ["KR-1051", "Matias R.", "Bundle pro", "Pagado", 319, 127, 348, -4],
      ["KR-1056", "Sofia C.", "Kit premium", "Pendiente", 248, 86, 401, -3],
      ["KR-1063", "Nicolas A.", "Starter pack", "Pagado", 88, 31, 276, -2],
      ["KR-1068", "Camila P.", "Bundle pro", "Enviado", 319, 121, 438, -1],
      ["KR-1071", "Andres G.", "Kit premium", "Pagado", 248, 95, 512, 0]
    ],
    billion: [
      ["BL-2201", "Paula N.", "Membership anual", "Pagado", 499, 311, 920, -6],
      ["BL-2207", "Ramon V.", "Plan launch", "Pagado", 279, 162, 760, -5],
      ["BL-2210", "Julia K.", "Membership anual", "Enviado", 499, 304, 1080, -4],
      ["BL-2218", "Carlos F.", "Upsell elite", "Pagado", 189, 102, 840, -3],
      ["BL-2222", "Valeria B.", "Plan launch", "Pendiente", 279, 142, 690, -2],
      ["BL-2229", "Martin E.", "Membership anual", "Pagado", 499, 318, 1120, -1]
    ],
    kiwifi: [
      ["KW-3102", "Mica T.", "Checkout starter", "Pagado", 69, 34, 420, -6],
      ["KW-3109", "Bruno H.", "Pack creator", "Enviado", 149, 73, 510, -5],
      ["KW-3114", "Ana L.", "Pack creator", "Pagado", 149, 75, 620, -4],
      ["KW-3121", "Pedro O.", "Checkout starter", "Pagado", 69, 32, 480, -3],
      ["KW-3127", "Lucia J.", "Suite pro", "Pagado", 289, 151, 730, -2],
      ["KW-3133", "Tomas Q.", "Suite pro", "Pendiente", 289, 145, 690, -1],
      ["KW-3139", "Eva D.", "Pack creator", "Enviado", 149, 71, 800, 0]
    ]
  };

  const elements = {
    viewTitle: document.getElementById("viewTitle"),
    viewDescription: document.getElementById("viewDescription"),
    monthFilter: document.getElementById("monthFilter"),
    seedDataButton: document.getElementById("seedDataButton"),
    topbarActions: document.querySelector(".topbar-actions"),
    financeTools: document.getElementById("financeTools"),
    chartViewToggle: document.getElementById("chartViewToggle"),
    chartModeButtons: Array.from(document.querySelectorAll("[data-chart-mode]")),
    chartResetButton: document.getElementById("chartResetButton"),
    navButtons: Array.from(document.querySelectorAll("[data-view]")),
    panels: Array.from(document.querySelectorAll("[data-panel]")),
    welcomeCards: Array.from(document.querySelectorAll("[data-welcome-view]")),
    balanceValue: document.getElementById("balanceValue"),
    incomeValue: document.getElementById("incomeValue"),
    expenseValue: document.getElementById("expenseValue"),
    savingValue: document.getElementById("savingValue"),
    balanceHint: document.getElementById("balanceHint"),
    incomeHint: document.getElementById("incomeHint"),
    expenseHint: document.getElementById("expenseHint"),
    savingHint: document.getElementById("savingHint"),
    cashflowChart: document.getElementById("cashflowChart"),
    categoryChart: document.getElementById("categoryChart"),
    categoryLegend: document.getElementById("categoryLegend"),
    form: document.getElementById("movementForm"),
    formTitle: document.getElementById("formTitle"),
    movementId: document.getElementById("movementId"),
    movementType: document.getElementById("movementType"),
    movementAmount: document.getElementById("movementAmount"),
    movementDate: document.getElementById("movementDate"),
    movementCategory: document.getElementById("movementCategory"),
    movementDescription: document.getElementById("movementDescription"),
    saveMovementButton: document.getElementById("saveMovementButton"),
    cancelEditButton: document.getElementById("cancelEditButton"),
    typeFilter: document.getElementById("typeFilter"),
    categoryFilter: document.getElementById("categoryFilter"),
    movementsTable: document.getElementById("movementsTable"),
    emptyState: document.getElementById("emptyState"),
    metaConfigForm: document.getElementById("metaConfigForm"),
    metaPlatformSelector: document.getElementById("metaPlatformSelector"),
    metaPlatformWorkspace: document.getElementById("metaPlatformWorkspace"),
    metaPlatformCards: document.getElementById("metaPlatformCards"),
    metaBackButton: document.getElementById("metaBackButton"),
    metaPlatformEyebrow: document.getElementById("metaPlatformEyebrow"),
    metaPlatformTitle: document.getElementById("metaPlatformTitle"),
    metaPlatformDescription: document.getElementById("metaPlatformDescription"),
    metaPixelId: document.getElementById("metaPixelId"),
    metaAdAccountId: document.getElementById("metaAdAccountId"),
    metaApiVersion: document.getElementById("metaApiVersion"),
    metaDatePreset: document.getElementById("metaDatePreset"),
    metaAccessToken: document.getElementById("metaAccessToken"),
    metaRefreshInterval: document.getElementById("metaRefreshInterval"),
    metaSyncButton: document.getElementById("metaSyncButton"),
    metaDemoButton: document.getElementById("metaDemoButton"),
    metaClearButton: document.getElementById("metaClearButton"),
    metaMessage: document.getElementById("metaMessage"),
    metaConnectionStatus: document.getElementById("metaConnectionStatus"),
    metaStatusTitle: document.getElementById("metaStatusTitle"),
    metaStatusDetail: document.getElementById("metaStatusDetail"),
    metaDataSource: document.getElementById("metaDataSource"),
    metaSpendValue: document.getElementById("metaSpendValue"),
    metaSpendHint: document.getElementById("metaSpendHint"),
    metaImpressionsValue: document.getElementById("metaImpressionsValue"),
    metaImpressionsHint: document.getElementById("metaImpressionsHint"),
    metaClicksValue: document.getElementById("metaClicksValue"),
    metaCtrHint: document.getElementById("metaCtrHint"),
    metaCpcValue: document.getElementById("metaCpcValue"),
    metaConversionsValue: document.getElementById("metaConversionsValue"),
    metaConversionsHint: document.getElementById("metaConversionsHint"),
    metaRoasValue: document.getElementById("metaRoasValue"),
    metaRoasHint: document.getElementById("metaRoasHint"),
    metaPixelLabel: document.getElementById("metaPixelLabel"),
    metaAccountLabel: document.getElementById("metaAccountLabel"),
    metaLastSync: document.getElementById("metaLastSync"),
    metaSourceLabel: document.getElementById("metaSourceLabel"),
    metaCampaignTable: document.getElementById("metaCampaignTable"),
    metaEmptyState: document.getElementById("metaEmptyState"),
    metaEventList: document.getElementById("metaEventList"),
    metaTrendChart: document.getElementById("metaTrendChart"),
    commerceAppSwitcher: document.getElementById("commerceAppSwitcher"),
    commerceConfigForm: document.getElementById("commerceConfigForm"),
    commerceConfigTitle: document.getElementById("commerceConfigTitle"),
    commercePixelId: document.getElementById("commercePixelId"),
    commerceApiUrl: document.getElementById("commerceApiUrl"),
    commerceApiToken: document.getElementById("commerceApiToken"),
    commerceRefreshInterval: document.getElementById("commerceRefreshInterval"),
    commerceSyncButton: document.getElementById("commerceSyncButton"),
    commerceDemoButton: document.getElementById("commerceDemoButton"),
    commerceClearButton: document.getElementById("commerceClearButton"),
    commerceMessage: document.getElementById("commerceMessage"),
    commerceDataSource: document.getElementById("commerceDataSource"),
    commerceRevenueValue: document.getElementById("commerceRevenueValue"),
    commerceRevenueHint: document.getElementById("commerceRevenueHint"),
    commerceOrdersValue: document.getElementById("commerceOrdersValue"),
    commerceOrdersHint: document.getElementById("commerceOrdersHint"),
    commerceAovValue: document.getElementById("commerceAovValue"),
    commerceConversionValue: document.getElementById("commerceConversionValue"),
    commerceTrafficHint: document.getElementById("commerceTrafficHint"),
    commerceMarginValue: document.getElementById("commerceMarginValue"),
    commerceMarginHint: document.getElementById("commerceMarginHint"),
    commerceStatusValue: document.getElementById("commerceStatusValue"),
    commerceStatusHint: document.getElementById("commerceStatusHint"),
    commerceActiveLabel: document.getElementById("commerceActiveLabel"),
    commercePixelLabel: document.getElementById("commercePixelLabel"),
    commerceEndpointLabel: document.getElementById("commerceEndpointLabel"),
    commerceLastSync: document.getElementById("commerceLastSync"),
    commerceOrdersTable: document.getElementById("commerceOrdersTable"),
    commerceEmptyState: document.getElementById("commerceEmptyState"),
    commerceProductList: document.getElementById("commerceProductList"),
    commerceTrendChart: document.getElementById("commerceTrendChart"),
    chartTooltip: document.getElementById("chartTooltip"),
    logoutButton: document.querySelector("[data-logout]"),
    exportButton: document.querySelector("[data-export]"),
    importButton: document.querySelector("[data-import]"),
    importInput: document.querySelector("[data-import-input]")
  };

  const state = {
    movements: loadMovements(),
    filters: {
      month: localStorage.getItem(MONTH_FILTER_KEY) || currentMonth(),
      type: "all",
      category: "all"
    },
    activeView: "welcome",
    chartMode: localStorage.getItem(CHART_VIEW_MODE_KEY) === "3d" ? "3d" : "2d",
    meta: {
      platforms: loadMetaPlatforms(),
      selectedPlatform: null,
      config: defaultMetaConfig(),
      snapshot: null,
      syncing: false,
      message: "",
      messageType: "",
      refreshTimer: 0
    },
    commerce: {
      activeApp: localStorage.getItem("nexus.ecommerce.activeApp.v1") || "kairos",
      configs: loadCommerceConfigs(),
      snapshots: loadCommerceSnapshots(),
      syncing: false,
      message: "",
      messageType: "",
      refreshTimer: 0
    }
  };

  if (!commerceApps.some((app) => app.id === state.commerce.activeApp)) {
    state.commerce.activeApp = commerceApps[0].id;
    safeSetItem("nexus.ecommerce.activeApp.v1", state.commerce.activeApp);
  }

  // Re-lee del localStorage los campos del state que se cargan al arrancar.
  // Necesario tras bajar datos de la nube (Firestore) en un dispositivo nuevo:
  // el state se armó con el localStorage vacío y hay que re-hidratarlo antes de
  // renderizar. Espeja el inicializador de `state` de arriba.
  function rehydrateState() {
    state.movements = loadMovements();
    state.filters.month = localStorage.getItem(MONTH_FILTER_KEY) || currentMonth();
    state.chartMode = localStorage.getItem(CHART_VIEW_MODE_KEY) === "3d" ? "3d" : "2d";
    state.meta.platforms = loadMetaPlatforms();
    state.commerce.activeApp = localStorage.getItem("nexus.ecommerce.activeApp.v1") || "kairos";
    state.commerce.configs = loadCommerceConfigs();
    state.commerce.snapshots = loadCommerceSnapshots();
    if (!commerceApps.some((app) => app.id === state.commerce.activeApp)) {
      state.commerce.activeApp = commerceApps[0].id;
    }
  }

  const chartTargets = new Map();

  function currentMonth() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function toDateInput(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function shiftMonth(monthKey, offset) {
    const [year, month] = monthKey.split("-").map(Number);
    const date = new Date(year, month - 1 + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function labelMonth(monthKey) {
    if (monthKey === "all") return "Todos los meses";
    const [year, month] = monthKey.split("-").map(Number);
    return new Intl.DateTimeFormat("es-419", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
  }

  function loadMovements() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(isValidMovement) : [];
    } catch (error) {
      return [];
    }
  }

  function isValidMovement(item) {
    return item && item.id && item.date && ["income", "expense"].includes(item.type) && Number(item.amount) > 0;
  }

  function saveMovements() {
    safeSetItem(STORAGE_KEY, JSON.stringify(state.movements));
  }

  function defaultMetaConfig() {
    return {
      pixelId: "",
      adAccountId: "",
      apiVersion: "v23.0",
      datePreset: "last_30d",
      accessToken: "",
      hasToken: false,
      refreshInterval: "0"
    };
  }

  // Nunca persistir el secreto en localStorage (vive cifrado en Firestore vía el
  // proxy serverless). Devuelve una copia con el campo secreto vaciado y un flag
  // hasToken que indica que existe un token guardado.
  function stripSecret(config, field) {
    if (!config || typeof config !== "object") return config;
    const clone = { ...config };
    const had = Boolean(clone[field]) || Boolean(clone.hasToken);
    clone[field] = "";
    clone.hasToken = had;
    return clone;
  }

  function loadMetaConfig() {
    try {
      const parsed = JSON.parse(localStorage.getItem(META_CONFIG_KEY) || "null");
      return { ...defaultMetaConfig(), ...(parsed && typeof parsed === "object" ? parsed : {}) };
    } catch (error) {
      return defaultMetaConfig();
    }
  }

  function saveMetaConfig() {
    if (state.meta.selectedPlatform) {
      persistActiveMetaPlatform();
      return;
    }
    safeSetItem(META_CONFIG_KEY, JSON.stringify(stripSecret(state.meta.config, "accessToken")));
  }

  function loadMetaSnapshot() {
    try {
      const parsed = JSON.parse(localStorage.getItem(META_DATA_KEY) || "null");
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function saveMetaSnapshot(snapshot) {
    state.meta.snapshot = snapshot;
    if (state.meta.selectedPlatform) {
      persistActiveMetaPlatform();
      return;
    }
    safeSetItem(META_DATA_KEY, JSON.stringify(snapshot));
  }

  function defaultMetaPlatformState(platform) {
    return {
      id: platform.id,
      name: platform.name,
      config: defaultMetaConfig(),
      snapshot: null
    };
  }

  function loadMetaPlatforms() {
    let stored = {};
    try {
      const parsed = JSON.parse(localStorage.getItem(META_PLATFORMS_KEY) || "null");
      stored = parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      stored = {};
    }

    const legacyConfig = loadMetaConfig();
    const legacySnapshot = loadMetaSnapshot();
    const hasLegacy = Boolean(legacyConfig.pixelId || legacyConfig.adAccountId || legacyConfig.accessToken || legacySnapshot);

    return metaPlatforms.reduce((acc, platform, index) => {
      const saved = stored[platform.id] && typeof stored[platform.id] === "object" ? stored[platform.id] : {};
      acc[platform.id] = {
        ...defaultMetaPlatformState(platform),
        ...saved,
        config: {
          ...defaultMetaConfig(),
          ...(saved.config && typeof saved.config === "object" ? saved.config : {})
        },
        snapshot: saved.snapshot || null
      };

      if (index === 0 && hasLegacy && !saved.config && !saved.snapshot) {
        acc[platform.id].config = legacyConfig;
        acc[platform.id].snapshot = legacySnapshot;
      }
      return acc;
    }, {});
  }

  function saveMetaPlatforms() {
    // Cada plataforma guarda su config sin el accessToken (vive cifrado en Firestore).
    const sanitized = {};
    Object.keys(state.meta.platforms).forEach((id) => {
      const ps = state.meta.platforms[id];
      sanitized[id] = { ...ps, config: stripSecret(ps.config, "accessToken") };
    });
    safeSetItem(META_PLATFORMS_KEY, JSON.stringify(sanitized));
  }

  function getMetaPlatform(id = state.meta.selectedPlatform) {
    return metaPlatforms.find((platform) => platform.id === id) || null;
  }

  function getMetaPlatformState(id = state.meta.selectedPlatform) {
    const platform = getMetaPlatform(id);
    if (!platform) return null;
    if (!state.meta.platforms[id]) {
      state.meta.platforms[id] = defaultMetaPlatformState(platform);
    }
    return state.meta.platforms[id];
  }

  function loadActiveMetaPlatform() {
    const platformState = getMetaPlatformState();
    state.meta.config = {
      ...defaultMetaConfig(),
      ...(platformState?.config || {})
    };
    state.meta.snapshot = platformState?.snapshot || null;
  }

  function persistActiveMetaPlatform() {
    const platformState = getMetaPlatformState();
    if (!platformState) return;
    platformState.config = { ...defaultMetaConfig(), ...state.meta.config };
    platformState.snapshot = state.meta.snapshot || null;
    saveMetaPlatforms();
  }

  function normalizeAdAccountId(value) {
    const clean = String(value || "").trim();
    if (!clean) return "";
    if (/^act_\d+$/i.test(clean)) return `act_${clean.replace(/^act_/i, "")}`;
    const digits = clean.replace(/\D/g, "");
    return digits ? `act_${digits}` : clean;
  }

  function normalizeApiVersion(value) {
    const clean = String(value || "").trim().toLowerCase();
    if (!clean) return "v23.0";
    if (/^v\d+\.\d+$/.test(clean)) return clean;
    const number = clean.replace(/[^\d.]/g, "");
    return number ? `v${number}` : "v23.0";
  }

  function formatMetaDate(value) {
    if (!value) return "Sin sincronizar";
    try {
      return new Intl.DateTimeFormat("es-419", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(value));
    } catch (error) {
      return "Sin sincronizar";
    }
  }

  function defaultCommerceConfig() {
    return {
      pixelId: "",
      apiUrl: "",
      apiToken: "",
      hasToken: false,
      refreshInterval: "0"
    };
  }

  function loadCommerceConfigs() {
    try {
      const parsed = JSON.parse(localStorage.getItem(COMMERCE_CONFIG_KEY) || "null");
      const configs = parsed && typeof parsed === "object" ? parsed : {};
      return commerceApps.reduce((acc, app) => {
        acc[app.id] = { ...defaultCommerceConfig(), ...(configs[app.id] || {}) };
        return acc;
      }, {});
    } catch (error) {
      return commerceApps.reduce((acc, app) => {
        acc[app.id] = defaultCommerceConfig();
        return acc;
      }, {});
    }
  }

  function saveCommerceConfigs() {
    // Cada negocio guarda su config sin el apiToken (vive cifrado en Firestore).
    const sanitized = {};
    Object.keys(state.commerce.configs).forEach((id) => {
      sanitized[id] = stripSecret(state.commerce.configs[id], "apiToken");
    });
    safeSetItem(COMMERCE_CONFIG_KEY, JSON.stringify(sanitized));
  }

  function loadCommerceSnapshots() {
    try {
      const parsed = JSON.parse(localStorage.getItem(COMMERCE_DATA_KEY) || "null");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function saveCommerceSnapshots() {
    safeSetItem(COMMERCE_DATA_KEY, JSON.stringify(state.commerce.snapshots));
  }

  function getCommerceApp(id = state.commerce.activeApp) {
    return commerceApps.find((app) => app.id === id) || commerceApps[0];
  }

  function getCommerceConfig(id = state.commerce.activeApp) {
    return state.commerce.configs[id] || defaultCommerceConfig();
  }

  function getCommerceSnapshot(id = state.commerce.activeApp) {
    return state.commerce.snapshots[id] || null;
  }

  function hasCommerceConnection(config = getCommerceConfig()) {
    return Boolean(config.pixelId && config.apiUrl && (config.apiToken || config.hasToken));
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function movementMonth(movement) {
    return movement.date.slice(0, 7);
  }

  function getFilteredMovements({ includeMonth = true } = {}) {
    return state.movements.filter((movement) => {
      if (includeMonth && state.filters.month !== "all" && movementMonth(movement) !== state.filters.month) return false;
      if (state.filters.type !== "all" && movement.type !== state.filters.type) return false;
      if (state.filters.category !== "all" && movement.category !== state.filters.category) return false;
      return true;
    });
  }

  function summarize(movements) {
    const income = movements.filter((movement) => movement.type === "income").reduce((sum, movement) => sum + Number(movement.amount), 0);
    const expense = movements.filter((movement) => movement.type === "expense").reduce((sum, movement) => sum + Number(movement.amount), 0);
    return {
      income,
      expense,
      balance: income - expense,
      savingRate: income > 0 ? ((income - expense) / income) * 100 : 0,
      incomeCount: movements.filter((movement) => movement.type === "income").length,
      expenseCount: movements.filter((movement) => movement.type === "expense").length
    };
  }

  function formatDate(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("es-419", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(year, month - 1, day));
  }

  function updateTopbarForView(view) {
    const platform = state.meta.selectedPlatform ? getMetaPlatform() : null;
    elements.topbarActions?.classList.toggle("is-hidden", view === "welcome" || (view === "meta" && !platform));
    elements.financeTools?.classList.toggle("is-hidden", view !== "finance");

    if (view === "welcome") {
      elements.viewTitle.textContent = "Hola, Diego!";
      document.title = "Nexus Dashboard - Centro de Control";
      elements.viewDescription.textContent = "¿Con qué quieres trabajar hoy?";
      return;
    }

    if (view === "meta") {
      elements.viewTitle.textContent = platform ? `Meta Ads / ${platform.name}` : "Meta Ads";
      document.title = platform ? `Nexus Dashboard - Meta Ads / ${platform.name}` : "Nexus Dashboard - Meta Ads";
      elements.viewDescription.textContent = platform
        ? platform.description
        : "Elige Kairos, Billion o KiwiFi para conectar campañas, pixel, inversión, conversiones y ROAS.";
      return;
    }

    if (view === "ecommerce") {
      elements.viewTitle.textContent = "E-Commerce";
      document.title = "Nexus Dashboard - E-Commerce";
      elements.viewDescription.textContent = "Administra Kairos, Billion y KiwiFi con pixel, ventas, pedidos, productos, conversiones y sincronizacion en tiempo real.";
      return;
    }

    elements.viewTitle.textContent = "Finanzas Personales";
    document.title = "Nexus Dashboard - Finanzas Personales";
    elements.viewDescription.textContent = "Registra movimientos, entiende tu flujo mensual y controla tu ahorro disponible desde una sola interfaz.";
  }

  function animateActivePanel() {
    const activePanel = elements.panels.find((panel) => panel.classList.contains("is-active"));
    if (!activePanel) return;
    activePanel.classList.remove("is-entering");
    void activePanel.offsetWidth;
    activePanel.classList.add("is-entering");
    window.setTimeout(() => activePanel.classList.remove("is-entering"), 1250);
  }


  Object.assign(S, {
    AUTH_KEY, AUTH_USER, CHART_VIEW_MODE_KEY, COMMERCE_CONFIG_KEY, COMMERCE_DATA_KEY, DASHBOARD_REVEAL_KEY,
    META_ACTIVE_PLATFORM_KEY, META_CONFIG_KEY, META_DATA_KEY, META_PLATFORMS_KEY, MONTH_FILTER_KEY, NON_DATA_KEYS,
    STORAGE_KEY, animateActivePanel, categories, categoryColors, chartTargets, collectNexusData,
    commerceApps, compactNumber, currency, currentMonth, decimalNumber, defaultCommerceConfig,
    defaultMetaConfig, defaultMetaPlatformState, demoCommerceData, demoMetaRecords, elements, escapeHtml,
    exportNexusData, formatDate, formatMetaDate, getCommerceApp, getCommerceConfig, getCommerceSnapshot,
    getFilteredMovements, getMetaPlatform, getMetaPlatformState, hasCommerceConnection, importNexusData, integerNumber,
    isValidMovement, labelMonth, loadActiveMetaPlatform, loadCommerceConfigs, loadCommerceSnapshots, loadMetaConfig,
    loadMetaPlatforms, loadMetaSnapshot, loadMovements, mainSections, metaPlatforms, moneyWithCents,
    movementMonth, normalizeAdAccountId, normalizeApiVersion, persistActiveMetaPlatform, runDashboardReveal, safeSetItem,
    sampleMovements, saveCommerceConfigs, saveCommerceSnapshots, saveMetaConfig, saveMetaPlatforms, saveMetaSnapshot,
    saveMovements, shiftMonth, state, summarize, toDateInput, updateTopbarForView,
    rehydrateState,
  });
})();
