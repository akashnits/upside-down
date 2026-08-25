// atsEngine.js — ATS Score Engine (weighted coverage, section diagnostics, synonym taxonomy)
// Functions: normalizeText, simpleStem, buildStemIndex, detectSections,
//            countKeywordInSections, calculateATSScore

// --- Protected tokens for normalization ---
const PROTECTED_TOKENS = {
  "c++": "CPLUS_PLACEHOLDER",
  "c#": "CSHARP_PLACEHOLDER",
  ".net": "DOTNET_PLACEHOLDER",
  "ci/cd": "CICD_PLACEHOLDER",
  "node.js": "NODEJS_PLACEHOLDER",
  "react.js": "REACTJS_PLACEHOLDER",
  "vue.js": "VUEJS_PLACEHOLDER",
  "next.js": "NEXTJS_PLACEHOLDER",
  "d3.js": "D3JS_PLACEHOLDER",
  "three.js": "THREEJS_PLACEHOLDER",
  "pub/sub": "PUBSUB_PLACEHOLDER",
};

// Section weight multipliers — mirrors how real ATS weights sections
const SECTION_WEIGHTS = {
  Skills: 1.5,
  Summary: 1.3,
  Experience: 1.0,
  Projects: 1.0,
  Certifications: 0.9,
  Education: 0.8,
  Other: 0.7,
};

// --- Strict alias taxonomy ---
// These are alternate spellings or unambiguous abbreviations of the same skill.
// Related technologies or capabilities must not appear here: they are useful
// coaching signals but overstate ATS coverage when treated as equivalents.
const SYNONYM_TAXONOMY = {
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
  "node.js": ["nodejs", "node.js"],
  "vue.js": ["vue", "vuejs", "vue.js"],
  angular: ["angular", "angularjs"],
  "next.js": ["nextjs", "next.js"],
  graphql: ["graphql", "gql"],
  "rest api": ["rest api", "rest apis", "restful api", "restful apis"],
  "ci/cd": ["ci/cd", "cicd", "continuous integration and continuous deployment", "continuous integration continuous deployment"],
  "user experience": ["ux", "user experience"],
  "user interface": ["ui", "user interface"],
  "software development": ["software engineering", "software development", "swe"],
  bachelor: ["bachelor", "bachelors", "bachelor's", "bs", "b.s.", "bsc"],
  master: ["master", "masters", "master's", "ms", "m.s.", "msc"],
};

// A phrase is not evidenced merely because its individual words appear in
// unrelated bullets. Keep this disabled until a proximity-aware matcher is
// implemented and validated by the benchmark.
const ENABLE_NGRAM_MATCHING = false;

/**
 * Normalize text the way ATS PDF/DOCX parsers flatten formatting artifacts.
 * Protects structural special chars (C++, CI/CD, .NET) before replacing /-|_. with spaces.
 */
function normalizeText(text) {
  let result = text.toLowerCase();
  // Protect tokens with structural special chars
  for (const [token, placeholder] of Object.entries(PROTECTED_TOKENS)) {
    result = result.split(token).join(placeholder);
  }
  // Replace formatting artifacts with spaces
  result = result.replace(/[\/\-\|_\.]/g, " ");
  // Restore protected tokens
  for (const [token, placeholder] of Object.entries(PROTECTED_TOKENS)) {
    result = result.split(placeholder).join(token);
  }
  // Collapse whitespace
  result = result.replace(/\s+/g, " ").trim();
  return result;
}

/**
 * Simple suffix stemmer — mirrors Elasticsearch/Solr analyzers used by real ATS.
 * Strips common English suffixes. Guard: stem must be >= 3 chars.
 */
function simpleStem(word) {
  const suffixes = [
    "ization", "isation", "tion", "sion", "ment", "ness", "able", "ible",
    "ence", "ance", "zing", "zing", "ling", "ing", "ize", "ise",
    "ied", "ity", "ful", "ous", "ive", "ist",
    "ed", "er", "ly", "al", "es", "s",
  ];
  const lower = word.toLowerCase();
  for (const suffix of suffixes) {
    if (lower.endsWith(suffix) && lower.length - suffix.length >= 3) {
      return lower.slice(0, -suffix.length);
    }
  }
  return lower;
}

