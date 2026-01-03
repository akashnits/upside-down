// Background Service Worker - The "tunnel" that bypasses CSP
// Import config - update GAS_URL in config.js with your deployed Apps Script URL
importScripts('config.js');
const GAS_URL = CONFIG.GAS_URL;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "analyze") {
        console.log("[Upside Down] Sending analyze request...");

        fetch(GAS_URL, {
            method: "POST",
            redirect: "follow",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ ...request.payload, action: "analyze" })
        })
            .then(res => {
                console.log("[Upside Down] Response status:", res.status);
                return res.text();
            })
            .then(text => {
                console.log("[Upside Down] Response text:", text.substring(0, 500));
                try {
                    const data = JSON.parse(text);
                    sendResponse(data);
                } catch (e) {
                    sendResponse({ success: false, error: "Invalid JSON: " + text.substring(0, 200) });
                }
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
            .then(res => res.text())
            .then(text => {
                console.log("[Upside Down] Save response:", text.substring(0, 200));
                try {
                    sendResponse(JSON.parse(text));
                } catch (e) {
                    sendResponse({ success: false, error: "Invalid JSON" });
                }
            })
            .catch(err => {
                console.error("[Upside Down] Save error:", err);
                sendResponse({ success: false, error: err.message });
            });

        return true;
    }
});
