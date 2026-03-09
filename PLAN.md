# Upside Down v2 — Implementation Plan

## Overview

Six phases to transform Upside Down from a single-job analyzer into a full job-hunting copilot. Each phase is independent and shippable — you get value after every phase, not just at the end.

---

## Phase 1: Collapse Two LLM Calls Into One

**Why:** Currently `extractKeywords()` makes one LLM call, then `analyzeJob()` makes another and passes the keywords back in. The second model is perfectly capable of extracting keywords itself. This halves latency (~3-5s saved) and halves API cost.

**What changes:**

- `Code.gs` — Delete the `extractKeywords()` function entirely
- `Code.gs` — Modify `analyzeJob()` to include keyword extraction in its prompt
- `Code.gs` — Update the JSON output schema to include `keywords: string[]` alongside `markdown`, `decision`, `confidence`, `effort`
- `Code.gs` — After parsing the LLM response, run `calculateATSScore()` using the LLM-extracted keywords (this keeps ATS scoring deterministic — the LLM extracts, but the matching is still code)
- `config.gs` — Remove `MODELS.KEYWORD_EXTRACTION` and `TEMPERATURE.KEYWORD_EXTRACTION` since there's only one call now

**Updated prompt structure (single call):**
```
You are an expert Career Coach and Recruiter.

JOB DESCRIPTION:
${jdText}

RESUME:
${resumeText}

Task: Analyze this job application.
Step 1: Extract all required skills, technologies, and qualifications as keywords.
Step 2: Use those keywords to evaluate resume fit.
Step 3: Provide actionable insights.

Output strict JSON:
{
  "keywords": ["Python", "AWS", ...],
  "markdown": "# Company — Role ...",
  "decision": "APPLY" | "MAYBE" | "SKIP",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "effort": "LOW" | "MEDIUM" | "HIGH"
}
```

**After LLM returns:**
```javascript
const llmResult = JSON.parse(response);
const ats = calculateATSScore(llmResult.keywords, resumeText); // Still deterministic
llmResult.atsScore = ats.score;
llmResult.atsMatched = ats.matched;
llmResult.atsMissing = ats.missing;
```

**The trick:** We still get deterministic ATS scoring (keyword matching in code), but we let the LLM do what it's good at (understanding that "5+ years of distributed systems experience" is a keyword). Best of both worlds, one API call.

**Risk:** The markdown insight card currently references the ATS score inline (e.g., `## ATS Score: 72%`). Since we calculate ATS *after* the LLM call now, the markdown won't have the real score baked in. Two options:
- Option A: Do a string replace on the markdown after: `markdown.replace(/ATS Score: \d+%/, \`ATS Score: ${ats.score}%\`)`
- Option B: Remove ATS from the markdown template and show it only in the modal's header bar (cleaner separation)

**Recommendation:** Option B. The modal already shows ATS in the header. Don't duplicate it.

**Files touched:** `Code.gs`, `config.gs`

---

## Phase 2: Embeddings-Based ATS Matching

**Why:** The hardcoded synonym map (~30 entries) misses semantic relationships like "distributed systems" ≈ "microservices" or "stakeholder management" ≈ "cross-functional collaboration". Embeddings handle this automatically with zero maintenance.

