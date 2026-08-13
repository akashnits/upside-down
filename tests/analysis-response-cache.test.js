const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const cache = new Map();
const logs = [];
const context = {
  PropertiesService: { getScriptProperties: () => ({}) },
  CacheService: {
    getScriptCache: () => ({
      get: key => cache.get(key) || null,
      put: (key, value, ttlSeconds) => cache.set(key, { value, ttlSeconds }),
    }),
  },
  Logger: { log: message => logs.push(message) },
};

// Match Apps Script Cache.get() while retaining the TTL supplied to put().
context.CacheService.getScriptCache = () => ({
  get: key => cache.get(key)?.value || null,
  put: (key, value, ttlSeconds) => cache.set(key, { value, ttlSeconds }),
});

vm.createContext(context);
vm.runInContext(fs.readFileSync("google-apps-script/router.js", "utf8"), context);

const requestId = "4f5d2a01-0279-4f4f-b0ab-9c01d44eab42";
const response = { success: true, analysis: { atsScore: 42, decision: "APPLY" } };

assert.strictEqual(context.getCachedAnalysisResponse(requestId), null);
context.cacheAnalysisResponse(requestId, response);

const cacheEntry = cache.get(context.getAnalysisResponseCacheKey(requestId));
assert.strictEqual(cacheEntry.ttlSeconds, 600);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.getCachedAnalysisResponse(requestId))),
  response,
);
assert.strictEqual(context.getCachedAnalysisResponse("invalid"), null);
assert.ok(logs.some(message => message.includes("Analysis stored")));
assert.ok(logs.some(message => message.includes("Analysis hit")));

console.log("analysis response cache tests passed");
