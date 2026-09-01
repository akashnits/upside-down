#!/usr/bin/env node

const [command, endpoint, jobId, patchPath] = process.argv.slice(2);
const actions = {
  claim: "claimTailoringTask",
  apply: "applyTailoringPatch",
  outreach: "saveTailoringOutreach",
};

if (!actions[command] || !endpoint || !jobId || (command === "apply" && !patchPath)) {
  console.error("Usage: task-client.js <claim|apply|outreach> <endpoint> <jobId> [filePath]");
  process.exit(1);
}

let patch;
if (command === "apply" || command === "outreach") {
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
      ...(command === "apply" ? { patch } : { outreach: patch }),
    }),
  });
  const text = await response.text();
  let responsePayload;
  try {
    responsePayload = JSON.parse(text);
  } catch (error) {
    if (response.status === 404 && new URL(response.url).hostname === "script.googleusercontent.com") {
      throw new Error(
        "Apps Script rejected this unauthenticated task request. In Apps Script, open Deploy > Manage deployments > "
        + "the web app, then set Who has access to Anyone and redeploy."
      );
    }
    throw new Error(`Invalid task API response (${response.status}): ${text.slice(0, 200)}`);
  }
  if (!responsePayload.success) throw new Error(responsePayload.error || "Tailoring task request failed");
  process.stdout.write(`${JSON.stringify(responsePayload, null, 2)}\n`);
}

run().catch(error => {
  console.error(error.message);
  process.exit(1);
});
