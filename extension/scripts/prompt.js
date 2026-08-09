// prompt.js — Cowork prompt template builder
// Separated from main.js for easy prompt iteration

function buildTailoringBrief(analysis) {
    const brief = analysis.tailoringBrief || analysis.analysisBrief || {};
    return JSON.stringify(brief, null, 2);
}

/**
 * Build the Cowork prompt string for resume tailoring.
 * @param {Object} jobData - Job data from scraper (role, company, etc.)
 * @param {Object} analysis - Analysis object from the backend
 * @param {string} resumeUrl - URL of the resume document
 * @returns {string} The formatted Cowork prompt
 */
function buildCoworkPrompt(jobData, analysis, resumeUrl) {
    const tailoringBrief = buildTailoringBrief(analysis);

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
2. Analysis Brief:
"""
${tailoringBrief}
"""

Task Requirements & Execution Rules:
1. SOURCE OF TRUTH
   Treat the Analysis Brief JSON as authoritative. Use its priority, missingKeywords,
   weakMatches, strongMatches, highRoiFixes, suggestedSummary, and userSelections fields.

2. APPLY HIGH-ROI ACTIONS FIRST
   Work through highRoiFixes in priority order.
   Prioritize required keywords, then weak required matches, then preferred keywords.
   Deprioritize nice-to-have keywords unless higher-priority actions are complete.

3. TARGETED EDITS ONLY
   Only modify these two sections:
   - Professional Summary / Objective:
     Rewrite concisely and naturally using the highest-priority supported keywords.
   - Skills / Technologies:
     Add supported missing hard skills using the exact canonical terms from the Analysis Brief.

4. EXACT KEYWORD MATCHING
   For each selected supported missing or weak keyword, use the exact canonical term
   or approved alias at least once in Summary or Skills.
   Do not repeat keywords unnaturally or add terms that are already exact matches.

5. STRONG MATCHES
   Preserve all strongMatches. Do not remove, weaken, or replace their terminology.

6. UNKNOWN EXPERIENCE
   Add needs_confirmation keywords only when they appear in userSelections.confirmedKeywords.
   Do not ask follow-up questions for excluded or unconfirmed keywords. Never add unsupported
   technologies, responsibilities, or qualifications.

7. FORMAT PRESERVATION
   Read the resume content from the provided link, then produce the output by populating
   data_<company>.js and running it through resume_builder.js. Preserve fonts, spacing,
   date alignment, styling, and document structure.

8. FINAL VALIDATION
   Verify that selected high-ROI actions were applied or explicitly skipped, exact selected
   keywords appear in Summary or Skills, no unsupported claims or unnecessary repetition were
   introduced, and the generated resume was visually checked in Google Docs-friendly format`;
}
