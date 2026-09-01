// tailoring.js — Signed task lifecycle for agent-executed resume tailoring

const TAILORING_TASK_VERSION = 4;

function resolveJobId(data) {
  if (data && data.jobId) return String(data.jobId);
  const match = String((data && data.jobUrl) || "").match(/\/jobs\/view\/(\d+)/);
  if (match) return match[1];
  throw new Error("A LinkedIn job ID is required to prepare a tailoring task");
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

function getTailoringStatus(data) {
  const jobId = resolveJobId(data);
  const entry = findNotionEntry(jobId);
  if (!entry || !entry.tailoringTask) {
    throw new Error("Tailoring task not found. Prepare the task from the extension first.");
  }
  const task = entry.tailoringTask;
  const selections = task.analysisBrief && task.analysisBrief.userSelections || {};
  const confirmedKeywords = selections.confirmedKeywords || [];
  const literalizeKeywords = selections.literalizeKeywords || [];
  return {
    jobId,
    company: task.company,
    role: task.role,
    status: entry.status || task.status || "Tailoring",
    documentUrl: entry.resumeUrl || null,
    atsScore: entry.currentScore,
    baselineScore: entry.baselineScore,
    scoreDelta: entry.currentScore !== null && entry.baselineScore !== null
      ? entry.currentScore - entry.baselineScore
      : null,
    changes: {
      sections: ["Professional Summary", "Skills"],
      confirmedKeywords,
      exactTerms: literalizeKeywords,
    },
    completedAt: task.completedAt || null,
    recruiterEnrichment: entry.recruiterEnrichment || (entry.recruiterEmail ? "completed" : "pending"),
    recruiters: entry.recruiterEmail,
    recruiterContacts: entry.recruiterContacts || [],
    outreachDraft: entry.outreachDraft,
    fitHighlights: entry.fitHighlights,
  };
}

function normalizeRecruiterEmails(emails) {
  if (!Array.isArray(emails) || emails.length > 20) throw new Error("Recruiter emails must be an array with at most 20 addresses");
  const seen = {};
  return emails.map((value, index) => {
    if (typeof value !== "string") throw new Error(`Recruiter email ${index + 1} must be a string`);
    const email = value.trim().toLowerCase();
    if (!email || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`Recruiter email ${index + 1} is invalid`);
    if (seen[email]) return null;
    seen[email] = true;
    return email;
  }).filter(Boolean);
}

function normalizeRecruiterContacts(contacts, emails) {
  if (contacts === undefined) return emails.map(email => ({ email, status: "verified" }));
  if (!Array.isArray(contacts) || contacts.length > 20) throw new Error("Recruiter contacts are invalid");
  return contacts.map((contact, index) => {
    if (!contact || typeof contact !== "object" || typeof contact.name !== "string") throw new Error(`Recruiter contact ${index + 1} is invalid`);
    const email = typeof contact.email === "string" ? contact.email.trim().toLowerCase() : "";
    if (email && emails.indexOf(email) === -1) throw new Error(`Recruiter contact ${index + 1} email is not in emails`);
    const name = contact.name.trim();
    if (!name) throw new Error(`Recruiter contact ${index + 1} name is empty`);
    const linkedinUrl = contact.linkedinUrl ? String(contact.linkedinUrl).trim() : null;
    if (linkedinUrl && !/^https:\/\/(www\.)?linkedin\.com\/in\//i.test(linkedinUrl)) throw new Error(`Recruiter contact ${index + 1} LinkedIn URL is invalid`);
    return { name: name.substring(0, 120), email: email || null, status: String(contact.status || (email ? "verified" : "not found")).substring(0, 40), provider: contact.provider ? String(contact.provider).substring(0, 80) : null, linkedinUrl: linkedinUrl ? linkedinUrl.substring(0, 500) : null, location: contact.location ? String(contact.location).substring(0, 120) : null };
  });
}

function isTransientNotionResponse(code) { return code === 408 || code === 429 || code >= 500; }

function readNotionPageEmail(pageId, token) {
  const response = UrlFetchApp.fetch(`https://api.notion.com/v1/pages/${pageId}`, getNotionOptions(token, "get"));
  const data = parseNotionResponse(response, 200, "Notion recruiter email read error");
  return getNotionRichTextValue(data.properties && data.properties["Email"]);
}

function readNotionPageEmailWithRetry(pageId, token) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { return readNotionPageEmail(pageId, token); } catch (err) {
      lastError = err;
      if (attempt < 3) Utilities.sleep(250 * Math.pow(2, attempt - 1));
    }
  }
  throw lastError || new Error("Notion recruiter email read failed");
}

