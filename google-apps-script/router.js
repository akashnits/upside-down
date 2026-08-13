const PROPERTIES = PropertiesService.getScriptProperties();
const RESPONSE_CACHE_TTL_SECONDS = 600;
const MAX_CACHED_RESPONSE_CHARS = 80 * 1024;

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

function getResponseCacheKey(action, requestId) {
  return `response-v1:${action}:${requestId}`;
}

function isValidResponseRequestId(requestId) {
  return typeof requestId === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(requestId);
}

function getCachedResponse(action, requestId) {
  if (!isValidResponseRequestId(requestId)) return null;

  try {
    const value = CacheService.getScriptCache().get(getResponseCacheKey(action, requestId));
    if (!value) {
      Logger.log(`[CACHE] ${action} miss: requestId=${requestId}`);
      return null;
    }

    const response = JSON.parse(value);
    Logger.log(`[CACHE] ${action} hit: requestId=${requestId}; chars=${value.length}`);
    return response;
  } catch (err) {
    Logger.log(`[WARN] ${action} cache read failed for requestId=${requestId}: ${err.toString()}`);
    return null;
  }
}

function cacheResponse(action, requestId, response) {
  if (!isValidResponseRequestId(requestId)) return;

  const value = JSON.stringify(response);
  if (value.length > MAX_CACHED_RESPONSE_CHARS) {
    Logger.log(`[WARN] ${action} response not cached: requestId=${requestId}; chars=${value.length}`);
    return;
  }

  try {
    CacheService.getScriptCache().put(
      getResponseCacheKey(action, requestId),
      value,
      RESPONSE_CACHE_TTL_SECONDS,
    );
    Logger.log(`[CACHE] ${action} stored: requestId=${requestId}; chars=${value.length}; ttl=${RESPONSE_CACHE_TTL_SECONDS}s`);
  } catch (err) {
    Logger.log(`[WARN] ${action} cache write failed for requestId=${requestId}: ${err.toString()}`);
  }
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
      const requestId = data.analysisRequestId;
      if (requestId) Logger.log(`[ANALYZE] requestId=${requestId}`);

      const cachedResponse = getCachedResponse("analysis", requestId);
      if (cachedResponse) return jsonOutput(cachedResponse);

      const analysis = measureOperation("Total analysis request", () => performAnalysis(data));
      const response = { success: true, analysis };
      cacheResponse("analysis", requestId, response);
      return jsonOutput(response);
    }

    // --- ACTION: SAVE / PREPARE TAILORING TASK ---
    if (action === "save") {
      const requestId = data.saveRequestId;
      if (requestId) Logger.log(`[SAVE] requestId=${requestId}`);

      const cachedResponse = getCachedResponse("save", requestId);
      if (cachedResponse) return jsonOutput(cachedResponse);

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

      const response = {
        success: true,
        company: data.company || "Unknown",
        role: data.role || "Unknown",
        jobId: data.jobId,
        taskToken: issueTaskToken(data.jobId),
        agentEndpoint: getCurrentWebAppUrl(),
      };
      cacheResponse("save", requestId, response);
      return jsonOutput(response);
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
