// Configuration - Constants (safe to commit)
const CONFIG = {
  CVS_ROOT_FOLDER_ID: "18fYuakVsUgXpKsqAFcJfCy8Ns4DVSSTY",
  // --- 🎛️ Provider Selection ---
  // Options: "GEMINI" or "MISTRAL" (Both via OpenRouter)
  PROVIDER: "GEMINI",

  // --- 🛠️ Provider Settings ---
  PROVIDERS: {
    GEMINI: {
      API_URL: "https://openrouter.ai/api/v1/chat/completions",
      API_KEY_PROP: "OPENROUTER_API_KEY",
      MODELS: {
        ANALYSIS: "google/gemini-2.5-flash",
      },
    },
    NVIDIA: {
      API_URL: "https://openrouter.ai/api/v1/chat/completions",
      API_KEY_PROP: "OPENROUTER_API_KEY",
      MODELS: {
        ANALYSIS: "nvidia/nemotron-3-nano-30b-a3b:free",
      },
    },
  },

  // --- 🔗 Other APIs ---
  NOTION_API_URL: "https://api.notion.com/v1/pages",
  NOTION_VERSION: "2022-06-28",
  GITHUB_API_URL: "https://api.github.com/gists",

  // --- ⚙️ Global Settings ---
  TEMPERATURE: {
    ANALYSIS: 0.3,
  },
  MAX_KEYWORDS_DISPLAY: 8,
  MAX_MARKDOWN_LENGTH: 4000,
};

/**
 * Required Script Properties (set in Apps Script > Project Settings > Script Properties):
 *
 * - OPENROUTER_API_KEY: Get from https://openrouter.ai/keys
 * - GITHUB_TOKEN      : GitHub PAT with 'gist' scope
 * - RESUME_DOC_ID     : Google Doc ID containing your resume
 * - SHEET_ID          : (Optional) Google Sheet ID for logging
 */
