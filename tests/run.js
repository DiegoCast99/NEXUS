/* NEXUS · Runner de la suite de tests (Node puro, sin dependencias).
   Correr: node tests/run.js
   Ejecuta cada *.test.js en un proceso separado (aislamiento de mocks
   globales como fetch/setInterval) y resume el resultado. */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).sort();
let failures = 0;

const TIMEOUT_MS = 30000; // corta un archivo colgado en vez de esperar para siempre
console.log("NEXUS · suite de tests (" + files.length + " archivos)\n" + "=".repeat(50));
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    encoding: "utf8",
    timeout: TIMEOUT_MS
  });
  process.stdout.write(result.stdout || "");
  if (result.stderr) process.stderr.write(result.stderr);
  const timedOut = result.error && result.error.code === "ETIMEDOUT";
  const okFile = !timedOut && result.status === 0;
  if (!okFile) failures += 1;
  const mark = okFile ? " ✅" : timedOut ? " ⏱️ TIMEOUT (" + TIMEOUT_MS + "ms)" : " ❌";
  console.log("-".repeat(50) + " " + file + mark);
}

console.log("\n" + "=".repeat(50));
console.log(failures === 0 ? "SUITE COMPLETA: todo verde ✅" : "SUITE: " + failures + " archivo(s) con fallos ❌");
process.exitCode = failures ? 1 : 0;
