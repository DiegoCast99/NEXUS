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
const { adminGetDoc, adminPatchDocIf, PROJECT_ID } = require("./_fbadmin");
const { verifyFirebaseIdToken } = require("./_idtoken");
const EMAIL = require("./_email");

const JSON_HEADERS = {
  "Content-Type": "application/json",
  // El dashboard (mismo origen en prod) y Alpha (server-to-server) llaman acá. CORS
  // permisivo es seguro: la ruta está autenticada (Bearer) y no usa cookies.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-nexus-token"
};
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
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: JSON_HEADERS, body: "" };
  if (event.httpMethod === "GET") return ok({ ok: true, fn: "nexus-email" });
  if (event.httpMethod !== "POST") return fail(405, "Method not allowed");

  // ── Body ──
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return fail(400, "JSON inválido"); }

  // ── Auth: DOS caminos ──
  //  (1) SERVER (Alpha → Nexus): Bearer == NEXUS_EMAIL_TOKEN (secreto compartido).
  //  (2) ADMIN (dashboard "enviar prueba"): Bearer == ID token de Firebase del titular,
  //      verificado por firma; su uid debe ser el owner. Estos SIEMPRE son de prueba.
  const tok = bearer(event);
  const expected = process.env.NEXUS_EMAIL_TOKEN;
  let authKind = null, authUid = null;
  if (expected && safeEqual(tok, expected)) {
    authKind = "server";
  } else if (tok) {
    try { const claims = await verifyFirebaseIdToken(tok, PROJECT_ID); authUid = claims.sub; authKind = "admin"; }
    catch (e) { /* no es un ID token válido */ }
  }
  if (!authKind) return fail(401, "no autorizado");

  const ownerUid = await resolverOwnerUid();
  // El admin solo puede operar sobre SU cuenta (single-tenant). Si conocemos el owner,
  // exigimos que coincida; si no lo conocemos, alcanza con un ID token válido de Nexus.
  if (authKind === "admin" && ownerUid && authUid !== ownerUid) return fail(403, "usuario no autorizado");

  // Toda operación de admin es PRUEBA (los envíos reales entran por el server/Alpha).
  const isTest = authKind === "admin" ? true : !!body.test;
  const inlineTpl = (authKind === "admin" && body.template && typeof body.template === "object") ? body.template : null;

  const evento = String(body.evento || body.templateId || (inlineTpl && inlineTpl.evento) || "").trim();
  const to = body.to || {};
  const toEmail = String(to.email || body.email || "").trim();
  const data = body.data || {};
  const dedupeKey = body.dedupeKey ? String(body.dedupeKey) : "";
  if (!evento && !inlineTpl) return fail(400, "falta 'evento'");
  if (!toEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail)) return fail(400, "email destino inválido");

  // ── Remitente ──
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  if (!senderEmail) return fail(500, "BREVO_SENDER_EMAIL no configurado");
  const senderName = process.env.BREVO_SENDER_NAME || "Alpha Fitness";
  const replyTo = process.env.BREVO_REPLY_TO || "";

  // ── Plantillas: inline (prueba del editor), custom del titular, o semilla ──
  let templates = null, userUpdateTime = null, sentIds = [];
  if (ownerUid) {
    try {
      const doc = await adminGetDoc("users/" + ownerUid);
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

  // El editor puede mandar la plantilla EN LÍNEA (para probar cambios sin guardar).
  let template = inlineTpl || EMAIL.pickTemplate(templates, evento);
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
  if (dedupeKey && !isTest && ownerUid) {
    try {
      const next = sentIds.slice(); next.unshift(dedupeKey);
      if (next.length > 400) next.length = 400;
      await adminPatchDocIf("users/" + ownerUid,
        { email_sent_ids: { stringValue: JSON.stringify(next) } }, ["email_sent_ids"], userUpdateTime);
    } catch (e) { /* no bloquea */ }
  }

  return ok({ ok: true, id: sent.id || null, evento: evento, test: isTest });
};
