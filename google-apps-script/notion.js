// notion.js - Jobs tracker CRUD and page-body workflow state

const NOTION_RICH_TEXT_CHUNK_SIZE = 1900;
const NOTION_SYSTEM_STATE_VERSION = 1;
const NOTION_SYSTEM_STATE_MARKER = "[Upside Down system state - managed]";

// These properties are intentionally the only fields exposed by the Jobs tracker.
const LEGACY_NOTION_PROPERTIES = [
  "Confidence",
  "Current ATS Score",
  "Baseline ATS Score",
  "ATS Rubric",
  "Rubric Version",
  "JD Hash",
  "Tailoring Task",
  "Draft Folder ID",
  "Draft Document ID",
  "Gist Link",
];

function getNotionRichTextValue(property) {
  return getNotionPlainText(property && property.rich_text);
}

function getNotionPlainText(richText) {
  if (!Array.isArray(richText)) return "";
  return richText
    .map(item => item.plain_text || (item.text && item.text.content) || "")
    .join("");
}

function getNotionNumberValue(property) {
  return property && typeof property.number === "number" ? property.number : null;
}

function getNotionPercentScore(property) {
  const value = getNotionNumberValue(property);
  return value === null ? null : Math.round(value * 10000) / 100;
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

function parseStoredTailoringTask(value) {
  if (!value) return null;
  try {
    const task = JSON.parse(value);
    return task && task.version && task.jobId ? task : null;
  } catch (err) {
    Logger.log(`[WARN] Could not parse stored tailoring task: ${err.toString()}`);
    return null;
  }
}

function buildNotionRichText(value) {
  if (!value) return [];

  const chunks = [];
  for (let i = 0; i < value.length; i += NOTION_RICH_TEXT_CHUNK_SIZE) {
    chunks.push({ text: { content: value.substring(i, i + NOTION_RICH_TEXT_CHUNK_SIZE) } });
  }

  if (chunks.length > 100) {
    throw new Error("Tailoring state exceeds Notion's block rich-text limit");
  }
  return chunks;
}

function buildNotionRichTextProperty(value) {
  return { rich_text: buildNotionRichText(value) };
}

function getLegacySystemState(properties) {
  const baselineScore = getNotionPercentScore(properties["Baseline ATS Score"]);
  const currentScore = getNotionPercentScore(properties["Current ATS Score"]);
  const trackerScore = getNotionPercentScore(properties["ATS Score"]);
  const state = {
    version: NOTION_SYSTEM_STATE_VERSION,
    rubric: parseStoredRubric(getNotionRichTextValue(properties["ATS Rubric"])),
    rubricVersion: getNotionRichTextValue(properties["Rubric Version"]) || null,
    jdHash: getNotionRichTextValue(properties["JD Hash"]) || null,
    baselineScore,
    currentScore: currentScore === null ? trackerScore : currentScore,
    tailoringTask: parseStoredTailoringTask(getNotionRichTextValue(properties["Tailoring Task"])),
    draftFolderId: getNotionRichTextValue(properties["Draft Folder ID"]) || null,
    draftDocumentId: getNotionRichTextValue(properties["Draft Document ID"]) || null,
  };

  return hasSystemStateData(state) ? state : null;
}

function hasSystemStateData(state) {
  return Boolean(state && (
    state.rubric ||
    state.rubricVersion ||
    state.jdHash ||
    typeof state.baselineScore === "number" ||
    typeof state.currentScore === "number" ||
    state.tailoringTask ||
    state.draftFolderId ||
    state.draftDocumentId
  ));
}

function mergeSystemState(base, override) {
  const merged = Object.assign({}, base || {}, override || {});
  merged.version = NOTION_SYSTEM_STATE_VERSION;
  return merged;
}

function getNotionOptions(token, method, payload) {
  const options = {
    method,
    contentType: "application/json",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Notion-Version": CONFIG.NOTION_VERSION,
    },
    muteHttpExceptions: true,
  };
  if (payload !== undefined) options.payload = JSON.stringify(payload);
  return options;
}

