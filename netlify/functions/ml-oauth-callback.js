/* ============================================================
   NEXUS · GET /.netlify/functions/ml-oauth-callback
   ------------------------------------------------------------
   Mercado Libre redirige aqui con ?code=...&state=... despues
   de que el usuario autoriza. Esta funcion:

   1. Intercambia el code por tokens (server-side, usa ML_CLIENT_SECRET).
   2. Cifra el bundle de tokens con TOKEN_ENC_KEY.
   3. Devuelve una pagina HTML puente que guarda el blob cifrado en
      sessionStorage y redirige al dashboard, donde el JS lo sube a
      Firestore bajo el uid del usuario logueado.

   El access_token/refresh_token NUNCA viajan en texto plano al browser.
   ============================================================ */
const { encrypt, json } = require("./_shared");

const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Solo GET." });

  const params = event.queryStringParameters || {};
  const code = params.code;
  const state = params.state || "";
  const error = params.error;

  if (error) return bridgePage({ error: "Mercado Libre rechazo la autorizacion: " + error });
  if (!code) return bridgePage({ error: "No se recibio codigo de autorizacion de ML." });

  const appId = process.env.ML_APP_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  if (!appId || !clientSecret) {
    return bridgePage({ error: "Faltan ML_APP_ID o ML_CLIENT_SECRET en Netlify." });
  }

  const siteUrl = process.env.URL || "";
  const redirectUri = siteUrl + "/.netlify/functions/ml-oauth-callback";

  let data;
  try {
    const res = await fetch(ML_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: appId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri
      }).toString()
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      return bridgePage({ error: data.message || data.error || "ML no devolvio tokens." });
    }
  } catch (networkErr) {
    return bridgePage({ error: "No se pudo contactar a la API de Mercado Libre." });
  }

  const bundle = JSON.stringify({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in || 10800,
    user_id: data.user_id,
    obtained_at: Math.floor(Date.now() / 1000)
  });

  const encBundle = encrypt(bundle);
  return bridgePage({ encBundle, state });
};

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function bridgePage({ error, encBundle, state }) {
  const body = error
    ? '<p class="err">' + esc(error) + '</p><p><a href="/dashboard.html#ecommerce" style="color:#ffe600">Volver al dashboard</a></p>'
    : '<div class="spin"></div><p>Conectando Mercado Libre...</p>'
      + '<script>'
      + 'try{'
      + 'sessionStorage.setItem("nexus_ml_enc",' + JSON.stringify(encBundle) + ');'
      + 'sessionStorage.setItem("nexus_ml_state",' + JSON.stringify(state || "") + ');'
      + 'window.location.replace("/dashboard.html#ml-connect");'
      + '}catch(e){document.querySelector(".box").innerHTML=\'<p class="err">\'+e.message+\'</p>\';}'
      + '</script>';

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Nexus · Mercado Libre</title>'
    + '<style>'
    + 'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0f;color:#f3f3f8;font-family:system-ui}'
    + '.box{text-align:center;max-width:400px;padding:2rem}'
    + '.spin{width:40px;height:40px;margin:0 auto 1rem;border:3px solid rgba(255,230,0,.15);border-top-color:#ffe600;border-radius:50%;animation:s .8s linear infinite}'
    + '@keyframes s{to{transform:rotate(360deg)}}'
    + '.err{color:#ff4d6a}'
    + '</style></head><body>'
    + '<div class="box">' + body + '</div>'
    + '</body></html>';

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    body: html
  };
}
