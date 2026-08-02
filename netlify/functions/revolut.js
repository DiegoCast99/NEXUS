/* ============================================================
   NEXUS · /.netlify/functions/revolut
   ------------------------------------------------------------
   Conecta la cuenta PERSONAL de Revolut (UK) a Finanzas de Nexus
   via GoCardless Bank Account Data (ex-Nordigen), que es un AISP
   con licencia de Open Banking (PSD2). Trae las transacciones
   (gastos, ingresos, transferencias) para volcarlas en Finanzas
   Personales como movimientos.

   Credenciales: el titular saca secret_id + secret_key del portal
   de GoCardless. Se guardan CIFRADAS en users/{uid} (secret_gc_id,
   secret_gc_key), nunca en el navegador ni en texto plano.

   Acciones (POST body { action, ... }, Header Bearer <Firebase ID token>):
     - "save-keys"  { secretId, secretKey }  -> guarda credenciales
     - "status"                              -> ¿conectado? ¿hay cuentas?
     - "link"                                -> crea la solicitud y devuelve
                                                el link para autorizar en Revolut
     - "confirm"                             -> tras autorizar, guarda las cuentas
     - "sync"       { days? }                -> trae transacciones normalizadas
     - "disconnect"                          -> borra credenciales y cuentas

   Sin dependencias npm: solo fetch global y helpers de _shared.
   ============================================================ */
const {
  encrypt,
  decrypt,
  getIdToken,
  uidFromIdToken,
  readUserField,
  writeUserField,
  parseBody,
  json
} = require("./_shared");

const GC = "https://bankaccountdata.gocardless.com/api/v2";
// Institucion de Revolut personal en Reino Unido (Open Banking GB).
const REVOLUT_GB = "REVOLUT_REVOGB21";

