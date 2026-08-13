// Background Service Worker - The "tunnel" that bypasses LinkedIn's CSP
// Import config - update GAS_URL in config.js with your deployed Apps Script URL
importScripts('config.js');
const GAS_URL = CONFIG.GAS_URL;
const ANALYZE_RESPONSE_RETRY_DELAY_MS = 250;
const REDIRECT_LOCATION_TIMEOUT_MS = 10000;
const TRANSPORT_REQUEST_QUERY_PARAM = 'udTransportRequestId';
const pendingRedirects = new Map();

function createAnalysisRequestId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = new Uint32Array(4);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, value => value.toString(16).padStart(8, '0')).join('');
}

function createTransportRequestId() {
    return createAnalysisRequestId();
}

function getRedirectLocation(responseHeaders) {
    const location = (responseHeaders || []).find(header => header.name?.toLowerCase() === 'location');
    return location?.value || null;
}

function isTrustedAppsScriptContentUrl(location) {
    try {
        const url = new URL(location);
        return url.protocol === 'https:' && url.host === 'script.googleusercontent.com';
    } catch (_) {
        return false;
    }
}

function waitForAppsScriptRedirect(transportRequestId) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            pendingRedirects.delete(transportRequestId);
            reject(new Error(`Apps Script redirect was not observed within ${REDIRECT_LOCATION_TIMEOUT_MS}ms`));
        }, REDIRECT_LOCATION_TIMEOUT_MS);
        pendingRedirects.set(transportRequestId, { resolve, reject, timeoutId });
    });
}

function clearPendingAppsScriptRedirect(transportRequestId) {
    const pending = pendingRedirects.get(transportRequestId);
    if (pending) clearTimeout(pending.timeoutId);
    pendingRedirects.delete(transportRequestId);
}

function observeAppsScriptRedirect(details) {
    let requestUrl;
    try {
        requestUrl = new URL(details.url);
    } catch (_) {
        return;
    }

    const transportRequestId = requestUrl.searchParams.get(TRANSPORT_REQUEST_QUERY_PARAM);
    if (!transportRequestId) return;

    const pending = pendingRedirects.get(transportRequestId);
    if (!pending) return;

    const location = getRedirectLocation(details.responseHeaders);
    if (!location) {
        clearPendingAppsScriptRedirect(transportRequestId);
        pending.reject(new Error(`Apps Script redirect was missing a Location header; requestId=${transportRequestId}`));
        return;
    }
    if (!isTrustedAppsScriptContentUrl(location)) {
        clearPendingAppsScriptRedirect(transportRequestId);
        pending.reject(new Error(`Apps Script redirect targeted an unexpected host; requestId=${transportRequestId}`));
        return;
    }

    clearPendingAppsScriptRedirect(transportRequestId);
    console.log(`[Upside Down] Captured Apps Script redirect; transportRequestId=${transportRequestId}`);
    pending.resolve(location);
}

chrome.webRequest.onHeadersReceived.addListener(
    observeAppsScriptRedirect,
    { urls: ['https://script.google.com/macros/s/*/exec*'] },
    ['responseHeaders'],
);

function responseTransportMetadata(response, text) {
    let host = 'unknown';
    try {
        host = new URL(response.url).host || 'unknown';
    } catch (_) {}
    return `status=${response.status}; redirected=${response.redirected}; host=${host}; chars=${text.length}`;
}

async function readAppsScriptResponse(response, action) {
    const text = await response.text();
    try {
        const data = JSON.parse(text);
        if (!response.ok) {
            console.warn(`[Upside Down] ${action} response delivery failure: ${responseTransportMetadata(response, text)}`);
            const error = new Error(`${action} endpoint returned HTTP ${response.status}: ${data?.error || 'Unknown error'}`);
            error.retryableResponseDeliveryFailure = action === 'Analyze' && response.status === 404;
            throw error;
        }
        return data;
    } catch (error) {
        if (error.message.startsWith(`${action} endpoint returned HTTP`)) throw error;
        const detail = text.trim().replace(/\s+/g, ' ').slice(0, 200) || 'empty response';
        console.warn(`[Upside Down] ${action} response delivery failure: ${responseTransportMetadata(response, text)}; detail=${detail}`);
        const responseError = new Error(`${action} endpoint returned HTTP ${response.status}: ${detail}`);
        responseError.retryableResponseDeliveryFailure = action === 'Analyze' && (
            response.status === 404 || (response.status === 200 && detail === 'empty response')
        );
        throw responseError;
    }
}

async function postToAppsScript(action, payload) {
    const transportRequestId = createTransportRequestId();
    const dispatchUrl = new URL(GAS_URL);
    dispatchUrl.searchParams.set(TRANSPORT_REQUEST_QUERY_PARAM, transportRequestId);
    const redirectLocation = waitForAppsScriptRedirect(transportRequestId);

    console.log(`[Upside Down] Dispatching ${action}; transportRequestId=${transportRequestId}`);
    try {
        const initialResponse = await fetch(dispatchUrl.toString(), {
            method: 'POST',
            redirect: 'manual',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ ...payload, action })
        });
        console.log(`[Upside Down] Apps Script dispatch response: type=${initialResponse.type}; status=${initialResponse.status}; transportRequestId=${transportRequestId}`);

        const location = await redirectLocation;
        console.log(`[Upside Down] Reading Apps Script response; transportRequestId=${transportRequestId}`);
        const response = await fetch(location, {
            method: 'GET',
            redirect: 'error',
            credentials: 'omit',
        });
        return await readAppsScriptResponse(response, action === 'analyze' ? 'Analyze' : 'Save');
    } finally {
        clearPendingAppsScriptRedirect(transportRequestId);
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function analyzeWithResponseRetry(payload) {
    const requestId = payload.analysisRequestId || createAnalysisRequestId();
    const requestPayload = { ...payload, analysisRequestId: requestId };

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        console.log(`[Upside Down] Analyze attempt ${attempt}/2; requestId=${requestId}`);
        try {
            return await postToAppsScript('analyze', requestPayload);
        } catch (error) {
            const shouldRetry = attempt === 1 && error.retryableResponseDeliveryFailure === true;
            console.warn(`[Upside Down] Analyze attempt ${attempt} failed; requestId=${requestId}; retry=${shouldRetry}`, error);
            if (!shouldRetry) throw error;
            await delay(ANALYZE_RESPONSE_RETRY_DELAY_MS);
        }
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'analyze' || request.action === 'save') {
        const action = request.action;
        console.log(`[Upside Down] Sending ${action} request...`);

        const operationPromise = action === 'analyze'
            ? analyzeWithResponseRetry(request.payload)
            : postToAppsScript(action, request.payload);

        operationPromise
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
