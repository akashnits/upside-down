const assert = require("assert");
const { requestTaskApi } = require("../.agents/skills/resume-tailor/scripts/task-client");

const endpoint = "https://script.google.com/macros/s/example/exec";
const payload = { action: "applyTailoringPatch", jobId: "4450120692", patch: { summary: "Updated" } };

async function run() {
  const requestBodies = [];
  const retryDelays = [];
  let attempts = 0;
  const response = await requestTaskApi(endpoint, payload, {
    fetchImpl: async (_url, options) => {
      requestBodies.push(options.body);
      attempts += 1;
      if (attempts === 1) {
        return {
          status: 200,
          url: "https://script.googleusercontent.com/macros/temporary",
          text: async () => "<!doctype html><html><title>Google</title></html>",
        };
      }
      return {
        status: 200,
        url: "https://script.googleusercontent.com/macros/temporary",
        text: async () => JSON.stringify({ success: true, jobId: "4450120692" }),
      };
    },
    sleepImpl: async milliseconds => retryDelays.push(milliseconds),
  });

  assert.deepStrictEqual(response, { success: true, jobId: "4450120692" });
  assert.strictEqual(requestBodies.length, 2);
  assert.strictEqual(requestBodies[1], requestBodies[0], "retries must reuse the exact request body");
  assert.deepStrictEqual(retryDelays, [1000]);

  let apiErrorCalls = 0;
  const apiError = await requestTaskApi(endpoint, payload, {
    fetchImpl: async () => {
      apiErrorCalls += 1;
      return { status: 400, url: endpoint, text: async () => JSON.stringify({ success: false, error: "Invalid patch" }) };
    },
    sleepImpl: async () => assert.fail("valid JSON API errors must not retry"),
  });
  assert.deepStrictEqual(apiError, { success: false, error: "Invalid patch" });
  assert.strictEqual(apiErrorCalls, 1);

  console.log("task client response retry tests passed");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
