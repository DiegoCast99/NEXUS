/* ============================================================
   NEXUS · Firestore (sincronización de datos por usuario)
   ============================================================
   Monta una capa de nube ENCIMA de localStorage: el dashboard sigue
   leyendo/escribiendo localStorage como siempre, y esta capa:
     - al iniciar sesión, baja el doc del usuario y lo vuelca a localStorage;
     - tras cada cambio (vía safeSetItem), sube todos los datos (debounced).
   Modelo: users/{uid}.nexusData = { "<clave localStorage>": "<valor>" , ... }
   Si el SDK de Firestore no está cargado, window.NexusFirestore queda undefined
   y el dashboard funciona igual (solo localStorage).
   ============================================================ */
(function () {
  if (typeof firebase === "undefined" || typeof firebase.firestore !== "function") {
    // SDK de Firestore no disponible: el dashboard sigue con localStorage.
    return;
  }

  const db = firebase.firestore();

  function currentUid() {
    const user =
      window.NexusFirebaseAuth && window.NexusFirebaseAuth.getCurrentUser
        ? window.NexusFirebaseAuth.getCurrentUser()
        : null;
    return user ? user.uid : null;
  }

  window.NexusFirestore = {
    // Baja el doc del usuario y escribe sus blobs en localStorage (uso directo,
    // NO safeSetItem, para no re-disparar la sincronización a la nube).
    loadUserData: async function (uid) {
      if (!uid) return false;
      try {
        const snap = await db.collection("users").doc(uid).get();
        if (!snap.exists) return false;
        const data = snap.data() || {};
        const blobs = data.nexusData || {};
        Object.keys(blobs).forEach(function (key) {
          try {
            if (typeof blobs[key] === "string") {
              localStorage.setItem(key, blobs[key]);
            }
          } catch (error) {
            /* cuota u otro: se ignora, el dato vive igual en la nube */
          }
        });
        return true;
      } catch (error) {
        console.warn("Nexus: no se pudieron cargar datos de Firestore:", error);
        return false;
      }
    },

    // Sube el objeto de blobs { clave: valor } al doc del usuario.
    saveUserData: async function (blobs) {
      const uid = currentUid();
      if (!uid || !blobs) return false;
      try {
        await db
          .collection("users")
          .doc(uid)
          .set(
            {
              nexusData: blobs,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        return true;
      } catch (error) {
        console.warn("Nexus: no se pudo guardar en Firestore:", error);
        return false;
      }
    }
  };
})();
