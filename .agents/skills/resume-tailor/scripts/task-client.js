#!/usr/bin/env node

const [command, endpoint, jobId, taskToken, documentUrl] = process.argv.slice(2);
const actions = {
  get: "getTailoringTask",
  start: "startTailoring",
  complete: "completeTailoring",
};

if (!actions[command] || !endpoint || !jobId || !taskToken || (command === "complete" && !documentUrl)) {
  console.error("Usage: task-client.js <get|start|complete> <endpoint> <jobId> <taskToken> [documentUrl]");
  process.exit(1);
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
