#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  accessSync,
  createWriteStream,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { execSync, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// ── Paths ──────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS_DIR = resolve(__dirname, "../..");
const DATA_DIR = join(homedir(), ".claude", "orchestrator");
const WORKTREES_DIR = join(DATA_DIR, "worktrees");
const LOGS_DIR = join(DATA_DIR, "logs");
const LOCKS_DIR = join(DATA_DIR, "locks");
const STATE_FILE = join(DATA_DIR, "state.json");
const DASHBOARD_META_FILE = join(DATA_DIR, "dashboard.json");
const DASHBOARD_INDEX = join(HARNESS_DIR, "mcp", "agent-dashboard", "index.js");
const IS_TEST_MODE = process.env.HARNESS_TEST_MODE === "1";

function parseDaysEnv(name, fallback) {
  const raw = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

const LIFECYCLE_POLICY = {
  completedArchiveDays: parseDaysEnv("HARNESS_COMPLETED_ARCHIVE_DAYS", 7),
  completedPurgeDays: parseDaysEnv("HARNESS_COMPLETED_PURGE_DAYS", 30),
  failedArchiveDays: parseDaysEnv("HARNESS_FAILED_ARCHIVE_DAYS", 14),
  failedPurgeDays: parseDaysEnv("HARNESS_FAILED_PURGE_DAYS", 60),
  workerArchiveDays: parseDaysEnv("HARNESS_WORKER_ARCHIVE_DAYS", 7),
  workerPurgeDays: parseDaysEnv("HARNESS_WORKER_PURGE_DAYS", 30),
  batchArchiveDays: parseDaysEnv("HARNESS_BATCH_ARCHIVE_DAYS", 7),
  batchPurgeDays: parseDaysEnv("HARNESS_BATCH_PURGE_DAYS", 60),
};

for (const d of [DATA_DIR, WORKTREES_DIR, LOGS_DIR, LOCKS_DIR]) {
  mkdirSync(d, { recursive: true });
}

// ── Harness pipeline ───────────────────────────────────────────────────────────

// All harness stages in canonical order.
const ALL_STAGES = [
  "ideate",
  "product-plan",
  "dev-plan",
  "prototype",
  "implement",
  "qa",
  "update-docs",
  "handoff",
];

/**
 * Build the prompt sent to a pipeline stage worker.
 * Embeds the SKILL.md as-is — skills are not modified or overridden.
 * Injects previous stage result when available.
 * Instructs the worker to write a structured result.json on completion.
 */
function stagePrompt(stageId, repoPath, description, previousResult = null) {
  const skillFile = join(HARNESS_DIR, "skills", stageId, "SKILL.md");
  const skillContent = existsSync(skillFile)
    ? readFileSync(skillFile, "utf8")
    : `Execute the '${stageId}' stage of the harness workflow on the project.`;

  const lines = [
    `You are an autonomous agent executing the "${stageId}" stage of the harness pipeline.`,
    `Project repository: ${repoPath}`,
  ];

  if (description) lines.push(`Pipeline goal: ${description}`);

  // Inject previous stage result so this stage starts informed, not blind
  if (previousResult) {
    lines.push(
      ``,
      `── Context from previous stage (${previousResult.stage}) ──`,
      `Status: ${previousResult.status}`,
    );
    if (previousResult.summary)
      lines.push(`Summary: ${previousResult.summary}`);
    if (previousResult.completed?.length)
      lines.push(`Completed: ${previousResult.completed.join(", ")}`);
    if (previousResult.blocked?.length)
      lines.push(`Blocked: ${previousResult.blocked.map(b => `${b.item} (${b.reason})`).join("; ")}`);
    if (previousResult.recommendations)
      lines.push(`Recommendation for this stage: ${previousResult.recommendations}`);
    lines.push(`── End context ──`);
  }

  lines.push(
    ``,
    `--- SKILL: ${stageId} ---`,
    skillContent,
    `--- END SKILL ---`,
    ``,
    `AUTOMATION MODE — run as far as possible without human input:`,
    `- Complete this stage autonomously. Do NOT wait for user input at any point.`,
    `- Use .harness/ and the codebase as the sole source of context for all decisions.`,
    `- If you hit a genuine blocker, document it in .harness/pipeline/${stageId}-blockers.md`,
    `  and continue with everything you can still complete.`,
    ``,
    `When this stage is finished:`,
    `1. Write .harness/pipeline/${stageId}-result.json with this exact structure:`,
    `   {`,
    `     "stage": "${stageId}",`,
    `     "status": "done" | "partial" | "blocked",`,
    `     "summary": "<one sentence of what was accomplished>",`,
    `     "completed": ["<item1>", "<item2>"],`,
    `     "blocked": [{ "item": "<name>", "reason": "<why>" }],`,
    `     "files_changed": ["<path1>", "<path2>"],`,
    `     "recommendations": "<what the next stage should focus on>"`,
    `   }`,
    `2. Commit all changes (including the result.json) with a descriptive message.`,
  );

  return lines.join("\n");
}

// ── State ──────────────────────────────────────────────────────────────────────

const workers = new Map();   // id → Worker
const pipelines = new Map(); // id → Pipeline
const batches = new Map();    // id → Batch
let telemetry = createTelemetry();

function createTelemetry() {
  return {
    pipelines: { started: 0, done: 0, blocked: 0, failed: 0, cancelled: 0, durationMsTotal: 0, finished: 0 },
    batches: { started: 0, done: 0, blocked: 0, failed: 0, cancelled: 0, durationMsTotal: 0, finished: 0 },
    workers: { started: 0, done: 0, failed: 0, terminated: 0, durationMsTotal: 0, finished: 0 },
    lifecycle: { archived: 0, purged: 0 },
    manual: { cancels: 0, terminations: 0, cleanups: 0 },
    health: { recent: [] },
    lastEvent: null,
  };
}

function normalizeTelemetry(value) {
  const normalized = createTelemetry();
  if (!value || typeof value !== "object") return normalized;

  for (const group of ["pipelines", "batches", "workers", "lifecycle", "manual"]) {
    const src = value[group];
    if (!src || typeof src !== "object") continue;
    for (const key of Object.keys(normalized[group])) {
      const nestedValue = src[key];
      if (typeof nestedValue === "number" && Number.isFinite(nestedValue)) {
        normalized[group][key] = nestedValue;
      }
    }
  }
  if (value.health && typeof value.health === "object" && Array.isArray(value.health.recent)) {
    normalized.health.recent = value.health.recent
      .map(normalizeHealthEvent)
      .filter(Boolean)
      .slice(-24);
  }
  if (value.lastEvent && typeof value.lastEvent === "object") {
    normalized.lastEvent = {
      type: typeof value.lastEvent.type === "string" && value.lastEvent.type ? value.lastEvent.type : "unknown",
      at: typeof value.lastEvent.at === "string" && value.lastEvent.at ? value.lastEvent.at : now(),
      scope: typeof value.lastEvent.scope === "string" && value.lastEvent.scope ? value.lastEvent.scope : "unknown",
      id: typeof value.lastEvent.id === "string" ? value.lastEvent.id : "",
      status: typeof value.lastEvent.status === "string" ? value.lastEvent.status : "",
      note: typeof value.lastEvent.note === "string" ? value.lastEvent.note : "",
    };
  }
  return normalized;
}

function normalizeHealthEvent(value) {
  if (!value || typeof value !== "object") return null;
  return {
    at: typeof value.at === "string" && value.at ? value.at : now(),
    scope: typeof value.scope === "string" && value.scope ? value.scope : "unknown",
    id: typeof value.id === "string" ? value.id : "",
    repoPath: typeof value.repoPath === "string" ? value.repoPath : "",
    level: value.level === "danger" || value.level === "warning" || value.level === "good" ? value.level : "good",
    type: typeof value.type === "string" && value.type ? value.type : "health_event",
    status: typeof value.status === "string" ? value.status : "",
    title: typeof value.title === "string" ? value.title : "",
    detail: typeof value.detail === "string" ? value.detail : "",
    durationMs: Number.isFinite(value.durationMs) ? value.durationMs : null,
  };
}

function healthLevelForStatus(status) {
  if (status === "done") return "good";
  if (status === "blocked" || status === "cancelled") return "warning";
  return "danger";
}

function recordHealthEvent({
  scope = "unknown",
  id = "",
  repoPath = "",
  level = "good",
  type = "health_event",
  status = "",
  title = "",
  detail = "",
  durationMs = null,
} = {}) {
  const entry = normalizeHealthEvent({
    at: now(),
    scope,
    id,
    repoPath,
    level,
    type,
    status,
    title,
    detail,
    durationMs,
  });
  if (!entry) return;
  telemetry.health.recent.push(entry);
  telemetry.health.recent = telemetry.health.recent.slice(-24);
  telemetry.lastEvent = {
    type,
    at: entry.at,
    scope,
    id,
    status,
    note: detail || title || repoPath || "",
  };
}

function recordTelemetry(group, status = null, meta = {}) {
  if (!telemetry) telemetry = createTelemetry();
  const bucket = telemetry[group];
  if (bucket && typeof bucket === "object") {
    if (status && Object.prototype.hasOwnProperty.call(bucket, status)) {
      bucket[status] += 1;
    }
    if (typeof meta.durationMs === "number" && Number.isFinite(meta.durationMs)) {
      if (typeof bucket.durationMsTotal === "number") {
        bucket.durationMsTotal += Math.max(0, meta.durationMs);
      }
      if (typeof bucket.finished === "number") {
        bucket.finished += 1;
      }
    }
  }
  if (meta.count && telemetry[group] && typeof telemetry[group] === "object" && typeof telemetry[group].count === "number") {
    telemetry[group].count += meta.count;
  }
  telemetry.lastEvent = {
    type: typeof meta.type === "string" && meta.type ? meta.type : "unknown",
    at: now(),
    scope: typeof group === "string" && group ? group : "unknown",
    id: typeof meta.id === "string" ? meta.id : "",
    status: typeof status === "string" ? status : "",
    note: typeof meta.note === "string" ? meta.note : "",
  };
}

function telemetryAverageMs(group) {
  const bucket = telemetry?.[group];
  if (!bucket || typeof bucket !== "object") return 0;
  if (!bucket.finished || !bucket.durationMsTotal) return 0;
  return Math.round(bucket.durationMsTotal / bucket.finished);
}

function loadState() {
  if (!existsSync(STATE_FILE)) return;
  try {
    const { workerList = [], pipelineList = [], batchList = [], telemetry: storedTelemetry = null } = JSON.parse(
      readFileSync(STATE_FILE, "utf8")
    );
    workers.clear();
    pipelines.clear();
    batches.clear();
    for (const w of workerList) {
      if (w.status === "running") {
        let alive = false;
        try { process.kill(w.pid, 0); alive = true; } catch {}
        if (!alive) { w.status = "failed"; w.endTime = now(); }
      }
      workers.set(w.id, w);
    }
    for (const p of pipelineList) pipelines.set(p.id, p);
    for (const b of batchList) batches.set(b.id, b);
    telemetry = normalizeTelemetry(storedTelemetry);
  } catch {}
}

function saveState() {
  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        workerList: [...workers.values()],
        pipelineList: [...pipelines.values()],
        batchList: [...batches.values()],
        telemetry,
      },
      null,
      2
    )
  );
}

