// integrations.js — External service integrations (GitHub Gist, Google Sheets)
// Functions: createGist, logToSheet

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
  const sheetId = PROPERTIES.getProperty("SHEET_ID");
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