/**
 * Build a stemmed token index from text: { stem: count }
 */
function buildStemIndex(normalizedText) {
  const tokens = normalizedText.split(/\s+/);
  const index = {};
  for (const token of tokens) {
    if (token.length < 2) continue;
    const stem = simpleStem(token);
    index[stem] = (index[stem] || 0) + 1;
  }
  return index;
}

/**
 * Detect resume sections and return { sectionName: text } map.
 * Recognizes common resume heading patterns.
 */
function detectSections(resumeText) {
  const sectionPatterns = [
    { name: "Skills", pattern: /^(?:technical\s+)?skills|^core\s+competencies|^technologies/i },
    { name: "Experience", pattern: /^(?:work\s+)?experience|^employment|^professional\s+experience/i },
    { name: "Education", pattern: /^education|^academic/i },
    { name: "Summary", pattern: /^(?:professional\s+)?summary|^profile|^objective|^about/i },
    { name: "Projects", pattern: /^projects|^personal\s+projects|^key\s+projects/i },
    { name: "Certifications", pattern: /^certifications?|^licenses?/i },
  ];

  const lines = resumeText.split("\n");
  const sections = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Skip empty or very long lines (not headers)
    if (!trimmed || trimmed.length > 60) continue;
    for (const { name, pattern } of sectionPatterns) {
      if (pattern.test(trimmed)) {
        sections.push({ name, startLine: i });
        break;
      }
    }
  }

  // Build section text map
  const result = {};
  for (let idx = 0; idx < sections.length; idx++) {
    const start = sections[idx].startLine;
    const end = idx + 1 < sections.length ? sections[idx + 1].startLine : lines.length;
    result[sections[idx].name] = lines.slice(start, end).join("\n");
  }

  // Anything not in a detected section goes into "Other"
  if (sections.length === 0) {
    result["Other"] = resumeText;
  }

  return result;
}

/**
 * Count keyword occurrences with section-aware weighting.
 * Returns { weightedCount, rawCount, sections[] } for a keyword in the resume.
 */
function countKeywordInSections(keyword, sectionMap) {
  let weightedCount = 0;
  let rawCount = 0;
  const hitSections = [];
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = /^[a-z0-9]/i.test(keyword) ? "\\b" : "(^|[^a-z0-9])";
  const suffix = /[a-z0-9]$/i.test(keyword) ? "\\b" : "(?![a-z0-9])";
  const regex = new RegExp(prefix + escaped + suffix, "gi");

  for (const [sectionName, sectionText] of Object.entries(sectionMap)) {
    const normalizedSection = normalizeText(sectionText);
    const matches = normalizedSection.match(regex);
    if (matches) {
      const count = matches.length;
      rawCount += count;
      weightedCount += count * (SECTION_WEIGHTS[sectionName] || 0.7);
      hitSections.push(sectionName);
    }
  }
  return { weightedCount, rawCount, sections: hitSections };
}

/**
 * Match a multi-word phrase when its words occur consecutively and only differ
 * by simple inflection (for example, "mentored junior engineers" versus
 * "mentoring junior engineers"). Unlike n-gram decomposition, this cannot
 * join unrelated words from different parts of a resume.
 */
function countStemmedPhraseInSections(keyword, sectionMap) {
  const phraseStems = normalizeText(keyword)
    .split(/\s+/)
    .filter(Boolean)
    .map(simpleStem);
  if (phraseStems.length < 2) return { weightedCount: 0, rawCount: 0, sections: [] };

  let weightedCount = 0;
  let rawCount = 0;
  const hitSections = [];
  for (const [sectionName, sectionText] of Object.entries(sectionMap)) {
    const tokens = normalizeText(sectionText).split(/\s+/).filter(Boolean);
    let count = 0;
    for (let index = 0; index <= tokens.length - phraseStems.length; index += 1) {
      const matches = phraseStems.every((stem, offset) => simpleStem(tokens[index + offset]) === stem);
      if (matches) count += 1;
    }
    if (count) {
      rawCount += count;
      weightedCount += count * (SECTION_WEIGHTS[sectionName] || 0.7);
      hitSections.push(sectionName);
    }
  }
  return { weightedCount, rawCount, sections: hitSections };
}

