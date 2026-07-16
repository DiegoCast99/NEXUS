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
      throw new Error(data.error || "El servidor seguro respondió con error " + res.status + ".");
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
    mlSaveTokens: function (encBundle) {
      return call("ml-save-tokens", { encBundle: encBundle });
    },
    // Proxy seguro a la API de Mercado Libre.
    mlApi: function (endpoint, method, body) {
      return call("ml-api-proxy", { endpoint: endpoint, method: method || "GET", body: body });
    },
    // Guarda la suscripción Web Push del dispositivo.
    savePushSub: function (subscription, sellerId) {
      return call("save-push-sub", { subscription: subscription, sellerId: sellerId });
    },
    // Envía una notificación de prueba a los dispositivos del usuario.
    sendTestPush: function () {
      return call("send-test-push", {});
    },
    // Revisa la cadena que dispara la notificación de una venta real.
    mlDiagnose: function () {
      return call("ml-diagnose", {});
    }
  };
})();
