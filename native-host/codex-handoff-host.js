#!/opt/homebrew/bin/node
'use strict';

const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKER = path.join(__dirname, 'codex-task-worker.js');
const TASK_DIR = '/tmp/upside-down-codex-tasks';
const LOG_PATH = '/tmp/upside-down-codex-native-worker.log';
const CODEX_BIN = path.join(process.env.HOME, '.codex', 'packages', 'standalone', 'current', 'codex');
// Toggle this one value to change the extension's default dispatch mode.
// Supported values: 'foreground' (visible Terminal TUI) or 'background'
// (detached app-server worker). Individual native callers may still override
// it by sending runMode explicitly.
const DEFAULT_RUN_MODE = 'foreground';
let inputBuffer = Buffer.alloc(0);

function writeMessage(message) {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    process.stdout.write(Buffer.concat([header, body]));
}

function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function pathsFor(jobId) {
    const safeJobId = String(jobId).replace(/[^a-zA-Z0-9_-]/g, '_');
    return {
        statePath: path.join(TASK_DIR, `${safeJobId}.state.json`),
        taskPath: path.join(TASK_DIR, `${safeJobId}.${process.pid}.task.json`)
    };
}

function readState(statePath) {
    try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) { return null; }
}

function validateJobId(jobId) {
    if (!/^[0-9]+$/.test(String(jobId || ''))) throw new Error('Invalid job ID');
    return String(jobId);
}

function getTailoringSession(jobId) {
    const { statePath } = pathsFor(validateJobId(jobId));
    const state = readState(statePath);
    return {
        success: true,
        jobId: String(jobId),
        status: state?.status || 'pending',
        threadId: typeof state?.threadId === 'string' ? state.threadId : null,
    };
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function openTailoringSession(jobId) {
    const session = getTailoringSession(jobId);
    // Codex thread IDs are UUIDs. Validate the persisted value before it is
    // included in the Terminal command, even though the state directory is
    // private to the native host.
    if (!session.threadId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.threadId)) {
        throw new Error('Codex session is not ready yet');
    }
    const command = `${shellQuote(CODEX_BIN)} resume --include-non-interactive ${shellQuote(session.threadId)}`;
    const appleScript = `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(command)}\nend tell`;
    const terminal = spawn('/usr/bin/osascript', ['-e', appleScript], { detached: true, stdio: 'ignore' });
    terminal.unref();
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} SESSION_OPENED jobId=${session.jobId} threadId=${session.threadId}\n`);
    return { ...session, opened: true };
}

function buildTailoringPrompt(task) {
    return `Use the checked-in project skill at .agents/skills/resume-tailor/SKILL.md to execute this tailoring task; do not use a globally installed resume-tailor skill. Do not create a resume draft before invoking the skill. The skill will fetch the task and submit only a Summary/Skills patch. The backend will copy the canonical base resume into the job folder, apply and verify the patch, then rescore and update Notion. After apply succeeds, follow the skill instructions to draft and save the concise evidence-backed outreach email before running enrich-recruiters. Then run enrich-recruiters with this exact saved Job ID: ${task.jobId}.\n\nTask reference:\n${JSON.stringify({ company: task.company, role: task.role, endpoint: task.agentEndpoint, jobId: task.jobId }, null, 2)}`;
}

function startForegroundTailoring(taskReference) {
    fs.mkdirSync(TASK_DIR, { recursive: true, mode: 0o700 });
    const { statePath } = pathsFor(taskReference.jobId);
    const previous = readState(statePath);
    if (previous?.status === 'foreground') {
        return { success: true, alreadyStarted: true, foreground: true };
    }
    if (previous && ['started', 'running'].includes(previous.status) && isProcessAlive(previous.pid)) {
        return { success: false, error: 'This tailoring task is already running in the background. Wait for it to finish before starting a foreground session.' };
    }

    const promptPath = path.join(TASK_DIR, `${taskReference.jobId}.foreground-prompt.txt`);
    fs.writeFileSync(promptPath, buildTailoringPrompt(taskReference), { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(statePath, JSON.stringify({ status: 'foreground', jobId: taskReference.jobId, startedAt: new Date().toISOString() }), { encoding: 'utf8', mode: 0o600 });

    // The Terminal-hosted TUI is the sole writer for this job. Its prompt is read
    // from a private file so job text never has to be interpolated into a shell
    // command, and --no-alt-screen preserves the visible run history.
    const command = `cd ${shellQuote(PROJECT_ROOT)} && exec ${shellQuote(CODEX_BIN)} --no-alt-screen --sandbox workspace-write "$(cat ${shellQuote(promptPath)})"`;
    const appleScript = `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(command)}\nend tell`;
    const terminal = spawn('/usr/bin/osascript', ['-e', appleScript], { detached: true, stdio: 'ignore' });
    terminal.unref();
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} FOREGROUND_TASK_STARTED jobId=${taskReference.jobId}\n`);
    return { success: true, started: true, foreground: true };
}

