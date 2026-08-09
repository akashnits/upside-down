#!/usr/bin/env node

const [command, endpoint, jobId, taskToken, documentUrl, manifestPath] = process.argv.slice(2);
const actions = {
  claim: "claimTailoringTask",
  complete: "completeTailoring",
};

if (!actions[command] || !endpoint || !jobId || !taskToken || (command === "complete" && (!documentUrl || !manifestPath))) {
  console.error("Usage: task-client.js <claim|complete> <endpoint> <jobId> <taskToken> [documentUrl manifestPath]");
  process.exit(1);
}

let renderManifest;
if (command === "complete") {
  try {
    renderManifest = JSON.parse(require("fs").readFileSync(manifestPath, "utf8"));
  } catch (error) {
    console.error(`Could not read render manifest: ${error.message}`);
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
      ...(documentUrl ? { documentUrl } : {}),
      ...(renderManifest ? { renderManifest } : {}),
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
