const PROPERTIES = PropertiesService.getScriptProperties();

function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function measureOperation(name, operation) {
  const startedAt = Date.now();
  try {
    return operation();
  } finally {
    Logger.log(`[PERF] ${name}: ${Date.now() - startedAt}ms`);
  }
}

function runTransportProbe(data) {
  const delayMs = Number(data && data.delayMs);
  const allowedDelays = [0, 10000, 20000, 30000];
  if (!allowedDelays.includes(delayMs)) {
    throw new Error("Unsupported transport probe delay");
  }

  Logger.log(`[PROBE] Starting fixed-response probe at ${delayMs}ms`);
  if (delayMs) Utilities.sleep(delayMs);
  Logger.log(`[PROBE] Completed fixed-response probe at ${delayMs}ms`);
  return { success: true, probe: "transport", delayMs };
}

function performAnalysis(data) {
  const jobDescription = data.jobDescription;
  const currentJdHash = computeJobDescriptionHash(jobDescription);

  // Try the existing tailored resume first, then use the canonical Base Resume.
  let resumeText = "";
  let resumeSource = "base";
  let existingEntry = null;
  if (data.jobId) {
    try {
      existingEntry = measureOperation("Notion lookup", () => findNotionEntry(data.jobId));
      if (existingEntry && existingEntry.resumeUrl) {
        resumeText = measureOperation("Tailored resume read", () => getDocTextFromUrl(existingEntry.resumeUrl));
        resumeSource = "tailored";
      }
    } catch (err) {
      Logger.log(`[WARN] Could not fetch tailored resume from Notion: ${err.toString()}`);
    }
  }

  if (!resumeText) resumeText = measureOperation("Base resume read", () => getResumeContent());
  Logger.log(`[INFO] Resume source: ${resumeSource}. Length: ${resumeText.length} chars`);

  let rubric = existingEntry && existingEntry.rubric;
  if (rubric) {
    if (rubric.jdHash && rubric.jdHash !== currentJdHash) {
      Logger.log(`[WARN] JD hash changed for Job ID ${data.jobId}; reusing stored rubric ${rubric.jdHash}`);
    } else {
      Logger.log(`[INFO] Reusing stored ATS rubric for Job ID: ${data.jobId}`);
    }
  } else {
    Logger.log("[INFO] Generating ATS rubric from the job description");
    rubric = measureOperation("Rubric extraction", () => extractJobRubric(jobDescription));
  }

  const analysis = measureOperation("Evidence analysis", () => analyzeJob(jobDescription, resumeText, rubric));
  analysis.currentJdHash = currentJdHash;
  analysis.currentScore = analysis.atsScore;
  analysis.baselineScore = existingEntry && typeof existingEntry.baselineScore === "number"
    ? existingEntry.baselineScore
    : (!existingEntry ? analysis.atsScore : null);
  analysis.scoreDelta = typeof analysis.baselineScore === "number"
    ? analysis.currentScore - analysis.baselineScore
    : null;
  if (analysis.tailoringBrief && analysis.tailoringBrief.ats) {
    analysis.tailoringBrief.ats.baselineCoverage = analysis.baselineScore;
    analysis.tailoringBrief.ats.currentCoverage = analysis.currentScore;
    analysis.tailoringBrief.ats.delta = analysis.scoreDelta;
  }

  if (existingEntry) {
    try {
      measureOperation("Notion analysis update", () => updateNotionPage(existingEntry.pageId, {
        analysis,
        systemState: existingEntry.systemState,
        systemStateBlockId: existingEntry.systemStateBlockId,
      }));
    } catch (err) {
      Logger.log(`[WARN] Could not update ATS in Notion: ${err.toString()}`);
    }
  }
  return analysis;
}

/**
 * Main Entry Point: Receives POST request from Bookmarklet
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action || "analyze"; // Default to analyze

    Logger.log(`[START] Action: ${action} for ${data.role} at ${data.company}`);

    // --- ACTION: ANALYZE ---
    if (action === "analyze") {
      const analysis = measureOperation("Total analysis request", () => performAnalysis(data));
      return jsonOutput({ success: true, analysis });
    }

    // Temporary diagnostic: exercises the same ContentService response path
    // without invoking model, Notion, Drive, or resume work.
    if (action === "transportProbe") {
      return jsonOutput(runTransportProbe(data));
    }

    // --- ACTION: SAVE / PREPARE TAILORING TASK ---
    if (action === "save") {
      // Persists the immutable task only. The server creates the Drive copy after it receives a patch.
      const analysis = data.analysis;
      data.jobId = resolveJobId(data);

      // Check if this Job ID already exists in Notion
      let existingEntry = null;
      if (data.jobId) {
        try {
          existingEntry = findNotionEntry(data.jobId);
        } catch (err) {
          Logger.log(`[WARN] Notion lookup failed: ${err.toString()}`);
        }
      }

      data.tailoringTask = buildTailoringTask(data);
      data.draftDocumentId = null;
      data.status = "Tailoring";

      if (existingEntry) {
        // Do not create or replace a Drive document during task preparation.
        data.systemState = existingEntry.systemState;
        data.systemStateBlockId = existingEntry.systemStateBlockId;
        updateNotionPage(existingEntry.pageId, data);
        Logger.log(`[INFO] Updated existing Notion entry: ${existingEntry.pageId}`);
      } else {
        // Save the task record before the agent creates the job-folder draft.
        saveToNotion(data);
        Logger.log(`[INFO] Saved new Notion entry`);
      }

      // Log to Sheet (Optional Secondary tracking)
      try {
        logToSheet({
          company: data.company,
          role: data.role,
          decision: analysis.decision,
          confidence: analysis.confidence,
          effort: analysis.effort,
          gistUrl: "",
          jobUrl: data.jobUrl,
        });
      } catch (err) {
        Logger.log(`[WARN] Optional Sheet log failed: ${err.toString()}`);
      }

      return jsonOutput({
        success: true,
        jobId: data.jobId,
        taskToken: issueTaskToken(data.jobId),
        agentEndpoint: getCurrentWebAppUrl(),
      });
    }

    // --- AGENT ACTION: CLAIM TASK AND READ CURRENT EDITABLE BASE CONTENT ---
    if (action === "claimTailoringTask") {
      return jsonOutput({ success: true, ...claimTailoringTask(data) });
    }

    // --- AGENT ACTION: COPY BASE, APPLY PATCH, VERIFY, RESCORE, AND PERSIST ---
    if (action === "applyTailoringPatch") {
      return jsonOutput({ success: true, ...applyTailoringPatchForTask(data) });
    }
  } catch (err) {
    Logger.log(`[ERROR] ${err.toString()}`);
    return jsonOutput({ success: false, error: err.toString() });
  }
}

// --- Resume functions moved to resume.js ---
// getResumeContent, getDocTextFromUrl, getEditableResumeContent,
// createOrGetTailoringFolder, createOrGetTailoringDraft, applyTailoringPatch


// --- Analysis functions moved to analysis.js ---
// getProviderConfig, calculateATSScore, analyzeJob

// --- Notion functions moved to notion.js ---
// findNotionEntry, updateNotionPage, saveToNotion, initNotionDatabase

// --- Tailoring task functions moved to tailoring.js ---
// buildTailoringTask, claimTailoringTask, applyTailoringPatchForTask

// --- Integration functions moved to integrations.js ---
// createGist, logToSheet
