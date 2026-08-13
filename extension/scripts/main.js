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
    btn.innerHTML = BUTTON_ICON_SVG;
    btn.title = 'Analyze Job with Upside Down';
    btn.style.cssText = BUTTON_STYLES.base;
    btn.onmouseover = () => Object.assign(btn.style, BUTTON_STYLES.hover);
    btn.onmouseout = () => Object.assign(btn.style, BUTTON_STYLES.normal);
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

        function showAnalysis(response) {
            console.log('[Upside Down] Response:', response?.success ? 'OK' : response?.error);
            if (!response || !response.success) {
                panel.showError(response?.error || 'Unknown error');
                resetButton();
                return;
            }

            const analysis = response.analysis;

            // Step 2: Show results and wait for Save
            panel.showResult(analysis, (userSelections) => {
                panel.setSaveLoading();

                const analysisForCreate = structuredClone(analysis);
                const brief = analysisForCreate.tailoringBrief || analysisForCreate.analysisBrief || {};
                brief.userSelections = userSelections;
                analysisForCreate.tailoringBrief = brief;

                chrome.runtime.sendMessage({
                    action: 'save',
                    payload: { ...jobData, analysis: analysisForCreate }
                }, (saveResponse) => {
                    if (saveResponse?.success) {
                        // Assemble compact agent-skill dispatch prompt.
                        const promptText = buildCoworkPrompt(saveResponse);

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
        }

        function pollAnalysis(jobId, startedAt) {
            chrome.runtime.sendMessage({ action: 'getAnalysisStatus', jobId }, (response) => {
                if (response?.success && response.pending) {
                    if (Date.now() - startedAt > 5 * 60 * 1000) {
                        panel.showError('Analysis is taking too long. Run Analyze again.');
                        resetButton();
                        return;
                    }
                    setTimeout(() => pollAnalysis(jobId, startedAt), response.pollAfterMs || 1500);
                    return;
                }
                showAnalysis(response);
            });
        }

        // Step 1: start analysis. The backend returns quickly, then the worker result is polled.
        chrome.runtime.sendMessage({ action: 'analyze', payload: jobData }, (response) => {
            if (response?.success && response.pending && response.analysisJobId) {
                setTimeout(() => pollAnalysis(response.analysisJobId, Date.now()), response.pollAfterMs || 1500);
                return;
            }
            showAnalysis(response);
        });
    };
})();
