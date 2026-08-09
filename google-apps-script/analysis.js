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

function roundScore(value) {
  return Math.round(value * 10) / 10;
}

function buildDeterministicBrief(ats, rubric) {
  const weightedKeywords = rubricToWeightedKeywords(rubric);
  const totalWeight = weightedKeywords.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const tierNames = ["required", "preferred", "nice_to_have"];
  const weakMethods = new Set(["stem", "ngram"]);
  const missingSet = new Set(ats.missing.map(term => term.toLowerCase()));
  const brief = {
    strongMatches: [],
    weakMatches: [],
    missingKeywords: { required: [], preferred: [], nice_to_have: [] },
    deprioritized: [],
  };

  tierNames.forEach(tier => {
    (rubric.keywords[tier] || []).forEach(item => {
      const method = ats.matchMethod[item.term];
      const frequency = (ats.keywordFrequency || {})[item.term] || 0;
      const sections = (ats.sectionHits || {})[item.term] || [];
      const weight = Number(item.weight || 0);

      if (missingSet.has(item.term.toLowerCase())) {
        const missingItem = {
          keyword: item.term,
          aliases: item.aliases || [],
          expectedGain: totalWeight ? roundScore((weight / totalWeight) * 100) : 0,
        };
        brief.missingKeywords[tier].push(missingItem);
        if (tier === "nice_to_have") {
          brief.deprioritized.push({
            keyword: item.term,
            expectedGain: missingItem.expectedGain,
            reason: "Nice-to-have; address after required and preferred terms",
          });
        }
      } else if (weakMethods.has(method)) {
        brief.weakMatches.push({
          keyword: item.term,
          method,
          frequency,
          sections,
          expectedGainIfExact: totalWeight ? roundScore((weight * 0.5 / totalWeight) * 100) : 0,
        });
      } else if (method) {
        brief.strongMatches.push({
          keyword: item.term,
          method,
          frequency,
          sections,
        });
      }
    });
  });

  return brief;
}

function buildCompactAnalysisMarkdown(brief) {
  const gaps = [
    ...(brief.missingKeywords.required || []).map(item => `${item.keyword} (required, +${item.expectedGain})`),
    ...(brief.weakMatches || []).map(item => `${item.keyword} (weak, +${item.expectedGainIfExact})`),
  ].slice(0, 5);
  const fixes = (brief.highRoiFixes || []).slice(0, 5).map(item => {
    const action = typeof item === "string" ? item : item.action;
    return `- ${action}`;
  });
  return [
    `# ${brief.decision || "MAYBE"} | ATS Coverage ${brief.ats.currentCoverage}%`,
    `Confidence: ${brief.confidence || "MEDIUM"} | Effort: ${brief.effort || "MEDIUM"}`,
    "",
    "## Gaps",
    gaps.length ? gaps.map(item => `- ${item}`).join("\n") : "- None identified",
    "",
    "## High-ROI Fixes",
    fixes.length ? fixes.join("\n") : "- None identified",
    "",
    "## Strong Signals",
    (brief.strongSignals || []).slice(0, 5).map(item => `- ${item}`).join("\n") || "- None identified",
  ].join("\n");
}

function buildConfirmationOptions(highRoiFixes, deterministicBrief) {
  const missingByKeyword = {};
  ["required", "preferred", "nice_to_have"].forEach(tier => {
    (deterministicBrief.missingKeywords[tier] || []).forEach(item => {
      missingByKeyword[item.keyword.toLowerCase()] = { ...item, tier };
    });
  });

  const options = [];
  const seen = new Set();
  (highRoiFixes || []).forEach(fix => {
    if (!fix || typeof fix !== "object" || fix.evidenceStatus === "supported") return;
    (Array.isArray(fix.keywords) ? fix.keywords : []).forEach(keyword => {
      const match = missingByKeyword[String(keyword).toLowerCase()];
      if (!match || seen.has(match.keyword.toLowerCase())) return;
      seen.add(match.keyword.toLowerCase());
      options.push({
        keyword: match.keyword,
        tier: match.tier,
        reason: fix.evidenceSource || "Not evidenced clearly in the current resume",
      });
    });
  });

  return options.slice(0, 6);
}

