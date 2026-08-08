// UI — Slide-in panel and all modal states
// Non-blocking: user can still interact with LinkedIn while panel is open

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderAnalysisScan(analysis) {
    const brief = analysis.tailoringBrief || analysis.analysisBrief || {};
    const ats = brief.ats || {};
    const current = typeof ats.currentCoverage === 'number' ? ats.currentCoverage : analysis.atsScore;
    const baseline = typeof ats.baselineCoverage === 'number' ? ats.baselineCoverage : analysis.baselineScore;
    const delta = typeof ats.delta === 'number' ? ats.delta : analysis.scoreDelta;
    const score = typeof current === 'number' ? `${current}%` : '?';
    const change = typeof baseline === 'number' && typeof delta === 'number'
        ? `Baseline ${baseline}% · ${delta >= 0 ? '+' : ''}${delta}%`
        : 'Baseline pending';
    const gainByKeyword = {};

    ['required', 'preferred', 'nice_to_have'].forEach(tier => {
        (brief.missingKeywords?.[tier] || []).forEach(item => {
            gainByKeyword[item.keyword] = item.expectedGain;
        });
    });
    (brief.weakMatches || []).forEach(item => {
        gainByKeyword[item.keyword] = item.expectedGainIfExact;
    });

    const strengths = (brief.strongMatches || []).slice(0, 4).map(item => {
        const sections = item.sections?.length ? ` · ${item.sections.join(' + ')}` : '';
        return `<div style="margin:3px 0;">${escapeHtml(item.keyword)}<span style="color:#6b7280;">${escapeHtml(sections)}</span></div>`;
    }).join('') || '<div style="color:#6b7280;">No strong matches yet</div>';

    const gaps = [
        ...(brief.missingKeywords?.required || []),
        ...(brief.missingKeywords?.preferred || []),
        ...(brief.weakMatches || []),
    ].slice(0, 4).map(item => {
        const keyword = item.keyword;
        const gain = gainByKeyword[keyword];
        const label = item.method ? `${keyword} · weak` : `${keyword} · missing`;
        return `<div style="margin:3px 0;">${escapeHtml(label)}${typeof gain === 'number' ? `<span style="color:#0A66C2;"> · +${escapeHtml(gain)}%</span>` : ''}</div>`;
    }).join('') || '<div style="color:#6b7280;">No critical gaps</div>';

    const fixes = (brief.highRoiFixes || []).slice(0, 3).map(item => {
        const action = typeof item === 'string' ? item : item.action;
        const keywords = typeof item === 'object' && Array.isArray(item.keywords) ? item.keywords : [];
        const gain = typeof item === 'object' && typeof item.expectedGain === 'number'
            ? item.expectedGain
            : keywords.map(keyword => gainByKeyword[keyword]).find(value => typeof value === 'number');
        return `<div style="margin:3px 0;">${typeof gain === 'number' ? `<span style="color:#0A66C2;">+${escapeHtml(gain)}% </span>` : ''}${escapeHtml(action || 'Review this action')}</div>`;
    }).join('') || '<div style="color:#6b7280;">No high-ROI fixes identified</div>';

    const sections = [
        ['STRENGTHS', strengths],
        ['GAPS', gaps],
        ['BEST MOVES', fixes],
    ].map(([label, content]) => `
        <div style="margin-top:14px;">
            <div style="font-size:11px; font-weight:700; letter-spacing:0.08em; color:#6b7280; margin-bottom:5px;">${label}</div>
            <div style="font-size:13px; line-height:1.45;">${content}</div>
        </div>`).join('');

    return `
        <div style="background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:16px; margin-bottom:16px;">
            <div style="display:flex; align-items:baseline; justify-content:space-between; gap:12px;">
                <div style="font-size:24px; font-weight:700; color:#111827;">${escapeHtml(brief.decision || analysis.decision || 'MAYBE')}</div>
                <div style="font-size:21px; font-weight:700; color:#0A66C2;">${escapeHtml(score)}</div>
            </div>
            <div style="margin-top:4px; color:#6b7280; font-size:12px;">${escapeHtml(change)} · ${escapeHtml(brief.effort || analysis.effort || 'MEDIUM')} effort · Section quality ${escapeHtml(ats.sectionQuality ?? analysis.atsSectionScore ?? '?')}%</div>
            ${brief.rejectionReasons?.[0] ? `<div style="margin-top:12px; font-size:13px; color:#374151;">${escapeHtml(brief.rejectionReasons[0])}</div>` : ''}
            ${sections}
        </div>`;
}

