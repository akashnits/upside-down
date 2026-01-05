// Configuration - Constants (safe to commit)
const CONFIG = {
  // --- 🎛️ Provider Selection ---
  // Options: "GEMINI" or "MISTRAL" (Both via OpenRouter)
  PROVIDER: "GEMINI", 

  // --- 🛠️ Provider Settings ---
  PROVIDERS: {
    GEMINI: {
      API_URL: "https://openrouter.ai/api/v1/chat/completions",
      API_KEY_PROP: "OPENROUTER_API_KEY", // Single key for everything
      MODELS: {
        KEYWORD_EXTRACTION: "google/gemini-2.5-flash",
        MAIN_ANALYSIS: "google/gemini-2.5-flash"
      }
    },
    MISTRAL: {
      API_URL: "https://openrouter.ai/api/v1/chat/completions",
      API_KEY_PROP: "OPENROUTER_API_KEY", // Single key for everything
      MODELS: {
        KEYWORD_EXTRACTION: "mistralai/devstral-2512:free",
        MAIN_ANALYSIS: "mistralai/devstral-2512:free"
      }
    }
  },

  // --- 🔗 Other APIs ---
  GITHUB_API_URL: "https://api.github.com/gists",
  
  // --- ⚙️ Global Settings ---
  TEMPERATURE: {
    KEYWORD_EXTRACTION: 0,
    MAIN_ANALYSIS: 0.3
  },
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
