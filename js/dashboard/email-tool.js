/* ============================================================
   NEXUS · Herramientas → Correos (editor de plantillas de email)
   ------------------------------------------------------------
   Editor visual de las plantillas transaccionales de Alpha Fitness (reemplazo de
   EmailJS). Crea/edita/activa plantillas con variables {{...}} y muestra una VISTA
   PREVIA en vivo. Se guardan en users/{uid}.emailTemplates (JSON string, campo
   SEPARADO del blob nexusData para que ni el sync ni el server se pisen). El endpoint
   netlify/functions/nexus-email.js las lee y envía por Brevo.

   Módulo autónomo: se lanza desde la tarjeta [data-email-open] del panel Herramientas
   y abre un modal propio. No toca el router ni el Publicador.
   SEGURIDAD: acá NO hay claves. El envío real (y su token/API key) vive en el server.
   ============================================================ */
(function () {
  "use strict";

  // ---- Motor de render (espejo cliente de _email.js, para la vista previa) ----
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function render(tpl, data) {
    data = data || {};
    return String(tpl == null ? "" : tpl)
      .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, function (_, k) { return data[k] != null ? String(data[k]) : ""; })
      .replace(/\{\{\s*([\w.]+)\s*\}\}/g, function (_, k) { return data[k] != null ? esc(data[k]) : ""; });
  }
  function money(n) { var v = parseFloat(n); return isNaN(v) ? String(n == null ? "" : n) : "$" + v.toFixed(2); }
  function buildItemsHtml(items) {
    if (!Array.isArray(items) || !items.length) return "";
    var rows = items.map(function (it) {
      it = it || {};
      var sabor = it.sabor ? ' <span style="color:#888;font-size:12px;">(' + esc(it.sabor) + ")</span>" : "";
      var qty = parseInt(it.cantidad, 10) || 1;
      return '<tr><td style="padding:6px 0;font-size:14px;color:#0f0f0f;">' + esc(it.nombre || "Producto") + sabor +
        ' <span style="color:#888;">× ' + qty + '</span></td><td style="padding:6px 0;font-size:14px;color:#0f0f0f;text-align:right;white-space:nowrap;">' +
        money((parseFloat(it.precio) || 0) * qty) + "</td></tr>";
    }).join("");
    return '<table style="width:100%;border-collapse:collapse;">' + rows + "</table>";
  }
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
  function renderPreview(tpl, data) {
    var rdata = Object.assign({}, data);
    if (Array.isArray(rdata.items)) rdata.items = buildItemsHtml(rdata.items);
    return { subject: render(tpl.asunto || "", rdata), html: wrap(render(tpl.cuerpoHtml || "", rdata)) };
  }

  // ---- Variables + datos de ejemplo por evento (para la ayuda y la vista previa) ----
  var EVENTOS = {
    venta: {
      label: "Confirmación de compra (venta)",
      vars: ["cliente", "numeroOrden", "total", "items", "direccion", "envio"],
      sample: { cliente: "Juan Pérez", numeroOrden: "AF-80153905", total: "$1141.00", direccion: "Calle 1234, Montevideo (CP 11200)", envio: "Envío estándar", items: [{ nombre: "Creatina Growth", cantidad: 1, precio: 990, sabor: "Vainilla" }] }
    },
    envio: {
      label: "Pedido despachado (envío)",
      vars: ["cliente", "numeroOrden", "transportista", "codigoRastreo", "urlRastreo"],
      sample: { cliente: "Juan Pérez", numeroOrden: "AF-80153905", transportista: "DAC", codigoRastreo: "DAC123456789", urlRastreo: "https://www.dac.com.uy/envios/rastrear" }
    },
    otro: {
      label: "Otro (genérico)",
      vars: ["cliente", "numeroOrden"],
      sample: { cliente: "Juan Pérez", numeroOrden: "AF-00000000" }
    }
  };

  // ---- Plantillas semilla (mismas que _email.js: el editor arranca con estas) ----
  function seedTemplates() {
    return [
      {
        id: "venta", evento: "venta", nombre: "Confirmación de compra", activo: true,
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
        id: "envio", evento: "envio", nombre: "Pedido despachado (con rastreo)", activo: true,
        asunto: "Tu pedido {{numeroOrden}} va en camino 🚚",
        cuerpoHtml:
          '<h1 style="margin:0 0 6px;font-size:22px;color:#0f0f0f;">¡Tu pedido va en camino, {{cliente}}!</h1>' +
          '<p style="margin:0 0 18px;font-size:15px;color:#444;line-height:1.6;">Despachamos tu pedido <strong>{{numeroOrden}}</strong> por <strong>{{transportista}}</strong>.</p>' +
          '<div style="background:#f7f7f8;border-radius:10px;padding:18px 20px;margin:0 0 20px;text-align:center;">' +
          '<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#999;font-weight:700;margin-bottom:6px;">Código de rastreo</div>' +
          '<div style="font-size:20px;font-weight:800;color:#0f0f0f;letter-spacing:1px;">{{codigoRastreo}}</div></div>' +
          '<div style="text-align:center;margin:0 0 8px;"><a href="{{urlRastreo}}" style="display:inline-block;background:#0f0f0f;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:8px;">Rastrear mi envío</a></div>'
      }
    ];
  }

  // ---- Firestore (cliente) ----
  function getUid() {
    try { var u = window.NexusFirebaseAuth && window.NexusFirebaseAuth.getCurrentUser(); return u ? u.uid : null; } catch (e) { return null; }
  }
  function fsRef() {
    if (typeof firebase === "undefined" || typeof firebase.firestore !== "function") return null;
    var uid = getUid(); if (!uid) return null;
    return firebase.firestore().collection("users").doc(uid);
  }
  async function loadTemplates() {
    var ref = fsRef(); if (!ref) return seedTemplates();
    try {
      var snap = await ref.get();
      var raw = snap.exists ? (snap.data() || {}).emailTemplates : null;
      var arr = raw ? JSON.parse(raw) : null;
      return (Array.isArray(arr) && arr.length) ? arr : seedTemplates();
    } catch (e) { console.warn("[email-tool] load:", e && e.message); return seedTemplates(); }
  }
  async function saveTemplates(arr) {
    var ref = fsRef(); if (!ref) throw new Error("Sin sesión de Nexus.");
    await ref.set({ emailTemplates: JSON.stringify(arr), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }

  // ---- Estado ----
  var STATE = { templates: [], sel: -1, dirty: false };

  function el(id) { return document.getElementById(id); }
  function toast(msg, kind) { try { if (window.NexusDash && window.NexusDash.toast) return window.NexusDash.toast(msg, kind); } catch (e) {} alert(msg); }

  // ---- Estilos del modal (autónomos) ----
  function ensureStyles() {
    if (el("emailToolStyles")) return;
    var s = document.createElement("style"); s.id = "emailToolStyles";
    s.textContent =
      "#emailToolOv{position:fixed;inset:0;z-index:100050;background:rgba(4,5,8,.72);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;padding:24px;}" +
      "#emailToolOv.open{display:flex;}" +
      ".et-modal{width:min(1080px,96vw);height:min(88vh,860px);background:#0f1117;border:1px solid rgba(255,255,255,.10);border-radius:18px;box-shadow:0 30px 90px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden;color:#eef0f5;font-family:inherit;}" +
      ".et-head{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.08);}" +
      ".et-head h2{margin:0;font-size:16px;font-weight:700;}" +
      ".et-head .et-sub{color:#8b8fa3;font-size:12px;}" +
      ".et-x{margin-left:auto;background:#16192252;border:1px solid rgba(255,255,255,.12);color:#cfd3e0;width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:16px;}" +
      ".et-body{flex:1;display:grid;grid-template-columns:250px 1fr;min-height:0;}" +
      ".et-list{border-right:1px solid rgba(255,255,255,.08);padding:12px;overflow:auto;display:flex;flex-direction:column;gap:8px;}" +
      ".et-titem{text-align:left;background:#151824;border:1px solid rgba(255,255,255,.08);border-radius:11px;padding:11px 12px;cursor:pointer;color:#dfe2ec;transition:border-color .15s,background .15s;}" +
      ".et-titem:hover{background:#1b1f2e;}" +
      ".et-titem.sel{border-color:rgba(124,140,255,.55);background:#1b2033;}" +
      ".et-titem .n{font-weight:700;font-size:13px;}" +
      ".et-titem .m{font-size:11px;color:#8b8fa3;margin-top:3px;display:flex;gap:6px;align-items:center;}" +
      ".et-dot{width:7px;height:7px;border-radius:50%;background:#3ad07a;display:inline-block;}" +
      ".et-dot.off{background:#6a6d78;}" +
      ".et-edit{padding:16px 18px;overflow:auto;display:flex;flex-direction:column;gap:12px;}" +
      ".et-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;min-height:0;}" +
      ".et-field label{display:block;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:#8b8fa3;font-weight:700;margin-bottom:5px;}" +
      ".et-input,.et-ta,.et-sel{width:100%;background:#151824;border:1px solid rgba(255,255,255,.10);border-radius:9px;padding:9px 11px;color:#eef0f5;font-size:13px;font-family:inherit;outline:none;box-sizing:border-box;}" +
      ".et-ta{min-height:220px;resize:vertical;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;}" +
      ".et-vars{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}" +
      ".et-chip{background:#1b2033;border:1px solid rgba(124,140,255,.35);color:#c7ccf0;border-radius:20px;padding:3px 9px;font-size:11px;cursor:pointer;font-family:ui-monospace,monospace;}" +
      ".et-chip:hover{background:#232a44;}" +
      ".et-prev-wrap{display:flex;flex-direction:column;min-height:0;}" +
      ".et-prev-subj{font-size:12px;color:#8b8fa3;margin-bottom:6px;}" +
      ".et-prev-subj b{color:#eef0f5;}" +
      ".et-iframe{flex:1;width:100%;min-height:320px;border:1px solid rgba(255,255,255,.10);border-radius:11px;background:#fff;}" +
      ".et-foot{display:flex;gap:10px;align-items:center;padding:14px 18px;border-top:1px solid rgba(255,255,255,.08);}" +
      ".et-btn{border:1px solid rgba(255,255,255,.12);background:#151824;color:#dfe2ec;border-radius:10px;padding:9px 15px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;}" +
      ".et-btn:hover{background:#1b1f2e;}" +
      ".et-btn.primary{background:linear-gradient(180deg,#edeff4,#c6cad4);color:#111318;border-color:transparent;font-weight:700;}" +
      ".et-btn.danger{color:#ff8f8a;border-color:rgba(255,90,80,.4);}" +
      ".et-btn.danger:hover{background:rgba(255,90,80,.12);}" +
      ".et-row-check{display:flex;align-items:center;gap:8px;font-size:13px;color:#dfe2ec;}" +
      "@media(max-width:820px){.et-body{grid-template-columns:1fr;}.et-list{max-height:130px;border-right:none;border-bottom:1px solid rgba(255,255,255,.08);}.et-cols{grid-template-columns:1fr;}}";
    document.head.appendChild(s);
  }

  // ---- Construcción del modal ----
  function buildModal() {
    if (el("emailToolOv")) return;
    ensureStyles();
    var ov = document.createElement("div"); ov.id = "emailToolOv";
    ov.innerHTML =
      '<div class="et-modal" role="dialog" aria-modal="true" aria-label="Editor de correos">' +
      '<div class="et-head"><div><h2>Correos · Plantillas</h2><div class="et-sub">Se guardan en tu cuenta y las usa el envío automático de Alpha Fitness (Brevo).</div></div>' +
      '<button class="et-x" type="button" id="etClose" title="Cerrar">✕</button></div>' +
      '<div class="et-body">' +
      '<div class="et-list" id="etList"></div>' +
      '<div class="et-edit" id="etEdit"></div>' +
      "</div>" +
      '<div class="et-foot">' +
      '<button class="et-btn" type="button" id="etNew">+ Nueva plantilla</button>' +
      '<button class="et-btn" type="button" id="etSeed">Restaurar semilla</button>' +
      '<span style="flex:1"></span>' +
      '<button class="et-btn danger" type="button" id="etDel">Eliminar</button>' +
      '<button class="et-btn primary" type="button" id="etSave">Guardar</button>' +
      "</div></div>";
    document.body.appendChild(ov);

    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    el("etClose").addEventListener("click", close);
    el("etNew").addEventListener("click", nuevaPlantilla);
    el("etSeed").addEventListener("click", restaurarSemilla);
    el("etDel").addEventListener("click", eliminarPlantilla);
    el("etSave").addEventListener("click", guardar);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && ov.classList.contains("open")) close(); });
  }

  function renderList() {
    var box = el("etList"); if (!box) return;
    if (!STATE.templates.length) { box.innerHTML = '<div style="color:#8b8fa3;font-size:12px;padding:8px;">Sin plantillas. Creá una nueva.</div>'; return; }
    box.innerHTML = STATE.templates.map(function (t, i) {
      var ev = (EVENTOS[t.evento] && EVENTOS[t.evento].label) || t.evento || "otro";
      return '<button class="et-titem ' + (i === STATE.sel ? "sel" : "") + '" data-i="' + i + '" type="button">' +
        '<div class="n">' + esc(t.nombre || "(sin nombre)") + "</div>" +
        '<div class="m"><span class="et-dot ' + (t.activo === false ? "off" : "") + '"></span>' + esc(ev) + "</div></button>";
    }).join("");
    Array.prototype.forEach.call(box.querySelectorAll("[data-i]"), function (b) {
      b.addEventListener("click", function () { selectTpl(parseInt(b.getAttribute("data-i"), 10)); });
    });
  }

  function renderEditor() {
    var box = el("etEdit"); if (!box) return;
    var t = STATE.templates[STATE.sel];
    if (!t) { box.innerHTML = '<div style="color:#8b8fa3;font-size:13px;">Elegí una plantilla de la izquierda o creá una nueva.</div>'; return; }
    var evOpts = Object.keys(EVENTOS).map(function (k) {
      return '<option value="' + k + '"' + (t.evento === k ? " selected" : "") + ">" + esc(EVENTOS[k].label) + "</option>";
    }).join("");
    var vars = (EVENTOS[t.evento] || EVENTOS.otro).vars;
    var chips = vars.map(function (v) {
      var tok = v === "items" ? "{{{items}}}" : "{{" + v + "}}";
      return '<button class="et-chip" type="button" data-tok="' + esc(tok) + '">' + esc(tok) + "</button>";
    }).join("");
    box.innerHTML =
      '<div class="et-field"><label>Nombre</label><input class="et-input" id="etNombre" value="' + esc(t.nombre || "") + '"></div>' +
      '<div class="et-cols">' +
      '<div class="et-field"><label>Evento (cuándo se envía)</label><select class="et-sel" id="etEvento">' + evOpts + "</select></div>" +
      '<div class="et-field"><label>Estado</label><label class="et-row-check"><input type="checkbox" id="etActivo"' + (t.activo === false ? "" : " checked") + "> Activa (se usa para este evento)</label></div>" +
      "</div>" +
      '<div class="et-field"><label>Asunto</label><input class="et-input" id="etAsunto" value="' + esc(t.asunto || "") + '"></div>' +
      '<div class="et-cols">' +
      '<div class="et-field"><label>Cuerpo (HTML · usá {{variable}} y {{{items}}})</label>' +
      '<textarea class="et-ta" id="etCuerpo">' + esc(t.cuerpoHtml || "") + "</textarea>" +
      '<div class="et-vars">' + chips + "</div></div>" +
      '<div class="et-prev-wrap"><div class="et-field" style="margin-bottom:0;"><label>Vista previa (con datos de ejemplo)</label></div>' +
      '<div class="et-prev-subj" id="etPrevSubj"></div><iframe class="et-iframe" id="etPrev"></iframe></div>' +
      "</div>";

    el("etNombre").addEventListener("input", function () { t.nombre = this.value; STATE.dirty = true; renderList(); });
    el("etEvento").addEventListener("change", function () { t.evento = this.value; STATE.dirty = true; renderEditor(); });
    el("etActivo").addEventListener("change", function () { t.activo = this.checked; STATE.dirty = true; renderList(); });
    el("etAsunto").addEventListener("input", function () { t.asunto = this.value; STATE.dirty = true; updatePreview(); });
    el("etCuerpo").addEventListener("input", function () { t.cuerpoHtml = this.value; STATE.dirty = true; updatePreview(); });
    Array.prototype.forEach.call(box.querySelectorAll(".et-chip"), function (c) {
      c.addEventListener("click", function () { insertAtCursor(el("etCuerpo"), c.getAttribute("data-tok")); t.cuerpoHtml = el("etCuerpo").value; STATE.dirty = true; updatePreview(); });
    });
    updatePreview();
  }

  function insertAtCursor(ta, text) {
    if (!ta) return;
    var s = ta.selectionStart || 0, e = ta.selectionEnd || 0;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.focus(); ta.selectionStart = ta.selectionEnd = s + text.length;
  }

  var _prevT = null;
  function updatePreview() {
    if (_prevT) clearTimeout(_prevT);
    _prevT = setTimeout(function () {
      var t = STATE.templates[STATE.sel]; if (!t) return;
      var sample = (EVENTOS[t.evento] || EVENTOS.otro).sample;
      var r = renderPreview(t, sample);
      var subj = el("etPrevSubj"); if (subj) subj.innerHTML = "<b>Asunto:</b> " + esc(r.subject);
      var fr = el("etPrev"); if (fr) fr.srcdoc = r.html;
    }, 180);
  }

  function selectTpl(i) { STATE.sel = i; renderList(); renderEditor(); }

  function nuevaPlantilla() {
    STATE.templates.push({ id: "t" + Date.now(), evento: "otro", nombre: "Nueva plantilla", activo: true, asunto: "Asunto {{numeroOrden}}", cuerpoHtml: '<p style="font-size:15px;color:#444;">Hola {{cliente}},</p>' });
    STATE.sel = STATE.templates.length - 1; STATE.dirty = true; renderList(); renderEditor();
  }
  function restaurarSemilla() {
    if (!confirm("Esto agrega/repone las plantillas semilla (venta y envío). ¿Continuar?")) return;
    var seeds = seedTemplates();
    seeds.forEach(function (s) {
      var idx = STATE.templates.findIndex(function (t) { return t.id === s.id; });
      if (idx >= 0) STATE.templates[idx] = s; else STATE.templates.push(s);
    });
    STATE.sel = 0; STATE.dirty = true; renderList(); renderEditor();
  }
  function eliminarPlantilla() {
    var t = STATE.templates[STATE.sel]; if (!t) return;
    if (!confirm('¿Eliminar la plantilla "' + (t.nombre || "") + '"?')) return;
    STATE.templates.splice(STATE.sel, 1); STATE.sel = STATE.templates.length ? 0 : -1; STATE.dirty = true; renderList(); renderEditor();
  }
  async function guardar() {
    var btn = el("etSave"); if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
    try {
      await saveTemplates(STATE.templates);
      STATE.dirty = false;
      toast("Plantillas guardadas", "ok");
    } catch (e) {
      toast("No se pudo guardar: " + (e && e.message || e), "error");
    } finally { if (btn) { btn.disabled = false; btn.textContent = "Guardar"; } }
  }

  async function open() {
    buildModal();
    el("emailToolOv").classList.add("open");
    el("etList").innerHTML = '<div style="color:#8b8fa3;font-size:12px;padding:8px;">Cargando…</div>';
    STATE.templates = await loadTemplates();
    STATE.sel = STATE.templates.length ? 0 : -1;
    STATE.dirty = false;
    renderList(); renderEditor();
  }
  function close() {
    if (STATE.dirty && !confirm("Tenés cambios sin guardar. ¿Cerrar igual?")) return;
    var ov = el("emailToolOv"); if (ov) ov.classList.remove("open");
  }

  // ---- Enganche a la tarjeta de Herramientas ----
  function bind() {
    document.addEventListener("click", function (e) {
      var trg = e.target.closest && e.target.closest("[data-email-open]");
      if (trg) { e.preventDefault(); open(); }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();

  window.NexusEmailTool = { open: open, close: close };
})();
