const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const requests = [];
let messageListener;
let redirectListener;
let redirectListenerFilter;
let redirectListenerOptions;
const finalResponses = [
  { ok: false, status: 404, redirected: false, url: "https://script.googleusercontent.com/macros/temporary", type: "cors", text: async () => "Not found" },
  { ok: true, status: 200, redirected: false, url: "https://script.googleusercontent.com/macros/temporary", type: "cors", text: async () => JSON.stringify({ success: true, analysis: { atsScore: 42 } }) },
];

const context = {
  CONFIG: { GAS_URL: "https://script.google.com/macros/s/example/exec" },
  importScripts() {},
  URL,
  Uint32Array,
  Promise,
  setTimeout: () => 1,
  clearTimeout() {},
  crypto: { randomUUID: () => "request-id-0123456789" },
  console: { log() {}, warn() {}, error() {} },
  fetch: async (url, options) => {
    if (options.method === "POST") {
      requests.push({ url, options, body: JSON.parse(options.body) });
      const transportRequestId = new URL(url).searchParams.get("udTransportRequestId");
      redirectListener({
        url,
        responseHeaders: [{ name: "Location", value: `https://script.googleusercontent.com/macros/echo?request=${transportRequestId}` }],
      });
      return { type: "opaqueredirect", status: 0 };
    }
    return finalResponses.shift();
  },
  chrome: {
    runtime: { onMessage: { addListener: listener => { messageListener = listener; } } },
    webRequest: { onHeadersReceived: { addListener: (listener, filter, options) => {
      redirectListener = listener;
      redirectListenerFilter = filter;
      redirectListenerOptions = options;
    } } },
  },
};

vm.createContext(context);
vm.runInContext(fs.readFileSync("extension/background.js", "utf8"), context);

assert.deepStrictEqual(JSON.parse(JSON.stringify(redirectListenerFilter)), {
  urls: ["https://script.google.com/macros/s/*/exec*"],
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(redirectListenerOptions)), ["responseHeaders"]);

(async () => {
  const result = await context.analyzeWithResponseRetry({ jobId: "4450120692" });

  assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), { success: true, analysis: { atsScore: 42 } });
  assert.strictEqual(requests.length, 2);
  assert.strictEqual(requests[0].options.redirect, "manual");
  assert.strictEqual(requests[0].body.analysisRequestId, "request-id-0123456789");
  assert.strictEqual(requests[1].body.analysisRequestId, requests[0].body.analysisRequestId);
  assert.ok(requests.every(request => new URL(request.url).searchParams.has("udTransportRequestId")));

  finalResponses.push({ ok: true, status: 200, redirected: false, url: "https://script.googleusercontent.com/macros/temporary", type: "cors", text: async () => JSON.stringify({ success: true, analysis: { atsScore: 84 } }) });
  await new Promise((resolve, reject) => {
    const keepsChannelOpen = messageListener(
      { action: "analyze", payload: { jobId: "4450120692" } },
      null,
      response => {
        try {
          assert.deepStrictEqual(JSON.parse(JSON.stringify(response)), { success: true, analysis: { atsScore: 84 } });
          resolve();
        } catch (error) {
          reject(error);
        }
      },
    );
    assert.strictEqual(keepsChannelOpen, true);
  });

  console.log("analysis response retry tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
