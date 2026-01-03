const PROPERTIES = PropertiesService.getScriptProperties();

/**
 * Main Entry Point: Receives POST request from Bookmarklet
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action || "analyze"; // Default to analyze 
    
    Logger.log(`[START] Action: ${action} for ${data.role} at ${data.company}`);

    // --- ACTION: ANALYZE ---
    if (action === "analyze") {
        const jobDescription = data.jobDescription;
        
        // 1. Fetch Resume
        const resumeText = getResumeContent();
        Logger.log(`[INFO] Resume fetched. Length: ${resumeText.length} chars`);

        // 2. Analyze
        const analysis = analyzeJob(jobDescription, resumeText);
        Logger.log(`[INFO] Analysis complete. Decision: ${analysis.decision}`);

        return ContentService.createTextOutput(JSON.stringify({ 
            success: true, 
            analysis: analysis 
        })).setMimeType(ContentService.MimeType.JSON);
    }

    // --- ACTION: SAVE ---
    if (action === "save") {
        // Expects: data.analysis (object), data.company, data.role, data.jobUrl
        const analysis = data.analysis;
        
        // 3. Create Gist   
        const gistUrl = createGist(analysis.markdown, data.company, data.role);
        Logger.log(`[INFO] Gist created: ${gistUrl}`);
        
        // 4. Log to Sheet
        logToSheet({
            company: data.company,
            role: data.role,
            decision: analysis.decision,
            confidence: analysis.confidence,
            effort: analysis.effort,
            gistUrl: gistUrl,
            jobUrl: data.jobUrl
        });
        Logger.log(`[SUCCESS] Logged to sheet`);

        return ContentService.createTextOutput(JSON.stringify({ 
            success: true, 
            gistUrl: gistUrl 
        })).setMimeType(ContentService.MimeType.JSON);
    }

  } catch (err) {
    Logger.log(`[ERROR] ${err.toString()}`);
    return ContentService.createTextOutput(JSON.stringify({ 
      success: false, 
      error: err.toString() 
    }))
    .setMimeType(ContentService.MimeType.JSON);
  }
}


/**
 * Helper to fetch Resume Text from Google Doc
 */
function getResumeContent() {
  const docId = PROPERTIES.getProperty("RESUME_DOC_ID");
  if (!docId) throw new Error("RESUME_DOC_ID not set in Script Properties");
  return DocumentApp.openById(docId).getBody().getText();
}


/**
 * Extract keywords from job description using LLM
 */
function extractKeywords(jdText, apiKey) {
  const prompt = `Extract the required skills, technologies, and qualifications from this job description.
Return ONLY a JSON array of keywords/phrases. Example: ["Python", "AWS", "5+ years experience", "Machine Learning"]

JOB DESCRIPTION:
${jdText}`;

  const payload = {
    model: CONFIG.MODELS.KEYWORD_EXTRACTION,
    messages: [
      { role: "system", content: "Extract keywords. Return only a JSON object with a 'keywords' array, nothing else." },
      { role: "user", content: prompt }
    ],
    temperature: CONFIG.TEMPERATURE.KEYWORD_EXTRACTION,
    response_format: { type: "json_object" }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { "Authorization": `Bearer ${apiKey}` },
    payload: JSON.stringify(payload)
  };

  const response = UrlFetchApp.fetch(CONFIG.MISTRAL_API_URL, options);
  const data = JSON.parse(response.getContentText());
  let jsonText = data.choices[0].message.content;
  
  // Clean markdown code blocks if present
  jsonText = jsonText.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  
  try {
    const result = JSON.parse(jsonText);
    // Handle both {"keywords": [...]} and direct [...] format
    return Array.isArray(result) ? result : (result.keywords || result.skills || Object.values(result)[0] || []);
  } catch (e) {
    Logger.log(`[ERROR] Failed to parse keywords JSON: ${jsonText}`);
    return [];
  }
}


/**
 * Calculate ATS score by matching keywords against resume
 */