function parseNotionResponse(response, expectedCode, context) {
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code !== expectedCode) {
    throw new Error(`${context} (${code}): ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

function readNotionSystemState(pageId, token) {
  let cursor = null;

  do {
    const cursorParam = cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : "";
    const response = UrlFetchApp.fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100${cursorParam}`,
      getNotionOptions(token, "get"),
    );
    const data = parseNotionResponse(response, 200, "Notion block read error");

    for (const block of data.results || []) {
      if (block.type !== "toggle" || !block.toggle) continue;
      const text = getNotionPlainText(block.toggle.rich_text);
      if (!text.startsWith(`${NOTION_SYSTEM_STATE_MARKER}\n`)) continue;

      try {
        const state = JSON.parse(text.substring(NOTION_SYSTEM_STATE_MARKER.length + 1));
        if (!state || state.version !== NOTION_SYSTEM_STATE_VERSION) {
          throw new Error("unsupported state version");
        }
        return { state, blockId: block.id };
      } catch (err) {
        throw new Error(`Could not parse Notion system state: ${err.toString()}`);
      }
    }

    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return { state: null, blockId: null };
}

function buildSystemState(existingState, data) {
  const analysis = data.analysis || {};
  const state = mergeSystemState(existingState, {});

  if (analysis.rubric) state.rubric = analysis.rubric;
  if (analysis.rubricVersion || (analysis.rubric && analysis.rubric.version)) {
    state.rubricVersion = analysis.rubricVersion || analysis.rubric.version;
  }
  if (analysis.currentJdHash || (analysis.rubric && analysis.rubric.jdHash)) {
    state.jdHash = analysis.currentJdHash || analysis.rubric.jdHash;
  }
  if (typeof analysis.baselineScore === "number") state.baselineScore = analysis.baselineScore;
  if (typeof analysis.atsScore === "number") state.currentScore = analysis.atsScore;

  if (Object.prototype.hasOwnProperty.call(data, "tailoringTask")) {
    state.tailoringTask = data.tailoringTask;
  }
  if (Object.prototype.hasOwnProperty.call(data, "draftFolderId")) {
    state.draftFolderId = data.draftFolderId;
  }
  if (Object.prototype.hasOwnProperty.call(data, "draftDocumentId")) {
    state.draftDocumentId = data.draftDocumentId;
  }

  state.updatedAt = new Date().toISOString();
  return state;
}

