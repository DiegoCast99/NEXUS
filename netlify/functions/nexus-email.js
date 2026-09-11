/* ============================================================
   NEXUS · POST /.netlify/functions/nexus-email
   ------------------------------------------------------------
   Herramienta propia de email transaccional (reemplaza EmailJS en Alpha Fitness).
   Alpha llama a este endpoint (desde su webhook de pago, server-side) con el evento
   + los datos del pedido; acá se resuelve la plantilla, se renderiza y se envía por
   Brevo (capa gratuita ~300/día). Las plantillas se editan en el dashboard de Nexus
   (Herramientas → Correos) y se guardan en users/{uid}.emailTemplates (JSON string);
   si no hay ninguna, se usan las semilla de _email.js.

   SEGURIDAD: gated por Bearer token (NEXUS_EMAIL_TOKEN). La API key de Brevo vive
   SOLO en el servidor (env var), nunca llega al navegador.

   Env vars (Netlify de Nexus):
     NEXUS_EMAIL_TOKEN     secreto compartido con Alpha (Authorization: Bearer ...)
     BREVO_API_KEY         API key de Brevo (secreta)
     BREVO_SENDER_EMAIL    remitente verificado (ej. no-reply@alphafitnessuy.com)
     BREVO_SENDER_NAME     opcional (default "Alpha Fitness")
     BREVO_REPLY_TO        opcional (ej. alphafitnes24@gmail.com)
     EMAIL_OWNER_UID       opcional; si falta se resuelve de config/alpha_store.uid
   ============================================================ */
const { adminGetDoc, adminPatchDocIf } = require("./_fbadmin");
const EMAIL = require("./_email");

const JSON_HEADERS = { "Content-Type": "application/json" };
function ok(body) { return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(body || { ok: true }) }; }
function fail(code, msg) { return { statusCode: code, headers: JSON_HEADERS, body: JSON.stringify({ error: msg }) }; }

// Comparación de tokens en tiempo ~constante (evita timing attacks básicos).
function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
function bearer(event) {
  const h = event.headers || {};
  const raw = h.authorization || h.Authorization || h["x-nexus-token"] || "";
  return String(raw).replace(/^Bearer\s+/i, "").trim();
}

function fS(f) { return (f && f.stringValue !== undefined) ? f.stringValue : ""; }
function parseJsonField(f) { try { const v = JSON.parse(fS(f) || "null"); return v; } catch (e) { return null; } }

// uid del titular: env directa o config/alpha_store.uid (registrado por alpha-store).
async function resolverOwnerUid() {
  if (process.env.EMAIL_OWNER_UID) return process.env.EMAIL_OWNER_UID;
  try {
    const meta = await adminGetDoc("config/alpha_store");
    const uid = meta && meta.fields && meta.fields.uid && meta.fields.uid.stringValue;
    return uid || null;
  } catch (e) { return null; }
}

// Envía por Brevo. Devuelve { ok, id } o { ok:false, status, body }.
async function brevoSend(payload) {
  const key = process.env.BREVO_API_KEY;
  if (!key) return { ok: false, status: 0, body: "sin BREVO_API_KEY" };
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload)
  });
  const txt = await res.text().catch(function () { return ""; });
  if (res.ok) { let j = {}; try { j = JSON.parse(txt); } catch (e) {} return { ok: true, id: j.messageId || null }; }
  return { ok: false, status: res.status, body: (txt || "").slice(0, 200) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") return ok({ ok: true, fn: "nexus-email" });
  if (event.httpMethod !== "POST") return fail(405, "Method not allowed");

  // ── Auth ──
  const expected = process.env.NEXUS_EMAIL_TOKEN;
  if (!expected) return fail(500, "NEXUS_EMAIL_TOKEN no configurado en el servidor");
  if (!safeEqual(bearer(event), expected)) return fail(401, "Token inválido");

  // ── Body ──
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return fail(400, "JSON inválido"); }
  const evento = String(body.evento || body.templateId || "").trim();
  const to = body.to || {};
  const toEmail = String(to.email || body.email || "").trim();
  const data = body.data || {};
  const dedupeKey = body.dedupeKey ? String(body.dedupeKey) : "";
  const isTest = !!body.test;
  if (!evento) return fail(400, "falta 'evento'");
  if (!toEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail)) return fail(400, "email destino inválido");

  // ── Remitente ──
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  if (!senderEmail) return fail(500, "BREVO_SENDER_EMAIL no configurado");
  const senderName = process.env.BREVO_SENDER_NAME || "Alpha Fitness";
  const replyTo = process.env.BREVO_REPLY_TO || "";

  // ── Plantillas: custom del titular o semilla ──
  const uid = await resolverOwnerUid();
  let templates = null, userUpdateTime = null, sentIds = [];
  if (uid) {
    try {
      const doc = await adminGetDoc("users/" + uid);
      if (doc && doc.fields) {
        userUpdateTime = doc.updateTime;
        const t = parseJsonField(doc.fields.emailTemplates);
        if (Array.isArray(t) && t.length) templates = t;
        const s = parseJsonField(doc.fields.email_sent_ids);
        if (Array.isArray(s)) sentIds = s;
      }
    } catch (e) { /* usa semilla */ }
  }
  if (!templates) templates = EMAIL.DEFAULT_TEMPLATES;

  // Idempotencia: no reenviar el mismo (evento+orden) dos veces (salvo prueba).
  if (dedupeKey && !isTest && sentIds.indexOf(dedupeKey) !== -1) {
    return ok({ ok: true, skipped: "ya_enviado" });
  }

  let template = EMAIL.pickTemplate(templates, evento);
  if (!template) template = EMAIL.pickTemplate(EMAIL.DEFAULT_TEMPLATES, evento);
  if (!template) return ok({ ok: true, skipped: "sin_plantilla_para_" + evento });

  const rendered = EMAIL.renderTemplate(template, data);
  const payload = EMAIL.brevoPayload({
    senderName: senderName, senderEmail: senderEmail, replyTo: replyTo,
    to: toEmail, toName: to.name || data.cliente || "",
    subject: rendered.subject, html: rendered.html
  });

  const sent = await brevoSend(payload);
  if (!sent.ok) {
    console.error("[nexus-email] Brevo falló:", sent.status, sent.body);
    return fail(502, "proveedor rechazó el envío (" + sent.status + ")");
  }

  // Registrar dedupe (best-effort, precondición; si falla no rompe el envío ya hecho).
  if (dedupeKey && !isTest && uid) {
    try {
      const next = sentIds.slice(); next.unshift(dedupeKey);
      if (next.length > 400) next.length = 400;
      await adminPatchDocIf("users/" + uid,
        { email_sent_ids: { stringValue: JSON.stringify(next) } }, ["email_sent_ids"], userUpdateTime);
    } catch (e) { /* no bloquea */ }
  }

  return ok({ ok: true, id: sent.id || null, evento: evento });
};
