/* ============================================================
   NEXUS · _mltoken.js — Gestion de tokens de Mercado Libre
   ------------------------------------------------------------
   decrypt + refresh (si vencido) + re-persist cifrado. Reusable
   por el autopilot de ads (y cualquier job server-side) sin
   acoplarse al webhook. Es la MISMA logica que ml-notifications
   (tokenParaCuenta/refrescarToken) — si tocas una, revisa la otra.
   Zero-dep (fetch + crypto nativos).
   ============================================================ */
const { decrypt, encrypt } = require("./_shared");
const { adminPatchDoc } = require("./_fbadmin");

const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const REFRESH_BUFFER_SECS = 600; // refrescar 10 min antes de vencer

async function refrescarToken(tokens, uid, campo) {
  const appId = process.env.ML_APP_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  if (!appId || !clientSecret) throw new Error("faltan ML_APP_ID / ML_CLIENT_SECRET");
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
    throw new Error("refresh de token fallo: " + (data.message || data.error || res.status));
  }
  const frescos = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in || 10800,
    user_id: data.user_id || tokens.user_id,
    obtained_at: Math.floor(Date.now() / 1000)
  };
  await adminPatchDoc("users/" + uid, { [campo]: { stringValue: encrypt(JSON.stringify(frescos)) } }, [campo]);
  return frescos;
}

// Devuelve el access_token vigente de una cuenta (refrescando si hace falta).
// `fields` = doc.fields de users/{uid} (ya leido). Lanza si no hay tokens.
async function tokenParaCuenta(uid, fields, account) {
  const campo = "secret_" + account;
  const enc = fields && fields[campo] && fields[campo].stringValue;
  if (!enc) throw new Error("sin tokens de " + account);
  let tokens = JSON.parse(decrypt(enc));
  const ahora = Math.floor(Date.now() / 1000);
  const vence = (tokens.obtained_at || 0) + (tokens.expires_in || 0) - REFRESH_BUFFER_SECS;
  if (ahora >= vence && tokens.refresh_token) tokens = await refrescarToken(tokens, uid, campo);
  return tokens.access_token;
}

module.exports = { tokenParaCuenta };