// --- HTTP helper contra GoCardless --------------------------
async function gcFetch(path, { method = "GET", token, body } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(GC + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  if (!res.ok) {
    const detail = (data && (data.detail || data.summary || (data.secret_id && data.secret_id[0]))) || ("HTTP " + res.status);
    const err = new Error("GoCardless: " + detail);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Un access token fresco a partir de las credenciales guardadas (duran ~24h,
// pero se pide uno nuevo en cada operacion: es barato y evita guardar tokens).
async function accessTokenFor(uid, idToken) {
  const encId = await readUserField(uid, idToken, "secret_gc_id");
  const encKey = await readUserField(uid, idToken, "secret_gc_key");
  if (!encId || !encKey) {
    const e = new Error("Falta conectar GoCardless (credenciales no guardadas).");
    e.code = "sin_credenciales";
    throw e;
  }
  const out = await gcFetch("/token/new/", {
    method: "POST",
    body: { secret_id: decrypt(encId).trim(), secret_key: decrypt(encKey).trim() }
  });
  return out.access;
}

// ---- Mapeo MCC -> categoria de Nexus -----------------------
// El MCC (Merchant Category Code) del comercio decide la categoria. Es un punto
// de partida razonable; el titular puede corregir a mano y en el futuro que
// aprenda por comercio. Las categorias son las de Finanzas (store.js).
const MCC_CAT = [
  [/^(5411|5422|5451|5462|5499|5300)$/, "Alimentación"],       // super, carnicería, panadería
  [/^(5811|5812|5813|5814)$/, "Ocio"],                          // restaurantes, bares (comer afuera)
  [/^(4111|4112|4121|4131|4784|7523)$/, "Transporte"],          // transporte, taxi, peajes, parking
  [/^(5541|5542|5983)$/, "Transporte"],                         // combustible
  [/^(6513|6011)$/, "Vivienda"],                                // alquiler
  [/^(4814|4899|4900|4901)$/, "Vivienda"],                      // servicios / utilities
  [/^(4899|5815|5816|5817|5818|7841)$/, "Suscripciones"],       // digital / streaming / apps
  [/^(7832|7841|7922|7929|7994|7996|7999)$/, "Ocio"],           // cine, juegos, entretenimiento
  [/^(8011|8021|8031|8042|8049|8062|8071|5912|5975|5976)$/, "Salud"], // médicos, farmacia
  [/^(8211|8220|8241|8244|8249|8299)$/, "Educación"],           // educación
  [/^(9311|9399|9223)$/, "Impuestos"],                          // impuestos / gobierno
  [/^(5940|5941|5945|5977|7011|4722)$/, "Ocio"]                 // hobbies, viajes, hoteles
];

function categoriaDe(mcc, isIncome) {
  if (isIncome) return "Otros ingresos";
  if (mcc) {
    for (const [re, cat] of MCC_CAT) if (re.test(String(mcc))) return cat;
  }
  return "Otros gastos";
}

// ---- Normaliza una transaccion de GoCardless a movimiento Nexus ----
function normalizarTx(tx, accountCurrency) {
  const rawAmount = Number(tx.transactionAmount && tx.transactionAmount.amount);
  if (!Number.isFinite(rawAmount) || rawAmount === 0) return null;
  const isIncome = rawAmount > 0;
  const amount = Math.abs(rawAmount);
  const currency = (tx.transactionAmount && tx.transactionAmount.currency) || accountCurrency || "GBP";

  // Nombre del comercio / contraparte, con varios fallbacks.
  const desc =
    tx.creditorName ||
    tx.debtorName ||
    (tx.remittanceInformationUnstructured || "") ||
    (Array.isArray(tx.remittanceInformationUnstructuredArray) ? tx.remittanceInformationUnstructuredArray.join(" ") : "") ||
    (tx.merchantCategoryCode ? "Comercio " + tx.merchantCategoryCode : "Movimiento Revolut");

  // Id estable para deduplicar (una tx pasa de pending a booked).
  const externalId = tx.transactionId || tx.internalTransactionId || tx.entryReference ||
    (currency + rawAmount + "|" + (tx.bookingDate || tx.valueDate || "") + "|" + String(desc).slice(0, 20));

  const out = {
    externalId: "revolut:" + externalId,
    date: (tx.bookingDate || tx.valueDate || tx.bookingDateTime || "").slice(0, 10),
    type: isIncome ? "income" : "expense",
    amount: amount,
    currency: currency,
    category: categoriaDe(tx.merchantCategoryCode, isIncome),
    description: String(desc).trim().slice(0, 120),
    source: "revolut"
  };
  // Si hubo cambio de moneda (ej: compra en pesos con tarjeta en GBP), guardar el original.
  const ex = tx.currencyExchange && (Array.isArray(tx.currencyExchange) ? tx.currencyExchange[0] : tx.currencyExchange);
  if (ex && ex.instructedAmount) {
    out.originalAmount = Number(ex.instructedAmount.amount) || undefined;
    out.originalCurrency = ex.instructedAmount.currency || ex.sourceCurrency || undefined;
  }
  return out.date ? out : null;
}

// ============================================================
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  let idToken, uid;
  try {
    idToken = getIdToken(event);
    uid = uidFromIdToken(idToken);
  } catch (e) {
    return json(401, { error: "No autenticado." });
  }

  let body;
  try { body = parseBody(event) || {}; } catch (e) { body = {}; }
  const action = body.action;

  try {
    // ---- Guardar credenciales de GoCardless ----
    if (action === "save-keys") {
      const secretId = String(body.secretId || "").trim();
      const secretKey = String(body.secretKey || "").trim();
      if (secretId.length < 8 || secretKey.length < 8) {
        return json(400, { error: "secret_id / secret_key inválidos." });
      }
      // Validar contra GoCardless antes de guardar (que sirvan de verdad).
      await gcFetch("/token/new/", { method: "POST", body: { secret_id: secretId, secret_key: secretKey } });
      await writeUserField(uid, idToken, "secret_gc_id", encrypt(secretId));
      await writeUserField(uid, idToken, "secret_gc_key", encrypt(secretKey));
      return json(200, { ok: true });
    }

    // ---- Estado de la conexion ----
    if (action === "status") {
      const encId = await readUserField(uid, idToken, "secret_gc_id");
      const accounts = await readUserField(uid, idToken, "gc_accounts");
      return json(200, {
        hasKeys: !!encId,
        accounts: accounts ? JSON.parse(accounts) : []
      });
    }

    // ---- Crear la solicitud de conexion (link para autorizar en Revolut) ----
    if (action === "link") {
      const token = await accessTokenFor(uid, idToken);
      const origin = "https://" + (event.headers.host || event.headers.Host || "");
      const redirect = origin + "/dashboard.html#finanzas-revolut";
      // Acuerdo de usuario: pedir el maximo de historial (2 años) y 90 dias de acceso.
      const agreement = await gcFetch("/agreements/enduser/", {
        method: "POST",
        token,
        body: {
          institution_id: body.institution || REVOLUT_GB,
          max_historical_days: 730,
          access_valid_for_days: 90,
          access_scope: ["balances", "details", "transactions"]
        }
      });
      const reference = "nexus-" + uid.slice(0, 8) + "-" + (event.headers["x-nf-request-id"] || Math.abs(hash(uid + redirect)));
      const req = await gcFetch("/requisitions/", {
        method: "POST",
        token,
        body: {
          redirect: redirect,
          institution_id: body.institution || REVOLUT_GB,
          reference: reference,
          agreement: agreement.id,
          user_language: "ES"
        }
      });
      // Guardar el id de la solicitud para el "confirm" post-redirect.
      await writeUserField(uid, idToken, "gc_requisition", String(req.id));
      return json(200, { link: req.link, requisition: req.id });
    }

    // ---- Tras autorizar en Revolut: guardar las cuentas conectadas ----
    if (action === "confirm") {
      const token = await accessTokenFor(uid, idToken);
      const reqId = body.requisition || (await readUserField(uid, idToken, "gc_requisition"));
      if (!reqId) return json(400, { error: "No hay una solicitud pendiente." });
      const req = await gcFetch("/requisitions/" + encodeURIComponent(reqId) + "/", { token });
      const accounts = Array.isArray(req.accounts) ? req.accounts : [];
      await writeUserField(uid, idToken, "gc_accounts", JSON.stringify(accounts));
      return json(200, { ok: true, status: req.status, accounts: accounts });
    }

    // ---- Sincronizar: traer transacciones normalizadas ----
    if (action === "sync") {
      const accountsRaw = await readUserField(uid, idToken, "gc_accounts");
      const accounts = accountsRaw ? JSON.parse(accountsRaw) : [];
      if (!accounts.length) return json(400, { error: "No hay cuentas conectadas. Autorizá primero.", code: "sin_cuentas" });
      const token = await accessTokenFor(uid, idToken);
      let movimientos = [];
      const detalles = [];
      for (const accId of accounts) {
        try {
          const meta = await gcFetch("/accounts/" + encodeURIComponent(accId) + "/", { token }).catch(() => ({}));
          const currency = meta.currency || "GBP";
          const data = await gcFetch("/accounts/" + encodeURIComponent(accId) + "/transactions/", { token });
          const booked = (data.transactions && data.transactions.booked) || [];
          for (const tx of booked) {
            const m = normalizarTx(tx, currency);
            if (m) movimientos.push(m);
          }
          detalles.push({ account: accId, currency: currency, count: booked.length });
        } catch (e) {
          // Rate limit (~4/día) u otro: no cortar todo, seguir con lo que haya.
          detalles.push({ account: accId, error: e.message, status: e.status || 0 });
        }
      }
      return json(200, { movimientos: movimientos, cuentas: detalles });
    }

    // ---- Desconectar ----
    if (action === "disconnect") {
      await writeUserField(uid, idToken, "secret_gc_id", "");
      await writeUserField(uid, idToken, "secret_gc_key", "");
      await writeUserField(uid, idToken, "gc_accounts", "");
      await writeUserField(uid, idToken, "gc_requisition", "");
      return json(200, { ok: true });
    }

    return json(400, { error: "Acción desconocida: " + action });
  } catch (error) {
    return json(error.status === 401 ? 401 : 400, { error: error.message || "Error en Revolut.", code: error.code });
  }
};

// Hash simple y estable (para la reference de la solicitud).
function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
  return h;
}
