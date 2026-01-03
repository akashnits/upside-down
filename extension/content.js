// Content Script - Runs on LinkedIn job pages
// Scrapes DOM and communicates with background.js

(function () {
    // Prevent multiple injections
    if (document.getElementById('upside-down-btn')) return;

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

    // Modal for displaying results
    function createModal() {
        const overlay = document.createElement('div');
        overlay.id = 'upside-down-modal';
        overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6);
      z-index: 10001;
      display: flex;
      justify-content: center;
      align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;

        const modal = document.createElement('div');
        modal.style.cssText = `
      background: white;
      border-radius: 16px;
      padding: 25px;
      max-width: 800px;
      width: 95%;
      max-height: 95vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    `;
        modal.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
        <h2 style="margin:0; font-size:20px;">🔮 Upside Down Analysis</h2>
        <button id="ud-close" style="background:none; border:none; font-size:24px; cursor:pointer;">&times;</button>
      </div>
      <div id="ud-status" style="text-align:center; padding:30px; color:#666;">Analyzing...</div>
      <div id="ud-result" style="display:none;"></div>
    `;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        document.getElementById('ud-close').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        return {
            setLoading: (msg) => {
                const status = document.getElementById('ud-status');
                status.style.display = 'block';
                status.innerHTML = `<div style="font-size:40px; margin-bottom:10px;">⏳</div>${msg}`;
                document.getElementById('ud-result').style.display = 'none';
            },
            showResult: (analysis, onSave) => {
                document.getElementById('ud-status').style.display = 'none';
                const result = document.getElementById('ud-result');
                result.style.display = 'block';

                const emoji = analysis.decision === 'APPLY' ? '✅' : analysis.decision === 'SKIP' ? '⛔' : '⚠️';
                const color = analysis.decision === 'APPLY' ? '#155724' : analysis.decision === 'SKIP' ? '#721c24' : '#856404';
                const bg = analysis.decision === 'APPLY' ? '#d4edda' : analysis.decision === 'SKIP' ? '#f8d7da' : '#fff3cd';

                result.innerHTML = `
          <div style="text-align:center; background:${bg}; color:${color}; padding:15px; border-radius:10px; margin-bottom:15px;">
            <div style="font-size:32px; font-weight:bold;">${emoji} ${analysis.decision}</div>
            <div style="margin-top:5px;">Confidence: ${analysis.confidence} | Effort: ${analysis.effort} | ATS: ${analysis.atsScore || '?'}%</div>
          </div>
          <div style="background:#f9f9f9; padding:15px; border-radius:8px; font-size:14px; max-height:500px; overflow-y:auto; margin-bottom:15px; white-space:pre-wrap; line-height:1.5;">${analysis.markdown.substring(0, 4000)}</div>
          <div style="display:flex; gap:10px;">
            <button id="ud-save" style="flex:1; background:#2563EB; color:white; border:none; padding:12px; border-radius:8px; cursor:pointer; font-weight:600;">💾 Save & Track</button>
            <button id="ud-discard" style="flex:1; background:#e5e7eb; color:#374151; border:none; padding:12px; border-radius:8px; cursor:pointer;">Discard</button>
          </div>
        `;

                document.getElementById('ud-save').onclick = onSave;
                document.getElementById('ud-discard').onclick = () => overlay.remove();
            },
            showSuccess: (gistUrl) => {
                document.getElementById('ud-status').style.display = 'none';
                const result = document.getElementById('ud-result');
                result.style.display = 'block';
                result.innerHTML = `
          <div style="text-align:center; padding:20px;">
            <div style="font-size:60px; margin-bottom:15px;">🎉</div>
            <h3 style="margin:0 0 10px 0; color:#155724;">Saved!</h3>
            <a href="${gistUrl}" target="_blank" style="color:#2563EB; font-weight:600;">View Insight Card →</a>
          </div>
        `;
            },
            showError: (msg) => {
                document.getElementById('ud-status').innerHTML = `<div style="font-size:40px; margin-bottom:10px;">❌</div>Error: ${msg}`;
            },
            close: () => overlay.remove()
        };
    }

    // Extract job data from DOM
    function scrapeJob() {
        return {
            role: document.querySelector('.job-details-jobs-unified-top-card__job-title')?.innerText?.trim() ||
                document.querySelector('.jobs-unified-top-card__job-title')?.innerText?.trim() || "Unknown Role",
            company: document.querySelector('.job-details-jobs-unified-top-card__company-name')?.innerText?.trim() ||
                document.querySelector('.jobs-unified-top-card__company-name')?.innerText?.trim() || "Unknown Company",
            jobDescription: document.querySelector('#job-details')?.innerText ||
                document.querySelector('.jobs-description')?.innerText || "",
            jobUrl: window.location.href
        };
    }

    // Main click handler
    btn.onclick = () => {
        const jobData = scrapeJob();

        if (!jobData.jobDescription) {
            alert('Could not find job description. Make sure a job is selected.');
            return;
        }

        const modal = createModal();
        modal.setLoading('Analyzing job against your resume...');

        // Step 1: Send to background.js for analysis
        chrome.runtime.sendMessage({ action: 'analyze', payload: jobData }, (response) => {
            if (!response || !response.success) {
                modal.showError(response?.error || 'Unknown error');
                return;
            }

            const analysis = response.analysis;

            // Step 2: Show results and wait for Save
            modal.showResult(analysis, () => {
                modal.setLoading('Saving to Gist & Sheet...');

                chrome.runtime.sendMessage({
                    action: 'save',
                    payload: { ...jobData, analysis: analysis }
                }, (saveResponse) => {
                    if (saveResponse?.success) {
                        modal.showSuccess(saveResponse.gistUrl);
                    } else {
                        modal.showError(saveResponse?.error || 'Save failed');
                    }
                });
            });
        });
    };
})();