function writeRecruiterEmailWithRetry(pageId, emailValue, token) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let nonRetryable = false;
    try {
      const response = UrlFetchApp.fetch(`https://api.notion.com/v1/pages/${pageId}`, getNotionOptions(token, "patch", { properties: { Email: { rich_text: buildNotionRichText(emailValue) } } }));
      const code = response.getResponseCode();
      if (code === 200) return;
      lastError = new Error(`Notion recruiter email update error (${code}): ${response.getContentText()}`);
      if (!isTransientNotionResponse(code)) { nonRetryable = true; throw lastError; }
      if (attempt === 3) throw lastError;
    } catch (err) {
      lastError = err;
      if (attempt === 3 || nonRetryable) throw lastError;
    }
    Utilities.sleep(250 * Math.pow(2, attempt - 1));
  }
  throw lastError || new Error("Notion recruiter email update failed");
}

function saveRecruiterEmails(data) {
  const authorized = getAuthorizedTailoringEntry(data);
  const emails = normalizeRecruiterEmails(data.emails || []);
  const emailValue = emails.join("; ");
  const recruiterContacts = normalizeRecruiterContacts(data.contacts, emails);
  const token = PROPERTIES.getProperty("NOTION_API_KEY");
  if (!token) throw new Error("NOTION_API_KEY not set");
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const current = readNotionPageEmailWithRetry(authorized.entry.pageId, token);
    // A no-result enrichment must not erase an existing verified address.
    const targetEmail = emails.length ? emailValue : current;
    if (current !== targetEmail) writeRecruiterEmailWithRetry(authorized.entry.pageId, targetEmail, token);
    let verified = false;
    let lastReadError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try { verified = readNotionPageEmail(authorized.entry.pageId, token) === targetEmail; if (verified) break; } catch (err) { lastReadError = err; }
      if (attempt < 3) Utilities.sleep(250 * Math.pow(2, attempt - 1));
    }
    if (!verified) throw lastReadError || new Error("Notion recruiter email read-back did not match");
    updateNotionPage(authorized.entry.pageId, { recruiterEmail: targetEmail, recruiterEnrichment: "completed", recruiterContacts, systemState: authorized.entry.systemState, systemStateBlockId: authorized.entry.systemStateBlockId });
    return { jobId: authorized.jobId, recruiterEnrichment: "completed", recruiters: targetEmail || null, recruiterContacts };
  } finally { lock.releaseLock(); }
}

function saveTailoringOutreach(data) {
  const authorized = getAuthorizedTailoringEntry(data);
  const outreach = data.outreach;
  if (!outreach || typeof outreach !== "object" || Array.isArray(outreach)) {
    throw new Error("Outreach draft must be an object");
  }
  if (typeof outreach.email !== "string" || !outreach.email.trim() || outreach.email.length > 1200) {
    throw new Error("Outreach draft must include a concise email");
  }
  if (!Array.isArray(outreach.fitHighlights) || outreach.fitHighlights.length < 1 || outreach.fitHighlights.length > 3) {
    throw new Error("Outreach draft must include 1 to 3 fit highlights");
  }
  const fitHighlights = outreach.fitHighlights.map(value => String(value).trim()).filter(Boolean);
  if (fitHighlights.length !== outreach.fitHighlights.length || fitHighlights.some(value => value.length > 80)) {
    throw new Error("Each fit highlight must be a non-empty phrase under 80 characters");
  }
  updateNotionPage(authorized.entry.pageId, {
    outreachDraft: outreach.email.trim(),
    systemState: authorized.entry.systemState,
    systemStateBlockId: authorized.entry.systemStateBlockId,
  });
  return { jobId: authorized.jobId, outreachDraft: outreach.email.trim(), fitHighlights };
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

function validatePatchAgainstBaseResume(patch) {
  const baseSkills = getEditableResumeContent().skills;
  if (patch.skills.length !== baseSkills.length) {
    throw new Error(`Tailoring patch must preserve the Base Resume's ${baseSkills.length} Skills rows`);
  }
}

function applyTailoringPatchForTask(data) {
  const authorized = getAuthorizedTailoringEntry(data);
  const patch = normalizeTailoringPatch(data.patch);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    validatePatchAgainstBaseResume(patch);
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
