// tailoring.js — Signed task lifecycle for agent-executed resume tailoring

const TAILORING_TASK_VERSION = 2;
const TAILORING_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;
const TAILORING_BASELINE_VERSION = "2026-08-09";

function resolveJobId(data) {
  if (data && data.jobId) return String(data.jobId);
  const match = String((data && data.jobUrl) || "").match(/\/jobs\/view\/(\d+)/);
  if (match) return match[1];
  throw new Error("A LinkedIn job ID is required to prepare a tailoring task");
}

function getTaskSigningSecret() {
  let secret = PROPERTIES.getProperty("TAILORING_TASK_SIGNING_SECRET");
  if (!secret) {
    secret = `${Utilities.getUuid()}-${Utilities.getUuid()}`;
    PROPERTIES.setProperty("TAILORING_TASK_SIGNING_SECRET", secret);
  }
  return secret;
}

function signTaskToken(jobId, expiresAt) {
  const payload = `${jobId}.${expiresAt}`;
  const bytes = Utilities.computeHmacSha256Signature(payload, getTaskSigningSecret());
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, "");
}

function issueTaskToken(jobId) {
  const expiresAt = Date.now() + TAILORING_TOKEN_TTL_MS;
  return `${expiresAt}.${signTaskToken(jobId, expiresAt)}`;
}

function validateTaskToken(jobId, taskToken) {
  const parts = String(taskToken || "").split(".");
  if (parts.length !== 2) throw new Error("Invalid tailoring task token");

  const expiresAt = Number(parts[0]);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    throw new Error("Tailoring task token has expired. Prepare the task again from the extension.");
  }

  if (parts[1] !== signTaskToken(jobId, expiresAt)) {
    throw new Error("Invalid tailoring task token");
  }
}

function buildTailoringTask(data) {
  const analysis = data.analysis || {};
  const brief = analysis.tailoringBrief || analysis.analysisBrief || {};
  const jobId = resolveJobId(data);

  return {
    version: TAILORING_TASK_VERSION,
    jobId,
    company: data.company || "Unknown",
    role: data.role || "Unknown",
    jobUrl: data.jobUrl || "",
    jobDescription: data.jobDescription || "",
    createdAt: new Date().toISOString(),
    status: "Tailoring",
    rubric: analysis.rubric || null,
    rubricVersion: analysis.rubricVersion || (analysis.rubric && analysis.rubric.version) || null,
    baselineScore: typeof analysis.baselineScore === "number" ? analysis.baselineScore : analysis.atsScore,
    initialScore: analysis.atsScore,
    decision: analysis.decision || brief.decision || "MAYBE",
    confidence: analysis.confidence || brief.confidence || "MEDIUM",
    effort: analysis.effort || brief.effort || "MEDIUM",
    analysisBrief: brief,
    constraints: {
      editableSections: ["Professional Summary / Objective", "Skills / Technologies"],
      preserveStrongMatches: true,
      requireConfirmedKeywords: true,
      renderer: "resume-tailor/render-tailored-resume",
      baselineVersion: TAILORING_BASELINE_VERSION,
      outputName: "Akash_Raj",
    },
  };
}

function buildTaskAnalysis(task, atsScore) {
  return {
    decision: task.decision || "MAYBE",
    confidence: task.confidence || "MEDIUM",
    effort: task.effort || "MEDIUM",
    rubric: task.rubric,
    rubricVersion: task.rubricVersion,
    baselineScore: typeof task.baselineScore === "number" ? task.baselineScore : null,
    atsScore: typeof atsScore === "number" ? atsScore : task.initialScore,
  };
}

function getCurrentWebAppUrl() {
  const url = ScriptApp.getService().getUrl();
  if (!url) throw new Error("Could not resolve the Apps Script web app URL");
  return url;
}

function getAuthorizedTailoringEntry(data) {
  const jobId = resolveJobId(data);
  validateTaskToken(jobId, data.taskToken);
  const entry = findNotionEntry(jobId);
  if (!entry || !entry.tailoringTask) {
    throw new Error("Tailoring task not found. Prepare the task from the extension first.");
  }
  return { jobId, entry };
}

