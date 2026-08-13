// Background Service Worker - The "tunnel" that bypasses CSP
// Import config - update GAS_URL in config.js with your deployed Apps Script URL
importScripts('config.js');
const GAS_URL = CONFIG.GAS_URL;

async function readAppsScriptResponse(response, action) {
    const text = await response.text();
    try {
        const data = JSON.parse(text);
        if (!response.ok) {
            const error = new Error(`${action} endpoint returned HTTP ${response.status}: ${data?.error || 'Unknown error'}`);
            error.retryable = response.status === 404 || response.status >= 500;
            throw error;
        }
        return data;
    } catch (error) {
        if (error.retryable !== undefined) throw error;
        const isEmpty = !text.trim();
        const detail = text.trim().replace(/\s+/g, ' ').slice(0, 200) || 'empty response';
        const responseError = new Error(`${action} endpoint returned HTTP ${response.status}: ${detail}`);
        responseError.retryable = isEmpty || response.status === 404 || response.status >= 500;
        throw responseError;
    }
}

async function startAnalysis(payload) {
    // ContentService always redirects POST responses to a temporary Google URL.
    // That URL intermittently returns 404 to extension fetches, so POST only
    // dispatches the known job ID. All readable state comes from doGet polling.
    await fetch(GAS_URL, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ ...payload, action: "analyze" })
    });

    return {
        success: true,
        pending: true,
        analysisJobId: payload.analysisJobId,
        pollAfterMs: 1500
    };
}

function getAnalysisStatusUrl(jobId) {
    const url = new URL(GAS_URL);
    url.searchParams.set('action', 'analysisStatus');
    url.searchParams.set('jobId', jobId);
    return url.toString();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "analyze") {
        console.log("[Upside Down] Sending analyze request...");

        const analysisJobId = crypto.randomUUID();
        startAnalysis({ ...request.payload, analysisJobId })
            .then(data => {
                console.log("[Upside Down] Analyze response:", data.success ? "OK" : data.error);
                sendResponse(data);
            })
            .catch(err => {
                console.error("[Upside Down] Fetch error:", err);
                sendResponse({ success: false, error: err.message });
            });

        return true;
    }

    if (request.action === "save") {
        console.log("[Upside Down] Sending save request...");

        fetch(GAS_URL, {
            method: "POST",
            redirect: "follow",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ ...request.payload, action: "save" })
        })
            .then(res => readAppsScriptResponse(res, "Save"))
            .then(data => {
                console.log("[Upside Down] Save response:", data.success ? "OK" : data.error);
                sendResponse(data);
            })
            .catch(err => {
                console.error("[Upside Down] Save error:", err);
                sendResponse({ success: false, error: err.message });
            });

        return true;
    }

    if (request.action === "getAnalysisStatus") {
        fetch(getAnalysisStatusUrl(request.jobId), {
            method: "GET",
            redirect: "follow"
        })
            .then(res => readAppsScriptResponse(res, "Analysis status"))
            .then(sendResponse)
            .catch(err => {
                console.error("[Upside Down] Analysis status error:", err);
                sendResponse({ success: false, error: err.message });
            });

        return true;
    }
});
