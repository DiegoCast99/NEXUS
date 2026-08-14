/* ============================================================
   NEXUS · ml-ads-agent.js — Config del piloto automatico (Nivel 3)
   ------------------------------------------------------------
   Acciones (con el idToken del titular; Firestore verifica que
   solo toca su propio doc — NO se usa la cuenta de servicio con
   un uid del cliente, por la firma no verificada de uidFromIdToken):
     - status : devuelve la config del piloto + el log.
     - arm    : arma una cuenta (techo, modo sim/real, guardarraíles).
     - disarm : desarma una cuenta.

   El estado vive en campos TOP-LEVEL del doc (no dentro de nexusData,
   que lo pisa el navegador):
     - ads_autopilot      "1"/"0"  (armado — lo consulta la funcion programada)
     - ads_autopilot_cfg  JSON     ({accounts:{<cuenta>:{armed,monthlyCap,mode,maxChangePct,minDaily}}})
     - ads_autopilot_log  JSON     (lo escribe el autopilot)

   La ejecucion real la hace ml-ads-autopilot (programada). "Probar
   ahora" es una simulacion 100% del lado del navegador (no pega acá).
   Zero-dep.
   ============================================================ */
const { getIdToken, uidFromIdToken, readUserDoc, writeUserFieldsIf, parseBody, json } = require("./_shared");

const ARMED = "ads_autopilot";
const CFG = "ads_autopilot_cfg";
const LOG = "ads_autopilot_log";

function fieldStr(doc, name) { return doc && doc.fields && doc.fields[name] && doc.fields[name].stringValue; }
function jparse(raw, fb) { try { return JSON.parse(raw || ""); } catch (e) { return fb; } }

async function mutar(uid, idToken, mutador) {
  // read -> modify -> writeIf, con reintentos ante precondicion fallida.
  for (var intento = 0; intento < 4; intento++) {
    var doc = await readUserDoc(uid, idToken, [CFG]);
    var cfg = jparse(fieldStr(doc, CFG), { accounts: {} });
    cfg.accounts = cfg.accounts || {};
    mutador(cfg);
    cfg.updatedAt = new Date().toISOString();
    var anyArmed = Object.keys(cfg.accounts).some(function (a) { return cfg.accounts[a] && cfg.accounts[a].armed; });
    var fieldsObj = {};
    fieldsObj[CFG] = { stringValue: JSON.stringify(cfg) };
    fieldsObj[ARMED] = { stringValue: anyArmed ? "1" : "0" };
    var ok = await writeUserFieldsIf(uid, idToken, fieldsObj, [CFG, ARMED], doc.updateTime);
    if (ok) return { cfg: cfg, armed: anyArmed };
  }
  throw new Error("no se pudo guardar la config (conflicto de escritura)");
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return json(405, { error: "metodo no permitido" });
  var idToken = getIdToken(event);
  if (!idToken) return json(401, { error: "sin autenticacion" });
  var uid;
  try { uid = uidFromIdToken(idToken); } catch (e) { return json(401, { error: "token invalido" }); }
  var body = parseBody(event) || {};
  var action = body.action;

  try {
    if (action === "status") {
      var doc = await readUserDoc(uid, idToken, [CFG, LOG, ARMED]);
      return json(200, {
        cfg: jparse(fieldStr(doc, CFG), { accounts: {} }),
        log: jparse(fieldStr(doc, LOG), []),
        armed: fieldStr(doc, ARMED) === "1"
      });
    }

    if (action === "arm" || action === "disarm") {
      var account = String(body.account || "").trim();
      if (!account) return json(400, { error: "falta la cuenta" });
      var r = await mutar(uid, idToken, function (cfg) {
        if (action === "arm") {
          cfg.accounts[account] = {
            armed: true,
            monthlyCap: Math.max(0, Number(body.monthlyCap) || 0),
            mode: body.mode === "real" ? "real" : "sim",
            maxChangePct: Math.min(100, Math.max(1, Number(body.maxChangePct) || 25)),
            minDaily: Math.max(0, Number(body.minDaily) || 0)
          };
        } else if (cfg.accounts[account]) {
          cfg.accounts[account].armed = false;
        }
      });
      return json(200, { ok: true, armed: r.armed, cfg: r.cfg });
    }

    return json(400, { error: "accion desconocida" });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