function calculateATSScore(keywords, resumeText) {
  const resumeLower = resumeText.toLowerCase();
  const matched = [];
  const missing = [];

  // Common abbreviation mappings (bidirectional)
  const synonyms = {
    'javascript': ['js', 'javascript', 'ecmascript'],
    'typescript': ['ts', 'typescript'],
    'python': ['python', 'py'],
    'machine learning': ['ml', 'machine learning', 'machinelearning'],
    'artificial intelligence': ['ai', 'artificial intelligence'],
    'natural language processing': ['nlp', 'natural language processing'],
    'amazon web services': ['aws', 'amazon web services'],
    'google cloud platform': ['gcp', 'google cloud platform', 'google cloud'],
    'microsoft azure': ['azure', 'microsoft azure'],
    'kubernetes': ['k8s', 'kubernetes'],
    'postgresql': ['postgres', 'postgresql', 'psql'],
    'mongodb': ['mongo', 'mongodb'],
    'react.js': ['react', 'reactjs', 'react.js'],
    'node.js': ['node', 'nodejs', 'node.js'],
    'vue.js': ['vue', 'vuejs', 'vue.js'],
    'angular': ['angular', 'angularjs'],
    'next.js': ['next', 'nextjs', 'next.js'],
    'graphql': ['graphql', 'gql'],
    'rest api': ['rest', 'restful', 'rest api', 'restful api'],
    'ci/cd': ['ci/cd', 'cicd', 'continuous integration', 'continuous deployment'],
    'docker': ['docker', 'containerization'],
    'terraform': ['terraform', 'iac', 'infrastructure as code'],
    'agile': ['agile', 'scrum', 'kanban'],
    'user experience': ['ux', 'user experience'],
    'user interface': ['ui', 'user interface'],
    'software development': ['software engineering', 'software development', 'swe'],
    'bachelor': ['bachelor', 'bachelors', "bachelor's", 'bs', 'b.s.', 'bsc'],
    'master': ['master', 'masters', "master's", 'ms', 'm.s.', 'msc'],
  };

  // Build reverse lookup: abbreviation -> all synonyms
  const expandedSynonyms = {};
  Object.values(synonyms).forEach(group => {
    group.forEach(term => {
      expandedSynonyms[term] = group;
    });
  });

  keywords.forEach(keyword => {
    const keywordLower = keyword.toLowerCase();
    
    // Get all possible variations to search for
    let variations = [
      keywordLower,
      keywordLower.replace(/\./g, ''),      // React.js -> Reactjs
      keywordLower.replace(/\.js$/i, ''),   // Node.js -> Node
      keywordLower.replace(/js$/i, ''),     // ReactJS -> React
    ];
    
    // Add synonym variations
    if (expandedSynonyms[keywordLower]) {
      variations = variations.concat(expandedSynonyms[keywordLower]);
    }
    
    // Also check if any synonym group contains this keyword
    Object.values(synonyms).forEach(group => {
      if (group.some(syn => keywordLower.includes(syn) || syn.includes(keywordLower))) {
        variations = variations.concat(group);
      }
    });
    
    // Remove duplicates
    variations = [...new Set(variations)];
    
    const found = variations.some(v => resumeLower.includes(v));
    if (found) {
      matched.push(keyword);
    } else {
      missing.push(keyword);
    }
  });

  const score = keywords.length > 0 ? Math.round((matched.length / keywords.length) * 100) : 0;
  
  return { score, matched, missing };
}


/**
 * Call Mistral API to analyze Job vs Resume
 * Get API key from https://console.mistral.ai
 */
