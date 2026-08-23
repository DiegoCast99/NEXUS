/* ============================================================
   NEXUS · Rentabilidad real (por publicación) — E-Commerce / ML
   ------------------------------------------------------------
   Ganancia neta = ingresos − comisión y envío de ML − costo (COGS) − ads.
   COGS sale del costo por producto (Inventario) vía la composición de cada
   publicación (S.cogsUnit). Usa el período elegido arriba (snap.orders ya viene
   filtrado). Ad spend: best-effort desde las campañas cacheadas (últ. 30 días).
   ============================================================ */
(function () {
  const S = window.NexusDash;
  if (!S) return;
  const el = (id) => document.getElementById(id);
  function esc(s) { try { return S.escapeHtml(String(s == null ? "" : s)); } catch (e) { return String(s == null ? "" : s); } }
  function money(n) { try { return S.moneyWithCents.format(Number(n) || 0); } catch (e) { return "$" + Math.round(Number(n) || 0); } }
  function intn(n) { try { return S.integerNumber.format(Number(n) || 0); } catch (e) { return String(Math.round(Number(n) || 0)); } }
  function pct(n) { return (Math.round((Number(n) || 0) * 10) / 10) + "%"; }

  function adsGastoDe(cuenta) {
    try {
      var d = S.adsDatos ? S.adsDatos(cuenta) : null;
      var camps = d && d.campaigns;
      if (!Array.isArray(camps)) return 0;
      return camps.reduce(function (a, c) { return a + (Number(c.gasto) || 0); }, 0);
    } catch (e) { return 0; }
  }

  function tile(label, value, sub, tone) {
    return '<div class="renta-tile' + (tone ? " is-" + tone : "") + '">' +
      '<span class="renta-tile-lbl">' + esc(label) + '</span>' +
      '<strong>' + esc(value) + '</strong>' +
      '<small>' + esc(sub) + '</small></div>';
  }

  function renderRentabilidad() {
    var box = el("rentaBody"); if (!box) return;
    if (!S.activeMLId || !S.getCommerceSnapshot) { box.innerHTML = ""; return; }
    var cuenta = S.activeMLId();
    var snap = S.getCommerceSnapshot(cuenta);
    var orders = (snap && snap.orders) || [];
    if (!orders.length) {
      box.innerHTML = '<div class="empty-state"><span></span><h3>Sin ventas en el período</h3><p>Cambiá el período arriba o sincronizá Mercado Libre.</p></div>';
      return;
    }
    // Agrupar por publicación (itemId).
    var byList = {};
    orders.forEach(function (o) {
      var id = String(o.itemId || o.product || "?");
      var r = byList[id] || (byList[id] = { id: id, name: o.product || id, itemId: String(o.itemId || ""), varId: String(o.variation || o.variationId || ""), units: 0, ingresos: 0, fees: 0, thumb: o.thumbnail || "" });
      r.units += Number(o.units) || 1;
      r.ingresos += Number(o.total) || 0;
      r.fees += (Number(o.commission) || 0) + (Number(o.shipping) || 0);
      if (!r.thumb && o.thumbnail) r.thumb = o.thumbnail;
    });
    var filas = Object.keys(byList).map(function (k) { return byList[k]; });

    var totIng = 0, totFees = 0, totCogs = 0, cogsKnown = false, faltanCosto = 0;
    filas.forEach(function (r) {
      var cu = S.cogsUnit ? S.cogsUnit(r.itemId || r.id, r.varId) : null;
      if (cu == null) { r.cogs = null; faltanCosto++; }
      else { r.cogs = cu * r.units; totCogs += r.cogs; cogsKnown = true; }
      r.neta = r.ingresos - r.fees - (r.cogs || 0);
      r.margen = r.ingresos > 0 ? (r.neta / r.ingresos) * 100 : 0;
      totIng += r.ingresos; totFees += r.fees;
    });
    filas.sort(function (a, b) { return b.neta - a.neta; });

    var ads = adsGastoDe(cuenta);
    var netaTotal = totIng - totFees - totCogs;
    var netaReal = netaTotal - ads;
    var margenTotal = totIng > 0 ? (netaTotal / totIng) * 100 : 0;

    var tiles =
      tile("Ingresos", money(totIng), "ventas del período") +
      tile("Costos ML", money(totFees), "comisión + envío", "neg") +
      tile("Costo (COGS)", cogsKnown ? money(totCogs) : "—", cogsKnown ? "costo de los productos" : "cargá costos en Inventario", "neg") +
      tile("Ganancia neta", money(netaTotal), "ingresos − ML − costo", netaTotal >= 0 ? "pos" : "neg") +
      tile("Margen", pct(margenTotal), "sobre ingresos", margenTotal >= 0 ? "pos" : "neg");

    var rowsHtml = filas.map(function (r) {
      var cogsC = r.cogs == null ? '<span class="renta-falta">falta costo</span>' : money(r.cogs);
      var netaC = r.cogs == null ? '<span class="renta-parcial">' + money(r.neta) + "*</span>" : money(r.neta);
      var cls = r.neta >= 0 ? "renta-pos" : "renta-neg";
      var thumb = r.thumb ? '<img class="renta-thumb" src="' + esc(r.thumb) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'"/>' : '<span class="renta-thumb"></span>';
      return "<tr>" +
        '<td class="renta-pub">' + thumb + "<span>" + esc(r.name) + "</span></td>" +
        '<td class="num">' + intn(r.units) + "</td>" +
        '<td class="num">' + money(r.ingresos) + "</td>" +
        '<td class="num">' + money(r.fees) + "</td>" +
        '<td class="num">' + cogsC + "</td>" +
        '<td class="num ' + cls + '">' + netaC + "</td>" +
        '<td class="num ' + cls + '">' + pct(r.margen) + "</td>" +
      "</tr>";
    }).join("");

    box.innerHTML =
      '<div class="renta-tiles">' + tiles + "</div>" +
      (ads > 0 ? '<p class="renta-adsline">Menos <b>publicidad</b> (' + money(ads) + ", últ. 30 días) &rarr; <b>ganancia neta real &asymp; " + money(netaReal) + "</b>.</p>" : "") +
      (faltanCosto ? '<p class="inv-hint">' + faltanCosto + " publicación(es) sin costo cargado (marcadas con <b>*</b>). Cargá el costo en <b>Inventario &rarr; Lista de productos</b> para que la ganancia sea exacta.</p>" : "") +
      '<div class="table-wrap"><table class="meta-table renta-table"><thead><tr>' +
      "<th>Publicación</th><th>Unid.</th><th>Ingresos</th><th>Costos ML</th><th>COGS</th><th>Neta</th><th>Margen</th>" +
      "</tr></thead><tbody>" + rowsHtml + "</tbody></table></div>";
  }

  function abrir() {
    var box = el("rentaBody");
    if (box) box.innerHTML = '<div class="home-empty">Calculando rentabilidad…</div>';
    Promise.resolve(S.ensureInventoryLoaded ? S.ensureInventoryLoaded() : true).then(renderRentabilidad).catch(renderRentabilidad);
  }

  // Se calcula al abrir la sección (trae el inventario para el COGS) y con el botón.
  try {
    window.addEventListener("nexus:section", function (e) {
      var d = e && e.detail;
      if (d && d.module === "commerce" && d.section === "rentabilidad") abrir();
    });
  } catch (e) {}
  document.addEventListener("click", function (e) {
    if (e.target && e.target.closest && e.target.closest("#rentaReload")) abrir();
  });

  Object.assign(S, { renderRentabilidad: renderRentabilidad });
})();
