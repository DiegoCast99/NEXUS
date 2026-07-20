/* ============================================================
   NEXUS · Puente al proxy serverless (window.NexusSecureAPI)
   ------------------------------------------------------------
   Llama a las Netlify Functions pasando el ID token de Firebase.
   El token de Meta/e-commerce NO viaja por acá: lo guarda cifrado
   `save-token` y el servidor lo usa para hablar con las APIs.
   ============================================================ */
(function () {
  const BASE = "/.netlify/functions";

  async function getIdToken() {
    const auth = window.NexusFirebaseAuth;
    const user = auth && auth.getCurrentUser ? auth.getCurrentUser() : null;
    if (!user || typeof user.getIdToken !== "function") {
      throw new Error("Necesitás iniciar sesión para conectar cuentas.");
    }
    return user.getIdToken();
  }

  async function call(path, body) {
    const idToken = await getIdToken();
    let res;
    try {
      res = await fetch(BASE + "/" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + idToken
        },
        body: JSON.stringify(body || {})
      });
    } catch (networkError) {
      throw new Error(
        "No se pudo contactar al servidor seguro. Esto solo funciona en el sitio deployado en Netlify."
      );
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.error || "El servidor seguro respondió con error " + res.status + ".");
      // El detalle del rechazo viaja adjunto al Error: sin esto el llamador
      // solo ve un mensaje genérico y no puede distinguir un error de
      // validación (no reintentar) de uno pasajero (reintentar).
      error.httpStatus = res.status;
      error.code = data.code || "";
      error.payload = data.payload || data.mlPayload || null;
      error.partial = data.partial || null;
      throw error;
    }
    return data;
  }

  window.NexusSecureAPI = {
    // ¿Hay sesión de Firebase para poder llamar al proxy?
    available: function () {
      const auth = window.NexusFirebaseAuth;
      return !!(auth && auth.getCurrentUser && auth.getCurrentUser());
    },
    // Guarda (cifrado, server-side) el token de un proveedor.
    saveProviderToken: function (provider, token) {
      return call("save-token", { provider: provider, token: token });
    },
    // Trae insights de Meta Ads (el token lo lee el servidor de Firestore).
    metaInsights: function (params) {
      return call("meta-insights", params || {});
    },
    // Trae datos de un e-commerce (idem).
    commerceFetch: function (params) {
      return call("commerce-fetch", params || {});
    },
    // Guarda el bundle cifrado de tokens de ML (viene del OAuth callback).
    // `account` elige la cuenta (mercadolibre | mercadolibre2).
    mlSaveTokens: function (encBundle, account) {
      return call("ml-save-tokens", { encBundle: encBundle, account: account });
    },
    // Proxy seguro a la API de Mercado Libre, sobre la cuenta indicada.
    mlApi: function (endpoint, method, body, account) {
      return call("ml-api-proxy", { endpoint: endpoint, method: method || "GET", body: body, account: account });
    },
    // Clona una publicación de una cuenta de ML a otra. El clon se crea
    // pausado y sin stock: activarlo es una acción aparte y manual.
    // Con dryRun no toca nada, solo devuelve lo que habría enviado.
    mlCloneItem: function (sourceAccount, destAccount, sourceItemId, dryRun) {
      return call("ml-clone-item", {
        sourceAccount: sourceAccount,
        destAccount: destAccount,
        sourceItemId: sourceItemId,
        dryRun: dryRun === true
      });
    },
    // Guarda la suscripción Web Push del dispositivo.
    savePushSub: function (subscription, sellerId) {
      return call("save-push-sub", { subscription: subscription, sellerId: sellerId });
    },
    // Envía una notificación de prueba a los dispositivos del usuario,
    // con el texto de la cuenta indicada (para que imite a la venta real).
    sendTestPush: function (account) {
      return call("send-test-push", { account: account });
    },
    // Revisa la cadena que dispara la notificación de una venta real.
    mlDiagnose: function () {
      return call("ml-diagnose", {});
    }
  };
})();
