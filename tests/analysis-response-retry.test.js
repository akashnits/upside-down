const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const requests = [];
const responses = [
  { ok: false, status: 404, redirected: true, url: "https://script.googleusercontent.com/macros/temporary", text: async () => "Not found" },
  { ok: true, status: 200, redirected: true, url: "https://script.googleusercontent.com/macros/temporary", text: async () => JSON.stringify({ success: true, analysis: { atsScore: 42 } }) },
];

const context = {
  CONFIG: { GAS_URL: "https://script.google.com/macros/s/example/exec" },
  importScripts() {},
  URL,
  Uint32Array,
  Promise,
  setTimeout: callback => callback(),
  crypto: { randomUUID: () => "request-id-0123456789" },
  console: { log() {}, warn() {}, error() {} },
  fetch: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return responses.shift();
  },
  chrome: { runtime: { onMessage: { addListener() {} } } },
};

vm.createContext(context);
vm.runInContext(fs.readFileSync("extension/background.js", "utf8"), context);

(async () => {
  const result = await context.analyzeWithResponseRetry({ jobId: "4450120692" });

  assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), { success: true, analysis: { atsScore: 42 } });
  assert.strictEqual(requests.length, 2);
  assert.strictEqual(requests[0].analysisRequestId, "request-id-0123456789");
  assert.strictEqual(requests[1].analysisRequestId, requests[0].analysisRequestId);

  console.log("analysis response retry tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
