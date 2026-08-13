const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const cache = new Map();
let notionWrites = 0;
let sheetWrites = 0;
let tokenIssues = 0;

const context = {
  PropertiesService: { getScriptProperties: () => ({}) },
  CacheService: {
    getScriptCache: () => ({
      get: key => cache.get(key)?.value || null,
      put: (key, value, ttlSeconds) => cache.set(key, { value, ttlSeconds }),
    }),
  },
  ContentService: {
    MimeType: { JSON: "JSON" },
    createTextOutput: value => ({
      value,
      setMimeType() { return this; },
    }),
  },
  Logger: { log() {} },
  resolveJobId: () => "4450120692",
  findNotionEntry: () => null,
  buildTailoringTask: () => ({ version: 1 }),
  saveToNotion: () => { notionWrites += 1; },
  logToSheet: () => { sheetWrites += 1; },
  issueTaskToken: () => `task-token-${++tokenIssues}`,
  getCurrentWebAppUrl: () => "https://script.google.com/macros/s/example/exec",
};

vm.createContext(context);
vm.runInContext(fs.readFileSync("google-apps-script/router.js", "utf8"), context);

const request = {
  action: "save",
  saveRequestId: "4f5d2a01-0279-4f4f-b0ab-9c01d44eab42",
  analysis: { decision: "APPLY", confidence: "HIGH", effort: "LOW" },
  jobId: "4450120692",
  company: "Example",
  role: "Engineer",
};

function post(data) {
  const output = context.doPost({ postData: { contents: JSON.stringify(data) } });
  return JSON.parse(output.value);
}

const firstResponse = post(request);
const retryResponse = post(request);

assert.deepStrictEqual(firstResponse, {
  success: true,
  jobId: "4450120692",
  taskToken: "task-token-1",
  agentEndpoint: "https://script.google.com/macros/s/example/exec",
});
assert.deepStrictEqual(retryResponse, firstResponse);
assert.strictEqual(notionWrites, 1);
assert.strictEqual(sheetWrites, 1);
assert.strictEqual(tokenIssues, 1);

console.log("save response idempotency tests passed");
