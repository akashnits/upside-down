// Background Service Worker - The "tunnel" that bypasses CSP
// Import config - update GAS_URL in config.js with your deployed Apps Script URL
importScripts('config.js');
const GAS_URL = CONFIG.GAS_URL;
const ANALYZE_REQUEST_RETRY_DELAYS_MS = [750, 1500, 3000];

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

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function startAnalysis(payload) {
    let lastError;
    for (let attempt = 0; attempt <= ANALYZE_REQUEST_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
            const response = await fetch(GAS_URL, {
                method: "POST",
                redirect: "follow",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({ ...payload, action: "analyze" })
            });
            return await readAppsScriptResponse(response, "Analyze");
        } catch (error) {
            lastError = error;
            if (!error.retryable || attempt === ANALYZE_REQUEST_RETRY_DELAYS_MS.length) throw error;
            await delay(ANALYZE_REQUEST_RETRY_DELAYS_MS[attempt]);
        }
    }
    throw lastError;
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

        const analysisRequestId = crypto.randomUUID();
        startAnalysis({ ...request.payload, analysisRequestId })
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
