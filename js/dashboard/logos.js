/* ============================================================
   NEXUS Dashboard · Logos de marketplaces y campañas (SVG)
   Marcas vectoriales en tiles redondeados, tal como el mockup.
   Se usan para identificar las cuentas/canales del titular
   (uso legítimo de marca, no impersonación). Si el titular pasa
   PNG oficiales, se reemplaza el `mark` del slug correspondiente.
   Parte de window.NexusDash.
   ============================================================ */
(function () {
  const S = window.NexusDash;
  if (!S) return;

  // Cada marca: color de fondo del tile + contenido SVG (viewBox 0 0 24 24).
  var MARKS = {
    mercadolibre: {
      // Logo oficial de Mercado Libre. `asset` = archivo real (va ARRIBA del SVG
      // dibujado; si falta o falla, queda el SVG de respaldo). Para pixel-perfect,
      // reemplazá img/logos/mercadolibre.svg por el export oficial (o .png).
      asset: "img/logos/mercadolibre.svg",
      full: true,
      vb: "0 0 48 48",
      svg: '<ellipse cx="24" cy="24" rx="22.4" ry="15.9" fill="#FFE600" stroke="#243A82" stroke-width="2.7"/>' +
        '<g fill="#fff" stroke="#243A82" stroke-width="1.15" stroke-linejoin="round" stroke-linecap="round">' +
        '<path d="M3.4 30.4c4.6-2.8 9-4.2 13.3-4 2.3.1 4.2.9 5.8 2.3l1.9 1.7-2 3.4c-1.5 1.1-3.4 1.6-5.5 1.4-4.6-.4-9.1-2-13.5-4.8Z"/>' +
        '<path d="M44.6 17.6c-4.6 2.8-9 4.2-13.3 4-2.3-.1-4.2-.9-5.8-2.3l-1.9-1.7 2-3.4c1.5-1.1 3.4-1.6 5.5-1.4 4.6.4 9.1 2 13.5 4.8Z"/>' +
        '<path d="M21.6 28.9c-1.7-1.6-2-4-.7-6 1.2-1.9 3.5-2.7 5.6-2l.6.2c1.5.5 2.6 1.7 3 3.2l.2.7c.5 2.1-.5 4.3-2.4 5.3l-.7.4c-1.9 1-4.2.6-5.7-.9Z"/>' +
        '<path d="M22.1 24l3.7 2.7M23.8 22.3l3.6 2.6M25.7 21.1l3.3 2.4" fill="none"/>' +
        '</g>'
    },
    amazon: {
      bg: "#232f3e",
      svg: '<path d="M5 14.4c2.2 1.5 4.7 2.2 7.2 2.2 2.1 0 4.2-.5 6.1-1.5.3-.2.6.1.3.4-1.7 1.6-4.1 2.4-6.3 2.4-3 0-5.8-1.1-7.9-3-.2-.2 0-.5.3-.5.1 0 .2 0 .2.0Z" fill="#ff9900"/><path d="M18.7 13.2c-.3-.4-1.8-.2-2.5-.1-.2 0-.2-.2-.1-.3.6-.4 1.6-.6 2.4-.4.6.2.6 1.4.2 2-.1.2-.3.1-.3-.1.1-.4.3-.8.1-1Z" fill="#ff9900"/><path d="M9.2 8.2c0-.6.3-1.1.8-1.4.5-.3 1.2-.4 1.9-.2.5.1.9.4 1.1.8.2.4.2.9.2 1.4v1.7c0 .4.1.6.3.9.1.1.1.2 0 .3l-.9.8c-.1.1-.2.1-.3 0-.2-.2-.3-.3-.4-.6-.4.4-.9.6-1.5.6-.9 0-1.7-.6-1.7-1.7 0-.9.5-1.5 1.2-1.8.6-.2 1.4-.3 1.8-.3v-.3c0-.4 0-.8-.3-1-.2-.2-.5-.2-.7-.2-.5 0-.9.2-1 .7 0 .1-.1.2-.2.2l-.9-.1c-.1 0-.2-.1-.2-.2Zm2.5 2.4v-.2c-.4 0-1 0-1.3.2-.3.2-.4.4-.4.7 0 .4.3.6.6.6.3 0 .5-.2.7-.4.1-.3.4-.5.4-.9Z" fill="#fff"/>'
    },
    shopee: {
      bg: "#ee4d2d",
      svg: '<path d="M6.2 9h11.6l-.9 8.6a1.6 1.6 0 0 1-1.6 1.4H9.3a1.6 1.6 0 0 1-1.6-1.4L6.2 9Z" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M9 9a3 3 0 0 1 6 0" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M13.7 12.3c-.4-.3-1-.5-1.6-.5-.9 0-1.5.4-1.5 1.1 0 1.4 3 .8 3 2.6 0 .8-.7 1.2-1.6 1.2-.7 0-1.4-.2-1.8-.6" fill="none" stroke="#fff" stroke-width="1.15" stroke-linecap="round"/>'
    },
    tiendamia: {
      bg: "linear-gradient(135deg,#33aaff,#1e6fd8)",
      svg: '<path d="M5 9.5 6.2 7h11.6L19 9.5v.6a2.1 2.1 0 0 1-4 .3 2.1 2.1 0 0 1-4 0 2.1 2.1 0 0 1-4 0 2.1 2.1 0 0 1-2-.9Z" fill="#fff"/><path d="M6.2 11.4V18h11.6v-6.6" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 18v-3.4h4V18" fill="none" stroke="#fff" stroke-width="1.4"/>'
    },
    // ---- Campañas ----
    meta: {
      bg: "#0b1f4d",
      svg: '<path d="M3 12.2c0-2.4 1.4-4.2 3.3-4.2 1.5 0 2.6 1.2 3.6 2.8.6 1 .8 1.5 1.1 1.5.3 0 .5-.5 1.1-1.5 1-1.6 2.1-2.8 3.6-2.8 1.9 0 3.3 1.8 3.3 4.2s-1.3 3.9-3 3.9c-1.4 0-2.4-1.1-3.4-2.7-.7-1.1-.9-1.6-1.2-1.6-.3 0-.5.5-1.2 1.6-1 1.6-2 2.7-3.4 2.7-1.7 0-3-1.5-3-3.9Zm2 0c0 1.3.6 2 1.4 2 .8 0 1.4-.7 2.2-2-.8-1.3-1.4-2-2.2-2-.8 0-1.4.7-1.4 2Zm9.2 0c.8 1.3 1.4 2 2.2 2 .8 0 1.4-.7 1.4-2s-.6-2-1.4-2c-.8 0-1.4.7-2.2 2Z" fill="#4a9eff"/>'
    },
    google: {
      bg: "#ffffff",
      svg: '<path d="M20 12.2c0-.6-.05-1.1-.15-1.6H12v3.1h4.5c-.2 1-.8 1.9-1.7 2.5v2h2.7c1.6-1.5 2.5-3.6 2.5-6Z" fill="#4285F4"/><path d="M12 20.2c2.3 0 4.2-.75 5.6-2l-2.7-2c-.75.5-1.7.8-2.9.8-2.2 0-4.1-1.5-4.8-3.5H4.4v2.1A8.2 8.2 0 0 0 12 20.2Z" fill="#34A853"/><path d="M7.2 13.5a4.9 4.9 0 0 1 0-3.1V8.3H4.4a8.2 8.2 0 0 0 0 7.3l2.8-2.1Z" fill="#FBBC05"/><path d="M12 6.8c1.25 0 2.4.43 3.3 1.28l2.4-2.4A8.2 8.2 0 0 0 4.4 8.3l2.8 2.1c.7-2 2.6-3.6 4.8-3.6Z" fill="#EA4335"/>'
    },
    tiktok: {
      bg: "#111111",
      svg: '<path d="M14.6 5.6c.35 1.9 1.6 3.35 3.4 3.7v2.5c-1.15-.05-2.25-.4-3.15-1v4.9a4.65 4.65 0 1 1-4.65-4.65c.25 0 .5.02.75.06v2.55a2.15 2.15 0 1 0 1.5 2.05V5.6h2.15Z" fill="#25f4ee"/><path d="M15.2 5.6c.35 1.9 1.6 3.35 3.4 3.7v2.5c-1.15-.05-2.25-.4-3.15-1v4.9A4.65 4.65 0 1 1 10.8 11c.25 0 .5.02.75.06v2.55A2.15 2.15 0 1 0 13.05 15.6V5.6h2.15Z" fill="#fff"/>'
    },
    email: {
      bg: "linear-gradient(135deg,#ff8f6b,#ff5a2e)",
      svg: '<rect x="4.5" y="7" width="15" height="10.5" rx="2" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M5.2 8.2 12 13l6.8-4.8" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
    }
  };

  var ALIAS = {
    mercadolibre2: "mercadolibre",
    mercadolivre: "mercadolibre",
    "mercado libre": "mercadolibre",
    "mercado libre 1": "mercadolibre",
    "mercado libre 2": "mercadolibre",
    "tienda mia": "tiendamia",
    "meta ads": "meta",
    facebook: "meta",
    "google ads": "google",
    "tiktok ads": "tiktok",
    "email marketing": "email"
  };

  function slugFor(key) {
    var k = String(key || "").toLowerCase().trim();
    if (MARKS[k]) return k;
    if (ALIAS[k]) return ALIAS[k];
    return null;
  }

  // Devuelve el tile de logo (span con fondo de marca + svg). size en px.
  function platformLogo(key, size) {
    var slug = slugFor(key);
    size = size || 40;
    var radius = Math.round(size * 0.26);
    if (!slug) {
      // Fallback: inicial sobre tile neutro (no rompe si aparece un canal nuevo).
      var ini = String(key || "?").trim().slice(0, 2).toUpperCase();
      return '<span class="pf-logo pf-fallback" style="width:' + size + 'px;height:' + size + 'px;border-radius:' + radius + 'px">' + ini + "</span>";
    }
    var m = MARKS[slug];
    // "full": el SVG ES el logo completo (ej: el ovalo de Mercado Libre) y llena
    // el tile, sin fondo cuadrado ni borde. El resto usa tile con fondo de marca.
    var full = !!m.full;
    var inner = full ? size : Math.round(size * 0.68);
    var vb = m.vb || "0 0 24 24";
    var style = "width:" + size + "px;height:" + size + "px;border-radius:" + radius + "px" + (full ? "" : ";background:" + m.bg) + (m.asset ? ";position:relative" : "");
    var svgTag = '<svg viewBox="' + vb + '" width="' + inner + '" height="' + inner + '" aria-hidden="true">' + m.svg + "</svg>";
    // Asset oficial (si existe) montado ARRIBA del SVG; onerror lo quita y deja el SVG.
    var imgTag = m.asset
      ? '<img src="' + m.asset + '" alt="" onerror="this.remove()" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;border-radius:inherit"/>'
      : "";
    return '<span class="pf-logo pf-' + slug + (full ? " pf-full" : "") + '" style="' + style + '">' + svgTag + imgTag + "</span>";
  }

  Object.assign(S, { platformLogo: platformLogo, logoSlugFor: slugFor });
})();
