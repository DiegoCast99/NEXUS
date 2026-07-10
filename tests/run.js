/* NEXUS · Runner de la suite de tests (Node puro, sin dependencias).
   Correr: node tests/run.js
   Ejecuta cada *.test.js en un proceso separado (aislamiento de mocks
   globales como fetch/setInterval) y resume el resultado. */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).sort();
let failures = 0;

console.log("NEXUS · suite de tests (" + files.length + " archivos)\n" + "=".repeat(50));
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: "utf8" });
  process.stdout.write(result.stdout || "");
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) failures += 1;
  console.log("-".repeat(50) + " " + file + (result.status === 0 ? " ✅" : " ❌"));
}

console.log("\n" + "=".repeat(50));
console.log(failures === 0 ? "SUITE COMPLETA: todo verde ✅" : "SUITE: " + failures + " archivo(s) con fallos ❌");
process.exitCode = failures ? 1 : 0;
