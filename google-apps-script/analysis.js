// analysis.js — LLM Analysis & ATS Score Calculation
// Functions: getProviderConfig, analyzeJob, calculateATSScore

/**
 * Get Current Provider Configuration
 */
function getProviderConfig() {
  const scriptProperties = PropertiesService.getScriptProperties();
  // Allow runtime switching via Script Properties without redeploying
  const providerName =
    scriptProperties.getProperty("PROVIDER") || CONFIG.PROVIDER;

  const provider = CONFIG.PROVIDERS[providerName];
  if (!provider)
    throw new Error(
      `Invalid PROVIDER setting: ${providerName}. Check Script Properties or config.gs.`,
    );
  return provider;
}

/**
 * Calculate ATS score by matching keywords against resume
 */
function calculateATSScore(keywords, resumeText) {
  const resumeLower = resumeText.toLowerCase();
  const matched = [];
  const missing = [];

  const synonyms = {
    javascript: ["js", "javascript", "ecmascript"],
    typescript: ["ts", "typescript"],
    python: ["python", "py"],
    "machine learning": ["ml", "machine learning", "machinelearning"],
    "artificial intelligence": ["ai", "artificial intelligence"],
    "natural language processing": ["nlp", "natural language processing"],
    "amazon web services": ["aws", "amazon web services"],
    "google cloud platform": ["gcp", "google cloud platform", "google cloud"],
    "microsoft azure": ["azure", "microsoft azure"],
    kubernetes: ["k8s", "kubernetes"],
    postgresql: ["postgres", "postgresql", "psql"],
    mongodb: ["mongo", "mongodb"],
    "react.js": ["react", "reactjs", "react.js"],
    "node.js": ["node", "nodejs", "node.js"],
    "vue.js": ["vue", "vuejs", "vue.js"],
    angular: ["angular", "angularjs"],
    "next.js": ["next", "nextjs", "next.js"],
    graphql: ["graphql", "gql"],
    "rest api": ["rest", "restful", "rest api", "restful api"],
    "ci/cd": ["ci/cd", "cicd", "continuous integration", "continuous deployment"],
    docker: ["docker", "containerization"],
    terraform: ["terraform", "iac", "infrastructure as code"],
    agile: ["agile", "scrum", "kanban"],
    "user experience": ["ux", "user experience"],
    "user interface": ["ui", "user interface"],
    "software development": ["software engineering", "software development", "swe"],
    bachelor: ["bachelor", "bachelors", "bachelor's", "bs", "b.s.", "bsc"],
    master: ["master", "masters", "master's", "ms", "m.s.", "msc"],

    // Modern Backend & AI groupings
    "system design": ["system design", "systems design", "architecture", "architected", "designing resilient"],
    "microservices": ["microservices", "micro-services", "distributed systems", "distributed platforms"],
    "message queuing": ["message queuing", "message queues", "pub/sub", "event-driven", "kafka", "rabbitmq", "kinesis"],
    "generative ai": ["generative ai", "genai", "llm", "large language models"],
    "technical leadership": ["technical leadership", "tech lead", "technical strategy", "driving strategy", "mentorship", "mentoring"],
    "cloud platforms": ["cloud platforms", "public cloud", "cloud computing", "aws", "gcp", "azure"],
  };

  const expandedSynonyms = {};
  Object.values(synonyms).forEach((group) => {
    group.forEach((term) => {
      expandedSynonyms[term] = group;
    });
  });

  keywords.forEach((keyword) => {
    const keywordLower = keyword.toLowerCase();

    let variations = [
      keywordLower,
      keywordLower.replace(/\./g, ""), // React.js -> Reactjs
      keywordLower.replace(/\.js$/i, ""), // Node.js -> Node
      keywordLower.replace(/js$/i, ""), // ReactJS -> React
    ];

    // Basic pluralization/singularization fallback
    if (keywordLower.endsWith('s')) variations.push(keywordLower.slice(0, -1));

    if (expandedSynonyms[keywordLower]) {
      variations = variations.concat(expandedSynonyms[keywordLower]);
    }

    Object.values(synonyms).forEach((group) => {
      // Allow partial structural matching (e.g. "RESTful APIs" inside "REST API" group)
      if (group.some((syn) => keywordLower.includes(syn) || syn.includes(keywordLower))) {
        variations = variations.concat(group);
      }
    });

    variations = [...new Set(variations)];

    const found = variations.some((v) => {
      // Use word boundaries for short acronyms to avoid false positives (like "flAWS" matching "aws")
      if (v.length <= 4 && /^[a-z0-9]+$/i.test(v)) {
        const regex = new RegExp(`\\b${v}\\b`, 'i');
        return regex.test(resumeLower);
      }
      return resumeLower.includes(v);
    });

    if (found) {
      matched.push(keyword);
    } else {
      missing.push(keyword);
    }
  });

  const score =
    keywords.length > 0
      ? Math.round((matched.length / keywords.length) * 100)
      : 0;

  return { score, matched, missing };
}

