#!/usr/bin/env node

const actions = {
  claim: "claimTailoringTask",
  apply: "applyTailoringPatch",
  outreach: "saveTailoringOutreach",
  recruiters: "saveRecruiterEmails",
  drafts: "createOutreachGmailDraft",
};

const RETRY_DELAYS_MS = [1000, 3000];

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function invalidResponseError(response, text) {
  let hostname = "";
  try {
    hostname = new URL(response.url).hostname;
  } catch (_) {
    // Keep the normal invalid-response error for malformed response URLs.
  }

  if (response.status === 404 && hostname === "script.googleusercontent.com") {
    return new Error(
      "Apps Script rejected this unauthenticated task request. In Apps Script, open Deploy > Manage deployments > "
      + "the web app, then set Who has access to Anyone and redeploy."
    );
  }
  return new Error(`Invalid task API response (${response.status}): ${text.slice(0, 200)}`);
}

/**
 * Posts one immutable task payload. Only transport/non-JSON responses retry;
 * a valid JSON API error returns immediately for the caller to report.
 */
async function requestTaskApi(endpoint, requestPayload, { fetchImpl = fetch, sleepImpl = sleep } = {}) {
  const body = JSON.stringify(requestPayload);
  let lastError;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body,
      });
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (_) {
        // Apps Script can briefly serve an HTML redirect/session page with 200 OK.
        lastError = invalidResponseError(response, text);
      }
    } catch (error) {
      // Network failures and timeouts are safe to retry with the identical body.
      lastError = error;
    }

    if (attempt < RETRY_DELAYS_MS.length) await sleepImpl(RETRY_DELAYS_MS[attempt]);
  }
  throw lastError;
}

function parseArguments(argv) {
  const [command, endpoint, jobId, patchPath] = argv;
  if (!actions[command] || !endpoint || !jobId || (["apply", "outreach", "recruiters", "drafts"].includes(command) && !patchPath)) {
    throw new Error("Usage: task-client.js <claim|apply|outreach|recruiters|drafts> <endpoint> <jobId> [filePath|draftToken]");
  }
  return { command, endpoint, jobId, patchPath };
}

function readPatch(command, patchPath) {
  if (!["apply", "outreach", "recruiters"].includes(command)) return undefined;
  try {
    return JSON.parse(require("fs").readFileSync(patchPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read tailoring patch: ${error.message}`);
  }
}

async function run(argv = process.argv.slice(2)) {
  const { command, endpoint, jobId, patchPath } = parseArguments(argv);
  const patch = readPatch(command, patchPath);
  const requestPayload = {
    action: actions[command],
    jobId,
    ...(command === "apply" ? { patch } : command === "outreach" ? { outreach: patch } : command === "recruiters" ? { emails: patch.emails, contacts: patch.contacts } : command === "drafts" ? { draftToken: patchPath } : {}),
  };
  const responsePayload = await requestTaskApi(endpoint, requestPayload);
  if (!responsePayload.success) throw new Error(responsePayload.error || "Tailoring task request failed");
  process.stdout.write(`${JSON.stringify(responsePayload, null, 2)}\n`);
}

if (require.main === module) {
  run().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { RETRY_DELAYS_MS, requestTaskApi, run };