function isArchived(record) {
  return record?.archived === true;
}

function ageInDays(record, referenceField = "endTime") {
  const reference = record?.[referenceField] || record?.archivedAt || record?.startTime;
  if (!reference) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(reference);
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  return (Date.now() - ms) / (1000 * 60 * 60 * 24);
}

function lifecycleStatusBucket(status) {
  if (status === "done" || status === "cancelled") return "completed";
  if (status === "failed" || status === "blocked" || status === "terminated") return "failed";
  return "other";
}

function archiveRecord(record, archivedReason) {
  if (record.archived) return false;
  record.archived = true;
  record.archivedAt = now();
  record.archivedReason = archivedReason;
  return true;
}

function purgeWorkerArtifacts(worker) {
  if (worker?.logFile) {
    try {
      rmSync(worker.logFile, { force: true });
    } catch {}
  }
  if (worker?.worktreePath) {
    try {
      rmSync(worker.worktreePath, { recursive: true, force: true });
    } catch {}
  }
}

function applyLifecyclePolicy() {
  let changed = false;
  let archivedCount = 0;
  let purgedCount = 0;

  for (const worker of [...workers.values()]) {
    if (worker.status === "running") continue;
    const bucket = lifecycleStatusBucket(worker.status);
    const archiveAfter = LIFECYCLE_POLICY.workerArchiveDays;
    const purgeAfter = LIFECYCLE_POLICY.workerPurgeDays;

    if (!isArchived(worker) && ageInDays(worker) >= archiveAfter) {
      if (archiveRecord(worker, `worker archived after ${bucket} retention window`)) {
        archivedCount += 1;
        changed = true;
      }
    }

    if (isArchived(worker) && ageInDays(worker, "archivedAt") >= purgeAfter) {
      purgeWorkerArtifacts(worker);
      workers.delete(worker.id);
      purgedCount += 1;
      changed = true;
    }
  }

  for (const pipeline of [...pipelines.values()]) {
    if (pipeline.status === "running") continue;
    const bucket = lifecycleStatusBucket(pipeline.status);
    const archiveAfter =
      bucket === "completed" ? LIFECYCLE_POLICY.completedArchiveDays : LIFECYCLE_POLICY.failedArchiveDays;
    const purgeAfter =
      bucket === "completed" ? LIFECYCLE_POLICY.completedPurgeDays : LIFECYCLE_POLICY.failedPurgeDays;

    if (!isArchived(pipeline) && ageInDays(pipeline) >= archiveAfter) {
      if (archiveRecord(pipeline, `pipeline archived after ${bucket} retention window`)) {
        archivedCount += 1;
        changed = true;
      }
    }

    if (isArchived(pipeline) && ageInDays(pipeline, "archivedAt") >= purgeAfter) {
      pipelines.delete(pipeline.id);
      purgedCount += 1;
      changed = true;
    }
  }

  for (const batch of [...batches.values()]) {
    if (batch.status === "running") continue;
    const bucket = lifecycleStatusBucket(batch.status);
    const archiveAfter = LIFECYCLE_POLICY.batchArchiveDays;
    const purgeAfter = LIFECYCLE_POLICY.batchPurgeDays;

    if (!isArchived(batch) && ageInDays(batch) >= archiveAfter) {
      if (archiveRecord(batch, `batch archived after ${bucket} retention window`)) {
        archivedCount += 1;
        changed = true;
      }
    }

    if (isArchived(batch) && ageInDays(batch, "archivedAt") >= purgeAfter) {
      batches.delete(batch.id);
      purgedCount += 1;
      changed = true;
    }
  }

  if (archivedCount > 0) {
    telemetry.lifecycle.archived += archivedCount;
    telemetry.lastEvent = {
      type: "archive_policy",
      at: now(),
      scope: "lifecycle",
      id: "",
      status: "archived",
      note: `archived ${archivedCount} records`,
    };
  }
  if (purgedCount > 0) {
    telemetry.lifecycle.purged += purgedCount;
    telemetry.lastEvent = {
      type: "purge_policy",
      at: now(),
      scope: "lifecycle",
      id: "",
      status: "purged",
      note: `purged ${purgedCount} records`,
    };
  }

  if (changed) saveState();
}

function matchesScope(record, scope) {
  if (scope === "workers") return Object.prototype.hasOwnProperty.call(record, "worktreePath");
  if (scope === "pipelines") return Array.isArray(record?.stages);
  if (scope === "batches") return Array.isArray(record?.pipelines);
  return true;
}

function archiveHistory({ scope = "all", olderThanDays = null } = {}) {
  const threshold = Number.isFinite(olderThanDays) ? olderThanDays : null;
  let changed = false;
  const archived = { workers: 0, pipelines: 0, batches: 0 };

  for (const worker of workers.values()) {
    if (worker.status === "running" || !matchesScope(worker, scope)) continue;
    if (threshold !== null && ageInDays(worker) < threshold) continue;
    if (archiveRecord(worker, `manual archive via dashboard/orchestrator`)) {
      archived.workers += 1;
      changed = true;
    }
  }

  for (const pipeline of pipelines.values()) {
    if (pipeline.status === "running" || !matchesScope(pipeline, scope)) continue;
    if (threshold !== null && ageInDays(pipeline) < threshold) continue;
    if (archiveRecord(pipeline, `manual archive via dashboard/orchestrator`)) {
      archived.pipelines += 1;
      changed = true;
    }
  }

  for (const batch of batches.values()) {
    if (batch.status === "running" || !matchesScope(batch, scope)) continue;
    if (threshold !== null && ageInDays(batch) < threshold) continue;
    if (archiveRecord(batch, `manual archive via dashboard/orchestrator`)) {
      archived.batches += 1;
      changed = true;
    }
  }

  const totalArchived = archived.workers + archived.pipelines + archived.batches;
  if (totalArchived > 0) {
    telemetry.lifecycle.archived += totalArchived;
    telemetry.lastEvent = {
      type: "archive_history",
      at: now(),
      scope,
      id: "",
      status: "archived",
      note: `${totalArchived} records archived`,
    };
  }
  if (changed) saveState();
  return archived;
}