function writeNotionSystemState(pageId, data, token) {
  let existingState = data.systemState || null;
  let blockId = data.systemStateBlockId || null;

  if (!existingState || !blockId) {
    const stored = readNotionSystemState(pageId, token);
    existingState = existingState || stored.state;
    blockId = blockId || stored.blockId;
  }

  const state = buildSystemState(existingState, data);
  const stateText = `${NOTION_SYSTEM_STATE_MARKER}\n${JSON.stringify(state)}`;
  const block = {
    object: "block",
    type: "toggle",
    toggle: { rich_text: buildNotionRichText(stateText) },
  };

  if (blockId) {
    const response = UrlFetchApp.fetch(
      `https://api.notion.com/v1/blocks/${blockId}`,
      getNotionOptions(token, "patch", { toggle: block.toggle }),
    );
    parseNotionResponse(response, 200, "Notion system state update error");
  } else {
    const response = UrlFetchApp.fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children`,
      getNotionOptions(token, "patch", { children: [block] }),
    );
    parseNotionResponse(response, 200, "Notion system state create error");
  }

  return state;
}

function buildTrackerProperties(data) {
  const analysis = data.analysis || {};
  const properties = {
    "Date": { date: { start: new Date().toISOString().split("T")[0] } },
  };

  if (analysis.decision) properties["Decision"] = { select: { name: analysis.decision } };
  if (typeof analysis.atsScore === "number") {
    properties["ATS Score"] = { number: (Math.round(analysis.atsScore * 100) / 100) / 100 };
  }
  if (data.status) properties["Status"] = { select: { name: data.status } };
  if (data.resumeUrl) properties["Resume Link"] = { url: data.resumeUrl };
  return properties;
}

/**
 * Query Notion DB for an existing entry by Job ID.
 * Tracker fields remain in database properties; workflow state is in the page body.
 */
function findNotionEntry(jobId) {
  const token = PROPERTIES.getProperty("NOTION_API_KEY");
  const dbId = PROPERTIES.getProperty("NOTION_DB_ID");
  if (!token || !dbId) return null;

  const payload = {
    filter: {
      property: "Job ID",
      rich_text: { equals: jobId },
    },
    page_size: 1,
  };
  const response = UrlFetchApp.fetch(
    `https://api.notion.com/v1/databases/${dbId}/query`,
    getNotionOptions(token, "post", payload),
  );
  const data = parseNotionResponse(response, 200, "Notion query error");

  if (!data.results || !data.results.length) {
    Logger.log(`[INFO] No existing Notion entry for Job ID: ${jobId}`);
    return null;
  }

  const page = data.results[0];
  const stored = readNotionSystemState(page.id, token);
  const legacyState = getLegacySystemState(page.properties);
  const systemState = mergeSystemState(legacyState, stored.state);
  const resumeLink = page.properties["Resume Link"];

  Logger.log(`[INFO] Found existing Notion entry for Job ID: ${jobId}`);
  return {
    pageId: page.id,
    resumeUrl: (resumeLink && resumeLink.url) || null,
    recruiterEmail: getNotionRichTextValue(page.properties["Email"]) || (page.properties["Email"] && page.properties["Email"].email) || null,
    rubric: systemState.rubric || null,
    rubricVersion: systemState.rubricVersion || null,
    jdHash: systemState.jdHash || null,
    baselineScore: typeof systemState.baselineScore === "number" ? systemState.baselineScore : null,
    currentScore: typeof systemState.currentScore === "number" ? systemState.currentScore : null,
    tailoringTask: systemState.tailoringTask || null,
    draftFolderId: systemState.draftFolderId || null,
    draftDocumentId: systemState.draftDocumentId || null,
    systemState: hasSystemStateData(systemState) ? systemState : null,
    systemStateBlockId: stored.blockId,
    status: page.properties["Status"] && page.properties["Status"].select
      ? page.properties["Status"].select.name
      : null,
  };
}

function updateNotionPage(pageId, data, isRetry = false) {
  const token = PROPERTIES.getProperty("NOTION_API_KEY");
  if (!token) throw new Error("NOTION_API_KEY not set");

  const response = UrlFetchApp.fetch(
    `https://api.notion.com/v1/pages/${pageId}`,
    getNotionOptions(token, "patch", { properties: buildTrackerProperties(data) }),
  );

  if (response.getResponseCode() !== 200) {
    if (!isRetry) {
      Logger.log("[INFO] Notion tracker schema may be missing. Initializing and retrying.");
      initNotionDatabase(PROPERTIES.getProperty("NOTION_DB_ID"), token);
      return updateNotionPage(pageId, data, true);
    }
    throw new Error(`Notion update error (${response.getResponseCode()}): ${response.getContentText()}`);
  }

  writeNotionSystemState(pageId, data, token);
}

function saveToNotion(data, isRetry = false) {
  const token = PROPERTIES.getProperty("NOTION_API_KEY");
  const dbId = PROPERTIES.getProperty("NOTION_DB_ID");
  if (!token || !dbId) throw new Error("NOTION_API_KEY or NOTION_DB_ID not set");

  const analysis = data.analysis || {};
  const properties = Object.assign({
    "Name": { title: [{ text: { content: `${data.company || "Unknown"} - ${data.role || "Unknown"}` } }] },
    "Company": buildNotionRichTextProperty(data.company || "Unknown"),
    "Role": buildNotionRichTextProperty(data.role || "Unknown"),
    "Job Link": { url: data.jobUrl || null },
    "Job ID": buildNotionRichTextProperty(data.jobId || "Unknown"),
  }, buildTrackerProperties(data));

  if (!properties["Decision"]) {
    properties["Decision"] = { select: { name: analysis.decision || "MAYBE" } };
  }
  if (!properties["Status"]) {
    properties["Status"] = { select: { name: data.status || "To Review" } };
  }
  if (!properties["ATS Score"]) {
    properties["ATS Score"] = { number: (Math.round((analysis.atsScore || 0) * 100) / 100) / 100 };
  }

  const response = UrlFetchApp.fetch(
    CONFIG.NOTION_API_URL,
    getNotionOptions(token, "post", { parent: { database_id: dbId }, properties }),
  );

  if (response.getResponseCode() !== 200) {
    const responseData = JSON.parse(response.getContentText());
    if (responseData.code === "validation_error" && !isRetry) {
      Logger.log("[INFO] Validation error caught. Provisioning Notion tracker schema.");
      initNotionDatabase(dbId, token);
      return saveToNotion(data, true);
    }
    throw new Error(`Notion API error (${response.getResponseCode()}): ${response.getContentText()}`);
  }

  const page = JSON.parse(response.getContentText());
  writeNotionSystemState(page.id, data, token);
  return page.url;
}

