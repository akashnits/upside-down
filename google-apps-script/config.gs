// Configuration - Constants (safe to commit)
const CONFIG = {
  // API Endpoints
  MISTRAL_API_URL: "https://api.mistral.ai/v1/chat/completions",
  GITHUB_API_URL: "https://api.github.com/gists",
  
  // Model Settings
  MODELS: {
    KEYWORD_EXTRACTION: "mistral-small-latest",
    MAIN_ANALYSIS: "mistral-large-latest"
  },
  
  // Analysis Settings
  TEMPERATURE: {
    KEYWORD_EXTRACTION: 0,
    MAIN_ANALYSIS: 0.3
  },
  
  // Display Limits
  MAX_KEYWORDS_DISPLAY: 8,
  MAX_MARKDOWN_LENGTH: 4000
};

/**
 * Required Script Properties (set in Apps Script > Project Settings > Script Properties):
 * 
 * - MISTRAL_API_KEY   : Get from https://console.mistral.ai
 * - GITHUB_TOKEN      : GitHub PAT with 'gist' scope
 * - RESUME_DOC_ID     : Google Doc ID containing your resume
 * - SHEET_ID          : (Optional) Google Sheet ID for logging
 */