function purgeHistory({ scope = "all", olderThanDays = null, dryRun = false } = {}) {
  const threshold = Number.isFinite(olderThanDays) ? olderThanDays : null;
  const purged = { workers: 0, pipelines: 0, batches: 0 };

  const shouldPurge = (record) => {
    if (!isArchived(record)) return false;
    if (threshold !== null && ageInDays(record, "archivedAt") < threshold) return false;
    return true;
  };

  for (const worker of [...workers.values()]) {
    if (!matchesScope(worker, scope) || !shouldPurge(worker)) continue;
    if (!dryRun) {
      purgeWorkerArtifacts(worker);
      workers.delete(worker.id);
    }
    purged.workers += 1;
  }

  for (const pipeline of [...pipelines.values()]) {
    if (!matchesScope(pipeline, scope) || !shouldPurge(pipeline)) continue;
    if (!dryRun) {
      pipelines.delete(pipeline.id);
    }
    purged.pipelines += 1;
  }

  for (const batch of [...batches.values()]) {
    if (!matchesScope(batch, scope) || !shouldPurge(batch)) continue;
    if (!dryRun) {
      batches.delete(batch.id);
    }
    purged.batches += 1;
  }

  const totalPurged = purged.workers + purged.pipelines + purged.batches;
  if (totalPurged > 0 && !dryRun) {
    telemetry.lifecycle.purged += totalPurged;
    telemetry.lastEvent = {
      type: "purge_history",
      at: now(),
      scope,
      id: "",
      status: "purged",
      note: `${totalPurged} records purged`,
    };
    saveState();
  }

  return purged;
}

loadState();
applyLifecyclePolicy();
cleanupStaleRepoLocks();

// ── Helpers ────────────────────────────────────────────────────────────────────

function genId() { return randomBytes(4).toString("hex"); }
function now() { return new Date().toISOString(); }

function repoKey(repoPath) {
  return createHash("sha1").update(resolve(repoPath)).digest("hex");
}

function lockDirFor(repoPath) {
  return join(LOCKS_DIR, repoKey(repoPath));
}

function validateSlug(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(value)) {
    throw new Error(
      `${field} must be a short slug with letters, numbers, dots, underscores, or hyphens`
    );
  }
}

function validateGitRef(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty git ref`);
  }
  if (value.startsWith("-")) {
    throw new Error(`${field} must not start with "-"`);
  }
  if (/[\s\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${field} must not contain whitespace or control characters`);
  }
  if (/[~^:?*[\]\\]/.test(value) || value.includes("..") || value.endsWith(".lock")) {
    throw new Error(`${field} contains unsupported git ref characters`);
  }
}

function acquireRepoLock(repoPath, pipelineId) {
  const dir = lockDirFor(repoPath);
  try {
    mkdirSync(dir);
  } catch (err) {
    if (err?.code === "EEXIST") {
      throw new Error(`Another AFK pipeline is already running for ${repoPath}`);
    }
    throw err;
  }
  writeFileSync(
    join(dir, "lock.json"),
    JSON.stringify({ pipelineId, repoPath, createdAt: now() }, null, 2)
  );
  return dir;
}

function releaseRepoLock(repoPath) {
  try {
    rmSync(lockDirFor(repoPath), { recursive: true, force: true });
  } catch {}
}