**How it works:**
1. Take each JD keyword (from Phase 1's LLM output): `["Kubernetes", "5+ years Python", "CI/CD"]`
2. Take resume text, split into meaningful chunks (skill phrases, not individual words)
3. Convert both to vectors using an embedding model
4. Compute cosine similarity between each JD keyword and each resume chunk
5. If max similarity > threshold (0.82-0.85), count as matched

**Which embedding model:**

OpenRouter now supports embeddings (as of late 2025). Since we're already using OpenRouter for chat completions, this is the path of least resistance:
- `openai/text-embedding-3-small` — $0.02/1M tokens, 1536 dimensions, fast. Best bang for buck.
- `qwen/qwen3-embedding-0.6b` — Cheaper, good for code/tech terms
- Can be called from GAS via `UrlFetchApp` the same way we call chat completions

**Alternative — Vertex AI directly from GAS:**
Google has a native `VertexAiService` advanced service for Apps Script. You could use `text-embedding-005` with zero additional API keys (uses your Google account's OAuth). But it requires enabling Vertex AI in a GCP project, which adds setup complexity.

**Recommendation:** Use OpenRouter `openai/text-embedding-3-small`. Same API key, same base URL, minimal code change.

**Implementation in `Code.gs`:**

```javascript
function getEmbeddings(texts) {
  const provider = getProviderConfig();
  const apiKey = PropertiesService.getScriptProperties()
    .getProperty(provider.API_KEY_PROP);

  const response = UrlFetchApp.fetch(provider.API_URL.replace('/chat/completions', '/embeddings'), {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/akashnits/upside-down'
    },
    payload: JSON.stringify({
      model: 'openai/text-embedding-3-small',
      input: texts
    })
  });

  const data = JSON.parse(response.getContentText());
  return data.data.map(d => d.embedding);
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

**Updated `calculateATSScore`:**
```javascript
function calculateATSScore(keywords, resumeText) {
  // Split resume into meaningful chunks (sentences or skill phrases)
  const resumeChunks = resumeText
    .split(/[.\n]/)
    .map(s => s.trim())
    .filter(s => s.length > 10);

  // Batch embed everything in 2 API calls (keywords + resume chunks)
  const keywordEmbeddings = getEmbeddings(keywords);
  const resumeEmbeddings = getEmbeddings(resumeChunks);

  const THRESHOLD = 0.82;
  const matched = [], missing = [];

  keywords.forEach((kw, i) => {
    const maxSim = Math.max(
      ...resumeEmbeddings.map(re => cosineSimilarity(keywordEmbeddings[i], re))
    );
    if (maxSim >= THRESHOLD) matched.push(kw);
    else missing.push(kw);
  });

  const score = keywords.length > 0
    ? Math.round((matched.length / keywords.length) * 100) : 0;
  return { score, matched, missing };
}
```

**Keep the old synonym-based matching as a fallback?** Yes, for the first release. If embeddings fail (rate limit, API error), fall back to the string-matching approach. Remove it once embeddings are proven stable.

**Performance note:** Two embedding API calls (~200ms each) replace nothing — they're *additional* to what we had before. But since we eliminated one LLM call in Phase 1, net latency is still lower than v1.

**Config addition (`config.gs`):**
```javascript
EMBEDDINGS: {
  MODEL: 'openai/text-embedding-3-small',
  SIMILARITY_THRESHOLD: 0.82
}
```

**Files touched:** `Code.gs`, `config.gs`

---

## Phase 3: LinkedIn Voyager Data Extraction

**Why:** The current DOM scraping uses 5+ CSS selector fallbacks per field and breaks whenever LinkedIn A/B tests their UI. LinkedIn embeds its Voyager API responses in hidden `<code>` blocks — these contain structured `JobPosting` entities with clean `title`, `description.text`, `skillsDescription` fields.

**What I verified on a live LinkedIn page:**
- LinkedIn embeds `<code id="bpr-guid-XXXXX">` blocks containing JSON with an `included` array
- Inside `included`, entities with `$type: "com.linkedin.voyager.dash.jobs.JobPosting"` have: `title` (string), `description` (object with `.text`), `skillsDescription`, `companyDetails`, `formattedLocation`
- This data is available on initial page load — no additional fetch needed

**Implementation — new `scrapeJob()` in content.js:**

```javascript
function scrapeJob() {
  // Strategy 1: Parse LinkedIn's embedded Voyager API data
  const voyagerData = extractFromVoyager();
  if (voyagerData && voyagerData.jobDescription) return voyagerData;

  // Strategy 2: Fallback to DOM scraping (current approach)
  return extractFromDOM();
}

function extractFromVoyager() {
  try {
    const codeBlocks = document.querySelectorAll('code');
    for (const code of codeBlocks) {
      let parsed;
      try { parsed = JSON.parse(code.textContent); } catch { continue; }

      if (!parsed.included || !Array.isArray(parsed.included)) continue;

      const jobEntity = parsed.included.find(e =>
        e['$type']?.includes('JobPosting') && e.title && e.description
      );

      if (!jobEntity) continue;

      // Find company name from related entity
      let companyName = 'Unknown Company';
      if (jobEntity.companyDetails) {
        const companyUrn = jobEntity.companyDetails['*companyResolutionResult']
          || jobEntity.companyDetails;
        const companyEntity = parsed.included.find(e =>
          e.entityUrn === companyUrn && e.name
        );
        if (companyEntity) companyName = companyEntity.name;
      }

      return {
        role: jobEntity.title,
        company: companyName,
        jobDescription: jobEntity.description?.text || '',
        jobUrl: window.location.href,
        source: 'voyager' // Track which strategy worked
      };
    }
  } catch (e) {
    console.warn('[Upside Down] Voyager extraction failed:', e);
  }
  return null;
}

function extractFromDOM() {
  // ... existing getText() + selector arrays (unchanged)
  return { role, company, jobDescription, jobUrl, source: 'dom' };
}
```

**Why keep DOM fallback:** Voyager data structure could change. LinkedIn could stop embedding it. The DOM approach is ugly but battle-tested. Belt and suspenders.

**Files touched:** `content.js` (or new `scraper.js` after Phase 4 refactor)

---

## Phase 4: Refactor content.js + Non-Blocking Modal + Button Debounce

**Why:** `content.js` is 328 lines mixing three concerns: DOM scraping, UI rendering, and orchestration. The modal is a full-screen overlay that blocks interaction with LinkedIn. The analyze button has no debounce protection.

### 4a. File Split

Split `content.js` into three files:

```
extension/
├── scraper.js    — extractFromVoyager() + extractFromDOM() + scrapeJob()
├── ui.js         — createModal(), all modal states, formatMarkdown()
├── main.js       — Click handler, orchestration, message passing
├── background.js — Unchanged
├── config.js     — Unchanged
└── manifest.json — Updated content_scripts to load all 3 files
```

**manifest.json update:**
```json
"content_scripts": [{
  "matches": ["https://www.linkedin.com/jobs/*"],
  "js": ["scraper.js", "ui.js", "main.js"]
}]
```

### 4b. Non-Blocking Modal (Slide-In Panel)

Instead of a centered overlay with a backdrop that blocks clicks, use a right-side slide-in panel:

```javascript
// In ui.js — replace the overlay approach
function createModal() {
  const panel = document.createElement('div');
  panel.id = 'upside-down-panel';
  panel.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    width: 420px;
    height: 100vh;
    background: white;
    z-index: 10001;
    box-shadow: -4px 0 20px rgba(0,0,0,0.15);
    overflow-y: auto;
    transform: translateX(100%);
    transition: transform 0.3s ease;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  `;

  document.body.appendChild(panel);

  // Slide in
  requestAnimationFrame(() => {
    panel.style.transform = 'translateX(0)';
  });

  // ... rest of modal logic, adapted for panel layout
}
```

**Key difference from side panel API:** This is NOT the Chrome Side Panel API (which you said you didn't want). This is just a CSS-positioned div that slides in from the right edge. The user can still scroll LinkedIn, click links, open other jobs — the panel just sits on the right side. They can drag it, minimize it, or close it. Similar to how LinkedIn's own messaging panel works.

### 4c. Button Debounce

```javascript
// In main.js
let isAnalyzing = false;

btn.onclick = () => {
  if (isAnalyzing) return;
  isAnalyzing = true;
  btn.style.opacity = '0.5';
  btn.style.pointerEvents = 'none';

  // ... analysis logic ...

  // Re-enable after response (success or error)
  const resetButton = () => {
    isAnalyzing = false;
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
  };
};
```

**Files touched:** `content.js` → split into `scraper.js`, `ui.js`, `main.js`. `manifest.json` updated.

---

## Phase 5: Notion Integration (Replace Google Sheets + GitHub Gists)

**Why:** Google Sheets is a flat table with no pipeline view. Gists are developer-friendly but clunky for tracking application status. Notion gives you Kanban boards, filters, calendar views, and the insight card lives *inside* the page (no external link needed).

**Notion free plan:** Unlimited pages, unlimited blocks, unlimited API calls for personal use. The only limits are 5MB file uploads and 10 guests — neither matters here. Rate limit is 3 requests/second, which is plenty.

**Setup (one-time):**
1. Create a Notion integration at https://www.notion.so/my-integrations
2. Create a database in Notion with these properties:
   - `Company` (Title)
   - `Role` (Rich text)
   - `Decision` (Select: APPLY / MAYBE / SKIP)
   - `Confidence` (Select: HIGH / MEDIUM / LOW)
   - `Effort` (Select: LOW / MEDIUM / HIGH)
   - `ATS Score` (Number)
   - `Status` (Select: Analyzed / Applied / Interview / Offer / Rejected)
   - `Job URL` (URL)
   - `Analyzed On` (Date)
3. Share the database with the integration
4. Add `NOTION_TOKEN` and `NOTION_DB_ID` to GAS Script Properties

**Replace `createGist()` + `logToSheet()` with `saveToNotion()`:**

```javascript
function saveToNotion(data) {
  const token = PROPERTIES.getProperty('NOTION_TOKEN');
  const dbId = PROPERTIES.getProperty('NOTION_DB_ID');
  if (!token || !dbId) throw new Error('NOTION_TOKEN or NOTION_DB_ID not set');

  const payload = {
    parent: { database_id: dbId },
    properties: {
      'Company': { title: [{ text: { content: data.company } }] },
      'Role': { rich_text: [{ text: { content: data.role } }] },
      'Decision': { select: { name: data.decision } },
      'Confidence': { select: { name: data.confidence } },
      'Effort': { select: { name: data.effort } },
      'ATS Score': { number: data.atsScore || 0 },
      'Status': { select: { name: 'Analyzed' } },
      'Job URL': { url: data.jobUrl },
      'Analyzed On': { date: { start: new Date().toISOString().split('T')[0] } }
    },
    // The insight card goes in the page BODY, not as a property
    children: markdownToNotionBlocks(data.markdown)
  };

  const response = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28'
    },
    payload: JSON.stringify(payload)
  });

  const result = JSON.parse(response.getContentText());
  return result.url; // Notion page URL (replaces Gist URL)
}
```

**The `markdownToNotionBlocks()` helper** converts the insight card markdown into Notion block objects (headings, paragraphs, bulleted lists, checkboxes). This is ~40 lines of parsing code. Notion's block API is well-documented for this.

**What gets removed:**
- `createGist()` function entirely
- `logToSheet()` function entirely
- `GITHUB_TOKEN` script property (no longer needed)
- `SHEET_ID` script property (no longer needed)
- `GITHUB_API_URL` from config

**What the user sees:** Instead of a Gist link, the "Save & Track" button now opens the Notion page directly. The insight card is embedded in the page body. The user can immediately update the Status to "Applied" from within Notion.

**Migration:** Keep `logToSheet()` as an optional fallback (controlled by a `USE_NOTION` script property) so existing users aren't broken.

**Files touched:** `Code.gs`, `config.gs`, `content.js` (update success modal to show Notion link)

---

## Phase 6: Apply Copilot — Tailored Resume Generation

**Why:** This is the highest-value feature. Right now the tool says "add these missing keywords." The user then has to manually rewrite their resume. We should generate the tailored resume for them.

**Two approaches — pick one:**

### Approach A: Built into GAS (self-contained, one-click)

The GAS backend already has access to the user's resume (Google Doc) and the full analysis. Add a third action: `generate`.

**Flow:**
1. User clicks "Generate Tailored Resume" button in the modal (appears after analysis)
2. Extension sends `{ action: "generate", analysis, company, role }` to GAS
3. GAS copies the original Google Doc → new doc titled `Resume_[Company]_[Role]`
4. GAS calls the LLM with the original resume + missing keywords + JD → gets back a rewritten resume text
5. GAS uses the Docs API to replace the content in the copied doc while preserving formatting
6. Returns the new Google Doc URL to the extension

**Implementation in Code.gs:**

```javascript
if (action === "generate") {
  const resumeDocId = PROPERTIES.getProperty('RESUME_DOC_ID');
  const originalDoc = DocumentApp.openById(resumeDocId);

  // 1. Copy the doc (preserves all formatting)
  const copy = DriveApp.getFileById(resumeDocId)
    .makeCopy(`Resume_${data.company}_${data.role}`);
  const newDoc = DocumentApp.openById(copy.getId());

  // 2. Generate tailored content via LLM
  const tailoredContent = generateTailoredResume(
    originalDoc.getBody().getText(),
    data.analysis,
    data.company,
    data.role
  );

  // 3. Replace summary section in the copied doc
  // (Uses DocumentApp's findText + replaceText for surgical edits)
  const body = newDoc.getBody();
  // Replace the professional summary paragraph
  // Insert missing keywords into relevant bullet points

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    docUrl: `https://docs.google.com/document/d/${copy.getId()}/edit`
  })).setMimeType(ContentService.MimeType.JSON);
}
```

**The LLM prompt for resume tailoring:**
```
You are a professional resume writer.

