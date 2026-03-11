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

      // 2. Analyze
      const analysis = analyzeJob(jobDescription, resumeText);
      Logger.log(`[INFO] Analysis complete. Decision: ${analysis.decision}`);

      // 3. Update ATS Score in Notion (if entry exists)
      if (existingEntry) {
        try {
          updateNotionPage(existingEntry.pageId, { analysis: analysis });
          Logger.log(`[INFO] Updated ATS Score in Notion for Job ID: ${data.jobId}`);
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

    // --- ACTION: SAVE ---
    if (action === "save") {
      // Expects: data.analysis (object), data.company, data.role, data.jobUrl
      const analysis = data.analysis;

      // Check if this Job ID already exists in Notion
      let existingEntry = null;
      if (data.jobId) {
        try {
          existingEntry = findNotionEntry(data.jobId);
        } catch (err) {
          Logger.log(`[WARN] Notion lookup failed: ${err.toString()}`);
        }
      }

      // 3. Create Gist (always create a new one for latest analysis)
      let gistUrl = "";
      try {
        gistUrl = createGist(analysis.markdown, data.company, data.role);
        Logger.log(`[INFO] Gist created: ${gistUrl}`);
      } catch (err) {
        Logger.log(`[ERROR] Failed to create Gist: ${err.toString()}`);
        throw new Error("Gist creation failed.");
      }

      let newResumeUrl = "";

      if (existingEntry) {
        // Reuse existing resume doc — no new duplicates
        newResumeUrl = existingEntry.resumeUrl || "";
        Logger.log(`[INFO] Reusing existing resume: ${newResumeUrl}`);

        // Update the existing Notion page with latest analysis
        try {
          data.gistUrl = gistUrl;
          data.resumeUrl = newResumeUrl;
          updateNotionPage(existingEntry.pageId, data);
          Logger.log(`[INFO] Updated existing Notion entry: ${existingEntry.pageId}`);
        } catch (err) {
          Logger.log(`[WARN] Notion update failed: ${err.toString()}`);
        }
      } else {
        // 4. Duplicate Resume for Tailoring (first time only)
        try {
          newResumeUrl = duplicateResume(data.role, data.company, data.jobId);
          Logger.log(`[INFO] Created tailored resume draft: ${newResumeUrl}`);
        } catch (err) {
          Logger.log(`[ERROR] Resume duplication failed: ${err.toString()}`);
        }

        // 5. Save to Notion (new entry)
        try {
          data.gistUrl = gistUrl;
          data.resumeUrl = newResumeUrl;
          saveToNotion(data);
          Logger.log(`[INFO] Saved new Notion entry`);
        } catch (err) {
          Logger.log(`[WARN] Notion save failed: ${err.toString()}`);
        }
      }

      // 6. Log to Sheet (Optional Secondary tracking)
      logToSheet({
        company: data.company,
        role: data.role,
        decision: analysis.decision,
        confidence: analysis.confidence,
        effort: analysis.effort,
        gistUrl: gistUrl,
        jobUrl: data.jobUrl,
      });

      return ContentService.createTextOutput(
        JSON.stringify({
          success: true,
          gistUrl: gistUrl, 
          resumeUrl: newResumeUrl || (PROPERTIES.getProperty("RESUME_DOC_ID") ? `https://docs.google.com/document/d/${PROPERTIES.getProperty("RESUME_DOC_ID")}/edit` : "")
        }),
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
// getResumeContent, getDocTextFromUrl, duplicateResume


// --- Analysis functions moved to analysis.js ---
// getProviderConfig, calculateATSScore, analyzeJob

// --- Notion functions moved to notion.js ---
// findNotionEntry, updateNotionPage, saveToNotion, initNotionDatabase

// --- Integration functions moved to integrations.js ---
// createGist, logToSheet

