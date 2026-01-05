// Configuration - Constants (safe to commit)
const CONFIG = {
  // API Endpoints
  OPENROUTER_API_URL: "https://openrouter.ai/api/v1/chat/completions",
  GITHUB_API_URL: "https://api.github.com/gists",
  
  // Model Settings (via OpenRouter)
  MODELS: {
    KEYWORD_EXTRACTION: "google/gemini-2.5-flash", // Very fast
    MAIN_ANALYSIS: "google/gemini-2.5-flash"      // Balanced speed/quality
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
 * - OPENROUTER_API_KEY: Get from https://openrouter.ai/keys
 * - GITHUB_TOKEN      : GitHub PAT with 'gist' scope
 * - RESUME_DOC_ID     : Google Doc ID containing your resume
 * - SHEET_ID          : (Optional) Google Sheet ID for logging
 */
