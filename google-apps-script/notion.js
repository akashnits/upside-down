// notion.js — Notion Database CRUD operations
// Functions: findNotionEntry, updateNotionPage, saveToNotion, initNotionDatabase

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
