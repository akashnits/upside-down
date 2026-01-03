# Upside Down - Resume Assistant

A Chrome Extension that analyzes LinkedIn job descriptions against your resume using AI.

## Installation

### 1. Deploy Google Apps Script

1. Open [Google Apps Script](https://script.google.com)
2. Create new project → Paste contents of `google-apps-script/Code.gs`
3. Go to **Project Settings** → **Script Properties** → Add:
   - `GEMINI_API_KEY` - Your Gemini API key
   - `GITHUB_TOKEN` - GitHub PAT with `gist` scope
   - `RESUME_DOC_ID` - Google Doc ID of your resume
   - `SHEET_ID` - (Optional) Google Sheet ID for logging
4. Click **Deploy** → **New Deployment** → **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the Web App URL

### 2. Update Extension

1. Open `extension/background.js`
2. Replace `GAS_URL` with your Web App URL from step 5

### 3. Load Extension in Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder

## Usage

1. Go to any LinkedIn job page
2. Click the floating **🔍 Analyze Job** button (bottom right)
3. Wait for AI analysis
4. Review the decision, rejection reasons, and fixes
5. Click **Save & Track** to create a Gist and log to Sheet

## Files

```
extension/
├── manifest.json   # Extension config
├── background.js   # Service worker (handles GAS fetch)
├── content.js      # Runs on LinkedIn (UI + scraping)
└── icon*.png       # Extension icons

google-apps-script/
└── Code.gs         # Backend (LLM, Gist, Sheet)
```
