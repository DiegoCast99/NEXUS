/* ============================================================
   NEXUS · Configuración de Firebase
   ============================================================
   Config pública (apiKey está expuesto en el navegador; está bien).
   Las reglas de Firestore y Auth verifican permisos en el backend.
   ============================================================ */
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyDLIXaVVhwI-cRzaqzuZQ6HKL5gSb6cRYA",
    authDomain: "nexus-systems-17a5b.firebaseapp.com",
    projectId: "nexus-systems-17a5b",
    storageBucket: "nexus-systems-17a5b.firebasestorage.app",
    messagingSenderId: "328485071391",
    appId: "1:328485071391:web:63f243a64d715ec460c32a"
  };

  // Exponer para que otros módulos accedan
  window.NexusFirebaseConfig = firebaseConfig;
})();
