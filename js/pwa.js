/* NEXUS · Registra el Service Worker (PWA). No bloquea el arranque. */
(function () {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {
      /* si falla (p.ej. file://), la app sigue funcionando sin offline */
    });
  });
})();
