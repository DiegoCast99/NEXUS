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
    }
  };
})();
