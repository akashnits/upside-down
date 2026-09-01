// Configuration - Constants (safe to commit)
const CONFIG = {
  // --- 🎛️ Provider Selection ---
  // Options: "GEMINI", "OPENAI", or "NVIDIA" (All via OpenRouter)
  PROVIDER: "OPENAI",

  // --- 🛠️ Provider Settings ---
  PROVIDERS: {
    OPENAI: {
      API_URL: "https://openrouter.ai/api/v1/chat/completions",
      API_KEY_PROP: "OPENROUTER_API_KEY",
      MODELS: {
        ANALYSIS: "openai/gpt-5.6-terra",
      },
    },
    GEMINI: {
      API_URL: "https://openrouter.ai/api/v1/chat/completions",
      API_KEY_PROP: "OPENROUTER_API_KEY",
      MODELS: {
        ANALYSIS: "google/gemini-2.0-flash-001",
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
 * - OPENROUTER_API_KEY : Get from https://openrouter.ai/keys
 * - GITHUB_TOKEN      : GitHub PAT with 'gist' scope
 * - RESUME_DOC_ID     : Canonical base-resume Google Doc ID. It is used for
 *                       analysis and copied when a tailored resume is created.
 * - CVS_ROOT_FOLDER_ID : Folder ID for 'Akash CVs'
 * - SHEET_ID          : (Optional) Google Sheet ID for logging
 *
 */
