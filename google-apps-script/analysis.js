// analysis.js — LLM Analysis
// Functions: getProviderConfig, analyzeJob

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

IMPORTANT — Resume Output Format:
When generating or editing a resume, always use the resume_builder.js module stored in the outputs folder. Copy it to the working directory first, then create a data_<company>.js file that calls buildResume(). Never inline the formatting logic. This ensures consistent fonts, bullet spacing, right-aligned dates, and section styling across all resumes.

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

  // Add ATS data to response — use BM25 as the single ATS score
  analysis.atsScore = ats.bm25Score;
  analysis.atsMatched = ats.matched;
  analysis.atsMissing = ats.missing;
  analysis.atsKeywordFrequency = ats.keywordFrequency;
  analysis.atsMatchMethod = ats.matchMethod;
  analysis.atsSectionHits = ats.sectionHits;

  // Build top keywords line: "Python (6x, Skills+Experience), AWS (3x, Skills)"
  const topKeywords = ats.matched
    .filter((kw) => ats.keywordFrequency[kw] > 0)
    .sort((a, b) => ats.keywordFrequency[b] - ats.keywordFrequency[a])
    .slice(0, 8)
    .map((kw) => {
      const freq = ats.keywordFrequency[kw];
      const sects = (ats.sectionHits[kw] || []).join("+");
      return `${kw} (${freq}x${sects ? ", " + sects : ""})`;
    })
    .join(", ");

  const mc = ats._methodCounts;
  const methodSummary = [
    mc.exact && `${mc.exact} exact`,
    mc.synonym && `${mc.synonym} synonym`,
    mc.stem && `${mc.stem} stem`,
    mc.ngram && `${mc.ngram} n-gram`,
  ].filter(Boolean).join(", ");

  // Inject ATS section into markdown (after first ---) so insight card has keyword details
  const atsSection =
    `\n\n## 📄 ATS Score: ${ats.bm25Score}%\n\n` +
    (topKeywords ? `**Top Keywords:** ${topKeywords}\n\n` : "") +
    `**Matched (${ats.matched.length}):** ${ats.matched.join(", ") || "None"}\n\n` +
    `**Missing (${ats.missing.length}):** ${ats.missing.join(", ") || "None"}\n\n` +
    (methodSummary ? `**Match Methods:** ${methodSummary}\n\n` : "") +
    `---`;

  // Replace the first --- with ATS section + ---
  analysis.markdown = analysis.markdown.replace(/\n---/, `\n---${atsSection}`);

  return analysis;
}
