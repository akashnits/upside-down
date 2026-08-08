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



function callJsonModel(provider, apiKey, prompt, temperature, maxTokens) {
  const payload = {
    model: provider.MODELS.ANALYSIS,
    messages: [
      {
        role: "system",
        content: "Always respond with valid JSON only, with no markdown code fences.",
      },
      { role: "user", content: prompt },
    ],
    temperature,
    max_tokens: maxTokens,
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

  let response = UrlFetchApp.fetch(provider.API_URL, options);
  let data = JSON.parse(response.getContentText());
  let finishReason = data.choices[0].finish_reason;

  if (finishReason === "length") {
    Logger.log("[WARN] LLM response was truncated. Retrying with higher max_tokens...");
    payload.max_tokens = Math.max(maxTokens * 2, 16384);
    options.payload = JSON.stringify(payload);
    response = UrlFetchApp.fetch(provider.API_URL, options);
    data = JSON.parse(response.getContentText());
    finishReason = data.choices[0].finish_reason;
  }

  if (finishReason === "length") {
    throw new Error("LLM response was truncated after retry");
  }

  const content = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : "";
  if (!content) throw new Error("LLM returned an empty response");

  try {
    return JSON.parse(content.replace(/```json\n?/gi, "").replace(/```\n?/g, "").trim());
  } catch (err) {
    Logger.log(`[ERROR] Failed to parse LLM JSON: ${content.substring(0, 500)}`);
    throw new Error("Failed to parse AI response as JSON");
  }
}

function computeJobDescriptionHash(jdText) {
  const normalized = (jdText || "").toLowerCase().replace(/\s+/g, " ").trim();
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    normalized,
    Utilities.Charset.UTF_8,
  );
  return digest.map(byte => {
    const value = byte < 0 ? byte + 256 : byte;
    return (value < 16 ? "0" : "") + value.toString(16);
  }).join("");
}

function normalizeRubric(rawRubric, jdHash) {
  const source = rawRubric.rubric || rawRubric;
  const tiers = [
    { name: "required", weight: 1.0 },
    { name: "preferred", weight: 0.6 },
    { name: "nice_to_have", weight: 0.3 },
  ];
  const seen = new Set();
  const keywords = {};

  tiers.forEach(({ name, weight }) => {
    const entries = Array.isArray(source[name]) ? source[name] : [];
    keywords[name] = [];

    entries.forEach(entry => {
      const value = typeof entry === "string" ? { term: entry } : entry || {};
      const term = typeof value.term === "string" ? value.term.trim() : "";
      if (!term) return;

      const key = normalizeText(term);
      if (seen.has(key)) return;
      seen.add(key);

      const aliases = Array.isArray(value.aliases)
        ? [...new Set(value.aliases.filter(alias => typeof alias === "string" && alias.trim()).map(alias => alias.trim()))]
        : [];
      keywords[name].push({ term, aliases, weight });
    });
  });

  return {
    version: "1",
    jdHash,
    keywords,
  };
}

function rubricToWeightedKeywords(rubric) {
  return [
    ...(rubric.keywords.required || []),
    ...(rubric.keywords.preferred || []),
    ...(rubric.keywords.nice_to_have || []),
  ];
}

function rubricToDisplayTiers(rubric) {
  return {
    required: (rubric.keywords.required || []).map(item => item.term),
    preferred: (rubric.keywords.preferred || []).map(item => item.term),
    nice_to_have: (rubric.keywords.nice_to_have || []).map(item => item.term),
  };
}

/**
 * Extract a stable ATS rubric from the job description only.
 */
