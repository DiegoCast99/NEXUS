/* NEXUS · Mini-framework de tests (Node puro, sin dependencias).
   Uso: const { test, ok, done } = require("./helpers"); */
let passed = 0;
let failed = 0;
let currentTest = "";
const pending = [];

function test(name, fn) {
  pending.push(async () => {
    currentTest = name;
    console.log("\n== " + name + " ==");
    try {
      await fn();
    } catch (error) {
      failed += 1;
      console.log("  ❌ EXCEPCIÓN: " + (error && error.stack ? error.stack.split("\n")[0] : error));
    }
  });
}

function ok(label, condition) {
  if (condition) {
    passed += 1;
    console.log("  ✅ " + label);
  } else {
    failed += 1;
    console.log("  ❌ " + label);
  }
}

function done() {
  (async () => {
    for (const run of pending) await run();
    console.log("\n=== RESULTADO: " + passed + " ok, " + failed + " fallos ===");
    process.exitCode = failed ? 1 : 0;
  })();
}

module.exports = { test, ok, done };
