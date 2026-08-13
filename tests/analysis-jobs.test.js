const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const properties = new Map();
const cache = new Map();
let triggerCount = 0;
let uuid = 0;

const context = {
  CacheService: {
    getScriptCache: () => ({
      get: key => cache.get(key) || null,
      put: (key, value) => cache.set(key, value),
    }),
  },
  PROPERTIES: {
    getProperty: key => properties.get(key) || null,
    setProperty: (key, value) => properties.set(key, value),
    deleteProperty: key => properties.delete(key),
  },
  LockService: {
    getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
  },
  ScriptApp: {
    newTrigger: () => ({
      timeBased: () => ({
        after: () => ({ create: () => { triggerCount += 1; } }),
      }),
    }),
  },
  Utilities: { getUuid: () => `job-${++uuid}` },
  Logger: { log() {} },
  performAnalysis: payload => ({ role: payload.role, atsScore: 72 }),
};

vm.createContext(context);
vm.runInContext(fs.readFileSync("google-apps-script/analysisJobs.js", "utf8"), context);

const enqueued = context.enqueueAnalysisJob({
  jobDescription: "Build Java services",
  role: "Backend Engineer",
  analysisRequestId: "request-1",
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(enqueued)), {
  success: true,
  pending: true,
  analysisJobId: "job-1",
  pollAfterMs: 1500,
});
assert.strictEqual(triggerCount, 1);
assert.strictEqual(context.getAnalysisJobStatus("job-1").status, "pending");
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.enqueueAnalysisJob({
    jobDescription: "Build Java services",
    role: "Backend Engineer",
    analysisRequestId: "request-1",
  }))),
  JSON.parse(JSON.stringify(enqueued)),
);
assert.strictEqual(triggerCount, 1);

context.runPendingAnalysisJobs();
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.getAnalysisJobStatus("job-1"))),
  { success: true, analysis: { role: "Backend Engineer", atsScore: 72 } },
);

context.performAnalysis = () => { throw new Error("provider unavailable"); };
const failedJob = context.enqueueAnalysisJob({ jobDescription: "Another job" });
context.runPendingAnalysisJobs();
assert.match(context.getAnalysisJobStatus(failedJob.analysisJobId).error, /provider unavailable/);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.getAnalysisJobStatus("missing"))),
  { success: false, error: "Analysis request expired. Run Analyze again." },
);

console.log("analysis job tests passed");
