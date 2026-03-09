// Main — Click handler, orchestration, message passing
// Loads after scraper.js and ui.js

(function () {
    console.log('[Upside Down] Extension loaded');

    // Prevent multiple injections
    if (document.getElementById('upside-down-btn')) return;

    // Track analysis state for debounce
    let isAnalyzing = false;

    // Create floating Analyze button (FAB style)
    const btn = document.createElement('button');
    btn.id = 'upside-down-btn';
    btn.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M12 0L14.59 8.41L23 11L14.59 13.59L12 22L9.41 13.59L1 11L9.41 8.41L12 0Z"/><path d="M19 2L19.94 4.06L22 5L19.94 5.94L19 8L18.06 5.94L16 5L18.06 4.06L19 2Z" opacity="0.7"/><path d="M5 16L5.66 17.34L7 18L5.66 18.66L5 20L4.34 18.66L3 18L4.34 17.34L5 16Z" opacity="0.7"/></svg>`;
    btn.title = 'Analyze Job with Upside Down';
    btn.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        width: 60px;
        height: 60px;
        background: #0A66C2;
        color: white;
        border: none;
        border-radius: 50%;
        font-size: 28px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(10, 102, 194, 0.4);
        transition: transform 0.2s, box-shadow 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        filter: drop-shadow(0 0 0 white);
    `;
    btn.onmouseover = () => {
        btn.style.transform = 'scale(1.1)';
        btn.style.boxShadow = '0 6px 16px rgba(10, 102, 194, 0.5)';
    };
    btn.onmouseout = () => {
        btn.style.transform = 'scale(1)';
        btn.style.boxShadow = '0 4px 12px rgba(10, 102, 194, 0.4)';
    };
    document.body.appendChild(btn);

    // Re-enable button after analysis completes (success or error)
    function resetButton() {
        isAnalyzing = false;
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
    }

    // Main click handler
    btn.onclick = () => {
        if (isAnalyzing) return;

        // Debounce: disable button during analysis
        isAnalyzing = true;
        btn.style.opacity = '0.5';
        btn.style.pointerEvents = 'none';

        const jobData = scrapeJob(); // from scraper.js
        console.log('[Upside Down] Analyzing:', jobData.role, '@', jobData.company);

        if (!jobData.jobDescription) {
            alert('Could not find job description. Make sure a job is selected.');
            resetButton();
            return;
        }

        const panel = createPanel(); // from ui.js
        panel.setLoading();

        // Step 1: Send to background.js for analysis
        chrome.runtime.sendMessage({ action: 'analyze', payload: jobData }, (response) => {
            console.log('[Upside Down] Response:', response?.success ? 'OK' : response?.error);
            if (!response || !response.success) {
                panel.showError(response?.error || 'Unknown error');
                resetButton();
                return;
            }

            const analysis = response.analysis;

            // Step 2: Show results and wait for Save
            panel.showResult(analysis, () => {
                panel.setSaveLoading();

                chrome.runtime.sendMessage({
                    action: 'save',
                    payload: { ...jobData, analysis: analysis }
                }, (saveResponse) => {
                    if (saveResponse?.success) {
                        // Assemble Cowork Prompt
                        const promptText = `Please act as an expert Executive Resume Writer and help me tailor my resume for the ${jobData.role} position at ${jobData.company} (Notion Job ID: ${jobData.jobId}).

Here is the context:
1. Base Resume: ${saveResponse.resumeUrl || "[Attach Resume .docx]"}
2. Job Analysis Data: 
"""
${analysis.markdown}
"""

Task Requirements & Execution Rules:
1. TARGETED EDITS ONLY: Only modify two sections of the document:
   - Professional Summary / Objective: Rewrite this to incorporate the missing keywords and directly address the "Rejection Reasons" found in the analysis.
   - Skills / Technologies: Inject missing hard skills where appropriate.

2. PRESERVE EXPERIENCE & FORMATTING:
   - Do NOT abbreviate, fabricate, or hallucinate work experience to force a missing keyword. Every keyword added must be contextually plausible based on my background.
   - You MUST use the 'docx' skill to maintain the exact same design, fonts, margins, header styles, and bullet layout structure as the base resume file.

Output & Automation Steps:
1. Generate New Document: Execute the rewrites and generate a brand new \`.docx\` file. NEVER overwrite or save changes directly to the original base resume link.
2. Save to Google Drive: Create a folder in my Google Drive named EXACTLY \`${jobData.role}_${jobData.company}\`. Save the newly tailored \`.docx\` resume into this folder.
3. Update Notion Tracker: Search my Notion Job Tracker database using the exact Job ID: \`${jobData.jobId}\`. Update that row's "Resume Link" property with the Google Drive share link to the newly tailored file.`;

                        // Copy to clipboard
                        navigator.clipboard.writeText(promptText).then(() => {
                            console.log('[Upside Down] Copied Cowork prompt to clipboard.');
                        }).catch(err => {
                            console.error('[Upside Down] Failed to copy to clipboard:', err);
                        });

                        panel.showSuccess(promptText);
                    } else {
                        panel.showError(saveResponse?.error || 'Save failed');
                    }
                    resetButton();
                });
            });

            resetButton();
        });
    };
})();
