#!/opt/homebrew/bin/node
'use strict';

const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CODEX_BIN = path.join(process.env.HOME, '.codex', 'packages', 'standalone', 'current', 'codex');
const LOG_PATH = '/tmp/upside-down-codex-native-worker.log';
const taskPath = process.argv[2];
const statePath = process.argv[3];

function loadLocalEnv() {
    const envPath = path.join(PROJECT_ROOT, '.env.local');
    let contents;
    try { contents = fs.readFileSync(envPath, 'utf8'); } catch (_) { return {}; }
    const values = {};
    for (const line of contents.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!match || match[1].startsWith('NODE_')) continue;
        values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
    return values;
}

function log(message) { fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`); }
function updateState(fields) {
    let state = {};
    try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) {}
    fs.writeFileSync(statePath, JSON.stringify({ ...state, ...fields }), { encoding: 'utf8', mode: 0o600 });
}
function fail(error) {
    log(`ERROR ${error.message}`);
    updateState({ status: 'failed', error: error.message });
    codex?.kill('SIGTERM');
}
function buildPrompt(task) {
    return `Use the resume-tailor skill to execute this tailoring task. Do not create a resume draft before invoking the skill. The skill will fetch the task and submit only a Summary/Skills patch. The backend will copy the canonical base resume into the job folder, apply and verify the patch, then rescore and update Notion. After apply succeeds, follow the skill instructions to draft and save the concise evidence-backed outreach email before running enrich-recruiters. Then run enrich-recruiters with this exact saved Job ID: ${task.jobId}.\n\nTask reference:\n${JSON.stringify({ company: task.company, role: task.role, endpoint: task.agentEndpoint, jobId: task.jobId }, null, 2)}`;
}

let task;
try {
    task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
    fs.unlinkSync(taskPath);
} catch (error) {
    log(`ERROR task input: ${error.message}`);
    try { updateState({ status: 'failed', error: 'Could not read task input' }); } catch (_) {}
    process.exit(1);
}

log(`MESSAGE_RECEIVED jobId=${task.jobId} company=${task.company} role=${task.role}`);
const codex = spawn(CODEX_BIN, ['app-server', '--stdio'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...loadLocalEnv() },
    stdio: ['pipe', 'pipe', 'pipe']
});
let buffer = '';
let threadId = null;
function send(message) { codex.stdin.write(`${JSON.stringify(message)}\n`); }
codex.on('error', fail);
codex.stderr.on('data', chunk => log(`stderr: ${chunk.toString().trim()}`));
codex.stdout.on('data', chunk => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch (error) { fail(error); return; }
        if (message.id === 1) {
            send({ jsonrpc: '2.0', id: 2, method: 'thread/start', params: { cwd: PROJECT_ROOT, ephemeral: false, threadSource: 'cli' } });
        } else if (message.id === 2) {
            threadId = message.result?.thread?.id;
            if (!threadId) { fail(new Error('Codex returned no thread ID')); return; }
            updateState({ status: 'running', threadId });
            log(`THREAD_STARTED ${threadId}`);
            send({ jsonrpc: '2.0', id: 3, method: 'turn/start', params: { threadId, input: [{ type: 'text', text: buildPrompt(task) }] } });
        } else if (message.method === 'turn/completed' && message.params?.threadId === threadId) {
            const status = message.params?.turn?.status || 'unknown';
            log(`TURN_COMPLETED ${status}`);
            updateState({ status: status === 'completed' ? 'completed' : 'failed' });
            codex.kill('SIGTERM');
        } else if (message.error) {
            fail(new Error(message.error.message || 'Codex app-server request failed'));
        }
    }
});

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'upside-down-native-worker', version: '1.0.0' }, capabilities: { experimentalApi: true } } });
setTimeout(() => fail(new Error('Codex app-server timed out')), 120000).unref();