function extractJobRubric(jdText) {
  const provider = getProviderConfig();
  const scriptProperties = PropertiesService.getScriptProperties();
  const apiKey = scriptProperties.getProperty(provider.API_KEY_PROP);

  if (!apiKey)
    throw new Error(`${provider.API_KEY_PROP} not found in Script Properties`);

  const rubricPrompt = `You are an ATS keyword analyst.

JOB DESCRIPTION:
${jdText}

Extract a stable, conservative rubric from the job description. Do not use any resume context.
- required: explicitly required, must-have, or central responsibility skills and qualifications.
- preferred: explicitly preferred, bonus, plus, or nice-to-have skills.
- nice_to_have: implied role-specific skills only when strongly supported by the description.
- Keep terms canonical and concise. Do not include generic soft skills or broad job duties.
- Add common resume spellings or abbreviations as aliases only when they are genuine equivalents.

Output strict JSON:
{
  "required": [{"term": "Python", "aliases": ["Python 3"]}],
  "preferred": [{"term": "Terraform", "aliases": []}],
  "nice_to_have": [{"term": "GraphQL", "aliases": ["GQL"]}]
}`;

  const rawRubric = callJsonModel(provider, apiKey, rubricPrompt, 0, 4096);
  return normalizeRubric(rawRubric, computeJobDescriptionHash(jdText));
}

/**
 * Analyze a job against a resume using a previously generated rubric.
 */
function analyzeJob(jdText, resumeText, rubric) {
  const provider = getProviderConfig();
  const scriptProperties = PropertiesService.getScriptProperties();
  const apiKey = scriptProperties.getProperty(provider.API_KEY_PROP);

  if (!apiKey)
    throw new Error(`${provider.API_KEY_PROP} not found in Script Properties`);

  const weightedKeywords = rubricToWeightedKeywords(rubric);
  const tieredKeywords = rubricToDisplayTiers(rubric);
  const insightPrompt = `You are an expert Career Coach and Recruiter.

JOB DESCRIPTION:
${jdText}

RESUME:
${resumeText}

FIXED ATS RUBRIC:
${JSON.stringify(rubric)}

Use the fixed rubric above. Do not extract, add, remove, or reclassify keywords.
Analyze the job application and provide actionable insights.

Output strict JSON in this format:
{
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
- **Analyzed On:** ${new Date().toLocaleDateString('en-CA')}`;

  const analysis = callJsonModel(
    provider,
    apiKey,
    insightPrompt,
    CONFIG.TEMPERATURE.ANALYSIS,
    8192,
  );

  const ats = calculateATSScore(weightedKeywords, resumeText);
  Logger.log(
    `[ATS] Coverage: ${ats.score}% (${ats.matched.length}/${weightedKeywords.length} rubric terms)`,
  );

  const allKeywords = weightedKeywords.map(k => k.term);
  analysis.keywords = allKeywords;
  analysis.rubric = rubric;
  analysis.rubricVersion = rubric.version;
  analysis.atsKeywordTiers = tieredKeywords;
  analysis.atsScore = ats.score;
  analysis.atsCoverageScore = ats.coverageScore;
  analysis.atsSectionScore = ats.sectionScore;
  analysis.atsMatched = ats.matched;
  analysis.atsMissing = ats.missing;
  analysis.atsKeywordFrequency = ats.keywordFrequency;
  analysis.atsMatchMethod = ats.matchMethod;
  analysis.atsSectionHits = ats.sectionHits;

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

  const atsSection =
    `\n\n## 📄 ATS Coverage: ${ats.score}%\n\n` +
    `**Section Quality:** ${ats.sectionScore}%\n\n` +
    (topKeywords ? `**Top Keywords:** ${topKeywords}\n\n` : "") +
    `**Matched (${ats.matched.length}):** ${ats.matched.join(", ") || "None"}\n\n` +
    `**Missing (${ats.missing.length}):** ${ats.missing.join(", ") || "None"}\n\n` +
    (methodSummary ? `**Match Methods:** ${methodSummary}\n\n` : "") +
    `---`;

  analysis.markdown = (analysis.markdown || "").replace(/\n---/, `\n---${atsSection}`);
  if (!analysis.markdown.includes("ATS Coverage:")) {
    analysis.markdown += atsSection;
  }

  return analysis;
}
