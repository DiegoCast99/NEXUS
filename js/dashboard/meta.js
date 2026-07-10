/* ============================================================
   NEXUS Dashboard · Módulo · Meta Ads
   Parte de window.NexusDash — namespace compartido (sin build).
   ============================================================ */
(function () {
  const S = window.NexusDash;
  const { META_ACTIVE_PLATFORM_KEY, animateActivePanel, compactNumber, currency, decimalNumber, defaultMetaConfig } = S;
  const { demoMetaRecords, drawMetaTrendChart, elements, escapeHtml, formatMetaDate, getMetaPlatform } = S;
  const { getMetaPlatformState, integerNumber, loadActiveMetaPlatform, metaPlatforms, moneyWithCents, normalizeAdAccountId } = S;
  const { normalizeApiVersion, safeSetItem, saveMetaConfig, saveMetaSnapshot, state, toDateInput } = S;
  const { updateTopbarForView } = S;
  function setMetaMessage(message = "", type = "") {
    state.meta.message = message;
    state.meta.messageType = type;
    if (!elements.metaMessage) return;
    elements.metaMessage.textContent = message;
    elements.metaMessage.classList.toggle("is-error", type === "error");
    elements.metaMessage.classList.toggle("is-success", type === "success");
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
    safeSetItem(META_ACTIVE_PLATFORM_KEY, id);
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

  function readMetaConfigFromForm() {
    const accessToken = String(elements.metaAccessToken?.value || "").trim();
    return {
      pixelId: String(elements.metaPixelId?.value || "").trim(),
      adAccountId: normalizeAdAccountId(elements.metaAdAccountId?.value || ""),
      apiVersion: normalizeApiVersion(elements.metaApiVersion?.value || ""),
      datePreset: elements.metaDatePreset?.value || "last_30d",
      accessToken,
      // hasToken: hay un token guardado (cifrado en Firestore) aunque el campo
      // esté vacío. Se preserva para no perderlo al releer el formulario.
      hasToken: Boolean(accessToken) || Boolean(state.meta.config && state.meta.config.hasToken),
      refreshInterval: elements.metaRefreshInterval?.value || "0"
    };
  }

  function populateMetaConfigForm() {
    const config = state.meta.config;
    if (elements.metaPixelId) elements.metaPixelId.value = config.pixelId || "";
    if (elements.metaAdAccountId) elements.metaAdAccountId.value = config.adAccountId || "";
    if (elements.metaApiVersion) elements.metaApiVersion.value = config.apiVersion || "v23.0";
    if (elements.metaDatePreset) elements.metaDatePreset.value = config.datePreset || "last_30d";
    if (elements.metaAccessToken) {
      elements.metaAccessToken.value = config.accessToken || "";
      elements.metaAccessToken.placeholder = config.hasToken
        ? "•••••••• (guardado de forma segura)"
        : "Access Token de Meta";
    }
    if (elements.metaRefreshInterval) elements.metaRefreshInterval.value = config.refreshInterval || "0";
  }

  function hasMetaCredentials(config = state.meta.config) {
    return Boolean(config.pixelId && config.adAccountId && (config.accessToken || config.hasToken));
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

  // Trae los insights vía el proxy serverless: el navegador NO llama a
  // graph.facebook.com ni ve el access_token; el servidor lee el token cifrado
  // de Firestore y hace la llamada. Devuelve filas crudas que normalizamos acá.
  async function fetchMetaInsights(config) {
    if (!window.NexusSecureAPI) {
      throw new Error("El proxy seguro no está disponible en este entorno.");
    }
    const result = await window.NexusSecureAPI.metaInsights({
      adAccountId: config.adAccountId,
      apiVersion: config.apiVersion,
      datePreset: config.datePreset
    });
    const rows = result && Array.isArray(result.rows) ? result.rows : [];
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
      // Si el usuario ingresó un token nuevo, guardarlo cifrado en el servidor
      // y sacarlo de memoria/DOM. Después el proxy lo usa desde Firestore.
      if (state.meta.config.accessToken) {
        await window.NexusSecureAPI.saveProviderToken("meta", state.meta.config.accessToken);
        state.meta.config.accessToken = "";
        state.meta.config.hasToken = true;
        saveMetaConfig();
        populateMetaConfigForm();
      }
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


  Object.assign(S, {
    aggregateMetaCampaigns, aggregateMetaEvents, aggregateMetaTrend, buildDemoMetaSnapshot, clearSelectedMetaPlatform, createMetaSnapshot,
    extractMetaEvents, fetchMetaInsights, getActionValue, getReportedRoas, hasMetaCredentials, isMetaPlatformReady,
    labelActionType, normalizeMetaInsightsRow, populateMetaConfigForm, readMetaConfigFromForm, renderMetaDashboard, renderMetaPlatformSelector,
    scheduleMetaRefresh, selectMetaPlatform, setMetaMessage, syncMetaAds,
  });
})();
