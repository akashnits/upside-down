// atsEngine.js — ATS Score Engine (BM25, stemming, section weighting, synonym taxonomy)
// Functions: normalizeText, simpleStem, buildStemIndex, detectSections,
//            countKeywordInSections, bm25TermScore, calculateATSScore

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

// --- Synonym taxonomy (mini Textkernel-style skill mapping) ---
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
  "system design": ["system design", "systems design", "architecture", "architected", "designing resilient"],
  microservices: ["microservices", "micro-services", "distributed systems", "distributed platforms"],
  "message queuing": ["message queuing", "message queues", "pub/sub", "event-driven", "kafka", "rabbitmq", "kinesis"],
  "generative ai": ["generative ai", "genai", "llm", "large language models"],
  "technical leadership": ["technical leadership", "tech lead", "technical strategy", "driving strategy", "mentorship", "mentoring"],
  "cloud platforms": ["cloud platforms", "public cloud", "cloud computing", "aws", "gcp", "azure"],
};

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
  const regex = new RegExp("\\b" + escaped + "\\b", "gi");

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
 * BM25 term score: tf / (tf + k1 * (1 - b + b * dl/avgdl))
 * k1=1.2, b=0.75 (standard BM25 parameters)
 */
function bm25TermScore(tf, docLength, avgDocLength) {
  const k1 = 1.2;
  const b = 0.75;
  return tf / (tf + k1 * (1 - b + b * (docLength / avgDocLength)));
}

/**
 * Calculate ATS score by matching keywords against resume.
 * Uses BM25-inspired scoring, stemming, synonym taxonomy, section weighting, and n-gram decomposition.
 */
function calculateATSScore(keywords, resumeText) {
  const matched = [];
  const missing = [];
  const keywordFrequency = {};
  const matchMethod = {};
  const sectionHits = {};

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
  const resumeTokens = normalizedResume.split(/\s+/);
  const docLength = resumeTokens.length;
  const avgDocLength = 500; // Typical resume word count
  const stemIndex = buildStemIndex(normalizedResume);

  // --- Detect sections and build section map ---
  const sectionMap = detectSections(resumeText);

  // --- Match type multipliers (exact > synonym > stem > ngram) ---
  const MATCH_MULTIPLIER = { exact: 1.0, synonym: 0.9, stem: 0.8, ngram: 0.7 };

  // --- Helper: word-boundary regex test on normalized text ---
  function wordBoundaryMatch(term, text) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("\\b" + escaped + "\\b", "i").test(text);
  }

  // --- Per-keyword BM25 scores ---
  let bm25Sum = 0;
  let bm25Max = 0; // Theoretical max if every keyword scored perfectly
  const methodCounts = { exact: 0, synonym: 0, stem: 0, ngram: 0 };

  keywords.forEach((keyword) => {
    const kwLower = keyword.toLowerCase();
    const kwNormalized = normalizeText(kwLower);

    // --- Synonym group deduplication ---
    const groupName = termToGroup[kwNormalized] || termToGroup[kwLower];
    if (groupName && claimedGroups.has(groupName)) {
      // This keyword maps to an already-matched synonym group — skip entirely
      Logger.log(`[ATS] Dedup: "${keyword}" -> group "${groupName}" already claimed, skipping`);
      return; // Don't count as matched OR missing
    }

    // Theoretical max: every keyword gets perfect BM25 + exact multiplier
    bm25Max += 1.0;

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
      const synGroup = SYNONYM_TAXONOMY[kwNormalized] || SYNONYM_TAXONOMY[kwLower];
      let synTerms = synGroup ? synGroup : [];
      // Also check if keyword is a member of any group
      if (!synTerms.length && termToGroup[kwNormalized]) {
        synTerms = SYNONYM_TAXONOMY[termToGroup[kwNormalized]] || [];
      }
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
      }
    }

    // 4. N-gram decomposition (multi-word keywords only)
    if (!method) {
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

      // Claim synonym group
      if (groupName) claimedGroups.add(groupName);

      // BM25 contribution with match-type multiplier
      const bm25Raw = bm25TermScore(tf, docLength, avgDocLength);
      bm25Sum += bm25Raw * MATCH_MULTIPLIER[method];
    } else {
      missing.push(keyword);
    }
  });

  // --- Scores ---
  const totalConsidered = matched.length + missing.length;
  const score = totalConsidered > 0
    ? Math.round((matched.length / totalConsidered) * 100)
    : 0;
  const bm25Score = bm25Max > 0
    ? Math.round((bm25Sum / bm25Max) * 100)
    : 0;

  Logger.log(`[ATS] Binary: ${score}%, BM25: ${bm25Score}%, Methods: ${JSON.stringify(methodCounts)}`);
  Logger.log(`[ATS] Frequencies: ${JSON.stringify(keywordFrequency)}`);
  Logger.log(`[ATS] Section hits: ${JSON.stringify(sectionHits)}`);

  return {
    score,
    bm25Score,
    matched,
    missing,
    keywordFrequency,
    matchMethod,
    sectionHits,
    _methodCounts: methodCounts,
  };
}
