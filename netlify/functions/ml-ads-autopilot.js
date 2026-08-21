/* ============================================================
   NEXUS · ml-ads-autopilot.js — Piloto automatico de Mercado Ads
   ------------------------------------------------------------
   NIVEL 3: corre PROGRAMADO (a diario, ver netlify.toml) y, para
   cada cuenta ARMADA, computa el plan del agente y lo aplica
   DENTRO DEL TECHO MENSUAL y los guardarraíles del titular.

   SEGURO POR DISEÑO:
     - Solo actua sobre cuentas con `armed:true` en ads_autopilot_cfg.
       Arranca DESARMADO: si nadie armo nada, es un no-op.
     - Modo por defecto "sim" (SIMULACION): calcula y registra lo
       que HARIA, sin escribir en Mercado Libre. El titular pasa a
       modo "real" cuando valido las reglas.
     - Guardarraíl duro: nunca supera el techo mensual; paso maximo
       de cambio por corrida (maxChangePct); piso diario (minDaily).
     - Solo toca presupuesto diario y estado (pausar/activar).

   ⚠️ Los paths de ESCRITURA de Mercado Ads no se pudieron verificar
   en vivo. Por eso el modo REAL debe validarse con un smoke-test
   tras el deploy (ver memoria nexus_agente_publicidad).
   Zero-dep (fetch + crypto nativos).
   ============================================================ */
const { adminGetDoc, adminPatchDoc, adminQueryUsersByField } = require("./_fbadmin");
const { tokenParaCuenta } = require("./_mltoken");
const { computePlan, aplicarGuardarrailTecho } = require("./_ads-agent");
const { sendPush } = require("./_webpush");

const ML_API = "https://api.mercadolibre.com";
const ARMED_FIELD = "ads_autopilot";
const CFG_FIELD = "ads_autopilot_cfg";
const LOG_FIELD = "ads_autopilot_log";

function jparse(raw, fb) { try { return JSON.parse(raw || ""); } catch (e) { return fb; } }
function fieldStr(fields, name) { return fields && fields[name] && fields[name].stringValue; }
function firstOfMonthISO() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01"; }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function daysAgoISO(n) { var d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

