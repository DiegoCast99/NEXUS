"use strict";
/* ============================================================
   Tests del verificador de ID token (netlify/functions/_idtoken.js)
   Solo casos que fallan ANTES de la red (sin tocar los certs de Google).
   ============================================================ */
const test = require("node:test");
const assert = require("node:assert");
const { verifyFirebaseIdToken } = require("../netlify/functions/_idtoken.js");

test("rechaza token vacío", async () => {
  await assert.rejects(() => verifyFirebaseIdToken("", "proj"), /token vacío/);
});
test("rechaza sin projectId", async () => {
  await assert.rejects(() => verifyFirebaseIdToken("a.b.c", ""), /projectId requerido/);
});
test("rechaza formato inválido (no 3 partes)", async () => {
  await assert.rejects(() => verifyFirebaseIdToken("solouna", "proj"), /formato de token inválido/);
});
test("rechaza payload/header no decodificable", async () => {
  await assert.rejects(() => verifyFirebaseIdToken("@@@.@@@.@@@", "proj"), /no decodificable|inválido/);
});
