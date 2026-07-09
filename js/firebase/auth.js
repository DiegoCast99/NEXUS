/* ============================================================
   NEXUS · Firebase Authentication
   ============================================================
   Inicializa Firebase y expone funciones de login/logout/signup.
   Usa Firebase Auth (en lugar del hardcoded "DiegoCast99").
   ============================================================ */
(function () {
  const config = window.NexusFirebaseConfig;
  if (!config) {
    console.error("Firebase config not loaded. Load config.js first.");
    return;
  }

  // Inicializar Firebase (librería debe estar cargada en el HTML)
  if (typeof firebase === "undefined") {
    console.error("Firebase SDK not loaded. Add <script> to HTML.");
    return;
  }

  firebase.initializeApp(config);
  const auth = firebase.auth();

  // Namespace público
  window.NexusFirebaseAuth = {
    // ¿Hay un usuario autenticado ahora?
    getCurrentUser: function () {
      return auth.currentUser;
    },

    // ¿Hay sesión activa?
    hasSession: function () {
      return !!auth.currentUser;
    },

    // Login con email/password
    loginWithEmail: async function (email, password) {
      try {
        const result = await auth.signInWithEmailAndPassword(email, password);
        return { success: true, user: result.user };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },

    // Signup (crear usuario)
    signupWithEmail: async function (email, password) {
      try {
        const result = await auth.createUserWithEmailAndPassword(email, password);
        return { success: true, user: result.user };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },

    // Logout
    logout: async function () {
      try {
        await auth.signOut();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },

    // Listener para cambios de autenticación
    onAuthStateChanged: function (callback) {
      return auth.onAuthStateChanged(callback);
    }
  };
})();
