#!/usr/bin/env node

const [command, endpoint, jobId, taskToken, patchPath] = process.argv.slice(2);
const actions = {
  claim: "claimTailoringTask",
  apply: "applyTailoringPatch",
};

if (!actions[command] || !endpoint || !jobId || !taskToken || (command === "apply" && !patchPath)) {
  console.error("Usage: task-client.js <claim|apply> <endpoint> <jobId> <taskToken> [patchPath]");
  process.exit(1);
}

let patch;
if (command === "apply") {
  try {
    patch = JSON.parse(require("fs").readFileSync(patchPath, "utf8"));
  } catch (error) {
    console.error(`Could not read tailoring patch: ${error.message}`);
    process.exit(1);
  }
}

async function run() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: actions[command],
      jobId,
      taskToken,
      ...(patch ? { patch } : {}),
    }),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid task API response (${response.status}): ${text.slice(0, 200)}`);
  }
  if (!payload.success) throw new Error(payload.error || "Tailoring task request failed");
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

run().catch(error => {
  console.error(error.message);
  process.exit(1);
});