function cleanupStaleRepoLocks() {
  const runningIds = new Set(
    [...pipelines.values()].filter((p) => p.status === "running").map((p) => p.id)
  );
  for (const entry of readdirSync(LOCKS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(LOCKS_DIR, entry.name);
    const lockFile = join(dir, "lock.json");
    let lock = null;
    try {
      lock = JSON.parse(readFileSync(lockFile, "utf8"));
    } catch {
      rmSync(dir, { recursive: true, force: true });
      continue;
    }
    const stillRunning = runningIds.has(lock.pipelineId);
    if (!stillRunning) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function sh(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

let codexLaunchMode = null;

function detectCodexLaunchMode() {
  if (codexLaunchMode) return codexLaunchMode;

  try {
    execFileSync("codex", ["exec", "--help"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    codexLaunchMode = "exec";
    return codexLaunchMode;
  } catch {}

  try {
    const help = execFileSync("codex", ["--help"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (help.includes("--full-auto")) {
      codexLaunchMode = "legacy";
      return codexLaunchMode;
    }
  } catch {}

  codexLaunchMode = "unsupported";
  return codexLaunchMode;
}

function buildAgentInvocation(agent, task, cwd) {
  if (agent !== "codex") {
    return { cmd: "claude", args: ["-p", task] };
  }

  const mode = detectCodexLaunchMode();
  if (mode === "exec") {
    return {
      cmd: "codex",
      args: [
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "--cd",
        cwd,
        task,
      ],
    };
  }

  if (mode === "legacy") {
    return { cmd: "codex", args: ["--full-auto", task] };
  }

  return {
    error:
      "Installed Codex CLI does not expose a supported non-interactive launch mode. Expected either `codex exec` or legacy `--full-auto` support.",
  };
}

function openUrl(targetUrl) {
  if (!targetUrl) return { ok: false, error: "Missing URL" };

  const platform = process.platform;
  const opener =
    platform === "darwin"
      ? { command: "open", args: [targetUrl] }
      : platform === "win32"
        ? { command: "cmd", args: ["/c", "start", "", targetUrl] }
        : { command: "xdg-open", args: [targetUrl] };

  try {
    const child = spawn(opener.command, opener.args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function waitForDashboardUrl(timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const meta = readJson(DASHBOARD_META_FILE, null);
    if (meta?.url && meta?.port) {
      return meta.url;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Dashboard did not start in time");
}

function spawnDetachedDashboard() {
  const child = spawn(process.execPath, [DASHBOARD_INDEX, "--serve-ui"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child.pid ?? null;
}

async function ensureDashboardAutostart() {
  const existing = readJson(DASHBOARD_META_FILE, null);
  if (existing?.pid && pidAlive(existing.pid) && existing?.url) {
    openUrl(existing.url);
    return;
  }

  try {
    mkdirSync(DATA_DIR, { recursive: true });
  } catch {}

  try {
    writeFileSync(
      DASHBOARD_META_FILE,
      JSON.stringify({ starting: true, startedAt: now() }, null, 2)
    );
  } catch {}

  try {
    spawnDetachedDashboard();
    const url = await waitForDashboardUrl();
    openUrl(url);
  } catch (error) {
    process.stderr.write(
      `dashboard autostart failed: ${error.stack || error.message}\n`
    );
  }
}

function defaultAgentForStage(stageId) {
  const hostAgent = process.env.HARNESS_ORCHESTRATOR_HOST === "codex" ? "codex" : "claude";
  const codeAgent = hostAgent === "claude" ? "codex" : "claude";
  return ["prototype", "implement", "qa", "update-docs", "handoff"].includes(stageId)
    ? codeAgent
    : hostAgent;
}

function resolveStageAgent(stageId, overrideAgent = null) {
  return overrideAgent || defaultAgentForStage(stageId);
}

function createPipelineRecord({ pipelineId, repoPath, description, agent, stages, batchId = null }) {
  return {
    id: pipelineId,
    description,
    repoPath,
    agent,
    repoCapabilities: null,
    recovery: null,
    mode: "single_repo",
    batchId,
    status: "running",
    stages: stages.map((id) => ({
      id,
      status: "pending",
      workerId: null,
      startTime: null,
      endTime: null,
      error: null,
    })),
    startTime: now(),
    endTime: null,
  };
}

function assertSingleRepoPath(repoPath) {
  if (!repoPath || typeof repoPath !== "string") {
    throw new Error("repo_path is required");
  }
}

function preflightRepoCapabilities(repoPath) {
  const absoluteRepoPath = resolve(repoPath);

  if (!existsSync(absoluteRepoPath)) {
    throw new Error(`repo_path not found: ${absoluteRepoPath}`);
  }

  try {
    accessSync(absoluteRepoPath);
  } catch {
    throw new Error(`repo_path is not accessible: ${absoluteRepoPath}`);
  }

  let gitRoot = null;
  let gitBranch = null;
  let gitRemote = null;

  try {
    gitRoot = runGit(["rev-parse", "--show-toplevel"], absoluteRepoPath);
    gitBranch = runGit(["branch", "--show-current"], absoluteRepoPath) || null;
    try {
      gitRemote = runGit(["remote", "get-url", "origin"], absoluteRepoPath) || null;
    } catch {
      gitRemote = null;
    }
  } catch (error) {
    throw new Error(`repo_path is not a git repository: ${absoluteRepoPath} (${error.message})`);
  }

  try {
    accessSync(gitRoot, 0o200);
  } catch {
    throw new Error(`git working tree is not writable: ${gitRoot}`);
  }

  return {
    repoPath: absoluteRepoPath,
    gitRoot,
    gitBranch,
    gitRemote,
    canWrite: true,
    directWriteSupported: true,
    branchProtectionKnown: false,
    branchProtectionCheckedAt: now(),
  };
}

function markRecoveredWorker(worker, reason) {
  worker.status = "failed";
  worker.exitCode = null;
  worker.endTime = now();
  worker.recoveryReason = reason;
}

function reconcileRecoveredWorkers() {
  let changed = false;
  for (const worker of workers.values()) {
    if (worker.status !== "running") continue;
    let alive = false;
    try {
      process.kill(worker.pid, 0);
      alive = true;
    } catch {}
    if (!alive) {
      markRecoveredWorker(worker, "worker process was not running after orchestrator restart");
      changed = true;
    }
  }
  if (changed) saveState();
}

async function startSingleRepoPipeline({
  repoPath,
  description = "",
  stages = ["implement", "qa", "update-docs"],
  agent = null,
  batchId = null,
}) {
  assertSingleRepoPath(repoPath);

  const badStages = stages.filter((stage) => !ALL_STAGES.includes(stage));
  if (badStages.length) {
    throw new Error(`Unknown stages: ${badStages.join(", ")}. Valid: ${ALL_STAGES.join(", ")}`);
  }

  const repoCapabilities = preflightRepoCapabilities(repoPath);

  try { mkdirSync(join(repoPath, ".harness", "pipeline"), { recursive: true }); } catch {}

  const pipelineId = genId();
  const pipeline = createPipelineRecord({
    pipelineId,
    repoPath,
    description,
    agent,
    stages,
    batchId,
  });
  pipeline.repoCapabilities = repoCapabilities;

  acquireRepoLock(repoPath, pipelineId);
  pipelines.set(pipelineId, pipeline);
  recordTelemetry("pipelines", "started", {
    type: "pipeline_started",
    id: pipelineId,
    note: repoPath,
  });
  saveState();

  await advancePipeline(pipeline);
  if (pipeline.status !== "running") {
    saveState();
  } else {
    startPollLoop();
  }

  return pipeline;
}

function buildPipelineSummary(pipeline) {
  const activeStage = pipeline.stages.find((s) => s.status === "running");
  return {
    pipeline_id: pipeline.id,
    status: pipeline.status,
    archived: pipeline.archived === true,
    archived_at: pipeline.archivedAt ?? null,
    archived_reason: pipeline.archivedReason ?? null,
    description: pipeline.description || null,
    repo_path: pipeline.repoPath,
    repo_capabilities: pipeline.repoCapabilities ?? null,
    recovery: pipeline.recovery ?? null,
    agent: pipeline.agent ?? "mixed",
    mode: pipeline.mode ?? "single_repo",
    batch_id: pipeline.batchId ?? null,
    current_stage:
      activeStage?.id ??
      (pipeline.status === "done" ? "complete" : pipeline.status === "blocked" ? "blocked" : null),
    start_time: pipeline.startTime,
    end_time: pipeline.endTime,
  };
}

function summarizeStageForMarkdown(stage) {
  const lines = [`- ${stage.id}: ${stage.status}`];
  if (stage.workerId) lines.push(`  - worker: ${stage.workerId}`);
  if (stage.error) lines.push(`  - error: ${stage.error}`);
  if (stage.result?.summary) lines.push(`  - summary: ${stage.result.summary}`);
  if (stage.result?.recommendations) lines.push(`  - next: ${stage.result.recommendations}`);
  if (Array.isArray(stage.result?.files_changed) && stage.result.files_changed.length) {
    lines.push(`  - files: ${stage.result.files_changed.join(", ")}`);
  }
  return lines.join("\n");
}

function buildPipelineMarkdown(pipeline) {
  const summary = buildPipelineSummary(pipeline);
  const lines = [
    `# Pipeline ${summary.pipeline_id}`,
    ``,
    `- status: ${summary.status}`,
    `- archived: ${summary.archived ? "yes" : "no"}`,
    `- mode: ${summary.mode}`,
    `- repo: ${summary.repo_path}`,
    `- agent: ${summary.agent}`,
    `- stage: ${summary.current_stage || "n/a"}`,
    `- started: ${summary.start_time || "n/a"}`,
    `- ended: ${summary.end_time || "n/a"}`,
  ];

  if (summary.repo_capabilities) {
    lines.push(
      ``,
      `## Repo capabilities`,
      `- git_root: ${summary.repo_capabilities.gitRoot || "n/a"}`,
      `- branch: ${summary.repo_capabilities.gitBranch || "n/a"}`,
      `- remote: ${summary.repo_capabilities.gitRemote || "n/a"}`
    );
  }

  if (summary.recovery?.note) {
    lines.push(``, `## Recovery`, `- ${summary.recovery.note}`);
  }

  lines.push(``, `## Stages`);
  for (const stage of pipeline.stages || []) {
    lines.push(summarizeStageForMarkdown(stage));
  }

  return lines.join("\n");
}

function buildBatchSummary(batch) {
  const pipelinesInBatch = Array.isArray(batch.pipelines) ? batch.pipelines : [];
  const counts = pipelinesInBatch.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === "running") acc.running += 1;
      else if (item.status === "done") acc.done += 1;
      else if (item.status === "blocked") acc.blocked += 1;
      else if (item.status === "failed") acc.failed += 1;
      else if (item.status === "cancelled") acc.cancelled += 1;
      return acc;
    },
    { total: 0, running: 0, done: 0, blocked: 0, failed: 0, cancelled: 0 }
  );

  return {
    batch_id: batch.id,
    mode: "batch",
    archived: batch.archived === true,
    archived_at: batch.archivedAt ?? null,
    archived_reason: batch.archivedReason ?? null,
    name: batch.name ?? null,
    description: batch.description ?? null,
    status: batch.status,
    repo_count: counts.total,
    running: counts.running,
    done: counts.done,
    blocked: counts.blocked,
    failed: counts.failed,
    cancelled: counts.cancelled,
    start_time: batch.startTime,
    end_time: batch.endTime,
    pipelines: pipelinesInBatch,
  };
}

function buildBatchMarkdown(batch) {
  const summary = buildBatchSummary(batch);
  const lines = [
    `# Batch ${summary.batch_id}`,
    ``,
    `- status: ${summary.status}`,
    `- archived: ${summary.archived ? "yes" : "no"}`,
    `- mode: ${summary.mode}`,
    `- name: ${summary.name || "n/a"}`,
    `- description: ${summary.description || "n/a"}`,
    `- repos: ${summary.repo_count}`,
    `- started: ${summary.start_time || "n/a"}`,
    `- ended: ${summary.end_time || "n/a"}`,
    ``,
    `## Pipelines`,
  ];

  for (const item of summary.pipelines || []) {
    lines.push(
      `- ${item.repoPath || "n/a"}: ${item.status}` +
      (item.currentStage ? ` (stage: ${item.currentStage})` : "") +
      (item.pipelineId ? ` [${item.pipelineId}]` : "")
    );
  }

  return lines.join("\n");
}

function refreshBatchStatuses() {
  let changed = false;

  for (const batch of batches.values()) {
    const items = Array.isArray(batch.pipelines) ? batch.pipelines : [];
    let hasRunning = false;
    let hasFailed = false;
    let hasBlocked = false;
    let allDone = items.length > 0;
    let allCancelled = items.length > 0;

    for (const item of items) {
      const pipeline = pipelines.get(item.pipelineId);
      if (!pipeline) {
        if (item.status === "running") hasRunning = true;
        if (item.status === "failed") hasFailed = true;
        if (item.status === "blocked") hasBlocked = true;
        if (item.status !== "done") allDone = false;
        if (item.status !== "cancelled") allCancelled = false;
        continue;
      }

      item.status = pipeline.status;
      item.currentStage = pipeline.stages.find((s) => s.status === "running")?.id ?? item.currentStage ?? null;

      if (pipeline.status === "running") hasRunning = true;
      if (pipeline.status === "failed") hasFailed = true;
      if (pipeline.status === "blocked") hasBlocked = true;
      if (pipeline.status !== "done") allDone = false;
      if (pipeline.status !== "cancelled") allCancelled = false;
    }

    const nextStatus = hasRunning
      ? "running"
      : hasFailed
        ? "failed"
        : hasBlocked
          ? "blocked"
          : allCancelled
            ? "cancelled"
            : allDone
              ? "done"
              : batch.status;

    if (nextStatus !== batch.status) {
      batch.status = nextStatus;
      if (nextStatus !== "running" && !batch.endTime) {
        batch.endTime = now();
        recordTelemetry("batches", nextStatus, {
          type: "batch_finished",
          id: batch.id,
          durationMs: Date.parse(batch.endTime) - Date.parse(batch.startTime),
          note: batch.description || batch.name || "",
        });
        recordHealthEvent({
          scope: "batch",
          id: batch.id,
          repoPath: "",
          level: healthLevelForStatus(nextStatus),
          type: "batch_health",
          status: nextStatus,
          title: `Batch ${nextStatus}`,
          detail: `${batch.description || batch.name || batch.id} finished as ${nextStatus}.`,
          durationMs: Date.parse(batch.endTime) - Date.parse(batch.startTime),
        });
      }
      changed = true;
    }
  }

  if (changed) saveState();
}

// ── Worker spawning ────────────────────────────────────────────────────────────

function autoCommitIfDirty(cwd, label) {
  try {
    if (sh("git status --porcelain", cwd)) {
      sh("git add -A", cwd);
      sh(`git commit -m "${label}: auto-commit remaining changes"`, cwd);
    }
  } catch {}
}

/**
 * Spawn a pipeline stage agent directly in the repo (no worktree, no branch).
 * Sequential stages share the same working directory — no merge needed.
 * Returns { workerId } on success, or { error } on failure.
 */
function spawnPipelineStage({ stageId, task, agent, repoPath, pipelineId = null }) {
  const workerId = genId();
  const logFile = join(LOGS_DIR, `${workerId}.log`);
  const selectedAgent = resolveStageAgent(stageId, agent);

  try { mkdirSync(join(repoPath, ".harness", "pipeline"), { recursive: true }); } catch {}

  const invocation = buildAgentInvocation(selectedAgent, task, repoPath);
  if (invocation.error) {
    return { error: invocation.error };
  }

  const { cmd, args: cmdArgs } = invocation;

  const logStream = createWriteStream(logFile, { flags: "a" });
  let proc;
  try {
    proc = spawn(cmd, cmdArgs, {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
  } catch (err) {
    logStream.end();
    return { error: `Failed to spawn ${selectedAgent}: ${err.message}` };
  }
  proc.stdout.pipe(logStream);
  proc.stderr.pipe(logStream);

  const record = {
    id: workerId,
    name: stageId,
    agent: selectedAgent,
    task,
    branch: null,       // pipeline stages commit directly — no branch
    worktreePath: null, // pipeline stages work in the repo directly
    repoPath,
    status: "running",
    pid: proc.pid ?? null,
    logFile,
    exitCode: null,
    startTime: now(),
    endTime: null,
  };
  workers.set(workerId, record);
  recordTelemetry("workers", "started", {
    type: "worker_started",
    id: workerId,
    note: `${stageId}@${repoPath}`,
  });
  saveState();

  proc.on("error", (err) => {
    logStream.end();
    const w = workers.get(workerId);
    if (!w) return;
    w.status = "failed";
    w.exitCode = null;
    w.endTime = now();
    saveState();

    if (pipelineId) {
      const pipeline = pipelines.get(pipelineId);
      const activeStage = pipeline?.stages.find((s) => s.workerId === workerId);
      if (pipeline && activeStage && pipeline.status === "running") {
        activeStage.status = "failed";
        activeStage.error = err.message;
        activeStage.endTime = now();
        void finishPipeline(pipeline, "failed").catch((finishErr) => {
          process.stderr.write(`finishPipeline failed: ${finishErr.stack || finishErr.message}\n`);
        });
      }
    }
  });

  proc.on("exit", (code) => {
    logStream.end();
    const w = workers.get(workerId);
    if (!w) return;
    if (code === 0) autoCommitIfDirty(w.repoPath, `pipeline(${w.name})`);
    w.status = code === 0 ? "done" : "failed";
    w.exitCode = code ?? null;
    w.endTime = now();
    if (w.status !== "terminated") {
      recordTelemetry("workers", w.status, {
        type: "worker_finished",
        id: w.id,
        durationMs: Date.parse(w.endTime) - Date.parse(w.startTime),
        note: w.repoPath,
      });
    }
    saveState();
  });

  return { workerId };
}

/**
 * Create a git worktree and spawn an agent inside it.
 * Used by the low-level spawn_worker tool for isolated one-off jobs.
 * Returns { workerId, branch, worktreePath } on success, or { error } on failure.
 */
function spawnWorker({ name, task, agent, repoPath, baseBranch = null }) {
  validateSlug(name, "name");
  if (baseBranch !== null) {
    validateGitRef(baseBranch, "base_branch");
  }

  preflightRepoCapabilities(repoPath);

  const workerId = genId();
  const branch = `agent/${name}-${workerId}`;
  const worktreePath = join(WORKTREES_DIR, workerId);
  const logFile = join(LOGS_DIR, `${workerId}.log`);

  try {
    runGit(
      ["worktree", "add", "-b", branch, worktreePath, baseBranch || "HEAD"],
      repoPath
    );
  } catch (err) {
    return { error: `Failed to create worktree: ${err.message}` };
  }

  // Ensure pipeline status dir exists inside the worktree
  try { mkdirSync(join(worktreePath, ".harness", "pipeline"), { recursive: true }); } catch {}

  const fullTask =
    `${task}\n\n` +
    `When you have finished all work, commit every change with a descriptive message.`;

  const invocation = buildAgentInvocation(agent, fullTask, worktreePath);
  if (invocation.error) {
    try {
      runGit(["worktree", "remove", "--force", worktreePath], repoPath);
    } catch {}
    return { error: invocation.error };
  }

  const { cmd, args: cmdArgs } = invocation;

  const logStream = createWriteStream(logFile, { flags: "a" });
  const proc = spawn(cmd, cmdArgs, {
    cwd: worktreePath,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  proc.stdout.pipe(logStream);
  proc.stderr.pipe(logStream);

  const record = {
    id: workerId,
    name,
    agent,
    task,
    branch,
    worktreePath,
    repoPath,
    status: "running",
    pid: proc.pid ?? null,
    logFile,
    exitCode: null,
    startTime: now(),
    endTime: null,
  };
  workers.set(workerId, record);
  recordTelemetry("workers", "started", {
    type: "worker_started",
    id: workerId,
    note: `${name}@${repoPath}`,
  });
  saveState();

  proc.on("error", (err) => {
    logStream.end();
    const w = workers.get(workerId);
    if (!w) return;
    w.status = "failed";
    w.exitCode = null;
    w.endTime = now();
    saveState();
  });

  proc.on("exit", (code) => {
    logStream.end();
    const w = workers.get(workerId);
    if (!w) return;
    if (code === 0) autoCommitIfDirty(w.worktreePath, `agent(${w.name})`);
    if (w.status !== "terminated") w.status = code === 0 ? "done" : "failed";
    w.exitCode = code ?? null;
    w.endTime = now();
    if (w.status !== "terminated") {
      recordTelemetry("workers", w.status, {
        type: "worker_finished",
        id: w.id,
        durationMs: Date.parse(w.endTime) - Date.parse(w.startTime),
        note: w.repoPath,
      });
    }
    saveState();
  });

  return { workerId, branch, worktreePath };
}

// ── Pipeline state machine ─────────────────────────────────────────────────────

let pollTimer = null;

function startPollLoop() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void tickAllPipelines().catch((error) => {
      process.stderr.write(`tickAllPipelines failed: ${error.stack || error.message}\n`);
    });
  }, 30_000);
}

function maybeStopPollLoop() {
  if ([...pipelines.values()].every(p => p.status !== "running")) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function finishPipeline(pipeline, status) {
  pipeline.status = status;
  pipeline.endTime = now();
  releaseRepoLock(pipeline.repoPath);
  recordTelemetry("pipelines", status, {
    type: "pipeline_finished",
    id: pipeline.id,
    durationMs: Date.parse(pipeline.endTime) - Date.parse(pipeline.startTime),
    note: pipeline.repoPath,
  });
  recordHealthEvent({
    scope: "pipeline",
    id: pipeline.id,
    repoPath: pipeline.repoPath,
    level: healthLevelForStatus(status),
    type: "pipeline_health",
    status,
    title: `Pipeline ${status}`,
    detail: `${pipeline.description || pipeline.id} finished as ${status}.`,
    durationMs: Date.parse(pipeline.endTime) - Date.parse(pipeline.startTime),
  });
  saveState();
  refreshBatchStatuses();
  maybeStopPollLoop();
}

function normalizeStageOutcome(result) {
  const status = result?.status;
  const blocked = Array.isArray(result?.blocked) ? result.blocked : [];
  if (status === "done") {
    return { status: "done" };
  }
  if (status === "blocked" || blocked.length > 0) {
    return {
      status: "blocked",
      reason:
        blocked.map((item) => item?.reason).filter(Boolean).join("; ") ||
        result?.summary ||
        result?.recommendations ||
        "stage reported a blocker",
    };
  }
  if (status === "partial") {
    return {
      status: "blocked",
      reason: result?.summary || result?.recommendations || "stage ended partial",
    };
  }
  return {
    status: "failed",
    reason: "stage did not write a recognized result.json status",
  };
}

async function tickAllPipelines() {
  for (const p of pipelines.values()) {
    if (p.status === "running") {
      await tickPipeline(p);
    }
  }
  maybeStopPollLoop();
}

async function tickPipeline(pipeline) {
  const activeStage = pipeline.stages.find(s => s.status === "running");

  if (activeStage) {
    const worker = activeStage.workerId ? workers.get(activeStage.workerId) : null;
    if (!worker) {
      const resultFile = join(
        pipeline.repoPath, ".harness", "pipeline", `${activeStage.id}-result.json`
      );
      if (existsSync(resultFile)) {
        try {
          activeStage.result = JSON.parse(readFileSync(resultFile, "utf8"));
        } catch {
          activeStage.result = null;
        }
        const outcome = normalizeStageOutcome(activeStage.result);
        activeStage.status = outcome.status;
        if (outcome.status !== "done") {
          activeStage.error = outcome.reason;
        }
        activeStage.endTime = now();
        pipeline.recovery = {
          last_checked_at: now(),
          note: "Recovered stage from result.json after worker record was missing",
        };
        saveState();
        if (outcome.status === "done") {
          await advancePipeline(pipeline);
        } else {
          await finishPipeline(pipeline, outcome.status);
        }
      } else {
        activeStage.status = "failed";
        activeStage.error = "Recovered pipeline could not find the active worker record or result.json after restart";
        activeStage.endTime = now();
        pipeline.recovery = {
          last_checked_at: now(),
          note: "Active stage had no worker record or result.json after restart",
        };
        await finishPipeline(pipeline, "failed");
      }
      return;
    }

    // Re-check liveness for workers still marked running
    if (worker.status === "running") {
      let alive = false;
      try { process.kill(worker.pid, 0); alive = true; } catch {}
      if (!alive) {
        worker.status = "failed";
        worker.endTime = now();
        saveState();
      }
    }

    if (worker.status === "done") {
      // Read the result.json the worker was instructed to write
      const resultFile = join(
        pipeline.repoPath, ".harness", "pipeline", `${activeStage.id}-result.json`
      );
      try {
        activeStage.result = JSON.parse(readFileSync(resultFile, "utf8"));
      } catch {
        activeStage.result = null; // worker didn't write it — continue anyway
      }
      const outcome = normalizeStageOutcome(activeStage.result);
      activeStage.status = outcome.status;
      if (outcome.status !== "done") {
        activeStage.error = outcome.reason;
      }
      activeStage.endTime = now();
      saveState();
      if (outcome.status === "done") {
        await advancePipeline(pipeline);
      } else {
        await finishPipeline(pipeline, outcome.status);
      }
    } else if (worker.status === "failed" || worker.status === "terminated") {
      activeStage.status = "failed";
      activeStage.endTime = now();
      await finishPipeline(pipeline, "failed");
    }
    return;
  }

  // No stage currently running — try to advance
  await advancePipeline(pipeline);
}

async function advancePipeline(pipeline) {
  const nextStage = pipeline.stages.find(s => s.status === "pending");

  if (!nextStage) {
    await finishPipeline(pipeline, "done");
    return;
  }

  // Pass the last completed stage's result as context for the next stage
  const lastDone = pipeline.stages.findLast(s => s.status === "done");
  const previousResult = lastDone?.result ?? null;

  const prompt = stagePrompt(
    nextStage.id,
    pipeline.repoPath,
    pipeline.description,
    previousResult,
  );

  const spawned = spawnPipelineStage({
    stageId: nextStage.id,
    task: prompt,
    agent: pipeline.agent,
    repoPath: pipeline.repoPath,
    pipelineId: pipeline.id,
  });

  if (spawned.error) {
    nextStage.status = "failed";
    nextStage.error = spawned.error;
    await finishPipeline(pipeline, "failed");
    return;
  }
  const { workerId } = spawned;

  nextStage.status = "running";
  nextStage.workerId = workerId;
  nextStage.startTime = now();
  saveState();
}

/** On MCP server restart, resume polling for any pipelines that were mid-flight. */
async function resumePipelines() {
  let hasRunning = false;
  for (const p of pipelines.values()) {
    if (p.status !== "running") continue;
    hasRunning = true;
    // Tick immediately — a stage's worker may have completed while we were down
    await tickPipeline(p);
  }
  if (hasRunning) startPollLoop();
}

if (!IS_TEST_MODE) {
  reconcileRecoveredWorkers();
  void resumePipelines().catch((error) => {
    process.stderr.write(`resumePipelines failed: ${error.stack || error.message}\n`);
  });
  const retentionTimer = setInterval(applyLifecyclePolicy, 15 * 60 * 1000);
  retentionTimer.unref?.();
  void ensureDashboardAutostart();
}

// ── MCP server setup ───────────────────────────────────────────────────────────

const server = new Server(
  { name: "agent-orchestrator", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

// ── Tool definitions ───────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ── Pipeline (high-level, AFK) ──────────────────────────────────────────
    {
      name: "run_pipeline",
      description: [
        "Start an automated harness pipeline for a single repository. Stages run sequentially and autonomously:",
        "each stage spawns a worker that executes the harness skill as-is (SKILL.md unchanged),",
        "commits its work, and the next stage starts only after the previous result is recorded.",
        "Returns immediately with a pipeline_id. Poll get_pipeline_status to monitor.",
        "",
        "Common presets:",
        "  Mid-project (planning already done): [\"implement\",\"qa\",\"update-docs\"] (default)",
        "  Full greenfield: [\"ideate\",\"product-plan\",\"dev-plan\",\"implement\",\"qa\",\"update-docs\"]",
        "  With prototype: add \"prototype\" between \"dev-plan\" and \"implement\"",
        "  With session handoff: append \"handoff\"",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: {
          repo_path: {
            type: "string",
            description: "Absolute path to the git repository root.",
          },
          description: {
            type: "string",
            description: "Goal or idea description — passed as context to every stage agent.",
          },
          stages: {
            type: "array",
            items: { type: "string", enum: ALL_STAGES },
            description: `Ordered list of harness stages to run. Default: ["implement","qa","update-docs"]. Available: ${ALL_STAGES.join(", ")}.`,
          },
          agent: {
            type: "string",
            enum: ["claude", "codex"],
            description: "Optional override for every stage. Default: planning stages use 'claude' and execution stages use 'codex'.",
          },
        },
        required: ["repo_path"],
      },
    },
    {
      name: "run_batch",
      description: [
        "Start a batch of independent single-repo pipeline runs for multi-repo work.",
        "Each repo gets its own pipeline, lock, and status stream.",
        "Use this only when you explicitly want to fan out the same or related work across multiple repositories.",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: {
          batch_name: {
            type: "string",
            description: "Short human-readable name for the batch.",
          },
          description: {
            type: "string",
            description: "Shared description for the batch.",
          },
          runs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                repo_path: {
                  type: "string",
                  description: "Absolute path to the git repository root.",
                },
                description: {
                  type: "string",
                  description: "Optional per-repo description override.",
                },
                stages: {
                  type: "array",
                  items: { type: "string", enum: ALL_STAGES },
                  description: "Optional ordered list of stages for this repo.",
                },
                agent: {
                  type: "string",
                  enum: ["claude", "codex"],
                  description: "Optional override for this repo.",
                },
              },
              required: ["repo_path"],
            },
          },
        },
        required: ["runs"],
      },
    },
    {
      name: "get_pipeline_status",
      description: "Get the full status of a pipeline: current stage, per-stage results, blockers, and worker IDs for log access.",
      inputSchema: {
        type: "object",
        properties: {
          pipeline_id: { type: "string" },
          format: {
            type: "string",
            enum: ["json", "markdown"],
            description: "Output format for the export. JSON is machine-friendly; Markdown is prompt-friendly.",
          },
        },
        required: ["pipeline_id"],
      },
    },
    {
      name: "list_pipelines",
      description: "List all pipelines (running, done, blocked, failed, cancelled).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_batch_status",
      description: "Get the status of a multi-repo batch and the pipelines it contains.",
      inputSchema: {
        type: "object",
        properties: {
          batch_id: { type: "string" },
          format: {
            type: "string",
            enum: ["json", "markdown"],
            description: "Output format for the export. JSON is machine-friendly; Markdown is prompt-friendly.",
          },
        },
        required: ["batch_id"],
      },
    },
    {
      name: "list_batches",
      description: "List all multi-repo batches.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "archive_history",
      description: "Archive completed or failed history items so they remain visible but are marked for retention.",
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["all", "workers", "pipelines", "batches"],
            description: "Which records to archive.",
          },
          older_than_days: {
            type: "number",
            description: "Only archive records older than this many days.",
          },
        },
      },
    },
    {
      name: "purge_history",
      description: "Purge archived history items and their attached artifacts.",
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["all", "workers", "pipelines", "batches"],
            description: "Which records to purge.",
          },
          older_than_days: {
            type: "number",
            description: "Only purge archived records older than this many days.",
          },
          dry_run: {
            type: "boolean",
            description: "If true, report what would be purged without deleting anything.",
          },
        },
      },
    },
    {
      name: "list_history",
      description: "List archived history items across pipelines, batches, and workers.",
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["all", "workers", "pipelines", "batches"],
            description: "Which history records to include.",
          },
        },
      },
    },
    {
      name: "cancel_pipeline",
      description: "Cancel a running pipeline and SIGTERM its active stage worker.",
      inputSchema: {
        type: "object",
        properties: { pipeline_id: { type: "string" } },
        required: ["pipeline_id"],
      },
    },
    // ── Workers (low-level, manual) ─────────────────────────────────────────
    {
      name: "spawn_worker",
      description: [
        "Low-level: spawn a single agent in an isolated git worktree with an arbitrary task.",
        "Use run_pipeline for automated harness workflows; use this for one-off jobs or custom stages.",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short slug (no spaces), used in the branch name." },
          task: { type: "string", description: "Full prompt / task description for the agent." },
          agent: { type: "string", enum: ["claude", "codex"] },
          repo_path: { type: "string", description: "Absolute path to the git repository root." },
          base_branch: { type: "string", description: "Ref to base the worktree on. Defaults to HEAD." },
        },
        required: ["name", "task", "agent", "repo_path"],
      },
    },
    {
      name: "get_worker_status",
      description: "Check a worker's status: running / done / failed / terminated.",
      inputSchema: {
        type: "object",
        properties: { worker_id: { type: "string" } },
        required: ["worker_id"],
      },
    },
    {
      name: "get_worker_log",
      description: "Fetch captured stdout/stderr from a worker process.",
      inputSchema: {
        type: "object",
        properties: {
          worker_id: { type: "string" },
          tail: { type: "number", description: "Last N lines (default: 100). Pass 0 for full log." },
        },
        required: ["worker_id"],
      },
    },
    {
      name: "list_workers",
      description: "List all workers and their statuses.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "terminate_worker",
      description: "Send SIGTERM to a running worker.",
      inputSchema: {
        type: "object",
        properties: { worker_id: { type: "string" } },
        required: ["worker_id"],
      },
    },
    {
      name: "cleanup_worker",
      description: "Remove a worker's git worktree. The branch is kept for inspection or manual merge.",
      inputSchema: {
        type: "object",
        properties: { worker_id: { type: "string" } },
        required: ["worker_id"],
      },
    },
  ],
}));

