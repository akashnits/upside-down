#!/opt/homebrew/bin/node
'use strict';

const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKER = path.join(__dirname, 'codex-task-worker.js');
const TASK_DIR = '/tmp/upside-down-codex-tasks';
const LOG_PATH = '/tmp/upside-down-codex-native-worker.log';
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
        return startWorker(message.taskReference);
    }
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
