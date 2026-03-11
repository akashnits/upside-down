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
      
      if (data.jobId) {
        try {
          const existing = findNotionEntry(data.jobId);
          if (existing && existing.resumeUrl) {
            resumeText = getDocTextFromUrl(existing.resumeUrl);
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
          notionUrl: pageUrl,
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

/**
 * Helper to fetch Resume Text from Google Doc (base resume)
 */
function getResumeContent() {
  const docId = PROPERTIES.getProperty("RESUME_DOC_ID");
  if (!docId) throw new Error("RESUME_DOC_ID not set in Script Properties");
  return DocumentApp.openById(docId).getBody().getText();
}

/**
 * Extract Google Doc text from a URL
 */
function getDocTextFromUrl(url) {
  // Extract Doc ID from URLs like https://docs.google.com/document/d/DOC_ID/edit
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error(`Could not extract Doc ID from URL: ${url}`);
  return DocumentApp.openById(match[1]).getBody().getText();
}

/**
 * Query Notion DB for an existing entry by Job ID.
 * Returns { pageId, resumeUrl } or null if not found.
 */
function findNotionEntry(jobId) {
  const token = PROPERTIES.getProperty("NOTION_API_KEY");
  const dbId = PROPERTIES.getProperty("NOTION_DB_ID");
  if (!token || !dbId) return null;

  const payload = {
    filter: {
      property: "Job ID",
      rich_text: { equals: jobId }
    },
    page_size: 1
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Notion-Version": CONFIG.NOTION_VERSION
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(`https://api.notion.com/v1/databases/${dbId}/query`, options);
  const data = JSON.parse(response.getContentText());

  if (data.results && data.results.length > 0) {
    const page = data.results[0];
    const resumeLink = page.properties["Resume Link"];
    Logger.log(`[INFO] Found existing Notion entry for Job ID: ${jobId}`);
    return {
      pageId: page.id,
      resumeUrl: (resumeLink && resumeLink.url) || null
    };
  }
  
  Logger.log(`[INFO] No existing entry in Notion for Job ID: ${jobId}`);
  return null;
}

/**
 * Update an existing Notion page with latest analysis data.
 */
function updateNotionPage(pageId, data) {
  const token = PROPERTIES.getProperty("NOTION_API_KEY");
  if (!token) throw new Error("NOTION_API_KEY not set");

  const analysis = data.analysis;

  const payload = {
    properties: {
      "Decision": { select: { name: analysis.decision || "MAYBE" } },
      "Confidence": { select: { name: analysis.confidence || "MEDIUM" } },
      "ATS Score": { number: (Math.round((analysis.atsScore || 0) * 100) / 100) / 100 },
      "Gist Link": { url: data.gistUrl || null },
      "Resume Link": { url: data.resumeUrl || null },
      "Date": { date: { start: new Date().toISOString().split('T')[0] } }
    }
  };

  const options = {
    method: "patch",
    contentType: "application/json",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Notion-Version": CONFIG.NOTION_VERSION
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(`https://api.notion.com/v1/pages/${pageId}`, options);
  const responseCode = response.getResponseCode();
  if (responseCode !== 200) {
    throw new Error(`Notion Update Error (${responseCode}): ${response.getContentText()}`);
  }
}

/**
 * Duplicates the Base Resume into a nested Drive folder structure:
 * Akash CVs -> [Company Name] -> [Role]_[JobId]
 * Returns the URL of the new document.
 */
function duplicateResume(role, company, jobId) {
  const baseDocId = PROPERTIES.getProperty("RESUME_DOC_ID");
  if (!baseDocId) return "";

  try {
    const baseFile = DriveApp.getFileById(baseDocId);
    const sanitizedCompany = (company || "Unknown").replace(/[^a-zA-Z0-9 _-]/g, '');
    const folderName = `${role || "Unknown"}_${jobId || "Unknown"}`.replace(/[^a-zA-Z0-9 _-]/g, '');
    
    // Access "Akash CVs" root folder directly
    const rootFolderId = PROPERTIES.getProperty("CVS_ROOT_FOLDER_ID");
    if (!rootFolderId) throw new Error("CVS_ROOT_FOLDER_ID not set in Script Properties");
    let rootFolder = DriveApp.getFolderById(rootFolderId);
    
    // Find or create Company folder inside Root
    let companyIter = rootFolder.getFoldersByName(sanitizedCompany);
    let companyFolder = companyIter.hasNext() ? companyIter.next() : rootFolder.createFolder(sanitizedCompany);

    // Create the specific Role/Job folder inside the Company folder
    const targetFolder = companyFolder.createFolder(folderName);
    
    // Create copy inside the new target folder
    const newFile = baseFile.makeCopy(`Akash_Raj`, targetFolder);
    
    // Grant edit access so Cowork/AI can modify it
    newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
    
    return newFile.getUrl();
  } catch (err) {
    Logger.log(`[ERROR] Failed to duplicate resume: ${err.toString()}`);
    return "";
  }
}

// 1. HELPER: Get Current Provider Configuration
function getProviderConfig() {
  const scriptProperties = PropertiesService.getScriptProperties();
  // Allow runtime switching via Script Properties without redeploying
  const providerName =
    scriptProperties.getProperty("PROVIDER") || CONFIG.PROVIDER;

  const provider = CONFIG.PROVIDERS[providerName];
  if (!provider)
    throw new Error(
      `Invalid PROVIDER setting: ${providerName}. Check Script Properties or config.gs.`,
    );
  return provider;
}

/**
 * Calculate ATS score by matching keywords against resume
 */
function calculateATSScore(keywords, resumeText) {
  const resumeLower = resumeText.toLowerCase();
  const matched = [];
  const missing = [];

  const synonyms = {
    javascript: ["js", "javascript", "ecmascript"],
    typescript: ["ts", "typescript"],
    python: ["python", "py"],
    "machine learning": ["ml", "machine learning", "machinelearning"],
    "artificial intelligence": ["ai", "artificial intelligence"],
    "natural language processing": ["nlp", "natural language processing"],
    "amazon web services": ["aws", "amazon web services"],
    "google cloud platform": ["gcp", "google cloud platform", "google cloud"],
    "microsoft azure": ["azure", "microsoft azure"],
    kubernetes: ["k8s", "kubernetes"],
    postgresql: ["postgres", "postgresql", "psql"],
    mongodb: ["mongo", "mongodb"],
    "react.js": ["react", "reactjs", "react.js"],
    "node.js": ["node", "nodejs", "node.js"],
    "vue.js": ["vue", "vuejs", "vue.js"],
    angular: ["angular", "angularjs"],
    "next.js": ["next", "nextjs", "next.js"],
    graphql: ["graphql", "gql"],
    "rest api": ["rest", "restful", "rest api", "restful api"],
    "ci/cd": ["ci/cd", "cicd", "continuous integration", "continuous deployment"],
    docker: ["docker", "containerization"],
    terraform: ["terraform", "iac", "infrastructure as code"],
    agile: ["agile", "scrum", "kanban"],
    "user experience": ["ux", "user experience"],
    "user interface": ["ui", "user interface"],
    "software development": ["software engineering", "software development", "swe"],
    bachelor: ["bachelor", "bachelors", "bachelor's", "bs", "b.s.", "bsc"],
    master: ["master", "masters", "master's", "ms", "m.s.", "msc"],

    // Modern Backend & AI groupings
    "system design": ["system design", "systems design", "architecture", "architected", "designing resilient"],
    "microservices": ["microservices", "micro-services", "distributed systems", "distributed platforms"],
    "message queuing": ["message queuing", "message queues", "pub/sub", "event-driven", "kafka", "rabbitmq", "kinesis"],
    "generative ai": ["generative ai", "genai", "llm", "large language models"],
    "technical leadership": ["technical leadership", "tech lead", "technical strategy", "driving strategy", "mentorship", "mentoring"],
    "cloud platforms": ["cloud platforms", "public cloud", "cloud computing", "aws", "gcp", "azure"],
  };

  const expandedSynonyms = {};
  Object.values(synonyms).forEach((group) => {
    group.forEach((term) => {
      expandedSynonyms[term] = group;
    });
  });

  keywords.forEach((keyword) => {
    const keywordLower = keyword.toLowerCase();

    let variations = [
      keywordLower,
      keywordLower.replace(/\./g, ""), // React.js -> Reactjs
      keywordLower.replace(/\.js$/i, ""), // Node.js -> Node
      keywordLower.replace(/js$/i, ""), // ReactJS -> React
    ];

    // Basic pluralization/singularization fallback
    if (keywordLower.endsWith('s')) variations.push(keywordLower.slice(0, -1));

    if (expandedSynonyms[keywordLower]) {
      variations = variations.concat(expandedSynonyms[keywordLower]);
    }

    Object.values(synonyms).forEach((group) => {
      // Allow partial structural matching (e.g. "RESTful APIs" inside "REST API" group)
      if (group.some((syn) => keywordLower.includes(syn) || syn.includes(keywordLower))) {
        variations = variations.concat(group);
      }
    });

    variations = [...new Set(variations)];

    const found = variations.some((v) => {
      // Use word boundaries for short acronyms to avoid false positives (like "flAWS" matching "aws")
      if (v.length <= 4 && /^[a-z0-9]+$/i.test(v)) {
        const regex = new RegExp(`\\b${v}\\b`, 'i');
        return regex.test(resumeLower);
      }
      return resumeLower.includes(v);
    });

    if (found) {
      matched.push(keyword);
    } else {
      missing.push(keyword);
    }
  });

  const score =
    keywords.length > 0
      ? Math.round((matched.length / keywords.length) * 100)
      : 0;

  return { score, matched, missing };
}

/**
 * Analyze Job vs Resume in a single LLM call
 * Extracts keywords AND provides analysis in one prompt
 */
function analyzeJob(jdText, resumeText) {
  const provider = getProviderConfig();
  const scriptProperties = PropertiesService.getScriptProperties();
  const apiKey = scriptProperties.getProperty(provider.API_KEY_PROP);

  if (!apiKey)
    throw new Error(`${provider.API_KEY_PROP} not found in Script Properties`);

  // Single LLM call: extract keywords + analyze in one prompt
  const prompt = `You are an expert Career Coach and Recruiter.

JOB DESCRIPTION:
${jdText}

RESUME:
${resumeText}

Task: Analyze this job application.
Step 1: Extract all required skills, technologies, and qualifications as keywords.
Step 2: Use those keywords to evaluate resume fit.
Step 3: Provide actionable insights.

Output strict JSON in this format:
{
  "keywords": ["Python", "AWS", ...],
  "markdown": "# Company — Role ... (The full Insight Card markdown)",
  "decision": "APPLY" | "MAYBE" | "SKIP",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "effort": "LOW" | "MEDIUM" | "HIGH"
}

The Markdown Insight Card MUST follow this structure EXACTLY (DO NOT include Decision/Confidence/Effort/ATS Score — those are shown separately in the UI):

# Company — Role

## 📝 Suggested Resume Summary
*[Write a 3-4 sentence professional summary that naturally incorporates the key missing skills/technologies from the job description. This should help the candidate boost their ATS score when added to their resume.]*

---

## 🚫 Likely Rejection Reasons
*(What may cause a recruiter to pass in the first scan)*

- [Reason 1]
- [Reason 2]
- [Reason 3]

---

## ✅ High-ROI Fixes (Checklist)
*(Do these before applying)*

- [ ] [Actionable fix 1]
- [ ] [Actionable fix 2]

---

## 💪 Strong Signals (Do NOT weaken these)

- [Signal 1]
- [Signal 2]

---

## 📌 Job Context

- **Company:** [Company Name]
- **Role:** [Role Name]
- **Analyzed On:** ${new Date().toLocaleDateString('en-CA')}`; // en-CA gives YYYY-MM-DD format based on local timezone

  const payload = {
    model: provider.MODELS.ANALYSIS,
    messages: [
      {
        role: "system",
        content:
          "You are a career coach. Always respond with valid JSON only, no markdown code blocks.",
      },
      { role: "user", content: prompt },
    ],
    temperature: CONFIG.TEMPERATURE.ANALYSIS,
    max_tokens: 8192,
    response_format: { type: "json_object" },
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/akashnits/upside-down",
      "X-Title": "Upside Down Extension",
    },
    payload: JSON.stringify(payload),
  };

  const response = UrlFetchApp.fetch(provider.API_URL, options);
  const data = JSON.parse(response.getContentText());
  
  // Check finish_reason — if 'length', the response was truncated
  const finishReason = data.choices[0].finish_reason;
  Logger.log(`[INFO] LLM finish_reason: ${finishReason}`);
  
  if (finishReason === 'length') {
    Logger.log(`[WARN] LLM response was truncated (finish_reason=length). Retrying with higher max_tokens...`);
    payload.max_tokens = 16384;
    options.payload = JSON.stringify(payload);
    const retryResponse = UrlFetchApp.fetch(provider.API_URL, options);
    const retryData = JSON.parse(retryResponse.getContentText());
    const retryFinish = retryData.choices[0].finish_reason;
    Logger.log(`[INFO] Retry finish_reason: ${retryFinish}`);
    if (retryFinish === 'length') {
      throw new Error('LLM response still truncated after retry. The job description may be too long.');
    }
    var jsonString = retryData.choices[0].message.content;
  } else {
    var jsonString = data.choices[0].message.content;
  }

  // Clean markdown code blocks if present
  jsonString = jsonString
    .replace(/```json\n?/gi, "")
    .replace(/```\n?/g, "")
    .trim();

  let analysis;
  try {
    analysis = JSON.parse(jsonString);
  } catch (e) {
    Logger.log(
      `[ERROR] Failed to parse analysis JSON (finish_reason=${finishReason}): ${jsonString.substring(0, 500)}`,
    );
    throw new Error("Failed to parse AI response as JSON");
  }

  // Extract keywords from LLM response, then calculate ATS score deterministically
  const keywords = analysis.keywords || [];
  const ats = calculateATSScore(keywords, resumeText);
  Logger.log(
    `[ATS] Score: ${ats.score}% (${ats.matched.length}/${keywords.length} keywords)`,
  );

  // Add ATS data to response
  analysis.atsScore = ats.score;
  analysis.atsMatched = ats.matched;
  analysis.atsMissing = ats.missing;

  // Inject ATS section into markdown (after first ---) so insight card has keyword details
  const atsSection =
    `\n\n## 📄 ATS Score: ${ats.score}%\n\n` +
    `**Matched (${ats.matched.length}):** ${ats.matched.join(", ") || "None"}\n\n` +
    `**Missing (${ats.missing.length}):** ${ats.missing.join(", ") || "None"}\n\n---`;

  // Replace the first --- with ATS section + ---
  analysis.markdown = analysis.markdown.replace(/\n---/, `\n---${atsSection}`);

  return analysis;
}

/**
 * Create a page in the Notion ATS Database (Tracker Only)
 */
function saveToNotion(data, isRetry = false) {
  const token = PROPERTIES.getProperty("NOTION_API_KEY");
  const dbId = PROPERTIES.getProperty("NOTION_DB_ID");
  
  if (!token || !dbId) throw new Error("NOTION_API_KEY or NOTION_DB_ID not set");

  const analysis = data.analysis;

  const payload = {
    parent: { database_id: dbId },
    properties: {
      "Name": { title: [{ text: { content: `${data.company || "Unknown"} - ${data.role || "Unknown"}` } }] },
      "Company": { rich_text: [{ text: { content: data.company || "Unknown" } }] },
      "Role": { rich_text: [{ text: { content: data.role || "Unknown" } }] },
      "Decision": { select: { name: analysis.decision || "MAYBE" } },
      "Confidence": { select: { name: analysis.confidence || "MEDIUM" } },
      "ATS Score": { number: (Math.round((analysis.atsScore || 0) * 100) / 100) / 100 }, // Notion percent format expects a decimal (0.67 = 67%)
      "Job Link": { url: data.jobUrl || "" },
      "Job ID": { rich_text: [{ text: { content: data.jobId || "Unknown" } }] },
      "Gist Link": { url: data.gistUrl || null },
      "Resume Link": { url: data.resumeUrl || null },
      "Status": { select: { name: "To Review" } },
      "Date": { date: { start: new Date().toISOString().split('T')[0] } }
    }
    // Note: We are no longer pushing body 'children' blocks because Gist holds the data
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { 
      "Authorization": `Bearer ${token}`,
      "Notion-Version": CONFIG.NOTION_VERSION
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(CONFIG.NOTION_API_URL, options);
  const responseCode = response.getResponseCode();
  const responseData = JSON.parse(response.getContentText());

  if (responseCode !== 200) {
    if (responseData.code === 'validation_error' && !isRetry) {
      Logger.log(`[INFO] Validation error caught. Provisioning Notion Tracker schema...`);
      initNotionDatabase(dbId, token);
      return saveToNotion(data, true);
    }
    throw new Error(`Notion API Error (${responseCode}): ${JSON.stringify(responseData)}`);
  }

  return responseData.url;
}

/**
 * Auto-Initialize the Notion Database Schema if properties are missing
 */
function initNotionDatabase(dbId, token) {
  Logger.log(`[INFO] Auto-initializing Notion Database schema for db: ${dbId}`);
  const payload = {
    properties: {
      "Company": { "rich_text": {} },
      "Role": { "rich_text": {} },
      "Decision": { "select": { "options": [{ "name": "APPLY", "color": "green" }, { "name": "MAYBE", "color": "yellow" }, { "name": "SKIP", "color": "red" }] } },
      "Confidence": { "select": { "options": [{ "name": "HIGH", "color": "green" }, { "name": "MEDIUM", "color": "yellow" }, { "name": "LOW", "color": "red" }] } },
      "ATS Score": { "number": { "format": "percent" } },
      "Job Link": { "url": {} },
      "Job ID": { "rich_text": {} },
      "Gist Link": { "url": {} },
      "Resume Link": { "url": {} },
      "Status": { "select": { "options": [{ "name": "To Review", "color": "gray" }, { "name": "Applied", "color": "blue" }, { "name": "Interview", "color": "purple" }, { "name": "Rejected", "color": "red" }] } },
      "Date": { "date": {} }
    }
  };

  const options = {
    method: "patch",
    contentType: "application/json",
    headers: { 
      "Authorization": `Bearer ${token}`,
      "Notion-Version": CONFIG.NOTION_VERSION
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(`https://api.notion.com/v1/databases/${dbId}`, options);
  Logger.log(`[INFO] Init schema response: ${response.getContentText()}`);
}

/**
 * Create a Private GitHub Gist
 */
function createGist(markdownContent, company, role) {
  const token = PROPERTIES.getProperty("GITHUB_TOKEN");
  if (!token) throw new Error("GITHUB_TOKEN not set");

  const filename = `${company}_${role}_Insight.md`.replace(/[^a-z0-9]/gi, "_");

  const payload = {
    description: `Upside-Down Insight: ${role} at ${company}`,
    public: false,
    files: {
      [filename]: {
        content: markdownContent,
      },
    },
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${token}` },
    payload: JSON.stringify(payload),
  };

  const response = UrlFetchApp.fetch(CONFIG.GITHUB_API_URL, options);
  const data = JSON.parse(response.getContentText());
  return data.html_url;
}

/**
 * Append row to Google Sheet
 */
function logToSheet(data) {
  const sheetId = PROPERTIES.getProperty("SHEET_ID"); // Or use ActiveSpreadsheet if container-bound
  let sheet;

  if (sheetId) {
    sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
  } else {
    // Fallback: assume script is bound to the sheet
    sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  }

  sheet.appendRow([
    new Date(),
    data.company,
    data.role,
    data.decision,
    data.confidence,
    data.effort,
    data.gistUrl,
    data.jobUrl,
  ]);
}