// ── Tool handlers ──────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  // ── run_pipeline ───────────────────────────────────────────────────────────
  if (name === "run_pipeline") {
    const {
      repo_path,
      description = "",
      stages = ["implement", "qa", "update-docs"],
      agent = null,
    } = args;

    try {
      const pipeline = await startSingleRepoPipeline({
        repoPath: repo_path,
        description,
        stages,
        agent,
      });

      if (pipeline.status !== "running") {
        const first = pipeline.stages[0];
        return err(`Pipeline failed to start: ${first?.error || "unknown error"}`);
      }

      const first = pipeline.stages[0];
      return ok({
        pipeline_id: pipeline.id,
        status: "running",
        stages,
        current_stage: first.id,
        first_worker_id: first.workerId,
        agent: agent ?? "mixed",
        mode: "single_repo",
        tip: `Poll get_pipeline_status("${pipeline.id}") to check progress. Each stage commits directly to the repo; only result.status === "done" advances the pipeline, while "partial" or "blocked" stops it for human review.`,
      });
    } catch (e) {
      return err(e.message);
    }
  }

  // ── run_batch ─────────────────────────────────────────────────────────────
  if (name === "run_batch") {
    const {
      batch_name = "",
      description = "",
      runs = [],
    } = args;

    if (!Array.isArray(runs) || runs.length === 0) {
      return err("runs must be a non-empty array");
    }

    const batchId = genId();
    const batch = {
      id: batchId,
      name: batch_name || null,
      description: description || null,
      status: "running",
      startTime: now(),
      endTime: null,
      pipelines: [],
    };
    batches.set(batchId, batch);
    recordTelemetry("batches", "started", {
      type: "batch_started",
      id: batchId,
      note: batch.description || batch.name || "",
    });
    saveState();

    const failures = [];

    for (const run of runs) {
      try {
        const pipeline = await startSingleRepoPipeline({
          repoPath: run.repo_path,
          description: run.description || description || "",
          stages: Array.isArray(run.stages) && run.stages.length ? run.stages : ["implement", "qa", "update-docs"],
          agent: run.agent ?? null,
          batchId,
        });
        batch.pipelines.push({
          pipelineId: pipeline.id,
          repoPath: pipeline.repoPath,
          status: pipeline.status,
          currentStage: pipeline.stages.find((s) => s.status === "running")?.id ?? null,
        });
        if (pipeline.status !== "running") {
          failures.push(
            `repo ${run.repo_path}: ${pipeline.stages[0]?.error || "failed to start"}`
          );
        }
      } catch (error) {
        batch.pipelines.push({
          pipelineId: null,
          repoPath: run.repo_path,
          status: "failed",
          currentStage: null,
          error: error instanceof Error ? error.message : String(error),
        });
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    refreshBatchStatuses();

    return ok({
      batch_id: batchId,
      status: batch.status,
      batch_name: batch.name,
      description: batch.description,
      pipelines: batch.pipelines,
      failures: failures.length ? failures : undefined,
      tip: "Poll get_batch_status(batch_id) to watch the batch or get_pipeline_status(pipeline_id) for a single repo.",
    });
  }

  // ── get_pipeline_status ────────────────────────────────────────────────────
  if (name === "get_pipeline_status") {
    const p = pipelines.get(args.pipeline_id);
    if (!p) return err(`No pipeline: ${args.pipeline_id}`);

    // Force a fresh tick so the status is always up to date
    if (p.status === "running") await tickPipeline(p);

    const stageDetails = p.stages.map(s => {
      const w = s.workerId ? workers.get(s.workerId) : null;
      return {
        id: s.id,
        status: s.status,
        worker_id: s.workerId,
        worker_status: w?.status ?? null,
        start_time: s.startTime,
        end_time: s.endTime,
        result: s.result ?? null,
        error: s.error ?? null,
      };
    });
    const format = args.format === "markdown" ? "markdown" : "json";
    if (format === "markdown") {
      const exportPipeline = {
        ...p,
        stages: p.stages.map((stage, index) => ({
          ...stage,
          result: stageDetails[index]?.result ?? stage.result ?? null,
        })),
      };
      return ok(buildPipelineMarkdown(exportPipeline));
    }

    return ok({
      ...buildPipelineSummary(p),
      stages: stageDetails,
    });
  }

  // ── list_pipelines ─────────────────────────────────────────────────────────
  if (name === "list_pipelines") {
    refreshBatchStatuses();
    if (!pipelines.size) return ok("No pipelines registered.");
    return ok(
      [...pipelines.values()].map((p) => ({
        id: p.id,
        status: p.status,
        archived: p.archived === true,
        description: p.description || null,
        mode: p.mode ?? "single_repo",
        batch_id: p.batchId ?? null,
        repo_path: p.repoPath,
        stages: p.stages.map((s) => `${s.id}:${s.status}`).join(" → "),
        start_time: p.startTime,
        end_time: p.endTime ?? "-",
      }))
    );
  }

  // ── get_batch_status ──────────────────────────────────────────────────────
  if (name === "get_batch_status") {
    refreshBatchStatuses();
    const batch = batches.get(args.batch_id);
    if (!batch) return err(`No batch: ${args.batch_id}`);
    if (args.format === "markdown") {
      return ok(buildBatchMarkdown(batch));
    }
    return ok(buildBatchSummary(batch));
  }

  // ── list_batches ──────────────────────────────────────────────────────────
  if (name === "list_batches") {
    refreshBatchStatuses();
    if (!batches.size) return ok("No batches registered.");
    return ok([...batches.values()].map((batch) => buildBatchSummary(batch)));
  }

  // ── archive_history ──────────────────────────────────────────────────────
  if (name === "archive_history") {
    const result = archiveHistory({
      scope: args.scope || "all",
      olderThanDays: Number.isFinite(args.older_than_days) ? args.older_than_days : null,
    });
    return ok({
      ok: true,
      action: "archive_history",
      scope: args.scope || "all",
      archived: result,
    });
  }

  // ── purge_history ────────────────────────────────────────────────────────
  if (name === "purge_history") {
    const result = purgeHistory({
      scope: args.scope || "all",
      olderThanDays: Number.isFinite(args.older_than_days) ? args.older_than_days : null,
      dryRun: args.dry_run === true,
    });
    return ok({
      ok: true,
      action: "purge_history",
      scope: args.scope || "all",
      dry_run: args.dry_run === true,
      purged: result,
    });
  }

  // ── list_history ──────────────────────────────────────────────────────────
  if (name === "list_history") {
    const scope = args.scope || "all";
    const payload = {
      workers: [...workers.values()]
        .filter((worker) => isArchived(worker) && matchesScope(worker, scope))
        .map((worker) => ({
          id: worker.id,
          status: worker.status,
          archived_at: worker.archivedAt ?? null,
          archived_reason: worker.archivedReason ?? null,
          repo_path: worker.repoPath,
        })),
      pipelines: [...pipelines.values()]
        .filter((pipeline) => isArchived(pipeline) && matchesScope(pipeline, scope))
        .map((pipeline) => ({
          id: pipeline.id,
          status: pipeline.status,
          archived_at: pipeline.archivedAt ?? null,
          archived_reason: pipeline.archivedReason ?? null,
          repo_path: pipeline.repoPath,
        })),
      batches: [...batches.values()]
        .filter((batch) => isArchived(batch) && matchesScope(batch, scope))
        .map((batch) => ({
          id: batch.id,
          status: batch.status,
          archived_at: batch.archivedAt ?? null,
          archived_reason: batch.archivedReason ?? null,
        })),
    };
    return ok(payload);
  }

  // ── cancel_pipeline ────────────────────────────────────────────────────────
  if (name === "cancel_pipeline") {
    const p = pipelines.get(args.pipeline_id);
    if (!p) return err(`No pipeline: ${args.pipeline_id}`);
    if (p.status !== "running") return ok(`Pipeline is already ${p.status}.`);

    const active = p.stages.find(s => s.status === "running");
    if (active?.workerId) {
      const w = workers.get(active.workerId);
      if (w?.pid) {
        try { process.kill(w.pid, "SIGTERM"); } catch {}
        w.status = "terminated";
        w.endTime = now();
      }
      active.status = "failed";
      active.endTime = now();
    }

    void finishPipeline(p, "cancelled").catch((error) => {
      process.stderr.write(`finishPipeline failed: ${error.stack || error.message}\n`);
    });
    recordTelemetry("manual", "cancels", {
      type: "manual_cancel_pipeline",
      id: p.id,
      note: p.repoPath,
    });
    return ok(`Pipeline ${p.id} cancelled.`);
  }

  // ── spawn_worker ───────────────────────────────────────────────────────────
  if (name === "spawn_worker") {
    const { name: workerName, task, agent, repo_path, base_branch } = args;
    const result = spawnWorker({
      name: workerName,
      task,
      agent,
      repoPath: repo_path,
      baseBranch: base_branch ?? null,
    });
    if (result.error) return err(result.error);
    return ok({
      worker_id: result.workerId,
      branch: result.branch,
      worktree_path: result.worktreePath,
      status: "running",
    });
  }

  // ── get_worker_status ──────────────────────────────────────────────────────
  if (name === "get_worker_status") {
    const w = workers.get(args.worker_id);
    if (!w) return err(`No worker: ${args.worker_id}`);
    if (w.status === "running") {
      let alive = false;
      try { process.kill(w.pid, 0); alive = true; } catch {}
      if (!alive) { w.status = "failed"; w.endTime = now(); saveState(); }
    }
    return ok({
      id: w.id, name: w.name, agent: w.agent,
      status: w.status, branch: w.branch,
      archived: w.archived === true,
      worktree_path: w.worktreePath, repo_path: w.repoPath,
      pid: w.pid, exit_code: w.exitCode,
      recovery_reason: w.recoveryReason ?? null,
      start_time: w.startTime, end_time: w.endTime,
    });
  }

  // ── get_worker_log ─────────────────────────────────────────────────────────
  if (name === "get_worker_log") {
    const w = workers.get(args.worker_id);
    if (!w) return err(`No worker: ${args.worker_id}`);
    try {
      const raw = existsSync(w.logFile) ? readFileSync(w.logFile, "utf8") : "";
      const lines = raw.split("\n");
      const tailN = args.tail ?? 100;
      return ok((tailN === 0 ? lines : lines.slice(-tailN)).join("\n") || "(no output yet)");
    } catch (e) {
      return err(`Cannot read log: ${e.message}`);
    }
  }

  // ── list_workers ───────────────────────────────────────────────────────────
  if (name === "list_workers") {
    if (!workers.size) return ok("No workers registered.");
    return ok(
      [...workers.values()].map(w => ({
        id: w.id, name: w.name, agent: w.agent,
        status: w.status, branch: w.branch,
        archived: w.archived === true,
        recovery_reason: w.recoveryReason ?? null,
        start_time: w.startTime, end_time: w.endTime ?? "-",
      }))
    );
  }

  // ── terminate_worker ───────────────────────────────────────────────────────
  if (name === "terminate_worker") {
    const w = workers.get(args.worker_id);
    if (!w) return err(`No worker: ${args.worker_id}`);
    if (w.status !== "running") return ok(`Worker is not running (status: ${w.status}).`);
    try {
      process.kill(w.pid, "SIGTERM");
      w.status = "terminated"; w.endTime = now();
      recordTelemetry("manual", "terminations", {
        type: "manual_terminate_worker",
        id: w.id,
        note: w.repoPath,
      });
      saveState();
      return ok(`Worker ${w.id} (${w.name}) terminated.`);
    } catch (e) {
      return err(`Failed to terminate: ${e.message}`);
    }
  }

  // ── cleanup_worker ─────────────────────────────────────────────────────────
  if (name === "cleanup_worker") {
    const w = workers.get(args.worker_id);
    if (!w) return err(`No worker: ${args.worker_id}`);
    if (w.status === "running") return err("Worker is still running. Terminate it first.");
    // Only pipeline-less (spawn_worker) workers have a worktree to remove
    if (w.worktreePath) {
      try { sh(`git worktree remove --force "${w.worktreePath}"`, w.repoPath); } catch {}
    }
    workers.delete(w.id);
    recordTelemetry("manual", "cleanups", {
      type: "manual_cleanup_worker",
      id: w.id,
      note: w.repoPath,
    });
    saveState();
    const msg = w.branch
      ? `Worker ${w.id} (${w.name}) cleaned up.\nBranch '${w.branch}' still exists — merge or delete when ready.`
      : `Worker ${w.id} (${w.name}) removed from registry. Changes were committed directly to the repo.`;
    return ok(msg);
  }

  return err(`Unknown tool: ${name}`);
});

// ── Response helpers ───────────────────────────────────────────────────────────

function ok(data) {
  return {
    content: [{
      type: "text",
      text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
    }],
  };
}

function err(msg) {
  return { content: [{ type: "text", text: msg }], isError: true };
}

// ── Connect ────────────────────────────────────────────────────────────────────

if (!IS_TEST_MODE) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export const __test = {
  get telemetry() { return telemetry; },
  workers,
  pipelines,
  batches,
  createTelemetry,
  normalizeTelemetry,
  recordTelemetry,
  recordHealthEvent,
  telemetryAverageMs,
  loadState,
  saveState,
  applyLifecyclePolicy,
  archiveHistory,
  purgeHistory,
  buildPipelineSummary,
  buildBatchSummary,
  buildPipelineMarkdown,
  buildBatchMarkdown,
  preflightRepoCapabilities,
  acquireRepoLock,
  releaseRepoLock,
  tickPipeline,
  resumePipelines,
  reconcileRecoveredWorkers,
  createPipelineRecord,
  markRecoveredWorker,
  detectCodexLaunchMode,
  buildAgentInvocation,
  resolveStageAgent,
  defaultAgentForStage,
  normalizeStageOutcome,
};
