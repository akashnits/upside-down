# 🔮 Upside Down - Resume Assistant

A Chrome Extension that analyzes LinkedIn job descriptions against your resume using AI, providing actionable insights and ATS score optimization.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

- 📊 **ATS Score Calculation** - Real keyword matching (not AI guesses)
- 📝 **Tailored Resume Summary** - AI-generated summary to boost ATS score
- 🚫 **Rejection Reasons** - What might cause a recruiter to pass
- ✅ **High-ROI Fixes** - Actionable checklist before applying
- 💾 **Save & Track** - Export analysis to GitHub Gist + Google Sheets

> 📖 **[Detailed Setup Instructions →](instructions.md)**

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Chrome Ext     │────▶│   Google Apps   │────▶│   Mistral AI    │
│  (LinkedIn)     │     │   Script        │     │   (Analysis)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │  GitHub Gists   │
                        │  Google Sheets  │
                        └─────────────────┘
```

## Setup

### 1. Google Apps Script

1. Go to [script.google.com](https://script.google.com) → New Project
2. Copy contents of `google-apps-script/Code.gs` and `config.gs`
3. Set Script Properties (Project Settings → Script Properties):
   - `MISTRAL_API_KEY` - Get from [console.mistral.ai](https://console.mistral.ai)
   - `GITHUB_TOKEN` - GitHub PAT with `gist` scope
   - `RESUME_DOC_ID` - Your Google Doc ID
   - `SHEET_ID` - (Optional) Google Sheet ID for logging
4. Deploy → New deployment → Web app → Anyone → Deploy
5. Copy the Web App URL

### 2. Chrome Extension

1. Copy `extension/config.example.js` → `extension/config.js`
2. Update `GAS_URL` with your deployed Apps Script URL
3. Go to `chrome://extensions` → Enable Developer Mode
4. Click "Load unpacked" → Select the `extension` folder

## Usage

1. Navigate to any LinkedIn job page
2. Click the purple **🔍 Analyze Job** button (top-right)
3. Wait for AI analysis (~10 seconds)
4. Review insights and click **💾 Save & Track** to export

## Configuration

### config.gs (Google Apps Script)
```javascript
const CONFIG = {
  MISTRAL_API_URL: "https://api.mistral.ai/v1/chat/completions",
  MODELS: {
    KEYWORD_EXTRACTION: "mistral-small-latest",
    MAIN_ANALYSIS: "mistral-large-latest"
  }
};
```

### config.js (Extension)
```javascript
const CONFIG = {
  GAS_URL: "YOUR_DEPLOYED_APPS_SCRIPT_URL"
};
```

## Rate Limits

Using Mistral AI free tier:
- **500,000 tokens/minute**
- **1 billion tokens/month**

This is virtually unlimited for normal usage.

## License

MIT
