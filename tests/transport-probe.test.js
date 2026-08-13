const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const sleeps = [];
const context = {
  PropertiesService: { getScriptProperties: () => ({}) },
  Logger: { log() {} },
  Utilities: { sleep: delay => sleeps.push(delay) },
};

vm.createContext(context);
vm.runInContext(fs.readFileSync("google-apps-script/router.js", "utf8"), context);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.runTransportProbe({ delayMs: 0 }))),
  { success: true, probe: "transport", delayMs: 0 },
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.runTransportProbe({ delayMs: 20000 }))),
  { success: true, probe: "transport", delayMs: 20000 },
);
assert.deepStrictEqual(sleeps, [20000]);
assert.throws(() => context.runTransportProbe({ delayMs: 5000 }), /Unsupported transport probe delay/);

console.log("transport probe tests passed");
