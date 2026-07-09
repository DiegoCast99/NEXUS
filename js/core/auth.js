/* ============================================================
   NEXUS · Núcleo de sesión (compartido)
   ------------------------------------------------------------
   Fuente ÚNICA de la clave y el usuario de sesión. Cargado por
   index.html y dashboard.html ANTES del script de cada página.
   Antes esto estaba duplicado: authKey/AUTH_KEY y loginUser/AUTH_USER.
   ============================================================ */
(function () {
  const KEY = "nexus.private.session.v1";
  const USER = "DiegoCast99";

  window.NexusAuth = {
    KEY: KEY,
    USER: USER,

    // ¿Hay una sesión válida guardada?
    hasSession: function () {
      try {
        const session = JSON.parse(localStorage.getItem(KEY) || "null");
        return !!session && session.user === USER;
      } catch (error) {
        return false;
      }
    },

    // Crea la sesión (tras login correcto).
    createSession: function () {
      localStorage.setItem(KEY, JSON.stringify({ user: USER, startedAt: Date.now() }));
    },

    // Cierra la sesión.
    clearSession: function () {
      localStorage.removeItem(KEY);
    }
  };
})();