function createPanel() {
    // Remove existing panel if present
    const existing = document.getElementById('upside-down-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'upside-down-panel';
    panel.style.cssText = `
        position: fixed;
        top: 0;
        right: 0;
        width: 840px;
        height: 100vh;
        background: #ffffff;
        z-index: 10001;
        box-shadow: -4px 0 24px rgba(0,0,0,0.18);
        overflow-y: auto;
        transform: translateX(100%);
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        display: flex;
        flex-direction: column;
    `;

    panel.innerHTML = `
        <div id="ud-header" style="display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#fafafa;">
            <h2 style="margin:0; font-size:17px; font-weight:600; color:#1a1a1a;">🔮 Upside Down</h2>
            <button id="ud-close" style="background:none; border:none; font-size:22px; cursor:pointer; color:#6b7280; padding:4px 8px; border-radius:4px; transition:background 0.15s;"
                onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='none'">&times;</button>
        </div>
        <div id="ud-status" style="flex:1; display:flex; align-items:center; justify-content:center; padding:30px; color:#666;"></div>
        <div id="ud-result" style="flex:1; display:none; padding:20px; overflow-y:auto;"></div>
    `;

    document.body.appendChild(panel);

    // Slide in
    requestAnimationFrame(() => {
        panel.style.transform = 'translateX(0)';
    });

    const closePanel = () => {
        panel.style.transform = 'translateX(100%)';
        setTimeout(() => panel.remove(), 300);
    };

    document.getElementById('ud-close').onclick = closePanel;

    return {
        setLoading: () => {
            document.getElementById('ud-header').style.display = 'flex';
            const status = document.getElementById('ud-status');
            status.style.display = 'flex';
            document.getElementById('ud-result').style.display = 'none';

            const messages = [
                'Analyzing job description...',
                'Extracting keywords...',
                'Calculating ATS score...',
                'Generating insights...',
                'Crafting recommendations...'
            ];

            status.innerHTML = `
                <style>
                    @keyframes flip { 0% { transform: rotate(0deg); } 50% { transform: rotate(180deg); } 100% { transform: rotate(360deg); } }
                    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
                </style>
                <div style="display:flex; flex-direction:column; align-items:center;">
                    <div style="font-size:40px; animation: flip 2s ease-in-out infinite;">⏳</div>
                    <div id="ud-loading-msg" style="margin-top:15px; font-size:15px; color:#374151; animation: pulse 2s ease-in-out infinite;"></div>
                </div>
            `;

            let msgIndex = 0;
            const msgEl = document.getElementById('ud-loading-msg');
            msgEl.textContent = messages[0];

            window.udLoadingInterval = setInterval(() => {
                msgIndex = (msgIndex + 1) % messages.length;
                msgEl.textContent = messages[msgIndex];
            }, 2000);
        },

        showResult: (analysis, onSave) => {
            if (window.udLoadingInterval) clearInterval(window.udLoadingInterval);

            document.getElementById('ud-status').style.display = 'none';
            const result = document.getElementById('ud-result');
            result.style.display = 'block';

            result.innerHTML = `
                ${renderAnalysisScan(analysis)}
                <div style="font-size:12px; color:#6b7280; margin:-4px 0 16px;">Full tailoring guidance is included in the copied Cowork prompt.</div>
                <div style="display:flex; gap:10px; padding-bottom:20px;">
                    <button id="ud-save" style="flex:1; background:#0A66C2; color:white; border:none; padding:12px; border-radius:8px; cursor:pointer; font-weight:600; font-size:14px; transition:background 0.2s;"
                        onmouseover="this.style.background='#084e96'" onmouseout="this.style.background='#0A66C2'">✨ Create</button>
                    <button id="ud-discard" style="flex:1; background:#f3f4f6; color:#374151; border:none; padding:12px; border-radius:8px; cursor:pointer; font-size:14px; transition:background 0.2s;"
                        onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='#f3f4f6'">Discard</button>
                </div>
            `;

            document.getElementById('ud-save').onclick = onSave;
            document.getElementById('ud-discard').onclick = closePanel;
        },

        setSaveLoading: () => {
            const result = document.getElementById('ud-result');
            const messages = [
                "Saving to Notion...",
                "Creating Drive folder...",
                "Duplicating base resume...",
                "Generating prompt..."
            ];

            result.innerHTML = `
                <style>
                    @keyframes flip { 0% { transform: rotate(0deg); } 50% { transform: rotate(180deg); } 100% { transform: rotate(360deg); } }
                    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
                </style>
                <div style="display:flex; flex-direction:column; align-items:center; padding:40px 20px;">
                    <div style="font-size:40px; animation: flip 2s ease-in-out infinite;">⏳</div>
                    <div id="ud-save-msg" style="margin-top:15px; font-size:15px; color:#374151; animation: pulse 2s ease-in-out infinite;"></div>
                </div>
            `;

            let msgIndex = 0;
            const msgEl = document.getElementById('ud-save-msg');
            msgEl.textContent = messages[0];

            window.udSaveInterval = setInterval(() => {
                msgIndex = (msgIndex + 1) % messages.length;
                msgEl.textContent = messages[msgIndex];
            }, 1500);
        },

        showSuccess: (promptText) => {
            if (window.udSaveInterval) clearInterval(window.udSaveInterval);

            const result = document.getElementById('ud-result');
            result.innerHTML = `
                <div style="text-align:center; padding:20px 20px 10px;">
                    <div style="font-size:40px; margin-bottom:10px;">🎉</div>
                    <h3 style="margin:0 0 10px 0; color:#155724;">Saved to Tracker!</h3>
                    <div style="color:#666; font-size:13px; margin-bottom:15px;">Paste the prompt below into Cowork to tailor your resume.</div>
                </div>
                
                <div style="position:relative; background:#f8f9fa; border:1px solid #e5e7eb; border-radius:8px; padding:16px; margin:0 0 20px 0; text-align:left;">
                    <button id="ud-copy-prompt" style="position:absolute; top:8px; right:8px; background:white; border:1px solid #d1d5db; border-radius:4px; width:28px; height:28px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:#6b7280; transition:all 0.15s;" title="Copy to clipboard">
                        <svg id="ud-icon-copy" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <svg id="ud-icon-check" style="display:none;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                    <pre style="margin:0; font-family:Menlo, Monaco, Consolas, monospace; font-size:12px; line-height:1.5; color:#1f2937; white-space:pre-wrap; word-wrap:break-word; padding-top:8px; padding-right:36px;">${promptText}</pre>
                </div>
            `;

            document.getElementById('ud-copy-prompt').addEventListener('click', function() {
                navigator.clipboard.writeText(promptText).then(() => {
                    const btn = this;
                    const iconCopy = document.getElementById('ud-icon-copy');
                    const iconCheck = document.getElementById('ud-icon-check');
                    
                    iconCopy.style.display = 'none';
                    iconCheck.style.display = 'block';
                    btn.style.color = '#10b981';
                    btn.style.borderColor = '#10b981';
                    
                    setTimeout(() => {
                        iconCopy.style.display = 'block';
                        iconCheck.style.display = 'none';
                        btn.style.color = '#6b7280';
                        btn.style.borderColor = '#d1d5db';
                    }, 2000);
                });
            });
        },

        showError: (msg) => {
            if (window.udLoadingInterval) clearInterval(window.udLoadingInterval);
            if (window.udSaveInterval) clearInterval(window.udSaveInterval);

            document.getElementById('ud-status').style.display = 'flex';
            document.getElementById('ud-status').innerHTML = `
                <div style="text-align:center; padding:20px; color:#ef4444;">
                    <div style="font-size:40px; margin-bottom:10px;">❌</div>
                    <div>Error: ${msg}</div>
                </div>
            `;
            document.getElementById('ud-result').style.display = 'none';
        },

        close: closePanel
    };
}
