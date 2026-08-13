// Background Service Worker - The "tunnel" that bypasses LinkedIn's CSP
// Import config - update GAS_URL in config.js with your deployed Apps Script URL
importScripts('config.js');
const GAS_URL = CONFIG.GAS_URL;

async function readAppsScriptResponse(response, action) {
    const text = await response.text();
    try {
        const data = JSON.parse(text);
        if (!response.ok) {
            throw new Error(`${action} endpoint returned HTTP ${response.status}: ${data?.error || 'Unknown error'}`);
        }
        return data;
    } catch (error) {
        if (error.message.startsWith(`${action} endpoint returned HTTP`)) throw error;
        const detail = text.trim().replace(/\s+/g, ' ').slice(0, 200) || 'empty response';
        throw new Error(`${action} endpoint returned HTTP ${response.status}: ${detail}`);
    }
}

function postToAppsScript(action, payload) {
    return fetch(GAS_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, action })
    }).then(response => readAppsScriptResponse(response, action === 'analyze' ? 'Analyze' : 'Save'));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'analyze' || request.action === 'save') {
        const action = request.action;
        console.log(`[Upside Down] Sending ${action} request...`);

        postToAppsScript(action, request.payload)
            .then(data => {
                console.log(`[Upside Down] ${action} response:`, data.success ? 'OK' : data.error);
                sendResponse(data);
            })
            .catch(error => {
                console.error(`[Upside Down] ${action} error:`, error);
                sendResponse({ success: false, error: error.message });
            });

        return true;
    }
});
