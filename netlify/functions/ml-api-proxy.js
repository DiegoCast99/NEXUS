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

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Solo POST." });
  try {
    const idToken = getIdToken(event);
    const uid = uidFromIdToken(idToken);
    const { endpoint, method, body: reqBody, account } = parseBody(event);
    const mlId = mlAccount(account);
    const field = "secret_" + mlId;

    if (!endpoint || typeof endpoint !== "string") {
      return json(400, { error: "Falta el endpoint de ML." });
    }

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

    const url = ML_API + (endpoint.startsWith("/") ? endpoint : "/" + endpoint);
    const fetchOpts = {
      method: (method || "GET").toUpperCase(),
      headers: {
        Authorization: "Bearer " + tokens.access_token,
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
      return json(status, { error: payload.message || "ML API error " + res.status, payload });
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
