// analysisJobs.js - Ephemeral asynchronous analysis queue

const ANALYSIS_JOB_CACHE_PREFIX = "analysis-job:";
const ANALYSIS_JOB_QUEUE_PROPERTY = "ANALYSIS_JOB_QUEUE";
const ANALYSIS_WORKER_SCHEDULED_AT_PROPERTY = "ANALYSIS_WORKER_SCHEDULED_AT";
const ANALYSIS_JOB_TTL_SECONDS = 15 * 60;
const ANALYSIS_WORKER_LEASE_MS = 10 * 60 * 1000;

// Run this once from the Apps Script editor after deploying the async worker.
// It deliberately performs no work; it only prompts the script owner for the
// trigger-management scope required by scheduleAnalysisWorkerIfNeeded().
function authorizeAnalysisWorker() {
  ScriptApp.getProjectTriggers();
  return "Analysis worker authorization complete";
}

function getAnalysisJobCache() {
  return CacheService.getScriptCache();
}

function getAnalysisJobKey(jobId) {
  return `${ANALYSIS_JOB_CACHE_PREFIX}${jobId}`;
}

function readAnalysisJob(jobId) {
  const value = getAnalysisJobCache().get(getAnalysisJobKey(jobId));
  return value ? JSON.parse(value) : null;
}

function writeAnalysisJob(job) {
  getAnalysisJobCache().put(
    getAnalysisJobKey(job.id),
    JSON.stringify(job),
    ANALYSIS_JOB_TTL_SECONDS,
  );
}

function readAnalysisQueue() {
  const value = PROPERTIES.getProperty(ANALYSIS_JOB_QUEUE_PROPERTY);
  if (!value) return [];
  try {
    const queue = JSON.parse(value);
    return Array.isArray(queue) ? queue : [];
  } catch (err) {
    Logger.log(`[WARN] Resetting invalid analysis queue: ${err.toString()}`);
    return [];
  }
}

function writeAnalysisQueue(queue) {
  if (queue.length) {
    PROPERTIES.setProperty(ANALYSIS_JOB_QUEUE_PROPERTY, JSON.stringify(queue));
  } else {
    PROPERTIES.deleteProperty(ANALYSIS_JOB_QUEUE_PROPERTY);
  }
}

function scheduleAnalysisWorkerIfNeeded() {
  const scheduledAt = Number(PROPERTIES.getProperty(ANALYSIS_WORKER_SCHEDULED_AT_PROPERTY) || 0);
  if (scheduledAt && Date.now() - scheduledAt < ANALYSIS_WORKER_LEASE_MS) return;

  PROPERTIES.setProperty(ANALYSIS_WORKER_SCHEDULED_AT_PROPERTY, String(Date.now()));
  try {
    ScriptApp.newTrigger("runPendingAnalysisJobs").timeBased().after(1000).create();
  } catch (err) {
    PROPERTIES.deleteProperty(ANALYSIS_WORKER_SCHEDULED_AT_PROPERTY);
    throw err;
  }
}

function enqueueAnalysisJob(data) {
  if (!data || !String(data.jobDescription || "").trim()) {
    throw new Error("A job description is required to start analysis");
  }

  const job = {
    id: Utilities.getUuid(),
    status: "pending",
    createdAt: new Date().toISOString(),
    payload: {
      company: data.company || "Unknown",
      role: data.role || "Unknown",
      jobId: data.jobId || null,
      jobUrl: data.jobUrl || "",
      jobDescription: data.jobDescription,
    },
  };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    writeAnalysisJob(job);
    const queue = readAnalysisQueue();
    queue.push(job.id);
    writeAnalysisQueue(queue);
    scheduleAnalysisWorkerIfNeeded();
  } finally {
    lock.releaseLock();
  }

  return {
    success: true,
    pending: true,
    analysisJobId: job.id,
    pollAfterMs: 1500,
  };
}

function getAnalysisJobStatus(jobId) {
  if (!jobId) throw new Error("An analysis job ID is required");
  const job = readAnalysisJob(jobId);
  if (!job) {
    return { success: false, error: "Analysis request expired. Run Analyze again." };
  }
  if (job.status === "completed") {
    return { success: true, analysis: job.analysis };
  }
  if (job.status === "failed") {
    return { success: false, error: job.error || "Analysis failed" };
  }
  return { success: true, pending: true, status: job.status, pollAfterMs: 1500 };
}

function takeNextAnalysisJob() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const queue = readAnalysisQueue();
    const jobId = queue.shift();
    writeAnalysisQueue(queue);
    return jobId || null;
  } finally {
    lock.releaseLock();
  }
}

function scheduleNextAnalysisWorker() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    PROPERTIES.deleteProperty(ANALYSIS_WORKER_SCHEDULED_AT_PROPERTY);
    if (readAnalysisQueue().length) scheduleAnalysisWorkerIfNeeded();
  } finally {
    lock.releaseLock();
  }
}

function runPendingAnalysisJobs() {
  const jobId = takeNextAnalysisJob();
  if (!jobId) {
    PROPERTIES.deleteProperty(ANALYSIS_WORKER_SCHEDULED_AT_PROPERTY);
    return;
  }

  const job = readAnalysisJob(jobId);
  if (!job || job.status !== "pending") {
    scheduleNextAnalysisWorker();
    return;
  }

  job.status = "running";
  job.startedAt = new Date().toISOString();
  writeAnalysisJob(job);

  try {
    job.analysis = performAnalysis(job.payload);
    job.status = "completed";
    job.completedAt = new Date().toISOString();
    delete job.payload;
  } catch (err) {
    Logger.log(`[ERROR] Async analysis failed: ${err.toString()}`);
    job.status = "failed";
    job.error = err.toString();
    job.completedAt = new Date().toISOString();
    delete job.payload;
  }
  writeAnalysisJob(job);
  scheduleNextAnalysisWorker();
}