ORIGINAL RESUME:
${resumeText}

JOB DESCRIPTION KEYWORDS MISSING FROM RESUME:
${analysis.atsMissing.join(', ')}

SUGGESTED SUMMARY (from prior analysis):
${analysis.markdown.match(/## Suggested Resume Summary\n\*(.*?)\*/s)?.[1]}

Task: Rewrite ONLY these sections of the resume to incorporate missing keywords:
1. Professional Summary (rewrite to include missing keywords naturally)
2. Up to 3 bullet points that could be enhanced (add missing tech/skills contextually)

Output JSON:
{
  "summary": "New professional summary...",
  "enhancedBullets": [
    { "original": "Led team of 5...", "revised": "Led cross-functional team of 5 using Agile/Scrum..." }
  ]
}

Rules:
- Do NOT fabricate experience. Only reframe existing experience to highlight relevant skills.
- Keep the same tone and voice as the original resume.
- Every missing keyword you add must be truthfully supported by existing experience.
```

**Pros:** One-click, stays in Google ecosystem, preserves exact formatting of original doc.
**Cons:** Google Docs API for fine-grained formatting edits is painful. Best for replacing text sections, not restructuring layout.

### Approach B: Cowork as Resume Copilot (better output quality)

Instead of building generation into GAS, use Cowork's document generation capabilities which you've already validated produce near-identical formatting.

**Flow:**
1. User clicks "Generate Tailored Resume" in the modal
2. Extension opens a new tab with a pre-built prompt URL or copies a prompt to clipboard
3. The prompt includes: base resume content + JD + missing keywords + suggested summary
4. User pastes into Cowork → Cowork generates the `.docx`

**To make this seamless, create a Cowork skill:**

Save a skill file at `~/.claude/skills/resume-tailor/SKILL.md`:
```markdown
---
name: resume-tailor
description: Generate a tailored resume for a specific job application
---

# Resume Tailoring Skill

Given a base resume and job description analysis, generate a tailored .docx resume.

## Input (provided by user):
- Base resume (file or text)
- Job description or missing keywords
- Company and role name

## Process:
1. Read the docx skill for formatting best practices
2. Analyze which sections of the resume to modify
3. Rewrite professional summary incorporating missing keywords
4. Enhance 3-5 bullet points to reflect JD requirements
5. Do NOT fabricate experience — only reframe existing experience
6. Output as .docx with identical formatting to the original

## Output:
A .docx file named Resume_[Company]_[Role].docx
```

**Pros:** Better formatting, Cowork handles .docx creation natively, user can iterate in conversation.
**Cons:** Requires context switch (extension → Cowork), not fully automated.

### Recommendation

**Start with Approach A** (built into GAS) for the "happy path" — it's one-click and stays in the extension workflow. The LLM generates the text changes, and GAS applies them to a copy of the Google Doc using `findText`/`replaceText`. It won't handle complex formatting changes, but for swapping a summary paragraph and enhancing bullet points, it's sufficient.

**Use Approach B** (Cowork skill) as the "power user" option for when someone wants a full resume overhaul, not just keyword optimization. Add both buttons: "Quick Tailor (Google Doc)" and "Full Rewrite (Cowork)".

**Files touched:** `Code.gs` (new `generate` action), `content.js`/`ui.js` (new button in modal), optionally a Cowork skill file.

---

## Execution Order

```
Phase 1 (Quick Win)     → Collapse LLM calls      ~1 hour
Phase 4 (Refactor)      → Split content.js         ~2 hours
Phase 3 (Stability)     → Voyager extraction        ~1 hour (builds on Phase 4's scraper.js)
Phase 2 (Intelligence)  → Embeddings ATS            ~2 hours
Phase 5 (Tracking)      → Notion integration        ~3 hours
Phase 6 (Big Feature)   → Resume generation         ~4 hours
```

**Total estimate: ~13 hours of focused work.**

Phase 1 should be done first (it's the simplest win). Phase 4 before Phase 3 (because Phase 3 creates the scraper.js file that Phase 4 defines). Phase 6 last because it's the most complex and benefits from all prior phases being stable.
