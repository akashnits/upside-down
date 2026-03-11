// prompt.js — Cowork prompt template builder
// Separated from main.js for easy prompt iteration

/**
 * Build the Cowork prompt string for resume tailoring.
 * @param {Object} jobData - Job data from scraper (role, company, etc.)
 * @param {Object} analysis - Analysis object from the backend
 * @param {string} resumeUrl - URL of the resume document
 * @returns {string} The formatted Cowork prompt
 */
function buildCoworkPrompt(jobData, analysis, resumeUrl) {
    return `Please act as an expert Executive Resume Writer and help me tailor my resume for the ${jobData.role} position at ${jobData.company}.

Here is the context:
1. Resume Draft Link: ${resumeUrl || "[Attach Resume .docx]"}
2. Job Analysis Data: 
"""
${analysis.markdown}
"""

Task Requirements & Execution Rules:
1. TARGETED EDITS ONLY: Only modify two sections of the document:
   - Professional Summary / Objective: Rewrite this to incorporate the missing keywords and directly address the "Rejection Reasons" found in the analysis.
   - Skills / Technologies: Inject missing hard skills where appropriate.

2. MISSING KEYWORDS & EXPERIENCE:
   - Do NOT abbreviate, fabricate, or hallucinate work experience to force a missing keyword.
   - For any missing technologies or hard skills (e.g. Kubernetes, GitOps, etc.) that are NOT in my background: Instead of an outright rejection or omission, ASK ME if I have experience with them and take my input to decide whether to include them.
   - You MUST use the 'docx' skill to maintain the exact same design, fonts, margins, header styles, and bullet layout structure as the provided resume draft.`;
}
