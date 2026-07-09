(function () {
  const AUTH_KEY = "nexus.private.session.v1";
  const AUTH_USER = "DiegoCast99";
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

  function hasSession() {
    try {
      const session = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
      return session?.user === AUTH_USER;
    } catch (error) {
      return false;
    }
  }

  if (!hasSession()) {
    window.location.replace("./index.html");
    return;
  }

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
    logoutButton: document.querySelector("[data-logout]")
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
    localStorage.setItem("nexus.ecommerce.activeApp.v1", state.commerce.activeApp);
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.movements));
  }

  function defaultMetaConfig() {
    return {
      pixelId: "",
      adAccountId: "",
      apiVersion: "v23.0",
      datePreset: "last_30d",
      accessToken: "",
      refreshInterval: "0"
    };
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
    localStorage.setItem(META_CONFIG_KEY, JSON.stringify(state.meta.config));
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
    localStorage.setItem(META_DATA_KEY, JSON.stringify(snapshot));
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
    localStorage.setItem(META_PLATFORMS_KEY, JSON.stringify(state.meta.platforms));
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

  function setMetaMessage(message = "", type = "") {
    state.meta.message = message;
    state.meta.messageType = type;
    if (!elements.metaMessage) return;
    elements.metaMessage.textContent = message;
    elements.metaMessage.classList.toggle("is-error", type === "error");
    elements.metaMessage.classList.toggle("is-success", type === "success");
  }

  function defaultCommerceConfig() {
    return {
      pixelId: "",
      apiUrl: "",
      apiToken: "",
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
    localStorage.setItem(COMMERCE_CONFIG_KEY, JSON.stringify(state.commerce.configs));
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
    localStorage.setItem(COMMERCE_DATA_KEY, JSON.stringify(state.commerce.snapshots));
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
    return Boolean(config.pixelId && config.apiUrl && config.apiToken);
  }

  function setCommerceMessage(message = "", type = "") {
    state.commerce.message = message;
    state.commerce.messageType = type;
    if (!elements.commerceMessage) return;
    elements.commerceMessage.textContent = message;
    elements.commerceMessage.classList.toggle("is-error", type === "error");
    elements.commerceMessage.classList.toggle("is-success", type === "success");
  }

  function readCommerceConfigFromForm() {
    return {
      pixelId: String(elements.commercePixelId?.value || "").trim(),
      apiUrl: String(elements.commerceApiUrl?.value || "").trim(),
      apiToken: String(elements.commerceApiToken?.value || "").trim(),
      refreshInterval: elements.commerceRefreshInterval?.value || "0"
    };
  }

  function populateCommerceConfigForm() {
    const app = getCommerceApp();
    const config = getCommerceConfig(app.id);
    if (elements.commerceConfigTitle) elements.commerceConfigTitle.textContent = `Configurar ${app.name}`;
    if (elements.commercePixelId) elements.commercePixelId.value = config.pixelId || "";
    if (elements.commerceApiUrl) elements.commerceApiUrl.value = config.apiUrl || "";
    if (elements.commerceApiToken) elements.commerceApiToken.value = config.apiToken || "";
    if (elements.commerceRefreshInterval) elements.commerceRefreshInterval.value = config.refreshInterval || "0";
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function isMetaPlatformReady(id) {
    const platformState = getMetaPlatformState(id);
    return Boolean(platformState?.snapshot || hasMetaCredentials(platformState?.config || defaultMetaConfig()));
  }

  function renderMetaPlatformSelector() {
    if (!elements.metaPlatformCards) return;
    elements.metaPlatformCards.innerHTML = metaPlatforms.map((platform) => {
      const platformState = getMetaPlatformState(platform.id);
      const ready = isMetaPlatformReady(platform.id);
      const snapshot = platformState?.snapshot;
      const status = snapshot?.source === "live"
        ? "Conectado"
        : snapshot?.source === "demo"
          ? "Demo activo"
          : ready
            ? "Configuracion guardada"
            : "Sin conexion";
      return `
        <article class="meta-platform-card" data-meta-platform="${platform.id}" style="--platform-accent:${platform.accent}">
          <span>${ready ? "Configurado" : "Pendiente"}</span>
          <div>
            <h3>${escapeHtml(platform.name)}</h3>
            <p>${escapeHtml(platform.description)}</p>
          </div>
          <b class="platform-status ${ready ? "is-ready" : ""}">${escapeHtml(status)}</b>
          <button class="primary-button" type="button">Entrar</button>
        </article>
      `;
    }).join("");
  }

  function selectMetaPlatform(id, shouldPushHash = true) {
    const platform = getMetaPlatform(id);
    if (!platform) return;
    state.meta.selectedPlatform = id;
    localStorage.setItem(META_ACTIVE_PLATFORM_KEY, id);
    loadActiveMetaPlatform();
    setMetaMessage("", "");
    populateMetaConfigForm();
    renderMetaDashboard();
    updateTopbarForView("meta");
    animateActivePanel();
    if (shouldPushHash) history.replaceState(null, "", `#meta-ads-${id}`);
  }

  function clearSelectedMetaPlatform(shouldPushHash = true) {
    state.meta.selectedPlatform = null;
    localStorage.removeItem(META_ACTIVE_PLATFORM_KEY);
    state.meta.config = defaultMetaConfig();
    state.meta.snapshot = null;
    setMetaMessage("", "");
    renderMetaDashboard();
    updateTopbarForView("meta");
    animateActivePanel();
    if (shouldPushHash) history.replaceState(null, "", "#meta-ads");
  }

  function movementMonth(movement) {
    return movement.date.slice(0, 7);
  }

  function getAvailableMonths() {
    const months = new Set([currentMonth()]);
    for (let i = 1; i <= 11; i += 1) {
      months.add(shiftMonth(currentMonth(), -i));
    }
    state.movements.forEach((movement) => months.add(movementMonth(movement)));
    return Array.from(months).sort().reverse();
  }

  function populateMonthFilter() {
    const months = getAvailableMonths();
    elements.monthFilter.innerHTML = [
      `<option value="all">Todos los meses</option>`,
      ...months.map((month) => `<option value="${month}">${escapeHtml(labelMonth(month))}</option>`)
    ].join("");

    if (state.filters.month !== "all" && !months.includes(state.filters.month)) {
      state.filters.month = currentMonth();
    }
    elements.monthFilter.value = state.filters.month;
  }

  function populateMovementCategories() {
    const type = elements.movementType.value;
    elements.movementCategory.innerHTML = categories[type]
      .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
      .join("");
  }

  function populateCategoryFilter() {
    const allCategories = [...categories.income, ...categories.expense];
    elements.categoryFilter.innerHTML = [
      `<option value="all">Todas</option>`,
      ...allCategories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    ].join("");
    elements.categoryFilter.value = state.filters.category;
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

  function renderMetrics() {
    const filtered = getFilteredMovements();
    const totals = summarize(filtered);
    const monthLabel = labelMonth(state.filters.month);
    elements.balanceValue.textContent = currency.format(totals.balance);
    elements.incomeValue.textContent = currency.format(totals.income);
    elements.expenseValue.textContent = currency.format(totals.expense);
    elements.savingValue.textContent = currency.format(Math.max(0, totals.balance));
    elements.balanceHint.textContent = monthLabel;
    elements.incomeHint.textContent = `${totals.incomeCount} movimiento${totals.incomeCount === 1 ? "" : "s"}`;
    elements.expenseHint.textContent = `${totals.expenseCount} movimiento${totals.expenseCount === 1 ? "" : "s"}`;
    elements.savingHint.textContent = `${Math.max(0, totals.savingRate).toFixed(1)}% de tus ingresos`;
  }

  function getMonthlySeries() {
    const endingMonth = state.filters.month === "all" ? currentMonth() : state.filters.month;
    const months = Array.from({ length: 6 }, (_, index) => shiftMonth(endingMonth, index - 5));
    const baseData = getFilteredMovements({ includeMonth: false });
    return months.map((month) => {
      const movements = baseData.filter((movement) => movementMonth(movement) === month);
      const totals = summarize(movements);
      return { month, income: totals.income, expense: totals.expense };
    });
  }

  function resizeCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const fallbackHeight = Number(canvas.getAttribute("height") || rect.height || 220);
    const cssHeight = rect.height || fallbackHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: rect.width, height: cssHeight };
  }

  function drawNoData(ctx, width, height, label) {
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(243,243,248,0.12)";
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const y = 44 + i * ((height - 82) / 3);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(243,243,248,0.5)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, width / 2, height / 2);
    ctx.restore();
  }

  function prefersReducedMotion() {
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  function is3DMode() {
    return state.chartMode === "3d" && !prefersReducedMotion() && window.innerWidth > 760;
  }

  function applyChartMode() {
    document.body.classList.toggle("chart-mode-3d", is3DMode());
    document.body.classList.toggle("chart-mode-2d", !is3DMode());
    elements.chartModeButtons.forEach((button) => {
      const active = button.dataset.chartMode === state.chartMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setChartTargets(canvas, targets) {
    if (!canvas) return;
    chartTargets.set(canvas, targets);
  }

  function draw3DBar(ctx, x, y, width, height, radius, colorTop, colorBottom, depth = 8) {
    const safeHeight = Math.max(0, height);
    const dx = depth;
    const dy = -depth * 0.55;
    const gradient = ctx.createLinearGradient(0, y, 0, y + safeHeight);
    gradient.addColorStop(0, colorTop);
    gradient.addColorStop(1, colorBottom);

    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.moveTo(x + radius, y + dy);
    ctx.lineTo(x + width + dx - radius, y + dy);
    ctx.quadraticCurveTo(x + width + dx, y + dy, x + width + dx, y + radius + dy);
    ctx.lineTo(x + width, y + radius);
    ctx.quadraticCurveTo(x + width, y, x + width - radius, y);
    ctx.lineTo(x + radius, y);
    ctx.quadraticCurveTo(x, y, x + radius, y + dy);
    ctx.fill();

    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.moveTo(x + width, y + radius);
    ctx.lineTo(x + width + dx, y + dy + radius);
    ctx.lineTo(x + width + dx, y + safeHeight + dy);
    ctx.lineTo(x + width, y + safeHeight);
    ctx.closePath();
    ctx.fill();

    ctx.shadowColor = colorTop;
    ctx.shadowBlur = 14;
    ctx.fillStyle = gradient;
    roundedRect(ctx, x, y, width, safeHeight, radius);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function showChartTooltip(canvas, event) {
    const tooltip = elements.chartTooltip;
    const targets = chartTargets.get(canvas) || [];
    if (!tooltip || !targets.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = targets.find((target) => (
      x >= target.x && x <= target.x + target.width && y >= target.y && y <= target.y + target.height
    ));
    if (!hit) {
      tooltip.classList.remove("is-visible");
      return;
    }
    tooltip.innerHTML = hit.html;
    tooltip.style.left = `${Math.min(window.innerWidth - 280, event.clientX + 16)}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - 130, event.clientY + 16)}px`;
    tooltip.classList.add("is-visible");
  }

  function hideChartTooltip() {
    elements.chartTooltip?.classList.remove("is-visible");
  }

  function drawCashflowChart() {
    if (!elements.cashflowChart) return;
    const { ctx, width, height } = resizeCanvas(elements.cashflowChart);
    const series = getMonthlySeries();
    const maxValue = Math.max(...series.flatMap((item) => [item.income, item.expense]), 1) * 1.18;
    ctx.clearRect(0, 0, width, height);

    const padding = { top: 18, right: 18, bottom: 34, left: 38 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    if (series.every((item) => item.income === 0 && item.expense === 0)) {
      drawNoData(ctx, width, height, "Sin datos para la evolución mensual");
      setChartTargets(elements.cashflowChart, []);
      return;
    }

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.075)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    const groupW = chartW / series.length;
    const barW = Math.min(18, groupW * 0.2);
    const expensePoints = [];
    const targets = [];
    const use3D = is3DMode();

    series.forEach((item, index) => {
      const x = padding.left + index * groupW + groupW / 2;
      const incomeH = (item.income / maxValue) * chartH;
      const expenseH = (item.expense / maxValue) * chartH;
      const baseY = padding.top + chartH;

      if (use3D) {
        draw3DBar(ctx, x - barW - 3, baseY - incomeH, barW, incomeH, 5, "rgba(49,230,173,0.95)", "rgba(49,230,173,0.12)", 8);
        draw3DBar(ctx, x + 3, baseY - expenseH, barW, expenseH, 5, "rgba(255,26,157,0.95)", "rgba(255,26,157,0.12)", 8);
      } else {
        const incomeGradient = ctx.createLinearGradient(0, baseY - incomeH, 0, baseY);
        incomeGradient.addColorStop(0, "rgba(49,230,173,0.95)");
        incomeGradient.addColorStop(1, "rgba(49,230,173,0.12)");
        ctx.fillStyle = incomeGradient;
        roundedRect(ctx, x - barW - 3, baseY - incomeH, barW, incomeH, 5);
        ctx.fill();

        const expenseGradient = ctx.createLinearGradient(0, baseY - expenseH, 0, baseY);
        expenseGradient.addColorStop(0, "rgba(255,26,157,0.95)");
        expenseGradient.addColorStop(1, "rgba(255,26,157,0.12)");
        ctx.fillStyle = expenseGradient;
        roundedRect(ctx, x + 3, baseY - expenseH, barW, expenseH, 5);
        ctx.fill();
      }

      expensePoints.push({ x: x + barW / 2, y: baseY - expenseH });
      targets.push({
        x: x - groupW / 2,
        y: padding.top,
        width: groupW,
        height: chartH,
        html: `<b>${escapeHtml(labelMonth(item.month))}</b><span>Ingresos: ${moneyWithCents.format(item.income)}</span><span>Gastos: ${moneyWithCents.format(item.expense)}</span>`
      });

      ctx.fillStyle = "rgba(243,243,248,0.5)";
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText(labelMonth(item.month).slice(0, 3), x, height - 14);
    });

    ctx.beginPath();
    expensePoints.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "rgba(255,170,221,0.88)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(255,26,157,0.45)";
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.restore();
    setChartTargets(elements.cashflowChart, targets);
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, Math.max(0, height) / 2);
    ctx.beginPath();
    ctx.moveTo(x + safeRadius, y);
    ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
    ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
    ctx.arcTo(x, y + height, x, y, safeRadius);
    ctx.arcTo(x, y, x + width, y, safeRadius);
    ctx.closePath();
  }

  function drawCategoryChart() {
    if (!elements.categoryChart) return;
    const { ctx, width, height } = resizeCanvas(elements.categoryChart);
    const expenses = getFilteredMovements().filter((movement) => movement.type === "expense");
    const totals = new Map();
    expenses.forEach((movement) => totals.set(movement.category, (totals.get(movement.category) || 0) + Number(movement.amount)));
    const entries = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, item) => sum + item[1], 0);

    ctx.clearRect(0, 0, width, height);
    if (!entries.length) {
      drawNoData(ctx, width, height, "Sin gastos por categoría");
      elements.categoryLegend.innerHTML = "";
      setChartTargets(elements.categoryChart, []);
      return;
    }

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.35;
    let start = -Math.PI / 2;

    entries.forEach(([category, amount], index) => {
      const angle = (amount / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, start + angle);
      ctx.lineWidth = Math.max(16, radius * 0.22);
      ctx.strokeStyle = categoryColors[index % categoryColors.length];
      ctx.shadowColor = categoryColors[index % categoryColors.length];
      ctx.shadowBlur = index < 3 ? 12 : 4;
      ctx.stroke();
      start += angle;
    });

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(243,243,248,0.94)";
    ctx.font = "700 22px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(currency.format(total), cx, cy - 2);
    ctx.fillStyle = "rgba(243,243,248,0.52)";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("gastos", cx, cy + 18);

    elements.categoryLegend.innerHTML = entries.slice(0, 6).map(([category, amount], index) => {
      const percent = total ? (amount / total) * 100 : 0;
      return `<div class="legend-row"><i style="background:${categoryColors[index % categoryColors.length]}"></i><span>${escapeHtml(category)}</span><small>${percent.toFixed(1)}%</small></div>`;
    }).join("");
  }

  function renderMovements() {
    const filtered = getFilteredMovements().sort((a, b) => b.date.localeCompare(a.date));
    elements.emptyState.classList.toggle("is-visible", filtered.length === 0);
    elements.movementsTable.innerHTML = filtered.map((movement) => {
      const typeLabel = movement.type === "income" ? "Ingreso" : "Gasto";
      const amountClass = movement.type === "income" ? "amount-income" : "amount-expense";
      const sign = movement.type === "income" ? "+" : "-";
      return `
        <tr>
          <td>${escapeHtml(formatDate(movement.date))}</td>
          <td>${escapeHtml(movement.description)}</td>
          <td>${escapeHtml(movement.category)}</td>
          <td><span class="type-pill ${movement.type}">${typeLabel}</span></td>
          <td class="${amountClass}">${sign}${moneyWithCents.format(Number(movement.amount))}</td>
          <td>
            <div class="row-actions">
              <button class="table-action" type="button" data-action="edit" data-id="${movement.id}">Editar</button>
              <button class="table-action delete-action" type="button" data-action="delete" data-id="${movement.id}">Eliminar</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  function readMetaConfigFromForm() {
    return {
      pixelId: String(elements.metaPixelId?.value || "").trim(),
      adAccountId: normalizeAdAccountId(elements.metaAdAccountId?.value || ""),
      apiVersion: normalizeApiVersion(elements.metaApiVersion?.value || ""),
      datePreset: elements.metaDatePreset?.value || "last_30d",
      accessToken: String(elements.metaAccessToken?.value || "").trim(),
      refreshInterval: elements.metaRefreshInterval?.value || "0"
    };
  }

  function populateMetaConfigForm() {
    const config = state.meta.config;
    if (elements.metaPixelId) elements.metaPixelId.value = config.pixelId || "";
    if (elements.metaAdAccountId) elements.metaAdAccountId.value = config.adAccountId || "";
    if (elements.metaApiVersion) elements.metaApiVersion.value = config.apiVersion || "v23.0";
    if (elements.metaDatePreset) elements.metaDatePreset.value = config.datePreset || "last_30d";
    if (elements.metaAccessToken) elements.metaAccessToken.value = config.accessToken || "";
    if (elements.metaRefreshInterval) elements.metaRefreshInterval.value = config.refreshInterval || "0";
  }

  function hasMetaCredentials(config = state.meta.config) {
    return Boolean(config.pixelId && config.adAccountId && config.accessToken);
  }

  function getActionValue(actions, needles) {
    if (!Array.isArray(actions)) return 0;
    return actions.reduce((sum, action) => {
      const type = String(action.action_type || action.type || "").toLowerCase();
      const matches = needles.some((needle) => type === needle || type.includes(needle));
      return matches ? sum + (Number(action.value) || 0) : sum;
    }, 0);
  }

  function labelActionType(type) {
    const value = String(type || "").toLowerCase();
    if (value.includes("purchase")) return "Compras";
    if (value.includes("lead")) return "Leads";
    if (value.includes("initiate_checkout")) return "Checkouts iniciados";
    if (value.includes("add_to_cart")) return "Agregados al carrito";
    if (value.includes("complete_registration")) return "Registros";
    return value.replaceAll("_", " ").replaceAll(".", " ");
  }

  function extractMetaEvents(actions) {
    if (!Array.isArray(actions)) return [];
    const conversionNeedles = ["purchase", "lead", "initiate_checkout", "add_to_cart", "complete_registration"];
    const eventMap = new Map();
    actions.forEach((action) => {
      const type = String(action.action_type || "").toLowerCase();
      if (!conversionNeedles.some((needle) => type.includes(needle))) return;
      const label = labelActionType(type);
      eventMap.set(label, (eventMap.get(label) || 0) + (Number(action.value) || 0));
    });
    return Array.from(eventMap, ([name, value]) => ({ name, value }));
  }

  function getReportedRoas(row) {
    const list = Array.isArray(row.purchase_roas) ? row.purchase_roas : [];
    const purchase = list.find((item) => String(item.action_type || "").toLowerCase().includes("purchase")) || list[0];
    return Number(purchase?.value) || 0;
  }

  function normalizeMetaInsightsRow(row) {
    const spend = Number(row.spend) || 0;
    const impressions = Number(row.impressions) || 0;
    const clicks = Number(row.clicks) || 0;
    const conversionNeedles = ["purchase", "lead", "complete_registration"];
    const revenueNeedles = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];
    const conversions = getActionValue(row.actions, conversionNeedles);
    const actionRevenue = getActionValue(row.action_values, revenueNeedles);
    const reportedRoas = getReportedRoas(row);
    const revenue = actionRevenue || (reportedRoas ? reportedRoas * spend : 0);
    return {
      campaignId: String(row.campaign_id || row.id || row.campaign_name || "campana-sin-id"),
      campaignName: String(row.campaign_name || row.campaign_id || "Campaña sin nombre"),
      dateStart: row.date_start || row.date || "",
      spend,
      impressions,
      clicks,
      conversions,
      revenue,
      roas: spend > 0 ? revenue / spend : reportedRoas,
      events: extractMetaEvents(row.actions)
    };
  }

  function buildDemoMetaSnapshot() {
    const platformName = getMetaPlatform()?.name || "Nexus";
    const records = demoMetaRecords.map(([campaignName, campaignId, dayOffset, spend, impressions, clicks, conversions, revenue, roas]) => {
      const date = new Date();
      date.setDate(date.getDate() + dayOffset);
      return {
        campaignId,
        campaignName: campaignName.replace("Alpha Fitness", platformName),
        dateStart: toDateInput(date),
        spend,
        impressions,
        clicks,
        conversions,
        revenue,
        roas,
        events: [
          { name: "Compras", value: Math.round(conversions * 0.72) },
          { name: "Leads", value: Math.round(conversions * 0.28) },
          { name: "Checkouts iniciados", value: Math.round(conversions * 1.8) }
        ]
      };
    });
    return createMetaSnapshot(records, "demo");
  }

  function aggregateMetaCampaigns(records) {
    const campaigns = new Map();
    records.forEach((record) => {
      const key = record.campaignId || record.campaignName;
      const current = campaigns.get(key) || {
        campaignId: record.campaignId,
        campaignName: record.campaignName,
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        revenue: 0
      };
      current.spend += record.spend;
      current.impressions += record.impressions;
      current.clicks += record.clicks;
      current.conversions += record.conversions;
      current.revenue += record.revenue;
      campaigns.set(key, current);
    });
    return Array.from(campaigns.values()).map((campaign) => ({
      ...campaign,
      ctr: campaign.impressions ? (campaign.clicks / campaign.impressions) * 100 : 0,
      cpc: campaign.clicks ? campaign.spend / campaign.clicks : 0,
      roas: campaign.spend ? campaign.revenue / campaign.spend : 0
    })).sort((a, b) => b.spend - a.spend);
  }

  function aggregateMetaTrend(records) {
    const days = new Map();
    records.forEach((record) => {
      const date = record.dateStart || "Periodo";
      const current = days.get(date) || { date, spend: 0, revenue: 0 };
      current.spend += record.spend;
      current.revenue += record.revenue;
      days.set(date, current);
    });
    return Array.from(days.values())
      .map((item) => ({ ...item, roas: item.spend ? item.revenue / item.spend : 0 }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-10);
  }

  function aggregateMetaEvents(records) {
    const events = new Map();
    records.forEach((record) => {
      record.events.forEach((event) => {
        events.set(event.name, (events.get(event.name) || 0) + event.value);
      });
    });
    return Array.from(events, ([name, value]) => ({ name, value }))
      .filter((event) => event.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }

  function createMetaSnapshot(records, source) {
    const campaigns = aggregateMetaCampaigns(records);
    const totals = campaigns.reduce((total, campaign) => ({
      spend: total.spend + campaign.spend,
      impressions: total.impressions + campaign.impressions,
      clicks: total.clicks + campaign.clicks,
      conversions: total.conversions + campaign.conversions,
      revenue: total.revenue + campaign.revenue
    }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 });
    totals.ctr = totals.impressions ? (totals.clicks / totals.impressions) * 100 : 0;
    totals.cpc = totals.clicks ? totals.spend / totals.clicks : 0;
    totals.roas = totals.spend ? totals.revenue / totals.spend : 0;

    return {
      source,
      fetchedAt: new Date().toISOString(),
      config: {
        pixelId: state.meta.config.pixelId,
        adAccountId: state.meta.config.adAccountId,
        apiVersion: state.meta.config.apiVersion,
        datePreset: state.meta.config.datePreset
      },
      totals,
      campaigns,
      trend: aggregateMetaTrend(records),
      events: aggregateMetaEvents(records),
      recordCount: records.length
    };
  }

  async function fetchMetaInsights(config) {
    const fields = [
      "campaign_id",
      "campaign_name",
      "date_start",
      "date_stop",
      "spend",
      "impressions",
      "clicks",
      "ctr",
      "cpc",
      "actions",
      "action_values",
      "purchase_roas"
    ].join(",");
    const params = new URLSearchParams({
      access_token: config.accessToken,
      date_preset: config.datePreset,
      fields,
      level: "campaign",
      limit: "100",
      time_increment: "1"
    });
    let nextUrl = `https://graph.facebook.com/${config.apiVersion}/${config.adAccountId}/insights?${params.toString()}`;
    const rows = [];
    let page = 0;

    while (nextUrl && page < 5) {
      const response = await fetch(nextUrl, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) {
        const message = payload.error?.message || "Meta no pudo devolver datos para esta conexión.";
        throw new Error(message);
      }
      rows.push(...(Array.isArray(payload.data) ? payload.data : []));
      nextUrl = payload.paging?.next || "";
      page += 1;
    }

    return rows.map(normalizeMetaInsightsRow);
  }

  async function syncMetaAds({ demo = false, silent = false } = {}) {
    if (!state.meta.selectedPlatform) {
      setMetaMessage("Primero selecciona una plataforma de Meta Ads.", "error");
      renderMetaDashboard();
      return;
    }

    if (demo) {
      saveMetaSnapshot(buildDemoMetaSnapshot());
      setMetaMessage(`Demo cargada para ${getMetaPlatform().name}. Podés reemplazarla por datos reales al sincronizar.`, "success");
      renderMetaDashboard();
      return;
    }

    state.meta.config = readMetaConfigFromForm();
    saveMetaConfig();

    if (!hasMetaCredentials()) {
      setMetaMessage("Para traer datos reales necesitás Pixel ID, cuenta publicitaria y Access Token de Meta.", "error");
      renderMetaDashboard();
      return;
    }

    state.meta.syncing = true;
    if (!silent) setMetaMessage("Sincronizando Meta Ads...", "");
    renderMetaDashboard();

    try {
      const records = await fetchMetaInsights(state.meta.config);
      saveMetaSnapshot(createMetaSnapshot(records, "live"));
      setMetaMessage(records.length ? `Datos reales sincronizados para ${getMetaPlatform().name}.` : "Meta respondió sin campañas para este periodo.", "success");
    } catch (error) {
      setMetaMessage(error.message || "No se pudo sincronizar Meta Ads.", "error");
    } finally {
      state.meta.syncing = false;
      renderMetaDashboard();
      scheduleMetaRefresh();
    }
  }

  function scheduleMetaRefresh() {
    window.clearInterval(state.meta.refreshTimer);
    state.meta.refreshTimer = 0;
    if (!state.meta.selectedPlatform) return;
    const seconds = Number(state.meta.config.refreshInterval);
    if (!seconds || !hasMetaCredentials()) return;
    state.meta.refreshTimer = window.setInterval(() => {
      syncMetaAds({ silent: true });
    }, seconds * 1000);
  }

  function renderMetaDashboard() {
    renderMetaPlatformSelector();
    const platform = getMetaPlatform();
    const hasPlatform = Boolean(platform);
    elements.metaPlatformSelector?.classList.toggle("is-hidden", hasPlatform);
    elements.metaPlatformWorkspace?.classList.toggle("is-hidden", !hasPlatform);

    if (!hasPlatform) {
      drawMetaTrendChart();
      return;
    }

    if (elements.metaPlatformEyebrow) elements.metaPlatformEyebrow.textContent = `Meta Ads / ${platform.name}`;
    if (elements.metaPlatformTitle) elements.metaPlatformTitle.textContent = `Meta Ads / ${platform.name}`;
    if (elements.metaPlatformDescription) elements.metaPlatformDescription.textContent = platform.description;

    const snapshot = state.meta.snapshot;
    const totals = snapshot?.totals || { spend: 0, impressions: 0, clicks: 0, conversions: 0, ctr: 0, cpc: 0, roas: 0 };
    const campaigns = snapshot?.campaigns || [];
    const events = snapshot?.events || [];
    const sourceLabel = snapshot?.source === "live" ? "API real" : snapshot?.source === "demo" ? "Demo" : "Datos locales";
    const hasCredentials = hasMetaCredentials();

    if (elements.metaSpendValue) elements.metaSpendValue.textContent = currency.format(totals.spend);
    if (elements.metaSpendHint) elements.metaSpendHint.textContent = snapshot ? `${campaigns.length} campaña${campaigns.length === 1 ? "" : "s"}` : "Sin datos sincronizados";
    if (elements.metaImpressionsValue) elements.metaImpressionsValue.textContent = compactNumber.format(totals.impressions || 0);
    if (elements.metaImpressionsHint) elements.metaImpressionsHint.textContent = `${integerNumber.format(totals.impressions || 0)} impresiones`;
    if (elements.metaClicksValue) elements.metaClicksValue.textContent = compactNumber.format(totals.clicks || 0);
    if (elements.metaCtrHint) elements.metaCtrHint.textContent = `CTR ${decimalNumber.format(totals.ctr || 0)}%`;
    if (elements.metaCpcValue) elements.metaCpcValue.textContent = moneyWithCents.format(totals.cpc || 0);
    if (elements.metaConversionsValue) elements.metaConversionsValue.textContent = compactNumber.format(totals.conversions || 0);
    if (elements.metaConversionsHint) elements.metaConversionsHint.textContent = `${integerNumber.format(totals.conversions || 0)} conversiones`;
    if (elements.metaRoasValue) elements.metaRoasValue.textContent = `${(totals.roas || 0).toFixed(1)}x`;
    if (elements.metaRoasHint) elements.metaRoasHint.textContent = `Valor atribuido ${currency.format(totals.revenue || 0)}`;

    if (elements.metaPixelLabel) elements.metaPixelLabel.textContent = state.meta.config.pixelId || "No configurado";
    if (elements.metaAccountLabel) elements.metaAccountLabel.textContent = state.meta.config.adAccountId || "No configurada";
    if (elements.metaLastSync) elements.metaLastSync.textContent = formatMetaDate(snapshot?.fetchedAt);
    if (elements.metaSourceLabel) elements.metaSourceLabel.textContent = sourceLabel;
    if (elements.metaDataSource) elements.metaDataSource.textContent = sourceLabel;

    if (elements.metaConnectionStatus) {
      elements.metaConnectionStatus.classList.toggle("is-syncing", state.meta.syncing);
      elements.metaConnectionStatus.classList.toggle("is-live", !state.meta.syncing && snapshot?.source === "live");
      elements.metaConnectionStatus.classList.toggle("is-error", state.meta.messageType === "error");
    }
    if (elements.metaStatusTitle) {
      elements.metaStatusTitle.textContent = state.meta.syncing
        ? "Sincronizando"
        : snapshot?.source === "live"
          ? "Conectado"
          : snapshot?.source === "demo"
            ? "Modo demo"
            : hasCredentials
              ? "Listo para sincronizar"
              : "Sin conexión";
    }
    if (elements.metaStatusDetail) {
      elements.metaStatusDetail.textContent = snapshot
        ? `${sourceLabel} · ${formatMetaDate(snapshot.fetchedAt)}`
        : hasCredentials
          ? "Credenciales guardadas. Sincronizá para traer datos."
          : "Agrega Pixel ID, cuenta publicitaria y token.";
    }

    if (elements.metaCampaignTable) {
      elements.metaCampaignTable.innerHTML = campaigns.map((campaign) => {
        const roasClass = campaign.roas >= 4 ? "roas-good" : campaign.roas >= 2 ? "roas-mid" : "roas-low";
        return `
          <tr>
            <td>${escapeHtml(campaign.campaignName)}</td>
            <td>${moneyWithCents.format(campaign.spend)}</td>
            <td>${integerNumber.format(campaign.impressions)}</td>
            <td>${integerNumber.format(campaign.clicks)}</td>
            <td>${decimalNumber.format(campaign.ctr)}%</td>
            <td>${moneyWithCents.format(campaign.cpc)}</td>
            <td>${integerNumber.format(campaign.conversions)}</td>
            <td class="${roasClass}">${campaign.roas.toFixed(2)}x</td>
          </tr>
        `;
      }).join("");
    }
    elements.metaEmptyState?.classList.toggle("is-visible", campaigns.length === 0);

    if (elements.metaEventList) {
      elements.metaEventList.innerHTML = events.length
        ? events.map((event) => `<div><span>${escapeHtml(event.name)}</span><b>${integerNumber.format(event.value)}</b></div>`).join("")
        : `<div><span>Sin eventos</span><b>Conecta el pixel y sincroniza campañas.</b></div>`;
    }

    drawMetaTrendChart();
  }

  function buildDemoCommerceSnapshot(appId) {
    const rows = demoCommerceData[appId] || demoCommerceData.kairos;
    const orders = rows.map(([id, customer, product, status, total, margin, sessions, dayOffset]) => {
      const date = new Date();
      date.setDate(date.getDate() + dayOffset);
      return {
        id,
        customer,
        product,
        status,
        total,
        margin,
        sessions,
        date: toDateInput(date)
      };
    });
    return createCommerceSnapshot(orders, "demo");
  }

  function normalizeCommerceOrder(order, index = 0) {
    const total = Number(order.total ?? order.revenue ?? order.amount ?? order.value) || 0;
    const cost = Number(order.cost ?? order.cogs ?? 0);
    const margin = Number(order.margin ?? order.profit ?? (cost ? total - cost : total * 0.36)) || 0;
    return {
      id: String(order.id || order.orderId || order.name || `ORD-${Date.now()}-${index}`),
      customer: String(order.customer || order.customerName || order.email || "Cliente"),
      product: String(order.product || order.productName || order.item || "Producto"),
      status: String(order.status || order.paymentStatus || "Pagado"),
      total,
      margin,
      sessions: Number(order.sessions || order.visits || order.traffic || 0),
      date: String(order.date || order.createdAt || toDateInput()).slice(0, 10)
    };
  }

  function aggregateCommerceProducts(orders) {
    const products = new Map();
    orders.forEach((order) => {
      const current = products.get(order.product) || { name: order.product, orders: 0, revenue: 0, margin: 0 };
      current.orders += 1;
      current.revenue += order.total;
      current.margin += order.margin;
      products.set(order.product, current);
    });
    return Array.from(products.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  }

  function aggregateCommerceTrend(orders) {
    const days = new Map();
    orders.forEach((order) => {
      const current = days.get(order.date) || { date: order.date, revenue: 0, orders: 0 };
      current.revenue += order.total;
      current.orders += 1;
      days.set(order.date, current);
    });
    return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-10);
  }

  function createCommerceSnapshot(orders, source) {
    const normalizedOrders = orders.map(normalizeCommerceOrder);
    const totals = normalizedOrders.reduce((total, order) => ({
      revenue: total.revenue + order.total,
      margin: total.margin + order.margin,
      sessions: total.sessions + order.sessions,
      orders: total.orders + 1
    }), { revenue: 0, margin: 0, sessions: 0, orders: 0 });
    totals.aov = totals.orders ? totals.revenue / totals.orders : 0;
    totals.conversion = totals.sessions ? (totals.orders / totals.sessions) * 100 : 0;

    return {
      source,
      fetchedAt: new Date().toISOString(),
      appId: state.commerce.activeApp,
      totals,
      orders: normalizedOrders.sort((a, b) => b.date.localeCompare(a.date)),
      products: aggregateCommerceProducts(normalizedOrders),
      trend: aggregateCommerceTrend(normalizedOrders)
    };
  }

  async function fetchCommerceData(config) {
    const response = await fetch(config.apiUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiToken}`,
        "X-Nexus-Pixel": config.pixelId
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "El endpoint del negocio no respondio correctamente.");
    }
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.orders)
        ? payload.orders
        : Array.isArray(payload.data)
          ? payload.data
          : [];
    return rows.map(normalizeCommerceOrder);
  }

  function renderCommerceSwitcher() {
    if (!elements.commerceAppSwitcher) return;
    elements.commerceAppSwitcher.innerHTML = commerceApps.map((app) => {
      const snapshot = state.commerce.snapshots[app.id];
      const source = snapshot?.source === "live" ? "Conectado" : snapshot?.source === "demo" ? "Demo activo" : "Sin datos";
      return `
        <button class="commerce-app-button ${state.commerce.activeApp === app.id ? "is-active" : ""}" type="button" data-commerce-app="${app.id}">
          <i style="background:linear-gradient(90deg, ${app.accent}, var(--cyan))"></i>
          <b>${escapeHtml(app.name)}</b>
          <small>${escapeHtml(app.model)} · ${source}</small>
        </button>
      `;
    }).join("");
  }

  function renderCommerceDashboard() {
    const app = getCommerceApp();
    const config = getCommerceConfig(app.id);
    const snapshot = getCommerceSnapshot(app.id);
    const totals = snapshot?.totals || { revenue: 0, orders: 0, aov: 0, conversion: 0, sessions: 0, margin: 0 };
    const sourceLabel = snapshot?.source === "live" ? "API real" : snapshot?.source === "demo" ? "Demo" : "Datos locales";

    renderCommerceSwitcher();
    populateCommerceConfigForm();

    if (elements.commerceDataSource) elements.commerceDataSource.textContent = sourceLabel;
    if (elements.commerceRevenueValue) elements.commerceRevenueValue.textContent = currency.format(totals.revenue || 0);
    if (elements.commerceRevenueHint) elements.commerceRevenueHint.textContent = snapshot ? `${snapshot.orders.length} pedido${snapshot.orders.length === 1 ? "" : "s"}` : "Sin datos sincronizados";
    if (elements.commerceOrdersValue) elements.commerceOrdersValue.textContent = integerNumber.format(totals.orders || 0);
    if (elements.commerceOrdersHint) elements.commerceOrdersHint.textContent = `${app.name} · periodo activo`;
    if (elements.commerceAovValue) elements.commerceAovValue.textContent = moneyWithCents.format(totals.aov || 0);
    if (elements.commerceConversionValue) elements.commerceConversionValue.textContent = `${(totals.conversion || 0).toFixed(1)}%`;
    if (elements.commerceTrafficHint) elements.commerceTrafficHint.textContent = `${integerNumber.format(totals.sessions || 0)} sesiones`;
    if (elements.commerceMarginValue) elements.commerceMarginValue.textContent = currency.format(totals.margin || 0);
    if (elements.commerceMarginHint) elements.commerceMarginHint.textContent = totals.revenue ? `${((totals.margin / totals.revenue) * 100).toFixed(1)}% sobre ventas` : "Rentabilidad estimada";
    if (elements.commerceStatusValue) {
      elements.commerceStatusValue.textContent = state.commerce.syncing ? "Sync" : snapshot?.source === "live" ? "Live" : snapshot?.source === "demo" ? "Demo" : "Offline";
      elements.commerceStatusValue.classList.toggle("commerce-status-live", snapshot?.source === "live");
      elements.commerceStatusValue.classList.toggle("commerce-status-demo", snapshot?.source === "demo");
    }
    if (elements.commerceStatusHint) elements.commerceStatusHint.textContent = snapshot ? `${sourceLabel} · ${formatMetaDate(snapshot.fetchedAt)}` : "Conecta datos o demo";
    if (elements.commerceActiveLabel) elements.commerceActiveLabel.textContent = app.name;
    if (elements.commercePixelLabel) elements.commercePixelLabel.textContent = config.pixelId || "No configurado";
    if (elements.commerceEndpointLabel) elements.commerceEndpointLabel.textContent = config.apiUrl || "No configurado";
    if (elements.commerceLastSync) elements.commerceLastSync.textContent = formatMetaDate(snapshot?.fetchedAt);

    const orders = snapshot?.orders || [];
    if (elements.commerceOrdersTable) {
      elements.commerceOrdersTable.innerHTML = orders.slice(0, 12).map((order) => `
        <tr>
          <td>${escapeHtml(order.id)}</td>
          <td>${escapeHtml(order.customer)}</td>
          <td>${escapeHtml(order.product)}</td>
          <td><span class="type-pill income">${escapeHtml(order.status)}</span></td>
          <td>${moneyWithCents.format(order.total)}</td>
          <td class="${order.margin >= 0 ? "amount-income" : "amount-expense"}">${moneyWithCents.format(order.margin)}</td>
        </tr>
      `).join("");
    }
    elements.commerceEmptyState?.classList.toggle("is-visible", orders.length === 0);

    if (elements.commerceProductList) {
      const products = snapshot?.products || [];
      elements.commerceProductList.innerHTML = products.length
        ? products.map((product) => `<div><span>${escapeHtml(product.name)}</span><b>${moneyWithCents.format(product.revenue)} · ${product.orders} pedidos</b></div>`).join("")
        : `<div><span>Sin productos</span><b>Sincroniza ${escapeHtml(app.name)} para ver rendimiento.</b></div>`;
    }

    drawCommerceTrendChart();
  }

  async function syncCommerce({ demo = false, silent = false } = {}) {
    const appId = state.commerce.activeApp;
    state.commerce.configs[appId] = readCommerceConfigFromForm();
    saveCommerceConfigs();

    if (demo) {
      state.commerce.snapshots[appId] = buildDemoCommerceSnapshot(appId);
      saveCommerceSnapshots();
      setCommerceMessage(`Demo cargada para ${getCommerceApp(appId).name}.`, "success");
      renderCommerceDashboard();
      return;
    }

    const config = getCommerceConfig(appId);
    if (!hasCommerceConnection(config)) {
      setCommerceMessage("Para traer datos reales necesitas Pixel ID, endpoint de datos y API Token.", "error");
      renderCommerceDashboard();
      return;
    }

    state.commerce.syncing = true;
    if (!silent) setCommerceMessage(`Sincronizando ${getCommerceApp(appId).name}...`, "");
    renderCommerceDashboard();

    try {
      const orders = await fetchCommerceData(config);
      state.commerce.snapshots[appId] = createCommerceSnapshot(orders, "live");
      saveCommerceSnapshots();
      setCommerceMessage(orders.length ? "Datos reales sincronizados correctamente." : "El endpoint respondio sin pedidos para este periodo.", "success");
    } catch (error) {
      setCommerceMessage(error.message || "No se pudo sincronizar este negocio.", "error");
    } finally {
      state.commerce.syncing = false;
      renderCommerceDashboard();
      scheduleCommerceRefresh();
    }
  }

  function scheduleCommerceRefresh() {
    window.clearInterval(state.commerce.refreshTimer);
    state.commerce.refreshTimer = 0;
    const config = getCommerceConfig();
    const seconds = Number(config.refreshInterval);
    if (!seconds || !hasCommerceConnection(config)) return;
    state.commerce.refreshTimer = window.setInterval(() => {
      syncCommerce({ silent: true });
    }, seconds * 1000);
  }

  function formatDate(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("es-419", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(year, month - 1, day));
  }

  function renderAll() {
    populateMonthFilter();
    populateCategoryFilter();
    renderMetrics();
    renderMovements();
    drawCashflowChart();
    drawCategoryChart();
  }

  function handleFormSubmit(event) {
    event.preventDefault();
    const id = elements.movementId.value;
    const amount = Number(elements.movementAmount.value);
    if (!Number.isFinite(amount) || amount <= 0) return;

    const payload = {
      id: id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: elements.movementType.value,
      amount,
      date: elements.movementDate.value,
      category: elements.movementCategory.value,
      description: elements.movementDescription.value.trim()
    };

    if (!payload.description) return;

    if (id) {
      state.movements = state.movements.map((movement) => movement.id === id ? payload : movement);
    } else {
      state.movements = [payload, ...state.movements];
      state.filters.month = movementMonth(payload);
      localStorage.setItem(MONTH_FILTER_KEY, state.filters.month);
    }

    saveMovements();
    resetForm();
    renderAll();
  }

  function resetForm() {
    elements.form.reset();
    elements.movementId.value = "";
    elements.movementDate.value = toDateInput();
    elements.movementType.value = "income";
    populateMovementCategories();
    elements.formTitle.textContent = "Agregar movimiento";
    elements.saveMovementButton.textContent = "Guardar movimiento";
    elements.cancelEditButton.classList.add("is-hidden");
  }

  function startEdit(id) {
    const movement = state.movements.find((item) => item.id === id);
    if (!movement) return;
    elements.movementId.value = movement.id;
    elements.movementType.value = movement.type;
    populateMovementCategories();
    elements.movementAmount.value = movement.amount;
    elements.movementDate.value = movement.date;
    elements.movementCategory.value = movement.category;
    elements.movementDescription.value = movement.description;
    elements.formTitle.textContent = "Editar movimiento";
    elements.saveMovementButton.textContent = "Guardar cambios";
    elements.cancelEditButton.classList.remove("is-hidden");
    elements.form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function deleteMovement(id) {
    const movement = state.movements.find((item) => item.id === id);
    if (!movement) return;
    const ok = window.confirm(`Eliminar "${movement.description}" de tus finanzas?`);
    if (!ok) return;
    state.movements = state.movements.filter((item) => item.id !== id);
    saveMovements();
    renderAll();
  }

  function seedData() {
    const baseMonth = currentMonth();
    const seeded = sampleMovements.map(([type, category, description, amount, monthOffset], index) => {
      const monthKey = shiftMonth(baseMonth, monthOffset + 1);
      const [year, month] = monthKey.split("-").map(Number);
      const day = Math.min(26, 5 + index * 2);
      return {
        id: `demo-${Date.now()}-${index}`,
        type,
        category,
        description,
        amount,
        date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      };
    });
    state.movements = [...seeded, ...state.movements.filter((movement) => !movement.id.startsWith("demo-"))];
    state.filters.month = currentMonth();
    localStorage.setItem(MONTH_FILTER_KEY, state.filters.month);
    saveMovements();
    renderAll();
  }

  function normalizeView(rawView = "") {
    const view = String(rawView || "").toLowerCase();
    const metaMatch = view.match(/^meta(?:-ads)?-(kairos|billion|kiwifi)$/);
    if (metaMatch) return { view: "meta", metaPlatform: metaMatch[1] };
    if (view === "meta" || view === "meta-ads") return { view: "meta", metaPlatform: null };
    if (view === "ecommerce" || view === "e-commerce") return { view: "ecommerce", metaPlatform: null };
    if (view === "finance" || view === "finanzas" || view === "finanzas-personales") return { view: "finance", metaPlatform: null };
    return { view: "welcome", metaPlatform: null };
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

  function setView(rawView, shouldPushHash = true) {
    const normalized = normalizeView(rawView);
    const nextView = normalized.view;
    state.activeView = nextView;

    if (nextView !== "meta") {
      state.meta.selectedPlatform = null;
      state.meta.config = defaultMetaConfig();
      state.meta.snapshot = null;
      localStorage.removeItem(META_ACTIVE_PLATFORM_KEY);
      window.clearInterval(state.meta.refreshTimer);
      state.meta.refreshTimer = 0;
    } else if (normalized.metaPlatform) {
      state.meta.selectedPlatform = normalized.metaPlatform;
      localStorage.setItem(META_ACTIVE_PLATFORM_KEY, normalized.metaPlatform);
      loadActiveMetaPlatform();
    } else {
      state.meta.selectedPlatform = null;
      state.meta.config = defaultMetaConfig();
      state.meta.snapshot = null;
      localStorage.removeItem(META_ACTIVE_PLATFORM_KEY);
    }

    elements.navButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.view === nextView));
    elements.panels.forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === nextView));
    updateTopbarForView(nextView);
    applyChartMode();

    if (nextView === "meta") {
      window.setTimeout(() => {
        renderMetaDashboard();
        if (state.meta.selectedPlatform) scheduleMetaRefresh();
      }, 30);
      if (shouldPushHash) history.replaceState(null, "", normalized.metaPlatform ? `#meta-ads-${normalized.metaPlatform}` : "#meta-ads");
      animateActivePanel();
      return;
    }

    if (nextView === "ecommerce") {
      window.setTimeout(renderCommerceDashboard, 30);
      if (shouldPushHash) history.replaceState(null, "", "#ecommerce");
      animateActivePanel();
      return;
    }

    if (nextView === "finance") {
      if (shouldPushHash) history.replaceState(null, "", "#finanzas-personales");
      window.setTimeout(() => {
        drawCashflowChart();
        drawCategoryChart();
      }, 30);
      animateActivePanel();
      return;
    }

    if (shouldPushHash) history.replaceState(null, "", "#welcome");
    animateActivePanel();
  }

  function drawMetaTrendChart() {
    if (!elements.metaTrendChart) return;
    const { ctx, width, height } = resizeCanvas(elements.metaTrendChart);
    const trend = state.meta.snapshot?.trend || [];
    const maxSpend = Math.max(...trend.map((item) => item.spend), 1);
    const maxRoas = Math.max(...trend.map((item) => item.roas), 1);
    const padding = { top: 28, right: 28, bottom: 38, left: 42 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    const step = trend.length > 1 ? chartW / (trend.length - 1) : chartW;

    ctx.clearRect(0, 0, width, height);

    if (!trend.length || trend.every((item) => item.spend === 0 && item.roas === 0)) {
      drawNoData(ctx, width, height, "Sin datos de Meta Ads para graficar");
      setChartTargets(elements.metaTrendChart, []);
      return;
    }

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.075)";
    for (let i = 0; i <= 4; i += 1) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    const targets = [];
    const use3D = is3DMode();

    trend.forEach((item, index) => {
      const barW = Math.min(26, step * 0.35);
      const x = trend.length > 1 ? padding.left + index * step - barW / 2 : padding.left + chartW / 2 - barW / 2;
      const h = (item.spend / maxSpend) * chartH;
      const y = padding.top + chartH - h;
      if (use3D) {
        draw3DBar(ctx, x, y, barW, h, 5, "rgba(82,225,255,0.72)", "rgba(82,225,255,0.07)", 9);
      } else {
        const gradient = ctx.createLinearGradient(0, y, 0, padding.top + chartH);
        gradient.addColorStop(0, "rgba(82,225,255,0.58)");
        gradient.addColorStop(1, "rgba(82,225,255,0.06)");
        ctx.fillStyle = gradient;
        roundedRect(ctx, x, y, barW, h, 5);
        ctx.fill();
      }
      targets.push({
        x: x - step * 0.2,
        y: padding.top,
        width: Math.max(barW + step * 0.4, 34),
        height: chartH,
        html: `<b>${escapeHtml(item.date)}</b><span>Inversión: ${moneyWithCents.format(item.spend)}</span><span>ROAS: ${(item.roas || 0).toFixed(2)}x</span><span>Ingresos atribuidos: ${moneyWithCents.format(item.revenue || 0)}</span>`
      });
    });

    const points = trend.map((item, index) => ({
      x: trend.length > 1 ? padding.left + index * step : padding.left + chartW / 2,
      y: padding.top + chartH - (item.roas / maxRoas) * chartH
    }));

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "rgba(255,120,205,0.96)";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(255,26,157,0.58)";
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;

    points.forEach((point) => {
      ctx.fillStyle = "#ff1a9d";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    trend.forEach((item, index) => {
      const x = trend.length > 1 ? padding.left + index * step : padding.left + chartW / 2;
      const label = item.date === "Periodo" ? "Periodo" : item.date.slice(5).replace("-", "/");
      ctx.fillStyle = "rgba(243,243,248,0.48)";
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText(label, x, height - 14);
    });

    ctx.fillStyle = "rgba(243,243,248,0.72)";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.fillText("Barras: inversión · Línea: ROAS", padding.left, height - 12);
    ctx.restore();
    setChartTargets(elements.metaTrendChart, targets);
  }

  function drawCommerceTrendChart() {
    if (!elements.commerceTrendChart) return;
    const { ctx, width, height } = resizeCanvas(elements.commerceTrendChart);
    const trend = getCommerceSnapshot()?.trend || [];
    const maxRevenue = Math.max(...trend.map((item) => item.revenue), 1);
    const maxOrders = Math.max(...trend.map((item) => item.orders), 1);
    const padding = { top: 28, right: 28, bottom: 38, left: 42 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    const step = trend.length > 1 ? chartW / (trend.length - 1) : chartW;

    ctx.clearRect(0, 0, width, height);
    if (!trend.length || trend.every((item) => item.revenue === 0 && item.orders === 0)) {
      drawNoData(ctx, width, height, "Sin datos de E-Commerce para graficar");
      setChartTargets(elements.commerceTrendChart, []);
      return;
    }

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.075)";
    for (let i = 0; i <= 4; i += 1) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    const targets = [];
    const use3D = is3DMode();

    trend.forEach((item, index) => {
      const barW = Math.min(28, step * 0.36);
      const x = trend.length > 1 ? padding.left + index * step - barW / 2 : padding.left + chartW / 2 - barW / 2;
      const h = (item.revenue / maxRevenue) * chartH;
      const y = padding.top + chartH - h;
      if (use3D) {
        draw3DBar(ctx, x, y, barW, h, 5, "rgba(49,230,173,0.9)", "rgba(49,230,173,0.08)", 9);
      } else {
        const gradient = ctx.createLinearGradient(0, y, 0, padding.top + chartH);
        gradient.addColorStop(0, "rgba(49,230,173,0.82)");
        gradient.addColorStop(1, "rgba(49,230,173,0.08)");
        ctx.fillStyle = gradient;
        roundedRect(ctx, x, y, barW, h, 5);
        ctx.fill();
      }
      targets.push({
        x: x - step * 0.2,
        y: padding.top,
        width: Math.max(barW + step * 0.4, 34),
        height: chartH,
        html: `<b>${escapeHtml(item.date)}</b><span>Ventas: ${moneyWithCents.format(item.revenue)}</span><span>Pedidos: ${integerNumber.format(item.orders)}</span>`
      });
    });

    const points = trend.map((item, index) => ({
      x: trend.length > 1 ? padding.left + index * step : padding.left + chartW / 2,
      y: padding.top + chartH - (item.orders / maxOrders) * chartH
    }));

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "rgba(82,225,255,0.94)";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(82,225,255,0.42)";
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    points.forEach((point) => {
      ctx.fillStyle = "#52e1ff";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    trend.forEach((item, index) => {
      const x = trend.length > 1 ? padding.left + index * step : padding.left + chartW / 2;
      const label = item.date.slice(5).replace("-", "/");
      ctx.fillStyle = "rgba(243,243,248,0.48)";
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText(label, x, height - 14);
    });

    ctx.fillStyle = "rgba(243,243,248,0.72)";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.fillText("Barras: ventas · Línea: pedidos", padding.left, height - 12);
    ctx.restore();
    setChartTargets(elements.commerceTrendChart, targets);
  }

  function bindEvents() {
    elements.navButtons.forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });

    elements.welcomeCards.forEach((card) => {
      card.addEventListener("click", () => setView(card.dataset.welcomeView));
    });

    elements.metaPlatformCards?.addEventListener("click", (event) => {
      const card = event.target.closest("[data-meta-platform]");
      if (!card) return;
      selectMetaPlatform(card.dataset.metaPlatform);
    });

    elements.metaBackButton?.addEventListener("click", () => {
      clearSelectedMetaPlatform();
    });

    elements.chartModeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.chartMode = button.dataset.chartMode === "3d" ? "3d" : "2d";
        localStorage.setItem(CHART_VIEW_MODE_KEY, state.chartMode);
        applyChartMode();
        if (state.activeView === "meta") renderMetaDashboard();
        else if (state.activeView === "ecommerce") renderCommerceDashboard();
        else {
          drawCashflowChart();
          drawCategoryChart();
        }
      });
    });

    elements.chartResetButton?.addEventListener("click", () => {
      if (state.activeView === "meta") renderMetaDashboard();
      else if (state.activeView === "ecommerce") renderCommerceDashboard();
      else {
        drawCashflowChart();
        drawCategoryChart();
      }
    });

    [elements.cashflowChart, elements.categoryChart, elements.metaTrendChart, elements.commerceTrendChart].forEach((canvas) => {
      canvas?.addEventListener("mousemove", (event) => showChartTooltip(canvas, event));
      canvas?.addEventListener("mouseleave", hideChartTooltip);
    });

    elements.monthFilter.addEventListener("change", () => {
      state.filters.month = elements.monthFilter.value;
      localStorage.setItem(MONTH_FILTER_KEY, state.filters.month);
      renderAll();
    });

    elements.typeFilter.addEventListener("change", () => {
      state.filters.type = elements.typeFilter.value;
      renderAll();
    });

    elements.categoryFilter.addEventListener("change", () => {
      state.filters.category = elements.categoryFilter.value;
      renderAll();
    });

    elements.movementType.addEventListener("change", populateMovementCategories);
    elements.form.addEventListener("submit", handleFormSubmit);
    elements.cancelEditButton.addEventListener("click", resetForm);
    elements.seedDataButton.addEventListener("click", seedData);
    elements.metaConfigForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!state.meta.selectedPlatform) {
        setMetaMessage("Selecciona Kairos, Billion o KiwiFi antes de guardar.", "error");
        return;
      }
      state.meta.config = readMetaConfigFromForm();
      saveMetaConfig();
      scheduleMetaRefresh();
      setMetaMessage(`Conexión guardada para ${getMetaPlatform().name}.`, "success");
      renderMetaDashboard();
    });
    elements.metaSyncButton?.addEventListener("click", () => {
      syncMetaAds();
    });
    elements.metaDemoButton?.addEventListener("click", () => {
      state.meta.config = readMetaConfigFromForm();
      saveMetaConfig();
      syncMetaAds({ demo: true });
    });
    elements.metaClearButton?.addEventListener("click", () => {
      const ok = window.confirm("Eliminar credenciales y datos locales de Meta Ads?");
      if (!ok) return;
      window.clearInterval(state.meta.refreshTimer);
      const platform = getMetaPlatform();
      state.meta.config = defaultMetaConfig();
      state.meta.snapshot = null;
      if (platform) {
        state.meta.platforms[platform.id] = defaultMetaPlatformState(platform);
        saveMetaPlatforms();
      } else {
        localStorage.removeItem(META_CONFIG_KEY);
        localStorage.removeItem(META_DATA_KEY);
      }
      populateMetaConfigForm();
      setMetaMessage(platform ? `${platform.name} fue limpiado.` : "Conexión de Meta Ads eliminada.", "success");
      renderMetaDashboard();
    });
    elements.metaRefreshInterval?.addEventListener("change", () => {
      state.meta.config = readMetaConfigFromForm();
      saveMetaConfig();
      scheduleMetaRefresh();
      renderMetaDashboard();
    });
    elements.commerceAppSwitcher?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-commerce-app]");
      if (!button) return;
      state.commerce.activeApp = button.dataset.commerceApp;
      localStorage.setItem("nexus.ecommerce.activeApp.v1", state.commerce.activeApp);
      setCommerceMessage("", "");
      scheduleCommerceRefresh();
      renderCommerceDashboard();
    });
    elements.commerceConfigForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      state.commerce.configs[state.commerce.activeApp] = readCommerceConfigFromForm();
      saveCommerceConfigs();
      scheduleCommerceRefresh();
      setCommerceMessage(`${getCommerceApp().name} guardado en este navegador.`, "success");
      renderCommerceDashboard();
    });
    elements.commerceSyncButton?.addEventListener("click", () => {
      syncCommerce();
    });
    elements.commerceDemoButton?.addEventListener("click", () => {
      syncCommerce({ demo: true });
    });
    elements.commerceClearButton?.addEventListener("click", () => {
      const app = getCommerceApp();
      const ok = window.confirm(`Eliminar conexion y datos locales de ${app.name}?`);
      if (!ok) return;
      window.clearInterval(state.commerce.refreshTimer);
      state.commerce.configs[app.id] = defaultCommerceConfig();
      delete state.commerce.snapshots[app.id];
      saveCommerceConfigs();
      saveCommerceSnapshots();
      populateCommerceConfigForm();
      setCommerceMessage(`${app.name} fue limpiado.`, "success");
      renderCommerceDashboard();
    });
    elements.commerceRefreshInterval?.addEventListener("change", () => {
      state.commerce.configs[state.commerce.activeApp] = readCommerceConfigFromForm();
      saveCommerceConfigs();
      scheduleCommerceRefresh();
      renderCommerceDashboard();
    });
    elements.logoutButton?.addEventListener("click", () => {
      localStorage.removeItem(AUTH_KEY);
      window.location.href = "./index.html";
    });

    elements.movementsTable.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "edit") startEdit(button.dataset.id);
      if (button.dataset.action === "delete") deleteMovement(button.dataset.id);
    });

    window.addEventListener("resize", () => {
      if (state.activeView === "meta") renderMetaDashboard();
      else if (state.activeView === "ecommerce") renderCommerceDashboard();
      else if (state.activeView === "finance") {
        drawCashflowChart();
        drawCategoryChart();
      }
    });

    window.addEventListener("hashchange", () => {
      setView(location.hash.replace("#", ""), false);
    });
  }

  function init() {
    try {
      elements.movementDate.value = toDateInput();
      populateMovementCategories();
      populateMonthFilter();
      populateCategoryFilter();
      populateMetaConfigForm();
      renderCommerceSwitcher();
      populateCommerceConfigForm();
      bindEvents();
      applyChartMode();
      renderAll();
      renderMetaDashboard();
      renderCommerceDashboard();
      scheduleMetaRefresh();
      scheduleCommerceRefresh();
      const initial = location.hash.replace("#", "");
      setView(initial || "welcome", false);
    } catch (error) {
      console.error("Nexus dashboard init error:", error);
    } finally {
      // Garantiza que el sidebar/topbar siempre se revelen, incluso si algo
      // de lo anterior falla — de lo contrario quedan invisibles para siempre.
      runDashboardReveal();
    }
  }

  init();
})();
