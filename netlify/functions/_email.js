/* ============================================================
   NEXUS · Motor de emails transaccionales (PURO, testeable, zero-dep)
   ------------------------------------------------------------
   Reemplaza a EmailJS en Alpha Fitness. La lógica de render vive acá para poder
   testearla sin red. El endpoint (nexus-email.js) resuelve la plantilla + datos,
   llama a render() y envía por el proveedor (Brevo).

   Convención de variables (la misma que ya conoce el titular de EmailJS):
     {{var}}    → valor ESCAPADO (seguro contra HTML en nombres/direcciones)
     {{{var}}}  → valor CRUDO (HTML ya armado, ej. la tabla de ítems)
   ============================================================ */

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Reemplaza {{{crudo}}} y luego {{escapado}}. Variables desconocidas → "".
function render(tpl, data) {
  data = data || {};
  return String(tpl == null ? "" : tpl)
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, function (_, k) { return data[k] != null ? String(data[k]) : ""; })
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, function (_, k) { return data[k] != null ? esc(data[k]) : ""; });
}

// Formatea un número como precio en pesos ("$1.141,00" estilo UY simple → "$1141.00").
function money(n) {
  var v = parseFloat(n);
  if (isNaN(v)) return String(n == null ? "" : n);
  return "$" + v.toFixed(2);
}

// Construye la tabla HTML de ítems del pedido a partir de un array estructurado.
// Cada item: { nombre, cantidad, precio, sabor }. Todo escapado.
function buildItemsHtml(items) {
  if (!Array.isArray(items) || !items.length) return "";
  var rows = items.map(function (it) {
    it = it || {};
    var nombre = esc(it.nombre || "Producto");
    var sabor = it.sabor ? ' <span style="color:#888;font-size:12px;">(' + esc(it.sabor) + ")</span>" : "";
    var qty = parseInt(it.cantidad, 10) || 1;
    var precio = money((parseFloat(it.precio) || 0) * qty);
    return '<tr>' +
      '<td style="padding:6px 0;font-size:14px;color:#0f0f0f;">' + nombre + sabor +
      ' <span style="color:#888;">× ' + qty + '</span></td>' +
      '<td style="padding:6px 0;font-size:14px;color:#0f0f0f;text-align:right;white-space:nowrap;">' + precio + "</td>" +
      "</tr>";
  }).join("");
  return '<table style="width:100%;border-collapse:collapse;">' + rows + "</table>";
}

// Envoltura de marca ALPHA FITNESS (misma identidad que usaba el email de EmailJS).
function wrap(bodyHtml) {
  return '<div style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;">' +
    '<div style="height:5px;background:#39ff14;"></div>' +
    '<div style="background:#0f0f0f;padding:22px 32px;"><span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:1px;">ALPHA FITNESS</span></div>' +
    '<div style="padding:32px;">' + (bodyHtml || "") +
    '<hr style="border:none;border-top:1px solid #ececed;margin:24px 0 18px;">' +
    '<p style="margin:0;font-size:13px;color:#999;line-height:1.6;">¿Dudas? Respondé este correo o escribinos.<br><strong>Alpha Fitness</strong> · Suplementos e indumentaria deportiva</p>' +
    "</div></div></div>";
}

// Elige la plantilla ACTIVA para un evento (por evento o por id). null si no hay.
function pickTemplate(templates, evento) {
  if (!Array.isArray(templates)) return null;
  return templates.find(function (t) {
    return t && t.activo !== false && (t.evento === evento || t.id === evento);
  }) || null;
}

// Renderiza asunto + cuerpo (con wrapper de marca) de una plantilla y sus datos.
// Los ítems se pre-renderizan a HTML y quedan disponibles como {{{items}}}.
function renderTemplate(template, data) {
  data = data || {};
  var rdata = Object.assign({}, data);
  if (rdata.items && Array.isArray(rdata.items)) rdata.items = buildItemsHtml(rdata.items);
  var subject = render((template && template.asunto) || "", rdata);
  var body = render((template && template.cuerpoHtml) || "", rdata);
  return { subject: subject, html: wrap(body) };
}

