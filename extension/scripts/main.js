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
                        chrome.runtime.sendMessage({
                            action: 'startTailoring',
                            taskReference: {
                                company: saveResponse.company,
                                role: saveResponse.role,
                                agentEndpoint: saveResponse.agentEndpoint,
                                jobId: saveResponse.jobId,
                            }
                        }, tailoringResponse => {
                            if (chrome.runtime.lastError || !tailoringResponse?.success) {
                                const error = chrome.runtime.lastError?.message || tailoringResponse?.error || 'Could not start Codex';
                                console.error('[Upside Down] Codex handoff failed:', error);
                                panel.showError(`Task saved, but Codex could not be started: ${error}`);
                                return;
                            }
                            panel.showSuccess({
                                alreadyStarted: tailoringResponse.alreadyStarted === true,
                                foreground: tailoringResponse.foreground === true,
                            });
                            if (tailoringResponse.success) {
                                panel.watchTailoringStatus(saveResponse.jobId);
                            }
                        });
                    } else {
                        panel.showError(saveResponse?.error || 'Save failed');
                    }
                    resetButton();
                });
            });
        }

        // Step 1: run the compact synchronous analysis request.
        chrome.runtime.sendMessage({ action: 'analyze', payload: jobData }, (response) => {
            showAnalysis(response);
        });
    };
})();
