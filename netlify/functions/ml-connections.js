/* ============================================================
   NEXUS · POST /.netlify/functions/ml-connections
   ------------------------------------------------------------
   Devuelve, por CADA cuenta de Mercado Libre, si tiene tokens
   guardados server-side (Firestore, cifrados, por uid). Es la
   FUENTE DE VERDAD del estado "conectado": no depende del blob
   localStorage<->Firestore (que puede llegar parcial o pisarse
   entre dispositivos). Cualquier dispositivo/navegador/PWA que
   inicie sesion con el mismo usuario ve el MISMO resultado.

   Respuesta: { ok:true, accounts: { <slot>: { connected, userId, scope } } }
   Header: Authorization: Bearer <Firebase ID token>
   ============================================================ */
const { decrypt, readUserField, uidFromIdToken, getIdToken, json, ML_ACCOUNTS } = require("./_shared");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Solo POST." });
  try {
    const idToken = getIdToken(event);
    const uid = uidFromIdToken(idToken);

    const accounts = {};
    for (const mlId of ML_ACCOUNTS) {
      let connected = false, userId = null, scope = null;
      try {
        const enc = await readUserField(uid, idToken, "secret_" + mlId);
        if (enc) {
          const parsed = JSON.parse(decrypt(enc));
          // Conectada de verdad solo si el bundle tiene los tokens; un refresh
          // reescribe el bundle conservando access/refresh, asi que esto es estable.
          if (parsed && parsed.access_token && parsed.refresh_token) {
            connected = true;
            userId = parsed.user_id != null ? String(parsed.user_id) : null;
            scope = parsed.scope || null;   // puede faltar tras un refresh; el front conserva el suyo
          }
        }
      } catch (e) { /* cuenta sin conectar o bundle ilegible: connected=false */ }
      accounts[mlId] = { connected: connected, userId: userId, scope: scope };
    }

    return json(200, { ok: true, accounts: accounts });
  } catch (error) {
    return json(400, { error: (error && error.message) || "No se pudo consultar las conexiones de ML." });
  }
};
