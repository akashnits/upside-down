// notion.js — Notion Database CRUD operations
// Functions: findNotionEntry, updateNotionPage, saveToNotion, initNotionDatabase

const NOTION_RICH_TEXT_CHUNK_SIZE = 1900;

function getNotionRichTextValue(property) {
  if (!property || !Array.isArray(property.rich_text)) return "";
  return property.rich_text
    .map(item => item.plain_text || (item.text && item.text.content) || "")
    .join("");
}

function getNotionNumberValue(property) {
  return property && typeof property.number === "number" ? property.number : null;
}

function parseStoredRubric(value) {
  if (!value) return null;
  try {
    const rubric = JSON.parse(value);
    return rubric && rubric.version && rubric.keywords ? rubric : null;
  } catch (err) {
    Logger.log(`[WARN] Could not parse stored ATS rubric: ${err.toString()}`);
    return null;
  }
}

function buildNotionRichTextProperty(value) {
  if (!value) return { rich_text: [] };
  const chunks = [];
  for (let i = 0; i < value.length; i += NOTION_RICH_TEXT_CHUNK_SIZE) {
    chunks.push({ text: { content: value.substring(i, i + NOTION_RICH_TEXT_CHUNK_SIZE) } });
  }
  return { rich_text: chunks };
}

function buildRubricProperties(analysis) {
  const properties = {};
  if (analysis.rubric) {
    properties["ATS Rubric"] = buildNotionRichTextProperty(JSON.stringify(analysis.rubric));
    properties["Rubric Version"] = buildNotionRichTextProperty(String(analysis.rubricVersion || analysis.rubric.version || "1"));
    properties["JD Hash"] = buildNotionRichTextProperty(String(analysis.rubric.jdHash || ""));
  }
  if (typeof analysis.baselineScore === "number") {
    properties["Baseline ATS Score"] = { number: analysis.baselineScore / 100 };
  }
  if (typeof analysis.atsScore === "number") {
    properties["Current ATS Score"] = { number: analysis.atsScore / 100 };
    properties["ATS Score"] = { number: analysis.atsScore / 100 };
  }
  return properties;
}

/**
 * Query Notion DB for an existing entry by Job ID.
 * Returns the resume URL and any persisted ATS comparison state.
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
    const baselineValue = getNotionNumberValue(page.properties["Baseline ATS Score"]);
    const currentValue = getNotionNumberValue(page.properties["Current ATS Score"]);
    Logger.log(`[INFO] Found existing Notion entry for Job ID: ${jobId}`);
    return {
      pageId: page.id,
      resumeUrl: (resumeLink && resumeLink.url) || null,
      rubric: parseStoredRubric(getNotionRichTextValue(page.properties["ATS Rubric"])),
      rubricVersion: getNotionRichTextValue(page.properties["Rubric Version"]) || null,
      jdHash: getNotionRichTextValue(page.properties["JD Hash"]) || null,
      baselineScore: baselineValue === null ? null : baselineValue * 100,
      currentScore: currentValue === null ? null : currentValue * 100,
    };
  }
  
  Logger.log(`[INFO] No existing entry in Notion for Job ID: ${jobId}`);
  return null;
}

/**
 * Update an existing Notion page with latest analysis data.
 */
function updateNotionPage(pageId, data, isRetry = false) {
  const token = PROPERTIES.getProperty("NOTION_API_KEY");
  if (!token) throw new Error("NOTION_API_KEY not set");

  const analysis = data.analysis;

  const payload = {
    properties: {
      "Decision": { select: { name: analysis.decision || "MAYBE" } },
      "Confidence": { select: { name: analysis.confidence || "MEDIUM" } },
      "ATS Score": { number: (Math.round((analysis.atsScore || 0) * 100) / 100) / 100 },
      "Date": { date: { start: new Date().toISOString().split('T')[0] } }
    }
  };

  Object.assign(payload.properties, buildRubricProperties(analysis));

  // Only update URL links if valid URLs were passed (prevents wiping them on early re-analysis)
  if (data.gistUrl) {
    payload.properties["Gist Link"] = { url: data.gistUrl };
  }

  // Only update Resume Link if a valid URL was passed
  if (data.resumeUrl) {
    payload.properties["Resume Link"] = { url: data.resumeUrl };
  }

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
    if (!isRetry) {
      Logger.log(`[INFO] Notion update may require the ATS rubric schema. Initializing and retrying.`);
      initNotionDatabase(PROPERTIES.getProperty("NOTION_DB_ID"), token);
      return updateNotionPage(pageId, data, true);
    }
    throw new Error(`Notion Update Error (${responseCode}): ${response.getContentText()}`);
  }
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
      "ATS Score": { number: (Math.round((analysis.atsScore || 0) * 100) / 100) / 100 },
      "Job Link": { url: data.jobUrl || "" },
      "Job ID": { rich_text: [{ text: { content: data.jobId || "Unknown" } }] },
      "Gist Link": { url: data.gistUrl || null },
      "Resume Link": { url: data.resumeUrl || null },
      "Status": { select: { name: "To Review" } },
      "Date": { date: { start: new Date().toISOString().split('T')[0] } }
    }
  };

  Object.assign(payload.properties, buildRubricProperties(analysis));

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
      "Current ATS Score": { "number": { "format": "percent" } },
      "Baseline ATS Score": { "number": { "format": "percent" } },
      "ATS Rubric": { "rich_text": {} },
      "Rubric Version": { "rich_text": {} },
      "JD Hash": { "rich_text": {} },
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
