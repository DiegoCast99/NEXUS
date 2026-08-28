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
  try {
    // La app del Dock en macOS corre en WKWebView (modo "standalone"): ahí el
    // transporte por streaming de Firestore (WebChannel) suele fallar y los datos
    // NUNCA cargan (dashboard vacío, sin perfil). Auto-detectar long-polling usa el
    // transporte eficiente en el navegador y cae a HTTP simple donde hace falta,
    // haciendo la sincronización confiable también instalado como app.
    db.settings({ experimentalAutoDetectLongPolling: true });
  } catch (error) {
    // settings() ya fijadas o no soportadas: seguimos con el transporte por defecto.
  }

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

    // Escucha EN VIVO el doc del usuario: cualquier cambio hecho en otro
    // dispositivo (o pestaña) dispara onRemote con los blobs frescos. Devuelve
    // la funcion para desuscribirse. Ignora el "eco" de las escrituras propias
    // aun no confirmadas por el servidor (hasPendingWrites) para no re-renderizar
    // de gusto ni entrar en bucle.
    watchUserData: function (uid, onRemote) {
      if (!uid || typeof onRemote !== "function") return function () {};
      try {
        return db.collection("users").doc(uid).onSnapshot(
          function (snap) {
            if (!snap.exists) return;
            if (snap.metadata && snap.metadata.hasPendingWrites) return;
            var data = snap.data() || {};
            onRemote(data.nexusData || {});
          },
          function (error) {
            console.warn("Nexus: listener de Firestore cortado:", error);
          }
        );
      } catch (error) {
        console.warn("Nexus: no se pudo suscribir a Firestore:", error);
        return function () {};
      }
    },

    // Sube el objeto de blobs { clave: valor } al doc del usuario.
    // Usa update() (no set merge) para REEMPLAZAR el campo nexusData entero: con
    // merge:true, Firestore hace merge PROFUNDO del mapa y las claves borradas
    // localmente nunca se iban de la nube (y el listener en vivo las resucitaba).
    // update solo toca nexusData/updatedAt; cualquier otro campo del doc queda
    // intacto. Si el doc aun no existe, se crea con set.
    saveUserData: async function (blobs) {
      const uid = currentUid();
      if (!uid || !blobs) return false;
      const ref = db.collection("users").doc(uid);
      const payload = {
        nexusData: blobs,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      try {
        await ref.update(payload);
        return true;
      } catch (error) {
        // Doc inexistente todavia: crearlo (primer guardado del usuario).
        if (error && error.code === "not-found") {
          try {
            await ref.set(payload, { merge: true });
            return true;
          } catch (e2) {
            console.warn("Nexus: no se pudo crear el doc en Firestore:", e2);
            return false;
          }
        }
        console.warn("Nexus: no se pudo guardar en Firestore:", error);
        return false;
      }
    }
  };
})();
