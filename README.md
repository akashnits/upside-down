# 🔮 Upside Down - AI Resume Copilot

Built for the modern job seeker. **Upside Down** is a high-performance Chrome Extension and Google Apps Script backend that transforms LinkedIn into a powerful career-hunting command center.

![License](https://img.shields.io/badge/license-MIT-6e56cf.svg)
![Version](https://img.shields.io/badge/version-2.0.0-6e56cf.svg)

---

## 🚀 Key Features

- 📊 **Deterministic ATS Engine** — Real-time scoring using **BM25**, stemming, section weighting, and a mini-taxonomy. No AI "guesses," just pure data.
- 🤖 **Multi-LLM Analysis** — Powered by Gemini and Mistral via OpenRouter. Extracts keywords and generates deep insights in a single pass.
- 📓 **Notion Integration** — One-click export to your Job Tracking board. Automatically builds a rich Insight Card within your Notion database.
- 📝 **Resume Tailoring (Cowork)** — Deep integration with the **Cowork** ecosystem for precision resume editing using `resume_builder.js` schemas.
- 🔍 **Voyager Scraping** — High-stability job extraction that taps into LinkedIn's internal data APIs.

---

## 🏗️ Architecture

```mermaid
graph LR
    subgraph "Browser (LinkedIn)"
    EXT[Chrome Extension]
    EXT --> SC[Voyager Scraper]
    EXT --> MOD[Side Panel UI]
    end

    subgraph "Backend (Google Apps Script)"
    GAS[GAS Router]
    ATS[ATS Engine]
    LLM[LLM Analysis]
    MODS[Integrations]
    GAS --> LLM
    GAS --> ATS
    GAS --> MODS
    end

    subgraph "External Ecosystem"
    OR[OpenRouter]
    NOT[Notion DB]
    COW[Cowork Generator]
    LLM --> OR
    MODS --> NOT
    MODS --> COW
    end
```

---

## 🛠️ Components

### 🖥️ Chrome Extension

Modern, non-blocking UI that slides into your job hunt.

- **Scraper**: Reliable extraction using `scraper.js`.
- **Logic**: Modularized into `main.js`, `prompt.js`, and `ui.js`.
- **Styles**: Premium visuals in `styles.js`.

### ☁️ Google Apps Script (Backend)

High-concurrency, modularized GAS environment managed via `clasp`.

- **`analysis.js`**: LLM orchestration and keyword extraction.
- **`atsEngine.js`**: The scoring brain (BM25, stemming, taxonomy).
- **`notion.js`**: Seamless connection to Notion's Block API.
- **`router.js`**: Central entry point for all endpoint requests.

---

## ⚙️ Setup & Deployment

1.  **Backend**: Navigate to `google-apps-script/` and run `clasp push`.
2.  **Config**: Set your `OPENROUTER_API_KEY` and `NOTION_TOKEN` in GAS Script Properties.
3.  **Extension**: Load the `extension/` folder as an unpacked extension in Developer Mode.

> 💡 **Pro-Tip**: Use the `deploy-gas` skill for one-click updates to the backend.

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.

---

_“Turning the job hunt right-side up.”_
