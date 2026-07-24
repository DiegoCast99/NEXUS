/* ============================================================
   NEXUS · POST /.netlify/functions/ml-api-proxy
   ------------------------------------------------------------
   Proxy seguro para la API de Mercado Libre. Lee los tokens
   cifrados de Firestore, refresca automaticamente si expiraron
   (cada 3 h) y llama al endpoint pedido.

   Body:   { "endpoint": "/orders/search?seller=123&sort=date_desc",
             "method": "GET" }
   Header: Authorization: Bearer <Firebase ID token>

   El access_token de ML NUNCA llega al navegador.
   ============================================================ */
const {
  decrypt,
  encrypt,
  readUserField,
  writeUserField,
  uidFromIdToken,
  getIdToken,
  parseBody,
  json,
  mlAccount
} = require("./_shared");

const ML_API = "https://api.mercadolibre.com";
const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const REFRESH_BUFFER_SECS = 300;

// Hosts alcanzables. Mercado Pago vive en OTRO dominio que Mercado Libre: el
// saldo y el detalle de los pagos (con su fecha de liberacion) solo salen de
// api.mercadopago.com. Es una lista blanca cerrada a proposito: el `endpoint`
// que manda el cliente no puede elegir un host arbitrario (evita SSRF).
const HOSTS = {
  ml: ML_API,
  mp: "https://api.mercadopago.com"
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Solo POST." });
  try {
    const idToken = getIdToken(event);
    const uid = uidFromIdToken(idToken);
    const { endpoint, method, body: reqBody, account, host } = parseBody(event);
    const mlId = mlAccount(account);
    const field = "secret_" + mlId;

    if (!endpoint || typeof endpoint !== "string") {
      return json(400, { error: "Falta el endpoint de ML." });
    }

    let accessToken;

    if (host === "mp") {
      // Mercado Pago usa credenciales PROPIAS: el token de Mercado Libre da
      // 403 forbidden contra su API. Se guarda un access token de MP por
      // cuenta (secret_mp_<cuenta>) desde la seccion Mercado Pago.
      const encMp = await readUserField(uid, idToken, "secret_mp_" + mlId);
      if (!encMp) {
        return json(400, {
          error: "Falta el token de Mercado Pago de esta cuenta.",
          code: "sin_token_mp"
        });
      }
      accessToken = decrypt(encMp).trim();
    } else {
      const enc = await readUserField(uid, idToken, field);
      if (!enc) {
        return json(400, { error: "No hay tokens de ML. Conecta tu cuenta primero." });
      }
      let tokens = JSON.parse(decrypt(enc));

      const now = Math.floor(Date.now() / 1000);
      const expiresAt = (tokens.obtained_at || 0) + (tokens.expires_in || 0) - REFRESH_BUFFER_SECS;
      if (now >= expiresAt && tokens.refresh_token) {
        tokens = await refreshToken(tokens, uid, idToken, field);
      }
      accessToken = tokens.access_token;
    }

    const base = HOSTS[host] || ML_API;
    const url = base + (endpoint.startsWith("/") ? endpoint : "/" + endpoint);
    const fetchOpts = {
      method: (method || "GET").toUpperCase(),
      headers: {
        Authorization: "Bearer " + accessToken,
        Accept: "application/json"
      },
      cache: "no-store"
    };
    if (reqBody && (fetchOpts.method === "POST" || fetchOpts.method === "PUT" || fetchOpts.method === "PATCH")) {
      fetchOpts.headers["Content-Type"] = "application/json";
      fetchOpts.body = JSON.stringify(reqBody);
    }

    const res = await fetch(url, fetchOpts);
    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      const status = res.status === 401 ? 401 : 502;
      const quien = host === "mp" ? "Mercado Pago" : "ML";
      return json(status, {
        error: payload.message || quien + " API error " + res.status,
        mlStatus: res.status,
        payload
      });
    }

    return json(200, { payload });
  } catch (error) {
    return json(400, { error: error.message || "Error al consultar Mercado Libre." });
  }
};

async function refreshToken(tokens, uid, idToken, field) {
  const appId = process.env.ML_APP_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  if (!appId || !clientSecret) throw new Error("Faltan ML_APP_ID / ML_CLIENT_SECRET.");

  const res = await fetch(ML_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: appId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token
    }).toString()
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error("No se pudo refrescar el token de ML: " + (data.message || data.error || "error"));
  }

  const fresh = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in || 10800,
    user_id: data.user_id || tokens.user_id,
    obtained_at: Math.floor(Date.now() / 1000)
  };

  await writeUserField(uid, idToken, field, encrypt(JSON.stringify(fresh)));
  return fresh;
}
