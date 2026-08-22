#!/usr/bin/env node
/* ============================================================
   NEXUS · Cache-busting por CONTENIDO (sin dependencias)
   ------------------------------------------------------------
   Reescribe `?v=<hash>` en las referencias locales de css/js de los HTML y
   pone el CACHE_VERSION del Service Worker en un hash combinado de todos los
   assets. El hash es del CONTENIDO del archivo → cambia SOLO cuando el archivo
   cambia (idempotente: correrlo dos veces sin tocar nada no genera diff, y
   nunca "bustea de gusto"). Adiós al bumping manual de `?v=` y al bug de
   "en el celular sigue igual" por olvidarse de subir una versión.

   Uso:
     node build-cache.js        (lo corre Netlify en cada deploy; y se puede
                                 correr a mano antes de commitear/drag-and-drop)
   Sin dependencias: solo módulos nativos de Node (fs, path, crypto).
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const HTML_FILES = ["dashboard.html", "index.html"];
const SW_FILE = "sw.js";
const HASH_LEN = 10;

function hashBuffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, HASH_LEN);
}

const assetHashes = Object.create(null); // ruta relativa -> hash de contenido
let rewrites = 0, missing = 0;

// href/src a css/js locales (con o sin ./ y con o sin ?v= previo).
const REF = /\b(href|src)="(\.\/)?((?:css|js)\/[^"?]+\.(?:css|js))(\?v=[^"]*)?"/g;

function hashOf(rel) {
  if (assetHashes[rel]) return assetHashes[rel];
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  const h = hashBuffer(fs.readFileSync(abs));
  assetHashes[rel] = h;
  return h;
}

for (const html of HTML_FILES) {
  const abs = path.join(ROOT, html);
  if (!fs.existsSync(abs)) continue;
  const before = fs.readFileSync(abs, "utf8");
  const after = before.replace(REF, function (m, attr, dot, rel) {
    const h = hashOf(rel);
    if (!h) { missing++; console.warn("  (falta el asset) " + rel); return m; }
    rewrites++;
    return attr + '="' + (dot || "") + rel + "?v=" + h + '"';
  });
  if (after !== before) fs.writeFileSync(abs, after);
}

// CACHE_VERSION del SW = hash combinado de TODOS los assets → cambia si cambia
// cualquiera, forzando al SW a re-cachear el app-shell en los clientes.
const swAbs = path.join(ROOT, SW_FILE);
if (fs.existsSync(swAbs)) {
  const combined = Object.keys(assetHashes).sort()
    .map(function (k) { return k + ":" + assetHashes[k]; }).join("|");
  const swHash = crypto.createHash("sha256").update(combined).digest("hex").slice(0, HASH_LEN);
  const before = fs.readFileSync(swAbs, "utf8");
  const after = before.replace(/const CACHE_VERSION = "[^"]*";/, 'const CACHE_VERSION = "nexus-cache-' + swHash + '";');
  if (after !== before) fs.writeFileSync(swAbs, after);
  console.log("SW CACHE_VERSION -> nexus-cache-" + swHash);
}

console.log("Cache-busting listo: " + rewrites + " referencias reescritas, " +
  Object.keys(assetHashes).length + " assets" + (missing ? ", " + missing + " faltantes (revisar)" : "") + ".");