// Payload para Brevo (POST https://api.brevo.com/v3/smtp/email).
function brevoPayload(opts) {
  var p = {
    sender: { name: opts.senderName || "Alpha Fitness", email: opts.senderEmail },
    to: [{ email: opts.to, name: opts.toName || undefined }],
    subject: opts.subject,
    htmlContent: opts.html
  };
  if (opts.replyTo) p.replyTo = { email: opts.replyTo };
  return p;
}

// ── Plantillas SEMILLA (fallback si el titular todavía no creó las suyas en el
//    editor de Nexus). Replican el correo que hoy manda EmailJS. ──
var DEFAULT_TEMPLATES = [
  {
    id: "venta",
    evento: "venta",
    nombre: "Confirmación de compra",
    activo: true,
    asunto: "¡Recibimos tu pedido! · {{numeroOrden}}",
    cuerpoHtml:
      '<h1 style="margin:0 0 6px;font-size:22px;color:#0f0f0f;">¡Gracias por tu compra, {{cliente}}!</h1>' +
      '<p style="margin:0 0 18px;font-size:15px;color:#444;line-height:1.6;">Recibimos tu pedido <strong>{{numeroOrden}}</strong> y ya lo estamos preparando. Te avisamos apenas salga el envío.</p>' +
      '<div style="background:#f7f7f8;border-radius:10px;padding:18px 20px;margin:0 0 18px;">' +
      '<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#999;font-weight:700;margin-bottom:10px;">Resumen del pedido</div>' +
      "{{{items}}}" +
      '<hr style="border:none;border-top:1px solid #e6e6e8;margin:12px 0;">' +
      '<table style="width:100%;font-size:15px;color:#0f0f0f;"><tr><td style="padding:2px 0;color:#666;">Total</td><td style="padding:2px 0;text-align:right;font-weight:800;">{{total}}</td></tr></table>' +
      "</div>" +
      '<p style="margin:0 0 6px;font-size:13px;color:#666;"><strong>Envío:</strong> {{envio}}</p>' +
      '<p style="margin:0 0 4px;font-size:13px;color:#666;"><strong>Entrega en:</strong> {{direccion}}</p>'
  },
  {
    id: "envio",
    evento: "envio",
    nombre: "Pedido despachado (con rastreo)",
    activo: true,
    asunto: "Tu pedido {{numeroOrden}} va en camino 🚚",
    cuerpoHtml:
      '<h1 style="margin:0 0 6px;font-size:22px;color:#0f0f0f;">¡Tu pedido va en camino, {{cliente}}!</h1>' +
      '<p style="margin:0 0 18px;font-size:15px;color:#444;line-height:1.6;">Despachamos tu pedido <strong>{{numeroOrden}}</strong> por <strong>{{transportista}}</strong>.</p>' +
      '<div style="background:#f7f7f8;border-radius:10px;padding:18px 20px;margin:0 0 20px;text-align:center;">' +
      '<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#999;font-weight:700;margin-bottom:6px;">Código de rastreo</div>' +
      '<div style="font-size:20px;font-weight:800;color:#0f0f0f;letter-spacing:1px;">{{codigoRastreo}}</div>' +
      "</div>" +
      '<div style="text-align:center;margin:0 0 8px;"><a href="{{urlRastreo}}" style="display:inline-block;background:#0f0f0f;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:8px;">Rastrear mi envío</a></div>'
  }
];

module.exports = {
  esc: esc, render: render, money: money, buildItemsHtml: buildItemsHtml,
  wrap: wrap, pickTemplate: pickTemplate, renderTemplate: renderTemplate,
  brevoPayload: brevoPayload, DEFAULT_TEMPLATES: DEFAULT_TEMPLATES
};
