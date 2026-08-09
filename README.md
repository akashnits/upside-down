# 🔮 Upside Down - AI Resume Copilot

Built for the modern job seeker. **Upside Down** is a high-performance Chrome Extension and Google Apps Script backend that transforms LinkedIn into a powerful career-hunting command center.

![License](https://img.shields.io/badge/license-MIT-6e56cf.svg)
![Version](https://img.shields.io/badge/version-2.0.0-6e56cf.svg)

---

## 🚀 Key Features

- 📊 **Deterministic ATS Engine** — Stable weighted keyword coverage with alias matching, stemming, section diagnostics, and a mini-taxonomy. No AI "guesses" in the score.
- 🤖 **Multi-LLM Analysis** — Powered by Gemini and Mistral via OpenRouter. Extracts keywords and generates deep insights in a single pass.
- 📓 **Notion Integration** — One-click export to your Job Tracking board. Automatically builds a rich Insight Card within your Notion database.
- 📝 **Agent-Skill Resume Tailoring** — A signed tailoring task keeps the resume rules, user-confirmed skills, Drive folder, ATS re-score, and Notion completion lifecycle consistent.

---

## 🏗️ Architecture

```mermaid
graph LR
    subgraph "Browser (LinkedIn)"
    EXT[Chrome Extension]
    EXT --> DOM[DOM Scraper]
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
    AGENT[Resume Tailor Skill]
    LLM --> OR
    MODS --> NOT
    EXT --> AGENT
    AGENT --> GAS
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
- **`atsEngine.js`**: The scoring brain (weighted coverage, alias matching, stemming, section diagnostics, and taxonomy).
- **`notion.js`**: Seamless connection to Notion's Block API.
- **`router.js`**: Central entry point for all endpoint requests.
- **`tailoring.js`**: Signed task claim, bounded patch lifecycle, verification, and deterministic re-scoring.

### Resume Tailoring Lifecycle

1. Analyze a job and confirm any uncertain skills in the extension.
2. Create prepares a signed task in Notion; it does not create a Drive document.
3. Paste the compact dispatch into an agent with the `resume-tailor` skill.
4. The skill claims the task and returns only a `summary`/`skills` patch. Its current editable content is read from the canonical Base Resume Google Doc at claim time.
5. The backend copies that Base Resume into `Akash CVs / <Company> / <Role>_<JobId>`, applies and verifies the bounded patch, re-scores it with the saved rubric, and updates Notion for review.

`RESUME_DOC_ID` is the only resume source of truth. The skill never stores or
renders a second copy of the resume data. `resume_builder.js` remains a local
formatting utility for deliberate Base Resume maintenance, not the tailoring runtime.

### Notion tracker model

The Jobs database is deliberately limited to scan-friendly tracker fields: company,
role, decision, status, job and resume links, current ATS score, date, and the
hidden Job ID used for lookup. Rubrics, task payloads, Drive IDs, baseline scores,
and other workflow metadata are stored in a collapsed `Upside Down system state`
toggle within the job page, not as database columns.

After deploying this change to an existing board, run
`migrateNotionTrackerState` once from the Apps Script editor. It backfills every
legacy row before removing the former internal columns.

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