/**
 * Analyze Job vs Resume in a single LLM call
 * Extracts keywords AND provides analysis in one prompt
 */
function analyzeJob(jdText, resumeText) {
  const provider = getProviderConfig();
  const scriptProperties = PropertiesService.getScriptProperties();
  const apiKey = scriptProperties.getProperty(provider.API_KEY_PROP);

  if (!apiKey)
    throw new Error(`${provider.API_KEY_PROP} not found in Script Properties`);

  // Single LLM call: extract keywords + analyze in one prompt
  const prompt = `You are an expert Career Coach and Recruiter.

JOB DESCRIPTION:
${jdText}

RESUME:
${resumeText}

Task: Analyze this job application.
Step 1: Extract all required skills, technologies, and qualifications as keywords.
Step 2: Use those keywords to evaluate resume fit.
Step 3: Provide actionable insights.

Output strict JSON in this format:
{
  "keywords": ["Python", "AWS", ...],
  "markdown": "# Company — Role ... (The full Insight Card markdown)",
  "decision": "APPLY" | "MAYBE" | "SKIP",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "effort": "LOW" | "MEDIUM" | "HIGH"
}

The Markdown Insight Card MUST follow this structure EXACTLY (DO NOT include Decision/Confidence/Effort/ATS Score — those are shown separately in the UI):

# Company — Role

## 📝 Suggested Resume Summary
*[Write a 3-4 sentence professional summary that naturally incorporates the key missing skills/technologies from the job description. This should help the candidate boost their ATS score when added to their resume.]*

---

## 🚫 Likely Rejection Reasons
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
- **Analyzed On:** ${new Date().toLocaleDateString('en-CA')}`; // en-CA gives YYYY-MM-DD format based on local timezone

  const payload = {
    model: provider.MODELS.ANALYSIS,
    messages: [
      {
        role: "system",
        content:
          "You are a career coach. Always respond with valid JSON only, no markdown code blocks.",
      },
      { role: "user", content: prompt },
    ],
    temperature: CONFIG.TEMPERATURE.ANALYSIS,
    max_tokens: 8192,
    response_format: { type: "json_object" },
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/akashnits/upside-down",
      "X-Title": "Upside Down Extension",
    },
    payload: JSON.stringify(payload),
  };

  const response = UrlFetchApp.fetch(provider.API_URL, options);
  const data = JSON.parse(response.getContentText());
  
  // Check finish_reason — if 'length', the response was truncated
  const finishReason = data.choices[0].finish_reason;
  Logger.log(`[INFO] LLM finish_reason: ${finishReason}`);
  
  if (finishReason === 'length') {
    Logger.log(`[WARN] LLM response was truncated (finish_reason=length). Retrying with higher max_tokens...`);
    payload.max_tokens = 16384;
    options.payload = JSON.stringify(payload);
    const retryResponse = UrlFetchApp.fetch(provider.API_URL, options);
    const retryData = JSON.parse(retryResponse.getContentText());
    const retryFinish = retryData.choices[0].finish_reason;
    Logger.log(`[INFO] Retry finish_reason: ${retryFinish}`);
    if (retryFinish === 'length') {
      throw new Error('LLM response still truncated after retry. The job description may be too long.');
    }
    var jsonString = retryData.choices[0].message.content;
  } else {
    var jsonString = data.choices[0].message.content;
  }

  // Clean markdown code blocks if present
  jsonString = jsonString
    .replace(/```json\n?/gi, "")
    .replace(/```\n?/g, "")
    .trim();

  let analysis;
  try {
    analysis = JSON.parse(jsonString);
  } catch (e) {
    Logger.log(
      `[ERROR] Failed to parse analysis JSON (finish_reason=${finishReason}): ${jsonString.substring(0, 500)}`,
    );
    throw new Error("Failed to parse AI response as JSON");
  }

  // Extract keywords from LLM response, then calculate ATS score deterministically
  const keywords = analysis.keywords || [];
  const ats = calculateATSScore(keywords, resumeText);
  Logger.log(
    `[ATS] Score: ${ats.score}% (${ats.matched.length}/${keywords.length} keywords)`,
  );

  // Add ATS data to response
  analysis.atsScore = ats.score;
  analysis.atsMatched = ats.matched;
  analysis.atsMissing = ats.missing;

  // Inject ATS section into markdown (after first ---) so insight card has keyword details
  const atsSection =
    `\n\n## 📄 ATS Score: ${ats.score}%\n\n` +
    `**Matched (${ats.matched.length}):** ${ats.matched.join(", ") || "None"}\n\n` +
    `**Missing (${ats.missing.length}):** ${ats.missing.join(", ") || "None"}\n\n---`;

  // Replace the first --- with ATS section + ---
  analysis.markdown = analysis.markdown.replace(/\n---/, `\n---${atsSection}`);

  return analysis;
}