function buildScanSummary(modelSummary, deterministicBrief, decision) {
  if (typeof modelSummary === "string" && modelSummary.trim()) {
    return modelSummary.trim();
  }

  const requiredGaps = (deterministicBrief.missingKeywords.required || [])
    .slice(0, 2)
    .map(item => item.keyword);
  const strongMatches = (deterministicBrief.strongMatches || [])
    .slice(0, 2)
    .map(item => item.keyword);

  if (requiredGaps.length) {
    return `${decision === "APPLY" ? "This is worth tailoring" : "Your current match is limited"}; the biggest gaps are ${requiredGaps.join(" and ")}.`;
  }
  if (strongMatches.length) {
    return `Your resume already shows relevant evidence in ${strongMatches.join(" and ")}.`;
  }
  return "Review the priority keyword gaps before deciding whether to tailor this resume.";
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
  const ats = calculateATSScore(weightedKeywords, resumeText);
  const deterministicBrief = buildDeterministicBrief(ats, rubric);

  const insightPrompt = `You are an expert Career Coach and Recruiter.

JOB DESCRIPTION:
${jdText}

RESUME:
${resumeText}

FIXED ATS RUBRIC:
${JSON.stringify(rubric)}

DETERMINISTIC ATS MATCH:
${JSON.stringify({
  currentCoverage: ats.score,
  sectionQuality: ats.sectionScore,
  ...deterministicBrief,
})}

Use the fixed rubric and deterministic match above. Do not extract, add, remove, or reclassify keywords.
Return concise structured analysis for a resume-writing agent. Do not return markdown.

Output strict JSON:
{
  "decision": "APPLY" | "MAYBE" | "SKIP",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "effort": "LOW" | "MEDIUM" | "HIGH",
  "scanSummary": "One plain-language sentence explaining the current fit and the most important gap or strength.",
  "suggestedSummary": "A 3-4 sentence summary using only supported themes and keywords.",
  "rejectionReasons": ["Short reason 1", "Short reason 2"],
  "highRoiFixes": [
    {
      "priority": 1,
      "action": "Short, concrete action",
      "keywords": ["exact keyword"],
      "targetSection": "Summary | Skills",
      "evidenceSource": "Existing resume evidence or confirmation needed",
      "evidenceStatus": "supported | needs_confirmation"
    }
  ],
  "strongSignals": ["Short signal 1", "Short signal 2"]
}

Rules for this JSON:
- Prioritize required missing keywords, then weak required matches, then preferred keywords.
- Use only evidence visible in the resume for supported actions.
- Use needs_confirmation when a technology or qualification is not clearly evidenced in the resume. Never recommend inventing it.
- Keep each reason, signal, and action concise enough for a quick scan.
- Do not recommend repeating an already exact keyword solely for ATS scoring.`;

  const modelAnalysis = callJsonModel(
    provider,
    apiKey,
    insightPrompt,
    CONFIG.TEMPERATURE.ANALYSIS,
    8192,
  );

  const expectedGainByKeyword = {};
  ["required", "preferred", "nice_to_have"].forEach(tier => {
    (deterministicBrief.missingKeywords[tier] || []).forEach(item => {
      expectedGainByKeyword[item.keyword.toLowerCase()] = item.expectedGain;
    });
  });
  deterministicBrief.weakMatches.forEach(item => {
    expectedGainByKeyword[item.keyword.toLowerCase()] = item.expectedGainIfExact;
  });
  const highRoiFixes = Array.isArray(modelAnalysis.highRoiFixes)
    ? modelAnalysis.highRoiFixes.slice(0, 5).map(item => {
        if (typeof item === "string") return item;
        const keywords = Array.isArray(item.keywords) ? item.keywords : [];
        const gains = keywords
          .map(keyword => expectedGainByKeyword[String(keyword).toLowerCase()])
          .filter(value => typeof value === "number");
        return {
          ...item,
          evidenceStatus: item.evidenceStatus === "supported" ? "supported" : "needs_confirmation",
          expectedGain: gains.length ? Math.max(...gains) : null,
        };
      })
    : [];
  const confirmationOptions = buildConfirmationOptions(highRoiFixes, deterministicBrief);

  const tailoringBrief = {
    decision: modelAnalysis.decision || "MAYBE",
    confidence: modelAnalysis.confidence || "MEDIUM",
    effort: modelAnalysis.effort || "MEDIUM",
    ats: {
      currentCoverage: ats.score,
      sectionQuality: ats.sectionScore,
    },
    scanSummary: buildScanSummary(modelAnalysis.scanSummary, deterministicBrief, modelAnalysis.decision || "MAYBE"),
    suggestedSummary: modelAnalysis.suggestedSummary || "",
    rejectionReasons: Array.isArray(modelAnalysis.rejectionReasons) ? modelAnalysis.rejectionReasons.slice(0, 3) : [],
    highRoiFixes,
    strongSignals: Array.isArray(modelAnalysis.strongSignals) ? modelAnalysis.strongSignals.slice(0, 5) : [],
    strongMatches: deterministicBrief.strongMatches,
    weakMatches: deterministicBrief.weakMatches,
    missingKeywords: deterministicBrief.missingKeywords,
    deprioritized: deterministicBrief.deprioritized,
    confirmationOptions,
  };

  const allKeywords = weightedKeywords.map(k => k.term);
  const analysis = {
    ...modelAnalysis,
    keywords: allKeywords,
    rubric,
    rubricVersion: rubric.version,
    atsKeywordTiers: tieredKeywords,
    atsScore: ats.score,
    atsCoverageScore: ats.coverageScore,
    atsSectionScore: ats.sectionScore,
    atsMatched: ats.matched,
    atsMissing: ats.missing,
    atsKeywordFrequency: ats.keywordFrequency,
    atsMatchMethod: ats.matchMethod,
    atsSectionHits: ats.sectionHits,
    tailoringBrief,
  };
  analysis.markdown = buildCompactAnalysisMarkdown(tailoringBrief);
  return analysis;
}
