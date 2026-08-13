// Background Service Worker - The "tunnel" that bypasses CSP
// Import config - update GAS_URL in config.js with your deployed Apps Script URL
importScripts('config.js');
const GAS_URL = CONFIG.GAS_URL;

async function readAppsScriptResponse(response, action) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch (error) {
        const detail = text.trim().replace(/\s+/g, ' ').slice(0, 200) || 'empty response';
        throw new Error(`${action} endpoint returned HTTP ${response.status}: ${detail}`);
    }
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

        fetch(GAS_URL, {
            method: "POST",
            redirect: "follow",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ ...request.payload, action: "analyze" })
        })
            .then(res => readAppsScriptResponse(res, "Analyze"))
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