function startWorker(taskReference) {
    fs.mkdirSync(TASK_DIR, { recursive: true, mode: 0o700 });
    const { statePath, taskPath } = pathsFor(taskReference.jobId);
    const previous = readState(statePath);
    if (previous && ['started', 'running'].includes(previous.status) && isProcessAlive(previous.pid)) {
        return { success: true, alreadyStarted: true, pid: previous.pid, threadId: previous.threadId || null };
    }
    if (previous?.status === 'completed') return { success: true, alreadyCompleted: true, threadId: previous.threadId || null };

    fs.writeFileSync(taskPath, JSON.stringify(taskReference), { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(statePath, JSON.stringify({ status: 'started', jobId: taskReference.jobId, startedAt: new Date().toISOString() }), { encoding: 'utf8', mode: 0o600 });
    const log = fs.openSync(LOG_PATH, 'a');
    const worker = spawn(process.execPath, [WORKER, taskPath, statePath], { cwd: PROJECT_ROOT, detached: true, stdio: ['ignore', log, log] });
    worker.unref();
    fs.writeFileSync(statePath, JSON.stringify({ status: 'running', jobId: taskReference.jobId, pid: worker.pid, startedAt: new Date().toISOString() }), { encoding: 'utf8', mode: 0o600 });
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} TASK_STARTED jobId=${taskReference.jobId}\n`);
    return {
        success: true,
        started: true,
        pid: worker.pid,
    };
}

function validateTaskReference(task) {
    if (!task || typeof task !== 'object') throw new Error('Missing task reference');
    for (const field of ['company', 'role', 'agentEndpoint', 'jobId']) {
        if (typeof task[field] !== 'string' || !task[field].trim()) throw new Error(`Missing task field: ${field}`);
    }
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(task.agentEndpoint)) throw new Error('Invalid agent endpoint');
    if (!/^[0-9]+$/.test(task.jobId)) throw new Error('Invalid job ID');
}

async function handleMessage(message) {
    if (!message || !message.action) throw new Error('Missing native host action');
    if (message.action === 'startTailoring') {
        validateTaskReference(message.taskReference);
        const runMode = message.runMode || DEFAULT_RUN_MODE;
        if (runMode !== 'foreground' && runMode !== 'background') throw new Error(`Unsupported run mode: ${runMode}`);
        return runMode === 'foreground'
            ? startForegroundTailoring(message.taskReference)
            : startWorker(message.taskReference);
    }
    if (message.action === 'getTailoringSession') return getTailoringSession(message.jobId);
    if (message.action === 'openTailoringSession') return openTailoringSession(message.jobId);
    throw new Error('Unsupported native host action');
}

process.stdin.on('data', async chunk => {
    inputBuffer = Buffer.concat([inputBuffer, chunk]);
    while (inputBuffer.length >= 4) {
        const length = inputBuffer.readUInt32LE(0);
        if (length > 1024 * 1024) { writeMessage({ success: false, error: 'Native message is too large' }); process.exit(1); }
        if (inputBuffer.length < length + 4) return;
        const payload = inputBuffer.subarray(4, length + 4).toString('utf8');
        inputBuffer = inputBuffer.subarray(length + 4);
        try { writeMessage(await handleMessage(JSON.parse(payload))); } catch (error) { writeMessage({ success: false, error: error.message }); }
    }
});