function analyzeJob(jdText, resumeText) {
  const apiKey = PROPERTIES.getProperty("MISTRAL_API_KEY");
  if (!apiKey) throw new Error("MISTRAL_API_KEY not set in Script Properties");

  // Step 1: Extract keywords and calculate real ATS score
  const keywords = extractKeywords(jdText, apiKey);
  const ats = calculateATSScore(keywords, resumeText);
  Logger.log(`[ATS] Score: ${ats.score}% (${ats.matched.length}/${keywords.length} keywords)`);

  // Step 2: Main analysis with real ATS data
  const prompt = `You are an expert Career Coach and Recruiter.
  
JOB DESCRIPTION:
${jdText}

RESUME:
${resumeText}

ATS ANALYSIS (already calculated):
- Score: ${ats.score}%
- Matched keywords: ${ats.matched.join(', ') || 'None'}
- Missing keywords: ${ats.missing.join(', ') || 'None'}

Task: Analyze this job application. 
Output strict JSON in this format:
{
  "markdown": "# Company - Role ... (The full Insight Card markdown)",
  "decision": "APPLY" | "MAYBE" | "SKIP",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "effort": "LOW" | "MEDIUM" | "HIGH"
}

The Markdown Insight Card MUST follow this structure EXACTLY (DO NOT include Decision/Confidence/Effort - those are shown separately):

# Company — Role

## 📝 Suggested Resume Summary
*[Write a 3-4 sentence professional summary that includes the MISSING keywords from the ATS analysis above. This should naturally incorporate those missing terms to boost ATS score when the candidate adds this to their resume.]*

---

## 📄 ATS Score: ${ats.score}%

**Matched (${ats.matched.length}):** ${ats.matched.slice(0, 8).join(', ') || 'None'}

**Missing (${ats.missing.length}):** ${ats.missing.slice(0, 8).join(', ') || 'None'}

---

## �🚫 Likely Rejection Reasons
*(What may cause a recruiter to pass in the first scan)*

- [Reason 1]
- [Reason 2]
- [Reason 3]

---

## ✅ High-ROI Fixes (Checklist)
*(Do these before applying)*

- [ ] [Actionable fix 1]
- [ ] [Actionable fix 2]

---

## 💪 Strong Signals (Do NOT weaken these)

- [Signal 1]
- [Signal 2]

---

## 📌 Job Context

- **Company:** [Company Name]
- **Role:** [Role Name]
- **Analyzed On:** [Today's Date]`;

  const url = CONFIG.MISTRAL_API_URL;
  const payload = {
    model: CONFIG.MODELS.MAIN_ANALYSIS,
    messages: [
      { role: "system", content: "You are a career coach. Always respond with valid JSON only, no markdown code blocks." },
      { role: "user", content: prompt }
    ],
    temperature: CONFIG.TEMPERATURE.MAIN_ANALYSIS,
    response_format: { type: "json_object" }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { "Authorization": `Bearer ${apiKey}` },
    payload: JSON.stringify(payload)
  };

  const response = UrlFetchApp.fetch(url, options);
  const data = JSON.parse(response.getContentText());
  let jsonString = data.choices[0].message.content;
  
  // Clean markdown code blocks if present
  jsonString = jsonString.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  
  let analysis;
  try {
    analysis = JSON.parse(jsonString);
  } catch (e) {
    Logger.log(`[ERROR] Failed to parse analysis JSON: ${jsonString.substring(0, 500)}`);
    throw new Error('Failed to parse AI response as JSON');
  }
  
  // Add ATS data to response
  analysis.atsScore = ats.score;
  analysis.atsMatched = ats.matched;
  analysis.atsMissing = ats.missing;
  
  return analysis;
}


/**
 * Create a Private GitHub Gist
 */
function createGist(markdownContent, company, role) {
  const token = PROPERTIES.getProperty("GITHUB_TOKEN");
  if (!token) throw new Error("GITHUB_TOKEN not set");

  const filename = `${company}_${role}_Insight.md`.replace(/[^a-z0-9]/gi, '_');
  
  const payload = {
    description: `Upside-Down Insight: ${role} at ${company}`,
    public: false,
    files: {
      [filename]: {
        content: markdownContent
      }
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${token}` },
    payload: JSON.stringify(payload)
  };

  const response = UrlFetchApp.fetch(CONFIG.GITHUB_API_URL, options);
  const data = JSON.parse(response.getContentText());
  return data.html_url;
}


/**
 * Append row to Google Sheet
 */
function logToSheet(data) {
  const sheetId = PROPERTIES.getProperty("SHEET_ID"); // Or use ActiveSpreadsheet if container-bound
  let sheet;
  
  if (sheetId) {
    sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
  } else {
    // Fallback: assume script is bound to the sheet
    sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  }

  sheet.appendRow([
    new Date(),
    data.company,
    data.role,
    data.decision,
    data.confidence,
    data.effort,
    data.gistUrl,
    data.jobUrl
  ]);
}