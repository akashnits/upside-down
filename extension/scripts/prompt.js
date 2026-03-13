// prompt.js — Cowork prompt template builder
// Separated from main.js for easy prompt iteration

/**
 * Build a structured ATS briefing from analysis data.
 * Gives the LLM actionable, prioritized keyword intelligence.
 */
function buildATSBriefing(analysis) {
    const lines = [];
    lines.push(`Current ATS Score: ${analysis.atsScore || 0}% (target: 70%+)`);

    // Weak matches that should be strengthened to exact
    const weakMatches = [];
    const strongMatches = [];
    if (analysis.atsMatchMethod) {
        for (const [kw, method] of Object.entries(analysis.atsMatchMethod)) {
            if (method === "stem" || method === "ngram") {
                weakMatches.push(`${kw} (matched via ${method})`);
            } else {
                const freq = (analysis.atsKeywordFrequency || {})[kw] || 0;
                const sects = ((analysis.atsSectionHits || {})[kw] || []).join("+");
                strongMatches.push(`${kw} (${freq}x${sects ? " in " + sects : ""})`);
            }
        }
    }

    if (strongMatches.length) {
        lines.push(`\nStrong matches (already well-placed, do NOT remove): ${strongMatches.join(", ")}`);
    }
    if (weakMatches.length) {
        lines.push(`\nWeak matches (strengthen to exact keyword): ${weakMatches.join(", ")}`);
    }

    const missing = analysis.atsMissing || [];
    if (missing.length) {
        lines.push(`\nMissing keywords (${missing.length}): ${missing.join(", ")}`);
    }

    return lines.join("\n");
}

/**
 * Build the Cowork prompt string for resume tailoring.
 * @param {Object} jobData - Job data from scraper (role, company, etc.)
 * @param {Object} analysis - Analysis object from the backend
 * @param {string} resumeUrl - URL of the resume document
 * @returns {string} The formatted Cowork prompt
 */
function buildCoworkPrompt(jobData, analysis, resumeUrl) {
    const atsBriefing = buildATSBriefing(analysis);

    return `You are an expert Executive Resume Writer.

IMPORTANT — Resume Output Format:
resume_builder.js is stored in the Downloads folder. Copy it to the working
directory first (if not present already), read it to understand the data schema, then 
create a data_<company>.js file that follows that schema and calls buildResume().
Never inline the formatting logic. This ensures consistent fonts, bullet
spacing, right-aligned dates, and section styling across all resumes.

Please help me tailor my resume for the ${jobData.role} position at ${jobData.company}.

Here is the context:
1. Resume Draft Link: ${resumeUrl || "[Attach Resume .docx]"}
2. Job Analysis Data:
"""
${analysis.markdown}
"""
3. ATS Keyword Intelligence:
"""
${atsBriefing}
"""

Task Requirements & Execution Rules:
1. TARGETED EDITS ONLY: Only modify two sections of the document:
   - Professional Summary / Objective: Rewrite to naturally incorporate the TOP MISSING KEYWORDS. Prioritize the missing keywords that appear most critical in the job description. Also address the "Rejection Reasons" from the analysis.
   - Skills / Technologies: Add missing hard skills. Place them prominently — the Skills section carries the highest ATS weight.

2. STRENGTHEN WEAK MATCHES: Keywords that matched via stem or n-gram (listed under "Weak matches" above) are fragile. Find where they appear in my resume and replace with the EXACT keyword from the job description. For example, if "Optimized" matched "Optimizing" via stem, change it to the exact JD wording.

3. DO NOT TOUCH STRONG MATCHES: Keywords listed as "Strong matches" are already well-placed. Do not move, remove, or rephrase them.

4. MISSING KEYWORDS & EXPERIENCE:
   - Do NOT fabricate or hallucinate work experience to force a missing keyword.
   - For any missing technologies or hard skills that are NOT in my background: ASK ME if I have experience with them and take my input to decide whether to include them.

5. FORMAT PRESERVATION: Read the resume content from the provided link, then
   produce the output by populating data_<company>.js and running it through
   resume_builder.js. Do not alter any section other than Summary and Skills.`;
}
