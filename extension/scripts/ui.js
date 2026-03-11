// UI — Slide-in panel and all modal states
// Non-blocking: user can still interact with LinkedIn while panel is open

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

            const emoji = analysis.decision === 'APPLY' ? '✅' : analysis.decision === 'SKIP' ? '⛔' : '⚠️';
            const color = analysis.decision === 'APPLY' ? '#155724' : analysis.decision === 'SKIP' ? '#721c24' : '#856404';
            const bg = analysis.decision === 'APPLY' ? '#d4edda' : analysis.decision === 'SKIP' ? '#f8d7da' : '#fff3cd';

            result.innerHTML = `
                <div style="text-align:center; background:${bg}; color:${color}; padding:14px; border-radius:12px; margin-bottom:16px; box-shadow:0 2px 8px rgba(0,0,0,0.08);">
                    <div style="font-size:28px; font-weight:bold;">${emoji} ${analysis.decision}</div>
                    <div style="margin-top:6px; font-size:13px;">Confidence: ${analysis.confidence} | Effort: ${analysis.effort} | ATS: ${analysis.atsScore || '?'}%</div>
                </div>
                <div style="background:#fff; padding:16px; border-radius:12px; font-size:13px; max-height:calc(100vh - 260px); overflow-y:auto; margin-bottom:16px; line-height:1.6; border:1px solid #e5e7eb;">
                    ${formatMarkdown(analysis.markdown.substring(0, 5000))}
                </div>
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

// Simple markdown to HTML converter
function formatMarkdown(md) {
    return md
        .replace(/^# (.+)$/gm, '<h2 style="margin:0 0 8px 0; color:#1a1a1a; font-size:17px; border-bottom:2px solid #0A66C2; padding-bottom:6px;">$1</h2>')
        .replace(/^## (.+)$/gm, '<h3 style="margin:8px 0 6px 0; color:#0A66C2; font-size:15px; font-weight:600;">$1</h3>')
        .replace(/^\*\*(.+?)\*\*$/gm, '<p style="margin:4px 0; font-weight:600; color:#333;">$1</p>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em style="color:#666;">$1</em>')
        .replace(/^- \[ \] (.+)$/gm, '<div style="margin:3px 0; padding:6px 10px; background:#f0f7ff; border-radius:4px; border-left:3px solid #0A66C2; font-size:13px;">☐ $1</div>')
        .replace(/^- (.+)$/gm, '<div style="margin:2px 0; padding:2px 0 2px 12px; border-left:2px solid #e0e0e0; font-size:13px;">$1</div>')
        .replace(/^> (.+)$/gm, '<blockquote style="margin:8px 0; padding:8px 10px; background:#fffbeb; border-left:3px solid #f59e0b; font-size:12px; color:#92400e; border-radius:0 4px 4px 0;">$1</blockquote>')
        .replace(/---/g, '<hr style="margin:10px 0; border:none; border-top:1px solid #e5e7eb;">')
        .replace(/\n\n/g, '<br>');
}
