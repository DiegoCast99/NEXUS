/* ============================================================
   NEXUS Dashboard · Tablas -> tarjetas en mobile (etiquetador)
   ------------------------------------------------------------
   En pantallas chicas las tablas se muestran como tarjetas
   apiladas (ver la Fase 3 en css/dashboard/mobile.css). Para que
   cada celda sepa a que columna pertenece, copiamos el texto de
   cada <th> del <thead> al <td> correspondiente como data-label;
   el CSS lo muestra con content: attr(data-label).

   Es generico: sirve para las 8 tablas (pedidos, publicaciones,
   mercado pago, publicador, historial, movimientos, campanas...)
   y para cualquiera que se agregue, sin tocar sus renders. Como
   las tablas se pintan por JS bajo demanda, un MutationObserver
   re-etiqueta cuando cambian las filas.
   ============================================================ */
(function (root) {
  function etiquetar(scope) {
    var tablas = (scope || document).querySelectorAll(".table-wrap table");
    for (var t = 0; t < tablas.length; t++) {
      var tabla = tablas[t];
      var ths = tabla.querySelectorAll("thead th");
      if (!ths.length) continue;
      var labels = [];
      for (var h = 0; h < ths.length; h++) labels.push(ths[h].textContent.trim());
      var filas = tabla.querySelectorAll("tbody tr");
      for (var f = 0; f < filas.length; f++) {
        var celdas = filas[f].children;
        for (var c = 0; c < celdas.length; c++) {
          var lbl = labels[c];
          // Solo escribir si cambia: no dispara el observer (es de childList).
          if (lbl && celdas[c].getAttribute("data-label") !== lbl) {
            celdas[c].setAttribute("data-label", lbl);
          }
        }
      }
    }
  }

  function init() {
    var main = document.querySelector(".dashboard-main");
    if (!main) return;
    etiquetar(main);
    if (typeof MutationObserver === "undefined") return;
    var pendiente = 0;
    var obs = new MutationObserver(function () {
      // Debounce con rAF: colapsa una rafaga de cambios en un solo pasado.
      if (pendiente) return;
      pendiente = requestAnimationFrame(function () {
        pendiente = 0;
        etiquetar(main);
      });
    });
    // childList (no attributes): escribir data-label no se re-dispara a si mismo.
    obs.observe(main, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  root.NexusMobileTables = { etiquetar: etiquetar };
})(typeof window !== "undefined" ? window : globalThis);