async function mlAds(token, path, method, body) {
  var res = await fetch(ML_API + path, {
    method: method || "GET",
    headers: {
      Authorization: "Bearer " + token,
      "Api-Version": "2",
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error("ML ads " + method + " " + res.status + ": " + (data.message || data.error || ""));
  return data;
}

function num(o, keys) { for (var i = 0; i < keys.length; i++) { if (o && o[keys[i]] != null) return Number(o[keys[i]]) || 0; } return 0; }
function normCamp(c) {
  var m = c.metrics || c.metrics_summary || {};
  var gasto = num(m, ["cost"]);
  var ingresos = num(m, ["total_amount"]) || (num(m, ["direct_amount"]) + num(m, ["indirect_amount"]));
  var roas = num(m, ["roas"]) || (gasto ? ingresos / gasto : 0);
  return {
    id: c.id, name: c.name || String(c.id), status: c.status,
    budget: num(c, ["budget", "daily_budget"]) || num(m, ["budget"]),
    gasto: gasto, ingresos: ingresos, roas: roas
  };
}

async function getAdvertiser(token) {
  var adv = await mlAds(token, "/advertising/advertisers?product_id=PADS", "GET");
  var list = (adv.advertisers || adv) || [];
  if (!Array.isArray(list) || !list.length) throw new Error("cuenta sin Product Ads");
  return { advertiserId: list[0].advertiser_id || list[0].id, siteId: list[0].site_id || "MLU" };
}
function mktBase(site, adv) { return "/marketplace/advertising/" + site + "/advertisers/" + adv + "/product_ads"; }
function advBase(adv) { return "/advertising/advertisers/" + adv + "/product_ads"; }
// Escritura de campaña: el path de ESCRITURA de Mercado Ads NO lleva /advertisers/{adv}
// (a diferencia del /campaigns/search de lectura) y usa ?channel=marketplace. Doc vigente:
// PUT /marketplace/advertising/{site}/product_ads/campaigns/{id}. Probamos ese primero y
// caemos a las formas legacy solo en 404/405/501 (legacy deprecado -> 404 desde 2026).
// Pausar/ajustar es idempotente, así que reintentar en otra URL es seguro.
function campWriteUrls(av, id) {
  var site = av.siteId, adv = av.advertiserId;
  return [
    "/marketplace/advertising/" + site + "/product_ads/campaigns/" + id + "?channel=marketplace",
    "/marketplace/advertising/" + site + "/product_ads/campaigns/" + id,
    "/marketplace/advertising/" + site + "/advertisers/" + adv + "/product_ads/campaigns/" + id,
    "/advertising/advertisers/" + adv + "/product_ads/campaigns/" + id
  ];
}
async function putCampaign(token, av, campaignId, patch) {
  var urls = campWriteUrls(av, campaignId);
  var lastErr = null;
  for (var i = 0; i < urls.length; i++) {
    try { return await mlAds(token, urls[i], "PUT", patch); }
    catch (e) { lastErr = e; if (!/ 40[45]:| 501:/.test(String(e && e.message))) throw e; }
  }
  throw lastErr;
}

async function fetchCampaigns(token, site, adv) {
  var METRICS = "cost,total_amount,direct_amount,indirect_amount,roas,acos,clicks,prints";
  var url = mktBase(site, adv) + "/campaigns/search?limit=100&date_from=" + daysAgoISO(29) + "&date_to=" + todayISO() + "&metrics=" + METRICS;
  var res = await mlAds(token, url, "GET");
  var results = (res.results || res) || [];
  return (Array.isArray(results) ? results : []).map(normCamp);
}
async function fetchMTD(token, site, adv) {
  var url = mktBase(site, adv) + "/campaigns/search?limit=100&date_from=" + firstOfMonthISO() + "&date_to=" + todayISO() + "&metrics=cost";
  var res = await mlAds(token, url, "GET");
  var results = (res.results || res) || [];
  var spent = 0;
  (Array.isArray(results) ? results : []).forEach(function (c) { var m = c.metrics || c.metrics_summary || {}; spent += Number(m.cost) || 0; });
  return spent;
}

// ---- Core: corre el agente para un usuario (todas sus cuentas armadas) ----
async function runForUser(uid, opts) {
  opts = opts || {};
  var doc = await adminGetDoc("users/" + uid);
  var fields = (doc && doc.fields) || {};
  var cfg = jparse(fieldStr(fields, CFG_FIELD), { accounts: {} });
  var accounts = cfg.accounts || {};
  var results = [];

  for (var account of Object.keys(accounts)) {
    var acc = accounts[account];
    if (!acc || !acc.armed) continue;
    var mode = opts.forceMode || acc.mode || "sim";
    try {
      var token = await tokenParaCuenta(uid, fields, account);
      var av = await getAdvertiser(token);
      var campaigns = await fetchCampaigns(token, av.siteId, av.advertiserId);
      var spentMTD = await fetchMTD(token, av.siteId, av.advertiserId);
      var plan = computePlan(campaigns, {
        monthlyCap: Number(acc.monthlyCap) || 0,
        spentMTD: spentMTD, now: new Date(),
        minDaily: Number(acc.minDaily) || 0,
        maxStepPct: (Number(acc.maxChangePct) || 25) / 100
      });
      plan = aplicarGuardarrailTecho(plan);

      var actions = [];
      for (var r of plan.recs) {
        var entry = { title: r.title, campaign: r.campaignName, patch: r.patch };
        if (mode === "real") {
          try { await putCampaign(token, av, r.campaignId, r.patch); entry.applied = true; }
          catch (e) { entry.applied = false; entry.error = e.message; }
        } else { entry.simulated = true; }
        actions.push(entry);
      }
      results.push({ account: account, mode: mode, pacing: plan.pacing, count: actions.length, actions: actions });
    } catch (e) {
      results.push({ account: account, error: e.message });
    }
  }

  await appendLog(uid, fields, results, opts);
  if (!opts.noPush) await notify(uid, fields, results).catch(function () {});
  return results;
}

async function appendLog(uid, fields, results, opts) {
  var log = jparse(fieldStr(fields, LOG_FIELD), []);
  if (!Array.isArray(log)) log = [];
  log.unshift({
    at: new Date().toISOString(),
    trigger: opts && opts.forceMode ? "manual" : "schedule",
    runs: results.map(function (r) {
      return r.error ? { account: r.account, error: r.error }
        : { account: r.account, mode: r.mode, count: r.count,
            status: r.pacing && r.pacing.status,
            actions: (r.actions || []).map(function (a) { return { title: a.title, campaign: a.campaign, budget: a.patch && a.patch.budget, status: a.patch && a.patch.status, applied: !!a.applied, simulated: !!a.simulated, error: a.error || null }; }) };
    })
  });
  log = log.slice(0, 30);
  await adminPatchDoc("users/" + uid, { [LOG_FIELD]: { stringValue: JSON.stringify(log) } }, [LOG_FIELD]);
}

async function notify(uid, fields, results) {
  var subsRaw = fieldStr(fields, "push_subs");
  var subs = jparse(subsRaw, []);
  if (!Array.isArray(subs) || !subs.length) return;
  var total = results.reduce(function (a, r) { return a + (r.count || 0); }, 0);
  var anyReal = results.some(function (r) { return r.mode === "real"; });
  var body = total ? (anyReal ? total + " ajuste(s) aplicados por el agente." : total + " ajuste(s) sugeridos (simulacion).") : "Sin cambios: tus campañas van en ritmo.";
  var payload = { title: "Agente publicitario", body: body, url: "/dashboard.html#ecommerce-mercadolibre" };
  for (var s of subs) { try { await sendPush(s, payload); } catch (e) {} }
}

// ---- Handler PROGRAMADO (netlify.toml define el schedule) ----
exports.handler = async function () {
  try {
    // App de un solo dueño: la query devuelve al titular si tiene el piloto armado.
    var hit = await adminQueryUsersByField(ARMED_FIELD, "1");
    if (!hit) return { statusCode: 200, body: "sin cuentas armadas" };
    var out = await runForUser(hit.uid, {});
    return { statusCode: 200, body: JSON.stringify({ uid: hit.uid, runs: out.length }) };
  } catch (e) {
    return { statusCode: 500, body: String((e && e.message) || e) };
  }
};

module.exports.runForUser = runForUser;
