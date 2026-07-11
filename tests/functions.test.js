/* NEXUS · Tests de las funciones serverless (Node puro, fetch mockeado).
   Cubre: cifrado AES-GCM, uid del ID token, guard anti-SSRF y los 3 handlers. */
const { test, ok, done } = require("./helpers");
const path = require("path");

process.env.TOKEN_ENC_KEY = "una-passphrase-de-prueba-muy-fuerte-123";
process.env.FIREBASE_PROJECT_ID = "nexus-systems-17a5b";

const FN = path.join(__dirname, "..", "netlify", "functions");
const shared = require(path.join(FN, "_shared.js"));

// --- Firestore simulado, POR UID (como el real) ---
const STORE = {};
function docStore(uid) { return (STORE[uid] = STORE[uid] || {}); }
function uidFromUrl(url) { const m = url.match(/documents\/users\/([^?]+)/); return m ? decodeURIComponent(m[1]) : null; }
function mockRes(status, obj) { return { ok: status >= 200 && status < 300, status, json: async () => obj }; }

globalThis.fetch = async (url, opts) => {
  url = String(url); opts = opts || {};
  if (url.includes("firestore.googleapis.com")) {
    const uid = uidFromUrl(url);
    if (opts.method === "PATCH") {
      const body = JSON.parse(opts.body);
      const doc = docStore(uid);
      for (const [k, v] of Object.entries(body.fields || {})) doc[k] = v.stringValue;
      return mockRes(200, { name: "doc" });
    }
    const m = url.match(/mask\.fieldPaths=([^&]+)/);
    const field = m ? decodeURIComponent(m[1]) : null;
    const doc = docStore(uid);
    const fields = {};
    if (field && doc[field] != null) fields[field] = { stringValue: doc[field] };
    return mockRes(200, { fields });
  }
  if (url.includes("graph.facebook.com")) {
    return mockRes(200, { data: [{ campaign_id: "c1", campaign_name: "Camp Test", spend: "42.5" }], paging: {} });
  }
  if (url.includes("tienda-real.example.com")) {
    return mockRes(200, { orders: [{ id: 1, total: 99 }] });
  }
  return mockRes(404, { error: "not mocked: " + url });
};

function fakeIdToken(uid) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return b64({ alg: "none" }) + "." + b64({ user_id: uid }) + ".firma";
}
const auth = { authorization: "Bearer " + fakeIdToken("testuid123") };
const SECRET = "EAABsecretMetaToken000";

test("cifrado AES-256-GCM round-trip", () => {
  const enc = shared.encrypt(SECRET);
  ok("produce iv.tag.ct (3 partes)", enc.split(".").length === 3);
  ok("decrypt recupera el original", shared.decrypt(enc) === SECRET);
  ok("el ciphertext no contiene el secreto", !enc.includes(SECRET));
  const partes = enc.split("."); partes[2] = Buffer.from("otracosa").toString("base64");
  let manipuladoFalla = false;
  try { shared.decrypt(partes.join(".")); } catch (e) { manipuladoFalla = true; }
  ok("ciphertext manipulado es rechazado (GCM auth)", manipuladoFalla);
});

test("identidad y providers", () => {
  ok("uidFromIdToken lee user_id", shared.uidFromIdToken(fakeIdToken("abc")) === "abc");
  ok("meta -> secret_meta", shared.providerField("meta") === "secret_meta");
  ok("commerce:kairos -> secret_commerce_kairos", shared.providerField("commerce:kairos") === "secret_commerce_kairos");
});

test("guard anti-SSRF", () => {
  ok("permite https público", !!shared.assertSafeUrl("https://tienda-real.example.com/api"));
  const bloqueadas = ["http://x.com", "https://localhost/x", "https://127.0.0.1/x", "https://192.168.0.1", "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/x"];
  const todasBloqueadas = bloqueadas.every((u) => { try { shared.assertSafeUrl(u); return false; } catch (e) { return true; } });
  ok("bloquea http/localhost/IPs internas/metadata", todasBloqueadas);
});

test("save-token handler", async () => {
  const handler = require(path.join(FN, "save-token.js")).handler;
  let r = await handler({ httpMethod: "POST", headers: auth, body: JSON.stringify({ provider: "meta", token: SECRET }) });
  ok("guardar token de meta -> 200", r.statusCode === 200 && JSON.parse(r.body).ok === true);
  const mio = docStore("testuid123");
  ok("quedó CIFRADO en Firestore", mio.secret_meta && mio.secret_meta !== SECRET && shared.decrypt(mio.secret_meta) === SECRET);
  r = await handler({ httpMethod: "POST", headers: auth, body: JSON.stringify({ provider: "commerce:kairos", token: "shop_tok_999" }) });
  ok("token de commerce -> 200 y cifrado", r.statusCode === 200 && shared.decrypt(mio.secret_commerce_kairos) === "shop_tok_999");
  r = await handler({ httpMethod: "POST", headers: auth, body: JSON.stringify({ provider: "meta", token: "" }) });
  ok("token vacío -> 400", r.statusCode === 400);
  r = await handler({ httpMethod: "GET", headers: auth, body: null });
  ok("GET -> 405", r.statusCode === 405);
  r = await handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ provider: "meta", token: "x" }) });
  ok("sin Authorization -> 400", r.statusCode === 400);
});

test("meta-insights handler", async () => {
  const handler = require(path.join(FN, "meta-insights.js")).handler;
  // Sembrar el token cifrado (test independiente del orden de ejecución).
  docStore("testuid123").secret_meta = shared.encrypt(SECRET);
  let r = await handler({ httpMethod: "POST", headers: auth, body: JSON.stringify({ adAccountId: "act_123", apiVersion: "v21.0", datePreset: "last_30d" }) });
  const body = JSON.parse(r.body);
  ok("con token guardado -> 200 con filas", r.statusCode === 200 && body.rows.length === 1 && body.rows[0].campaign_name === "Camp Test");
  r = await handler({ httpMethod: "POST", headers: auth, body: JSON.stringify({ apiVersion: "v21.0" }) });
  ok("sin adAccountId -> 400", r.statusCode === 400);
  const otro = { authorization: "Bearer " + fakeIdToken("uid-sin-token") };
  r = await handler({ httpMethod: "POST", headers: otro, body: JSON.stringify({ adAccountId: "act_1", apiVersion: "v21.0" }) });
  ok("otro uid sin token -> 400 con mensaje claro", r.statusCode === 400 && /credenciales/.test(JSON.parse(r.body).error));
});

test("commerce-fetch handler", async () => {
  const handler = require(path.join(FN, "commerce-fetch.js")).handler;
  // Sembrar el token cifrado (test independiente del orden de ejecución).
  docStore("testuid123").secret_commerce_kairos = shared.encrypt("shop_tok_999");
  let r = await handler({ httpMethod: "POST", headers: auth, body: JSON.stringify({ provider: "commerce:kairos", apiUrl: "https://tienda-real.example.com/api/orders", pixelId: "PIX1" }) });
  const body = JSON.parse(r.body);
  ok("con token guardado -> 200 con payload", r.statusCode === 200 && body.payload.orders[0].total === 99);
  r = await handler({ httpMethod: "POST", headers: auth, body: JSON.stringify({ provider: "commerce:kairos", apiUrl: "https://127.0.0.1/x" }) });
  ok("URL interna -> 400 (SSRF)", r.statusCode === 400);
});

done();
