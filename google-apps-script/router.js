const PROPERTIES = PropertiesService.getScriptProperties();

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
      const jobDescription = data.jobDescription;
      const currentJdHash = computeJobDescriptionHash(jobDescription);

      // 1. Try to fetch tailored resume from Notion, fall back to base resume
      let resumeText = "";
      let resumeSource = "base";
      let existingEntry = null;
      
      if (data.jobId) {
        try {
          existingEntry = findNotionEntry(data.jobId);
          if (existingEntry && existingEntry.resumeUrl) {
            resumeText = getDocTextFromUrl(existingEntry.resumeUrl);
            resumeSource = "tailored";
            Logger.log(`[INFO] Using tailored resume from Notion for Job ID: ${data.jobId}`);
          }
        } catch (err) {
          Logger.log(`[WARN] Could not fetch tailored resume from Notion: ${err.toString()}`);
        }
      }
      
      if (!resumeText) {
        resumeText = getResumeContent();
        Logger.log(`[INFO] Using base resume (fallback).`);
      }
      Logger.log(`[INFO] Resume source: ${resumeSource}. Length: ${resumeText.length} chars`);

      // 2. Reuse the persisted rubric. Only legacy entries without a rubric generate one.
      let rubric = existingEntry && existingEntry.rubric;
      if (rubric) {
        if (rubric.jdHash && rubric.jdHash !== currentJdHash) {
          Logger.log(`[WARN] JD hash changed for Job ID ${data.jobId}; reusing stored rubric ${rubric.jdHash}`);
        } else {
          Logger.log(`[INFO] Reusing stored ATS rubric for Job ID: ${data.jobId}`);
        }
      } else {
        Logger.log(`[INFO] Generating ATS rubric from the job description`);
        rubric = extractJobRubric(jobDescription);
      }

      // 3. Analyze against the fixed rubric
      const analysis = analyzeJob(jobDescription, resumeText, rubric);
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
      Logger.log(`[INFO] Analysis complete. Decision: ${analysis.decision}`);

      // 4. Update persisted rubric and current score for existing entries
      if (existingEntry) {
        try {
          updateNotionPage(existingEntry.pageId, {
            analysis: analysis,
            systemState: existingEntry.systemState,
            systemStateBlockId: existingEntry.systemStateBlockId,
          });
          Logger.log(`[INFO] Updated ATS coverage in Notion for Job ID: ${data.jobId}`);
        } catch (err) {
          Logger.log(`[WARN] Could not update ATS in Notion: ${err.toString()}`);
        }
      }

      return ContentService.createTextOutput(
        JSON.stringify({
          success: true,
          analysis: analysis,
        }),
      ).setMimeType(ContentService.MimeType.JSON);
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

      return ContentService.createTextOutput(
        JSON.stringify({
          success: true,
          jobId: data.jobId,
          taskToken: issueTaskToken(data.jobId),
          agentEndpoint: getCurrentWebAppUrl(),
        }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // --- AGENT ACTION: CLAIM TASK AND READ CURRENT EDITABLE BASE CONTENT ---
    if (action === "claimTailoringTask") {
      return ContentService.createTextOutput(
        JSON.stringify({ success: true, ...claimTailoringTask(data) }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // --- AGENT ACTION: COPY BASE, APPLY PATCH, VERIFY, RESCORE, AND PERSIST ---
    if (action === "applyTailoringPatch") {
      return ContentService.createTextOutput(
        JSON.stringify({ success: true, ...applyTailoringPatchForTask(data) }),
      ).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    Logger.log(`[ERROR] ${err.toString()}`);
    return ContentService.createTextOutput(
      JSON.stringify({
        success: false,
        error: err.toString(),
      }),
    ).setMimeType(ContentService.MimeType.JSON);
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