/**
 * Calculate ATS score by matching a fixed rubric against a resume.
 * The headline score is weighted coverage. Match method and section placement
 * are returned separately so resume length cannot hide coverage gains.
 * @param {Array} keywords - Array of {term, weight} objects or plain strings (backward compat)
 * @param {string} resumeText - The resume text to match against
 */
function calculateATSScore(keywords, resumeText) {
  const matched = [];
  const missing = [];
  const keywordFrequency = {};
  const matchMethod = {};
  const sectionHits = {};

  // Normalize input: accept both [{term, weight}] and ["keyword"] formats
  const weightedKeywords = keywords.map(k =>
    typeof k === "string" ? { term: k, weight: 1.0 } : k
  );

  // Build reverse lookup: term -> canonical group name
  const termToGroup = {};
  for (const [groupName, terms] of Object.entries(SYNONYM_TAXONOMY)) {
    for (const term of terms) {
      termToGroup[term] = groupName;
    }
    // Also map the group name itself
    termToGroup[groupName] = groupName;
  }

  // Track claimed synonym groups for deduplication
  const claimedGroups = new Set();

  // --- Normalize resume and build indices ---
  const normalizedResume = normalizeText(resumeText);
  const stemIndex = buildStemIndex(normalizedResume);

  // --- Detect sections and build section map ---
  const sectionMap = detectSections(resumeText);

  // --- Helper: word-boundary regex test on normalized text ---
  function wordBoundaryMatch(term, text) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prefix = /^[a-z0-9]/i.test(term) ? "\\b" : "(^|[^a-z0-9])";
    const suffix = /[a-z0-9]$/i.test(term) ? "\\b" : "(?![a-z0-9])";
    return new RegExp(prefix + escaped + suffix, "i").test(text);
  }

  const methodCounts = { exact: 0, synonym: 0, stem: 0, ngram: 0 };
  const coverageMultiplier = { exact: 1.0, synonym: 1.0, stem: 0.5, ngram: 0.5 };
  let totalWeight = 0;
  let matchedWeight = 0;
  let sectionQualitySum = 0;

  weightedKeywords.forEach(({ term: keyword, weight, aliases = [] }) => {
    if (!keyword || !Number.isFinite(Number(weight)) || Number(weight) <= 0) return;

    weight = Number(weight);
    const kwLower = keyword.toLowerCase();
    const kwNormalized = normalizeText(kwLower);

    // --- Synonym group deduplication ---
    const groupName = termToGroup[kwNormalized] || termToGroup[kwLower];
    if (groupName && claimedGroups.has(groupName)) {
      // This keyword maps to an already-matched synonym group — skip entirely
      Logger.log(`[ATS] Dedup: "${keyword}" -> group "${groupName}" already claimed, skipping`);
      return; // Don't count as matched OR missing
    }

    totalWeight += weight;

    const rubricAliases = aliases
      .filter(alias => typeof alias === "string" && alias.trim())
      .map(alias => normalizeText(alias.toLowerCase()))
      .filter(alias => alias !== kwNormalized);

    let method = null;
    let tf = 0;
    let hitSects = [];

    // --- Match cascade ---

    // 1. Exact word-boundary match on normalized text
    if (wordBoundaryMatch(kwNormalized, normalizedResume)) {
      method = "exact";
      const counts = countKeywordInSections(kwNormalized, sectionMap);
      tf = counts.weightedCount;
      hitSects = counts.sections;
    }

    // 2. Synonym/taxonomy match
    if (!method) {
      let synTerms = rubricAliases;
      const synGroup = SYNONYM_TAXONOMY[kwNormalized] || SYNONYM_TAXONOMY[kwLower];
      if (synGroup) synTerms = synTerms.concat(synGroup.map(syn => normalizeText(syn)));
      // Also check if keyword is a member of any group
      if (!synTerms.length && termToGroup[kwNormalized]) {
        synTerms = (SYNONYM_TAXONOMY[termToGroup[kwNormalized]] || []).map(syn => normalizeText(syn));
      }
      synTerms = [...new Set(synTerms)];
      for (const syn of synTerms) {
        const synNorm = normalizeText(syn);
        if (wordBoundaryMatch(synNorm, normalizedResume)) {
          method = "synonym";
          const counts = countKeywordInSections(synNorm, sectionMap);
          tf = counts.weightedCount;
          hitSects = counts.sections;
          break;
        }
      }
    }

    // 3. Stem match
    if (!method) {
      const kwStem = simpleStem(kwNormalized);
      if (kwStem.length >= 3 && stemIndex[kwStem]) {
        method = "stem";
        tf = stemIndex[kwStem]; // Raw stem count (no section weighting for stems)
        hitSects = ["Unknown"];
      } else {
        const counts = countStemmedPhraseInSections(kwNormalized, sectionMap);
        if (counts.rawCount) {
          method = "stem";
          tf = counts.weightedCount;
          hitSects = counts.sections;
        }
      }
    }

    // 4. N-gram decomposition (multi-word keywords only). Disabled for ATS
    // credit because the current implementation cannot require word proximity.
    if (!method && ENABLE_NGRAM_MATCHING) {
      const words = kwNormalized.split(/\s+/).filter((w) => w.length >= 2);
      if (words.length > 1) {
        const allWordsPresent = words.every((w) => wordBoundaryMatch(w, normalizedResume));
        if (allWordsPresent) {
          method = "ngram";
          // Use the minimum word frequency as the phrase proxy
          let minTf = Infinity;
          const combinedSections = new Set();
          for (const w of words) {
            const counts = countKeywordInSections(w, sectionMap);
            if (counts.weightedCount < minTf) minTf = counts.weightedCount;
            counts.sections.forEach((s) => combinedSections.add(s));
          }
          tf = minTf === Infinity ? 1 : minTf;
          hitSects = Array.from(combinedSections);
        }
      }
    }

    if (method) {
      matched.push(keyword);
      matchMethod[keyword] = method;
      methodCounts[method]++;
      keywordFrequency[keyword] = Math.round(tf);
      sectionHits[keyword] = hitSects;
      matchedWeight += weight * coverageMultiplier[method];

      const bestSectionWeight = hitSects.reduce((best, section) => {
        return Math.max(best, SECTION_WEIGHTS[section] || 0.7);
      }, 0);
      sectionQualitySum += weight * coverageMultiplier[method] * Math.min(bestSectionWeight / 1.5, 1);

      // Claim synonym group
      if (groupName) claimedGroups.add(groupName);
    } else {
      missing.push(keyword);
    }
  });

  // --- Scores ---
  const score = totalWeight > 0
    ? Math.round((matchedWeight / totalWeight) * 100)
    : 0;
  const sectionScore = matchedWeight > 0
    ? Math.round((sectionQualitySum / matchedWeight) * 100)
    : 0;

  Logger.log(`[ATS] Coverage: ${score}%, Section quality: ${sectionScore}%, Methods: ${JSON.stringify(methodCounts)}`);
  Logger.log(`[ATS] Frequencies: ${JSON.stringify(keywordFrequency)}`);
  Logger.log(`[ATS] Section hits: ${JSON.stringify(sectionHits)}`);

  return {
    score,
    coverageScore: score,
    sectionScore,
    matched,
    missing,
    keywordFrequency,
    matchMethod,
    sectionHits,
    _methodCounts: methodCounts,
  };
}
