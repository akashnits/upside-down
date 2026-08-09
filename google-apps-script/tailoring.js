// tailoring.js — Signed task lifecycle for agent-executed resume tailoring

const TAILORING_TASK_VERSION = 3;
const TAILORING_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;

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
    // Re-read after acquiring the lock so a claimed task records a single lifecycle state.
    const entry = findNotionEntry(authorized.jobId);
    if (!entry || !entry.tailoringTask) {
      throw new Error("Tailoring task not found. Prepare the task from the extension first.");
    }

    const task = {
      ...entry.tailoringTask,
      status: "Tailoring",
      claimedAt: entry.tailoringTask.claimedAt || new Date().toISOString(),
    };

    updateNotionPage(entry.pageId, {
      analysis: buildTaskAnalysis(task),
      tailoringTask: task,
      status: "Tailoring",
      systemState: entry.systemState,
      systemStateBlockId: entry.systemStateBlockId,
    });

    return {
      jobId: authorized.jobId,
      task: {
        ...task,
        editableContent: getEditableResumeContent(),
      },
      outputName: task.constraints.outputName,
    };
  } finally {
    lock.releaseLock();
  }
}

function normalizeTailoringPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Tailoring patch must be an object");
  }
  const keys = Object.keys(patch).sort().join(",");
  if (keys !== "skills,summary") {
    throw new Error("Tailoring patch may contain only summary and skills fields");
  }
  if (typeof patch.summary !== "string" || !patch.summary.trim()) {
    throw new Error("Tailoring patch must include a non-empty summary");
  }
  if (patch.summary.trim().length > 2000) {
    throw new Error("Tailoring summary is too long");
  }
  if (!Array.isArray(patch.skills) || !patch.skills.length || patch.skills.length > 15) {
    throw new Error("Tailoring patch must include between 1 and 15 Skills rows");
  }

  return {
    summary: patch.summary.trim(),
    skills: patch.skills.map((skill, index) => {
      if (!skill || typeof skill.label !== "string" || typeof skill.value !== "string") {
        throw new Error(`Skills row ${index + 1} must contain label and value strings`);
      }
      const label = skill.label.trim();
      const value = skill.value.trim();
      if (!label || !value || label.length > 100 || value.length > 600) {
        throw new Error(`Skills row ${index + 1} is invalid`);
      }
      return { label, value };
    }),
  };
}

function applyTailoringPatchForTask(data) {
  const authorized = getAuthorizedTailoringEntry(data);
  const patch = normalizeTailoringPatch(data.patch);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const entry = findNotionEntry(authorized.jobId);
    if (!entry || !entry.tailoringTask) {
      throw new Error("Tailoring task not found. Prepare the task from the extension first.");
    }
    const rubric = entry.tailoringTask.rubric || entry.rubric;
    if (!rubric) throw new Error("No saved ATS rubric exists for this task");

    const draft = createOrGetTailoringDraft(
      entry.tailoringTask.role,
      entry.tailoringTask.company,
      authorized.jobId,
      entry.draftFolderId,
      entry.draftDocumentId,
    );
    applyTailoringPatch(draft.documentId, patch);

    const resumeText = getDocTextFromUrl(draft.documentUrl);
    validateTailoringPatchInDocument(patch, resumeText);
    const ats = calculateATSScore(rubricToWeightedKeywords(rubric), resumeText);
    const task = {
      ...entry.tailoringTask,
      status: "To Review",
      completedAt: new Date().toISOString(),
      completedDocumentId: draft.documentId,
    };
    const analysis = buildTaskAnalysis(task, ats.score);
    analysis.currentScore = ats.score;
    analysis.scoreDelta = typeof analysis.baselineScore === "number"
      ? ats.score - analysis.baselineScore
      : null;

    updateNotionPage(entry.pageId, {
      analysis,
      tailoringTask: task,
      draftFolderId: draft.folderId,
      draftDocumentId: draft.documentId,
      resumeUrl: draft.documentUrl,
      status: "To Review",
      systemState: entry.systemState,
      systemStateBlockId: entry.systemStateBlockId,
    });

    return {
      jobId: authorized.jobId,
      documentUrl: draft.documentUrl,
      atsScore: ats.score,
      baselineScore: analysis.baselineScore,
      scoreDelta: analysis.scoreDelta,
    };
  } finally {
    lock.releaseLock();
  }
}

function normalizeVerificationText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim();
}

function validateTailoringPatchInDocument(patch, resumeText) {
  const renderedText = normalizeVerificationText(resumeText);
  const summary = normalizeVerificationText(patch.summary);
  if (!summary || !renderedText.includes(summary)) {
    throw new Error("Tailored Google Doc does not contain the submitted Summary");
  }

  for (const skill of patch.skills) {
    const expectedSkill = normalizeVerificationText(`${skill && skill.label} ${skill && skill.value}`);
    if (!expectedSkill || !renderedText.includes(expectedSkill)) {
      throw new Error("Tailored Google Doc does not contain all submitted Skills rows");
    }
  }
}