function claimTailoringTask(data) {
  const authorized = getAuthorizedTailoringEntry(data);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    // Re-read after acquiring the lock so parallel agent retries share one draft.
    const entry = findNotionEntry(authorized.jobId);
    if (!entry || !entry.tailoringTask) {
      throw new Error("Tailoring task not found. Prepare the task from the extension first.");
    }

    const folder = createOrGetTailoringFolder(
      entry.tailoringTask.role,
      entry.tailoringTask.company,
      authorized.jobId,
      entry.draftFolderId,
    );
    const task = {
      ...entry.tailoringTask,
      status: "Tailoring",
      claimedAt: entry.tailoringTask.claimedAt || new Date().toISOString(),
    };

    updateNotionPage(entry.pageId, {
      analysis: buildTaskAnalysis(task),
      tailoringTask: task,
      draftFolderId: folder.folderId,
      status: "Tailoring",
      systemState: entry.systemState,
      systemStateBlockId: entry.systemStateBlockId,
    });

    return {
      jobId: authorized.jobId,
      task,
      folderId: folder.folderId,
      folderUrl: folder.folderUrl,
      outputName: task.constraints.outputName,
      baselineVersion: task.constraints.baselineVersion,
    };
  } finally {
    lock.releaseLock();
  }
}

function completeTailoringTask(data) {
  const authorized = getAuthorizedTailoringEntry(data);
  const entry = authorized.entry;
  const documentId = getGoogleDocIdFromUrl(data.documentUrl);

  if (!entry.draftFolderId) {
    throw new Error("No task folder exists. Start tailoring before completing it.");
  }
  if (!isDocumentInFolder(documentId, entry.draftFolderId)) {
    throw new Error("The submitted document is not in this job's tailoring folder");
  }

  const resumeText = getDocTextFromUrl(data.documentUrl);
  const rubric = entry.tailoringTask.rubric || entry.rubric;
  if (!rubric) throw new Error("No saved ATS rubric exists for this task");

  validateTailoredResumeManifest(entry.tailoringTask, data.renderManifest, resumeText);

  const ats = calculateATSScore(rubricToWeightedKeywords(rubric), resumeText);
  const task = {
    ...entry.tailoringTask,
    status: "To Review",
    completedAt: new Date().toISOString(),
    completedDocumentId: documentId,
  };
  const analysis = buildTaskAnalysis(task, ats.score);
  analysis.currentScore = ats.score;
  analysis.scoreDelta = typeof analysis.baselineScore === "number"
    ? ats.score - analysis.baselineScore
    : null;

  updateNotionPage(entry.pageId, {
    analysis,
    tailoringTask: task,
    draftFolderId: entry.draftFolderId,
    draftDocumentId: documentId,
    resumeUrl: getGoogleDocUrl(documentId),
    status: "To Review",
    systemState: entry.systemState,
    systemStateBlockId: entry.systemStateBlockId,
  });

  return {
    jobId: authorized.jobId,
    documentUrl: getGoogleDocUrl(documentId),
    atsScore: ats.score,
    baselineScore: analysis.baselineScore,
    scoreDelta: analysis.scoreDelta,
  };
}

function normalizeVerificationText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim();
}

function validateTailoredResumeManifest(task, manifest, resumeText) {
  if (!task.constraints || !task.constraints.renderer) return;
  if (!manifest || typeof manifest !== "object") {
    throw new Error("A renderer manifest is required to complete this tailoring task");
  }
  if (manifest.baselineVersion !== task.constraints.baselineVersion) {
    throw new Error("Renderer manifest baseline version does not match this tailoring task");
  }
  if (!manifest.expected || typeof manifest.expected.summary !== "string" || !Array.isArray(manifest.expected.skills)) {
    throw new Error("Renderer manifest is missing the expected Summary or Skills content");
  }

  const renderedText = normalizeVerificationText(resumeText);
  const summary = normalizeVerificationText(manifest.expected.summary);
  if (!summary || !renderedText.includes(summary)) {
    throw new Error("Imported Google Doc does not contain the rendered Summary from the manifest");
  }

  for (const skill of manifest.expected.skills) {
    const expectedSkill = normalizeVerificationText(`${skill && skill.label} ${skill && skill.value}`);
    if (!expectedSkill || !renderedText.includes(expectedSkill)) {
      throw new Error("Imported Google Doc does not contain all rendered Skills from the manifest");
    }
  }
}