/**
 * Keeps the Jobs database limited to tracker properties. Existing legacy columns
 * are removed only by migrateNotionTrackerState after all rows are backfilled.
 */
function initNotionDatabase(dbId, token) {
  const payload = {
    properties: {
      "Company": { rich_text: {} },
      "Role": { rich_text: {} },
      "Decision": { select: { options: [{ name: "APPLY", color: "green" }, { name: "MAYBE", color: "yellow" }, { name: "SKIP", color: "red" }] } },
      "ATS Score": { number: { format: "percent" } },
      "Job Link": { url: {} },
      "Job ID": { rich_text: {} },
      "Resume Link": { url: {} },
      "Status": { select: { options: [{ name: "Tailoring", color: "yellow" }, { name: "To Review", color: "gray" }, { name: "Applied", color: "blue" }, { name: "Interview", color: "purple" }, { name: "Rejected", color: "red" }] } },
      "Date": { date: {} },
    },
  };
  const response = UrlFetchApp.fetch(
    `https://api.notion.com/v1/databases/${dbId}`,
    getNotionOptions(token, "patch", payload),
  );
  parseNotionResponse(response, 200, "Notion tracker schema update error");
}

function getNotionDatabaseSchema(dbId, token) {
  const response = UrlFetchApp.fetch(
    `https://api.notion.com/v1/databases/${dbId}`,
    getNotionOptions(token, "get"),
  );
  return parseNotionResponse(response, 200, "Notion database schema read error");
}

function getAllNotionPages(dbId, token) {
  const pages = [];
  let cursor = null;
  do {
    const payload = { page_size: 100 };
    if (cursor) payload.start_cursor = cursor;
    const response = UrlFetchApp.fetch(
      `https://api.notion.com/v1/databases/${dbId}/query`,
      getNotionOptions(token, "post", payload),
    );
    const data = parseNotionResponse(response, 200, "Notion migration query error");
    pages.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return pages;
}

/**
 * One-time manual migration. It first backfills every legacy row into its page
 * body, then removes the obsolete schema fields only when the backfill succeeds.
 */
function migrateNotionTrackerState() {
  const token = PROPERTIES.getProperty("NOTION_API_KEY");
  const dbId = PROPERTIES.getProperty("NOTION_DB_ID");
  if (!token || !dbId) throw new Error("NOTION_API_KEY or NOTION_DB_ID not set");

  const pages = getAllNotionPages(dbId, token);
  let migrated = 0;

  for (const page of pages) {
    const stored = readNotionSystemState(page.id, token);
    const legacyState = getLegacySystemState(page.properties);
    if (!stored.state && legacyState) {
      writeNotionSystemState(page.id, { systemState: legacyState }, token);
      migrated += 1;
    }
  }

  const schema = getNotionDatabaseSchema(dbId, token);
  const removals = {};
  for (const name of LEGACY_NOTION_PROPERTIES) {
    if (schema.properties && schema.properties[name]) removals[name] = null;
  }

  if (Object.keys(removals).length) {
    const response = UrlFetchApp.fetch(
      `https://api.notion.com/v1/databases/${dbId}`,
      getNotionOptions(token, "patch", { properties: removals }),
    );
    parseNotionResponse(response, 200, "Notion legacy property removal error");
  }

  return { pages: pages.length, migrated, removedProperties: Object.keys(removals) };
}
