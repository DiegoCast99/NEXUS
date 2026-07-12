/* ============================================================
   NEXUS Dashboard · Notificaciones de ventas (Web Push)
   ------------------------------------------------------------
   Suscribe el dispositivo a Web Push y guarda la suscripción en
   Firestore vía save-push-sub. Cuando Mercado Libre avise de una
   venta, el webhook ml-notifications dispara "Vendiste / Mercado Libre".

   Requisitos: HTTPS + Service Worker + (en iPhone) PWA instalada en
   pantalla de inicio con iOS 16.4+.
   ============================================================ */
(function () {
  // Clave pública VAPID (la privada vive como env var en el servidor).
  var VAPID_PUBLIC = "BLohTYozFQLoQcY2Qe63hTPZBNiMZMwyI11o4OQ2gfEuZzHMFCP9AssIsluHLRBx1EMGWh5-e2lBobW7688t-m4";

  function urlB64ToUint8Array(base64) {
    var padding = "=".repeat((4 - (base64.length % 4)) % 4);
    var b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(b64);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function supported() {
    return ("serviceWorker" in navigator) && ("PushManager" in window) && ("Notification" in window);
  }

  function setState(msg, type) {
    var el = document.getElementById("mlNotifyMessage");
    if (el) {
      el.textContent = msg || "";
      el.className = "meta-message" + (type ? " is-" + type : "");
    }
  }

  function setButton(label, disabled) {
    var btn = document.getElementById("mlNotifyButton");
    if (!btn) return;
    if (label) btn.textContent = label;
    btn.disabled = !!disabled;
  }

  function getSellerId() {
    try {
      var cfg = window.NexusDash && window.NexusDash.getCommerceConfig
        ? window.NexusDash.getCommerceConfig("mercadolibre")
        : null;
      return (cfg && cfg.mlUserId) || "";
    } catch (e) {
      return "";
    }
  }

  async function enableNotifications() {
    if (!supported()) {
      setState("Este dispositivo no soporta notificaciones push. En iPhone: agregá Nexus a la pantalla de inicio (iOS 16.4+).", "error");
      return;
    }
    setButton("Activando...", true);
    try {
      var permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("Permiso de notificaciones denegado. Activalo desde los ajustes del teléfono.", "error");
        setButton("Activar notificaciones de ventas", false);
        return;
      }

      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC)
        });
      }

      if (!window.NexusSecureAPI || !window.NexusSecureAPI.available()) {
        setState("Necesitás tener la sesión de Nexus iniciada para activar las notificaciones.", "error");
        setButton("Activar notificaciones de ventas", false);
        return;
      }

      await window.NexusSecureAPI.savePushSub(sub.toJSON(), getSellerId());
      setButton("Notificaciones activas ✓", true);
      setState("Notificaciones activadas. Enviando una prueba a este dispositivo...", "success");
      // Push de prueba inmediato: confirma que la cadena completa funciona.
      try {
        await window.NexusSecureAPI.sendTestPush();
        setState("¡Listo! Deberías ver una notificación de prueba. Te avisaremos con cada venta de Mercado Libre.", "success");
      } catch (e) {
        setState("Suscripción guardada, pero la prueba falló: " + (e.message || e) + ". Las ventas igual pueden notificar.", "error");
      }
    } catch (error) {
      setState("No se pudieron activar las notificaciones: " + (error.message || error), "error");
      setButton("Activar notificaciones de ventas", false);
    }
  }

  async function refreshState() {
    var btn = document.getElementById("mlNotifyButton");
    if (!btn) return;
    if (!supported()) {
      setButton("Notificaciones no soportadas en este dispositivo", true);
      return;
    }
    try {
      if (Notification.permission === "granted") {
        var reg = await navigator.serviceWorker.ready;
        var sub = await reg.pushManager.getSubscription();
        if (sub) {
          setButton("Notificaciones activas ✓", true);
          return;
        }
      }
    } catch (e) { /* noop */ }
    setButton("Activar notificaciones de ventas", false);
  }

  window.addEventListener("load", function () {
    var btn = document.getElementById("mlNotifyButton");
    if (btn) btn.addEventListener("click", enableNotifications);
    refreshState();
  });

  window.NexusNotifications = { enableNotifications: enableNotifications, refreshState: refreshState };
})();
