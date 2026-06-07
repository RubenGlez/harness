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
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import { now, readJson, pidAlive, readReadySignal } from "../shared/runtime.ts";
import {
  DATA_DIR,
  STATE_FILE,
  createTelemetry,
  normalizeHealthEvent,
  readState as readStateFromDisk,
  writeState as writeStateToDisk,
} from "../shared/store.ts";
import type { Telemetry, HealthLevel, HealthEvent, LastEvent } from "../shared/store.ts";
import { pipelineStages } from "../shared/skills.ts";

// ── Types ──────────────────────────────────────────────────────────────────────

type WorkerStatus = "running" | "done" | "failed" | "terminated" | "cancelled";
type PipelineStatus = "running" | "done" | "blocked" | "failed" | "cancelled";
type StageStatus = "pending" | "running" | "done" | "blocked" | "failed";

interface StageResult {
  stage: string;
  status: string;
  summary?: string;
  completed?: string[];
  blocked?: Array<{ item: string; reason: string }>;
  files_changed?: string[];
  recommendations?: string;
}

interface Stage {
  id: string;
  status: StageStatus;
  workerId: string | null;
  startTime: string | null;
  endTime: string | null;
  error: string | null;
  result?: StageResult | null;
}

interface Worker {
  id: string;
  name: string;
  agent: string;
  task: string;
  branch: string | null;
  worktreePath: string | null;
  repoPath: string;
  status: WorkerStatus;
  pid: number | null;
  logFile: string;
  exitCode: number | null;
  startTime: string;
  endTime: string | null;
  recoveryReason?: string;
  archived?: boolean;
  archivedAt?: string;
  archivedReason?: string;
}

interface RepoCapabilities {
  repoPath: string;
  gitRoot: string;
  gitBranch: string | null;
  gitRemote: string | null;
  canWrite: boolean;
  directWriteSupported: boolean;
  branchProtectionKnown: boolean;
  branchProtectionCheckedAt: string;
}

interface Recovery {
  last_checked_at: string;
  note: string;
}

interface Pipeline {
  id: string;
  description: string;
  repoPath: string;
  agent: string | null;
  repoCapabilities: RepoCapabilities | null;
  recovery: Recovery | null;
  mode: string;
  batchId: string | null;
  status: PipelineStatus;
  stages: Stage[];
  startTime: string;
  endTime: string | null;
  archived?: boolean;
  archivedAt?: string;
  archivedReason?: string;
}

interface BatchPipelineItem {
  pipelineId: string | null;
  repoPath: string;
  status: string;
  currentStage: string | null;
  error?: string;
}

interface Batch {
  id: string;
  name: string | null;
  description: string | null;
  status: string;
  startTime: string;
  endTime: string | null;
  pipelines: BatchPipelineItem[];
  archived?: boolean;
  archivedAt?: string;
  archivedReason?: string;
}

interface AgentInvocation {
  cmd?: string;
  args?: string[];
  error?: string;
}

interface SpawnWorkerResult {
  workerId?: string;
  branch?: string;
  worktreePath?: string;
  error?: string;
}

interface SpawnStageResult {
  workerId?: string;
  error?: string;
}

interface LifecyclePolicy {
  completedArchiveDays: number;
  completedPurgeDays: number;
  failedArchiveDays: number;
  failedPurgeDays: number;
  workerArchiveDays: number;
  workerPurgeDays: number;
  batchArchiveDays: number;
  batchPurgeDays: number;
}

type ArchiveScope = "all" | "workers" | "pipelines" | "batches";

interface ArchiveCounts {
  workers: number;
  pipelines: number;
  batches: number;
}

// ── Paths ──────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS_DIR = resolve(__dirname, "../..");
const WORKTREES_DIR = join(DATA_DIR, "worktrees");
const LOGS_DIR = join(DATA_DIR, "logs");
const LOCKS_DIR = join(DATA_DIR, "locks");
const DASHBOARD_META_FILE = join(DATA_DIR, "dashboard.json");
const DASHBOARD_INDEX = join(HARNESS_DIR, "mcp", "agent-dashboard", "index.ts");
const IS_TEST_MODE = process.env.HARNESS_TEST_MODE === "1";

function parseDaysEnv(name: string, fallback: number): number {
  const raw = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

const LIFECYCLE_POLICY: LifecyclePolicy = {
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

const ALL_STAGES = pipelineStages(join(HARNESS_DIR, "skills"));

function stagePrompt(stageId: string, repoPath: string, description: string, previousResult: StageResult | null = null): string {
  const skillFile = join(HARNESS_DIR, "skills", stageId, "SKILL.md");
  const skillContent = existsSync(skillFile)
    ? readFileSync(skillFile, "utf8")
    : `Execute the '${stageId}' stage of the harness workflow on the project.`;

  const lines = [
    `You are an autonomous agent executing the "${stageId}" stage of the harness pipeline.`,
    `Project repository: ${repoPath}`,
  ];

  if (description) lines.push(`Pipeline goal: ${description}`);

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

const workers = new Map<string, Worker>();
const pipelines = new Map<string, Pipeline>();
const batches = new Map<string, Batch>();
let telemetry = createTelemetry();

function healthLevelForStatus(status: string): HealthLevel {
  if (status === "done") return "good";
  if (status === "blocked" || status === "cancelled") return "warning";
  return "danger";
}

function recordHealthEvent({
  scope = "unknown",
  id = "",
  repoPath = "",
  level = "good" as HealthLevel,
  type = "health_event",
  status = "",
  title = "",
  detail = "",
  durationMs = null as number | null,
} = {}): void {
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

function recordTelemetry(group: string, status: string | null = null, meta: Record<string, unknown> = {}): void {
  if (!telemetry) telemetry = createTelemetry();
  const bucket = (telemetry as unknown as Record<string, unknown>)[group];
  if (bucket && typeof bucket === "object") {
    const b = bucket as Record<string, number>;
    if (status && Object.prototype.hasOwnProperty.call(b, status)) {
      b[status] += 1;
    }
    if (typeof meta.durationMs === "number" && Number.isFinite(meta.durationMs)) {
      if (typeof b.durationMsTotal === "number") {
        b.durationMsTotal += Math.max(0, meta.durationMs);
      }
      if (typeof b.finished === "number") {
        b.finished += 1;
      }
    }
  }
  if (meta.count && bucket && typeof bucket === "object" && typeof (bucket as Record<string, number>).count === "number") {
    (bucket as Record<string, number>).count += meta.count as number;
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

function telemetryAverageMs(group: string): number {
  const bucket = (telemetry as unknown as Record<string, unknown>)?.[group];
  if (!bucket || typeof bucket !== "object") return 0;
  const b = bucket as Record<string, number>;
  if (!b.finished || !b.durationMsTotal) return 0;
  return Math.round(b.durationMsTotal / b.finished);
}

function loadState(): void {
  const { workerList, pipelineList, batchList, telemetry: storedTelemetry } = readStateFromDisk();
  workers.clear();
  pipelines.clear();
  batches.clear();
  for (const w of workerList as Worker[]) {
    if (w.status === "running") {
      let alive = false;
      try { process.kill(w.pid!, 0); alive = true; } catch {}
      if (!alive) { w.status = "failed"; w.endTime = now(); }
    }
    workers.set(w.id, w);
  }
  for (const p of pipelineList as Pipeline[]) pipelines.set(p.id, p);
  for (const b of batchList as Batch[]) batches.set(b.id, b);
  telemetry = storedTelemetry;
}

function saveState(): void {
  writeStateToDisk({
    workerList: [...workers.values()],
    pipelineList: [...pipelines.values()],
    batchList: [...batches.values()],
    telemetry,
  });
}

function isArchived(record: { archived?: boolean }): boolean {
  return record?.archived === true;
}

function ageInDays(record: Record<string, unknown>, referenceField = "endTime"): number {
  const reference = record?.[referenceField] || record?.archivedAt || record?.startTime;
  if (!reference) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(reference as string);
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  return (Date.now() - ms) / (1000 * 60 * 60 * 24);
}

function lifecycleStatusBucket(status: string): "completed" | "failed" | "other" {
  if (status === "done" || status === "cancelled") return "completed";
  if (status === "failed" || status === "blocked" || status === "terminated") return "failed";
  return "other";
}

function archiveRecord(record: { archived?: boolean; archivedAt?: string; archivedReason?: string }, archivedReason: string): boolean {
  if (record.archived) return false;
  record.archived = true;
  record.archivedAt = now();
  record.archivedReason = archivedReason;
  return true;
}

function purgeWorkerArtifacts(worker: Worker): void {
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

function applyLifecyclePolicy(): void {
  let changed = false;
  let archivedCount = 0;
  let purgedCount = 0;

  for (const worker of [...workers.values()]) {
    if (worker.status === "running") continue;
    const bucket = lifecycleStatusBucket(worker.status);
    const archiveAfter = LIFECYCLE_POLICY.workerArchiveDays;
    const purgeAfter = LIFECYCLE_POLICY.workerPurgeDays;

    if (!isArchived(worker) && ageInDays(worker as unknown as Record<string, unknown>) >= archiveAfter) {
      if (archiveRecord(worker, `worker archived after ${bucket} retention window`)) {
        archivedCount += 1;
        changed = true;
      }
    }

    if (isArchived(worker) && ageInDays(worker as unknown as Record<string, unknown>, "archivedAt") >= purgeAfter) {
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

    if (!isArchived(pipeline) && ageInDays(pipeline as unknown as Record<string, unknown>) >= archiveAfter) {
      if (archiveRecord(pipeline, `pipeline archived after ${bucket} retention window`)) {
        archivedCount += 1;
        changed = true;
      }
    }

    if (isArchived(pipeline) && ageInDays(pipeline as unknown as Record<string, unknown>, "archivedAt") >= purgeAfter) {
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

    if (!isArchived(batch) && ageInDays(batch as unknown as Record<string, unknown>) >= archiveAfter) {
      if (archiveRecord(batch, `batch archived after ${bucket} retention window`)) {
        archivedCount += 1;
        changed = true;
      }
    }

    if (isArchived(batch) && ageInDays(batch as unknown as Record<string, unknown>, "archivedAt") >= purgeAfter) {
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

function matchesScope(record: unknown, scope: string): boolean {
  const r = record as Record<string, unknown>;
  if (scope === "workers") return Object.prototype.hasOwnProperty.call(r, "worktreePath");
  if (scope === "pipelines") return Array.isArray(r?.stages);
  if (scope === "batches") return Array.isArray(r?.pipelines);
  return true;
}

function archiveHistory({ scope = "all" as ArchiveScope, olderThanDays = null as number | null } = {}): ArchiveCounts {
  const threshold = Number.isFinite(olderThanDays) ? olderThanDays : null;
  let changed = false;
  const archived: ArchiveCounts = { workers: 0, pipelines: 0, batches: 0 };

  for (const worker of workers.values()) {
    if (worker.status === "running" || !matchesScope(worker, scope)) continue;
    if (threshold !== null && ageInDays(worker as unknown as Record<string, unknown>) < threshold) continue;
    if (archiveRecord(worker, `manual archive via dashboard/orchestrator`)) {
      archived.workers += 1;
      changed = true;
    }
  }

  for (const pipeline of pipelines.values()) {
    if (pipeline.status === "running" || !matchesScope(pipeline, scope)) continue;
    if (threshold !== null && ageInDays(pipeline as unknown as Record<string, unknown>) < threshold) continue;
    if (archiveRecord(pipeline, `manual archive via dashboard/orchestrator`)) {
      archived.pipelines += 1;
      changed = true;
    }
  }

  for (const batch of batches.values()) {
    if (batch.status === "running" || !matchesScope(batch, scope)) continue;
    if (threshold !== null && ageInDays(batch as unknown as Record<string, unknown>) < threshold) continue;
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

function purgeHistory({ scope = "all" as ArchiveScope, olderThanDays = null as number | null, dryRun = false } = {}): ArchiveCounts {
  const threshold = Number.isFinite(olderThanDays) ? olderThanDays : null;
  const purged: ArchiveCounts = { workers: 0, pipelines: 0, batches: 0 };

  const shouldPurge = (record: unknown): boolean => {
    if (!isArchived(record as { archived?: boolean })) return false;
    if (threshold !== null && ageInDays(record as Record<string, unknown>, "archivedAt") < threshold) return false;
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

function genId(): string { return randomBytes(4).toString("hex"); }

function repoKey(repoPath: string): string {
  return createHash("sha1").update(resolve(repoPath)).digest("hex");
}

function lockDirFor(repoPath: string): string {
  return join(LOCKS_DIR, repoKey(repoPath));
}

function validateSlug(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(value)) {
    throw new Error(
      `${field} must be a short slug with letters, numbers, dots, underscores, or hyphens`
    );
  }
}

function validateGitRef(value: unknown, field: string): void {
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

function acquireRepoLock(repoPath: string, pipelineId: string): string {
  const dir = lockDirFor(repoPath);
  try {
    mkdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "EEXIST") {
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

function releaseRepoLock(repoPath: string): void {
  try {
    rmSync(lockDirFor(repoPath), { recursive: true, force: true });
  } catch {}
}

function cleanupStaleRepoLocks(): void {
  const runningIds = new Set(
    [...pipelines.values()].filter((p) => p.status === "running").map((p) => p.id)
  );
  for (const entry of readdirSync(LOCKS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(LOCKS_DIR, entry.name);
    const lockFile = join(dir, "lock.json");
    let lock: { pipelineId?: string } | null = null;
    try {
      lock = JSON.parse(readFileSync(lockFile, "utf8")) as { pipelineId?: string };
    } catch {
      rmSync(dir, { recursive: true, force: true });
      continue;
    }
    const stillRunning = runningIds.has(lock.pipelineId ?? "");
    if (!stillRunning) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

let codexLaunchMode: string | null = null;

function detectCodexLaunchMode(): string {
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

function buildAgentInvocation(agent: string, task: string, cwd: string): AgentInvocation {
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

function openUrl(targetUrl: string): { ok: boolean; error?: string } {
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
    return { ok: false, error: (error as Error).message };
  }
}

function spawnDetachedDashboard(): ChildProcess {
  return spawn(process.execPath, ["--experimental-strip-types", DASHBOARD_INDEX, "--serve-ui"], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

async function ensureDashboardAutostart(): Promise<void> {
  const existing = readJson<{ pid?: number; url?: string } | null>(DASHBOARD_META_FILE, null);
  if (existing?.pid && pidAlive(existing.pid) && existing?.url) {
    return;
  }

  try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}

  try {
    const child = spawnDetachedDashboard();
    const url = await readReadySignal(child);
    openUrl(url);
  } catch (error) {
    process.stderr.write(`dashboard autostart failed: ${(error as Error).stack || (error as Error).message}\n`);
  }
}

function defaultAgentForStage(stageId: string): string {
  const hostAgent = process.env.HARNESS_ORCHESTRATOR_HOST === "codex" ? "codex" : "claude";
  const codeAgent = hostAgent === "claude" ? "codex" : "claude";
  return ["prototype", "implement", "qa", "update-docs", "handoff"].includes(stageId)
    ? codeAgent
    : hostAgent;
}

function resolveStageAgent(stageId: string, overrideAgent: string | null = null): string {
  return overrideAgent || defaultAgentForStage(stageId);
}

function createPipelineRecord({ pipelineId, repoPath, description, agent, stages, batchId = null }: {
  pipelineId: string;
  repoPath: string;
  description: string;
  agent: string | null;
  stages: string[];
  batchId?: string | null;
}): Pipeline {
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

function assertSingleRepoPath(repoPath: unknown): void {
  if (!repoPath || typeof repoPath !== "string") {
    throw new Error("repo_path is required");
  }
}

function preflightRepoCapabilities(repoPath: string): RepoCapabilities {
  const absoluteRepoPath = resolve(repoPath);

  if (!existsSync(absoluteRepoPath)) {
    throw new Error(`repo_path not found: ${absoluteRepoPath}`);
  }

  try {
    accessSync(absoluteRepoPath);
  } catch {
    throw new Error(`repo_path is not accessible: ${absoluteRepoPath}`);
  }

  let gitRoot: string | null = null;
  let gitBranch: string | null = null;
  let gitRemote: string | null = null;

  try {
    gitRoot = runGit(["rev-parse", "--show-toplevel"], absoluteRepoPath);
    gitBranch = runGit(["branch", "--show-current"], absoluteRepoPath) || null;
    try {
      gitRemote = runGit(["remote", "get-url", "origin"], absoluteRepoPath) || null;
    } catch {
      gitRemote = null;
    }
  } catch (error) {
    throw new Error(`repo_path is not a git repository: ${absoluteRepoPath} (${(error as Error).message})`);
  }

  try {
    accessSync(gitRoot!, 0o200);
  } catch {
    throw new Error(`git working tree is not writable: ${gitRoot}`);
  }

  return {
    repoPath: absoluteRepoPath,
    gitRoot: gitRoot!,
    gitBranch,
    gitRemote,
    canWrite: true,
    directWriteSupported: true,
    branchProtectionKnown: false,
    branchProtectionCheckedAt: now(),
  };
}

function markRecoveredWorker(worker: Worker, reason: string): void {
  worker.status = "failed";
  worker.exitCode = null;
  worker.endTime = now();
  worker.recoveryReason = reason;
}

function reconcileRecoveredWorkers(): void {
  let changed = false;
  for (const worker of workers.values()) {
    if (worker.status !== "running") continue;
    let alive = false;
    try {
      process.kill(worker.pid!, 0);
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
}: {
  repoPath: string;
  description?: string;
  stages?: string[];
  agent?: string | null;
  batchId?: string | null;
}): Promise<Pipeline> {
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

function buildPipelineSummary(pipeline: Pipeline): Record<string, unknown> {
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

function summarizeStageForMarkdown(stage: Stage): string {
  const lines = [`- ${stage.id}: ${stage.status}`];
  if (stage.workerId) lines.push(`  - worker: ${stage.workerId}`);
  if (stage.error) lines.push(`  - error: ${stage.error}`);
  if (stage.result?.summary) lines.push(`  - summary: ${stage.result.summary}`);
  if (stage.result?.recommendations) lines.push(`  - next: ${stage.result.recommendations}`);
  if (Array.isArray(stage.result?.files_changed) && stage.result!.files_changed!.length) {
    lines.push(`  - files: ${stage.result!.files_changed!.join(", ")}`);
  }
  return lines.join("\n");
}

function buildPipelineMarkdown(pipeline: Pipeline): string {
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
    const caps = summary.repo_capabilities as RepoCapabilities;
    lines.push(`- git_root: ${caps.gitRoot}`);
    if (caps.gitBranch) lines.push(`- git_branch: ${caps.gitBranch}`);
    if (caps.gitRemote) lines.push(`- git_remote: ${caps.gitRemote}`);
  }

  if (summary.recovery) {
    const rec = summary.recovery as Recovery;
    lines.push(``, `## Recovery`, `- last_checked_at: ${rec.last_checked_at}`, `- note: ${rec.note}`);
  }

  lines.push(``, `## Stages`);
  for (const stage of pipeline.stages) {
    lines.push(summarizeStageForMarkdown(stage));
  }

  return lines.join("\n");
}

function buildBatchSummary(batch: Batch): Record<string, unknown> {
  return {
    batch_id: batch.id,
    name: batch.name,
    description: batch.description,
    status: batch.status,
    archived: batch.archived === true,
    archived_at: batch.archivedAt ?? null,
    archived_reason: batch.archivedReason ?? null,
    pipeline_count: batch.pipelines.length,
    pipelines: batch.pipelines,
    start_time: batch.startTime,
    end_time: batch.endTime ?? null,
  };
}

function buildBatchMarkdown(batch: Batch): string {
  const summary = buildBatchSummary(batch);
  const lines = [
    `# Batch ${summary.batch_id}`,
    ``,
    `- name: ${summary.name || "n/a"}`,
    `- status: ${summary.status}`,
    `- archived: ${summary.archived ? "yes" : "no"}`,
    `- pipelines: ${summary.pipeline_count}`,
    `- started: ${summary.start_time || "n/a"}`,
    `- ended: ${summary.end_time || "n/a"}`,
    ``,
    `## Pipelines`,
  ];

  for (const item of batch.pipelines) {
    lines.push(`- ${item.pipelineId ?? "failed"}: ${item.status} · ${item.repoPath}${item.currentStage ? ` · stage: ${item.currentStage}` : ""}${item.error ? ` · error: ${item.error}` : ""}`);
  }

  return lines.join("\n");
}

function refreshBatchStatuses(): void {
  let changed = false;

  for (const batch of batches.values()) {
    if (batch.status !== "running") continue;

    const items = Array.isArray(batch.pipelines) ? batch.pipelines : [];
    let hasRunning = false;
    let hasFailed = false;
    let hasBlocked = false;
    let allDone = items.length > 0;
    let allCancelled = items.length > 0;

    for (const item of items) {
      const pipeline = item.pipelineId ? pipelines.get(item.pipelineId) : null;
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

function autoCommitIfDirty(cwd: string, label: string): void {
  try {
    if (sh("git status --porcelain", cwd)) {
      sh("git add -A", cwd);
      sh(`git commit -m "${label}: auto-commit remaining changes"`, cwd);
    }
  } catch {}
}

function spawnPipelineStage({ stageId, task, agent, repoPath, pipelineId = null }: {
  stageId: string;
  task: string;
  agent: string | null;
  repoPath: string;
  pipelineId?: string | null;
}): SpawnStageResult {
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
  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn(cmd!, cmdArgs!, {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
  } catch (err) {
    logStream.end();
    return { error: `Failed to spawn ${selectedAgent}: ${(err as Error).message}` };
  }
  proc.stdout!.pipe(logStream);
  proc.stderr!.pipe(logStream);

  const record: Worker = {
    id: workerId,
    name: stageId,
    agent: selectedAgent,
    task,
    branch: null,
    worktreePath: null,
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

  proc.on("error", (err: Error) => {
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
        void finishPipeline(pipeline, "failed").catch((finishErr: Error) => {
          process.stderr.write(`finishPipeline failed: ${finishErr.stack || finishErr.message}\n`);
        });
      }
    }
  });

  proc.on("exit", (code: number | null) => {
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

function spawnWorker({ name, task, agent, repoPath, baseBranch = null }: {
  name: string;
  task: string;
  agent: string;
  repoPath: string;
  baseBranch?: string | null;
}): SpawnWorkerResult {
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
    return { error: `Failed to create worktree: ${(err as Error).message}` };
  }

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
  const proc = spawn(cmd!, cmdArgs!, {
    cwd: worktreePath,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  proc.stdout!.pipe(logStream);
  proc.stderr!.pipe(logStream);

  const record: Worker = {
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

  proc.on("error", (err: Error) => {
    logStream.end();
    const w = workers.get(workerId);
    if (!w) return;
    w.status = "failed";
    w.exitCode = null;
    w.endTime = now();
    saveState();
  });

  proc.on("exit", (code: number | null) => {
    logStream.end();
    const w = workers.get(workerId);
    if (!w) return;
    if (code === 0) autoCommitIfDirty(w.worktreePath!, `agent(${w.name})`);
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

let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPollLoop(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void tickAllPipelines().catch((error: Error) => {
      process.stderr.write(`tickAllPipelines failed: ${error.stack || error.message}\n`);
    });
  }, 30_000);
}

function maybeStopPollLoop(): void {
  if ([...pipelines.values()].every(p => p.status !== "running")) {
    clearInterval(pollTimer!);
    pollTimer = null;
  }
}

async function finishPipeline(pipeline: Pipeline, status: PipelineStatus): Promise<void> {
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

interface StageOutcome {
  status: "done" | "blocked" | "failed";
  reason?: string;
}

function normalizeStageOutcome(result: StageResult | null | undefined): StageOutcome {
  const status = result?.status;
  const blocked = Array.isArray(result?.blocked) ? result!.blocked! : [];
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

async function tickAllPipelines(): Promise<void> {
  for (const p of pipelines.values()) {
    if (p.status === "running") {
      await tickPipeline(p);
    }
  }
  maybeStopPollLoop();
}

async function tickPipeline(pipeline: Pipeline): Promise<void> {
  const activeStage = pipeline.stages.find(s => s.status === "running");

  if (activeStage) {
    const worker = activeStage.workerId ? workers.get(activeStage.workerId) : null;
    if (!worker) {
      const resultFile = join(
        pipeline.repoPath, ".harness", "pipeline", `${activeStage.id}-result.json`
      );
      if (existsSync(resultFile)) {
        try {
          activeStage.result = JSON.parse(readFileSync(resultFile, "utf8")) as StageResult;
        } catch {
          activeStage.result = null;
        }
        const outcome = normalizeStageOutcome(activeStage.result);
        activeStage.status = outcome.status;
        if (outcome.status !== "done") {
          activeStage.error = outcome.reason ?? null;
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

    if (worker.status === "running") {
      let alive = false;
      try { process.kill(worker.pid!, 0); alive = true; } catch {}
      if (!alive) {
        worker.status = "failed";
        worker.endTime = now();
        saveState();
      }
    }

    if (worker.status === "done") {
      const resultFile = join(
        pipeline.repoPath, ".harness", "pipeline", `${activeStage.id}-result.json`
      );
      try {
        activeStage.result = JSON.parse(readFileSync(resultFile, "utf8")) as StageResult;
      } catch {
        activeStage.result = null;
      }
      const outcome = normalizeStageOutcome(activeStage.result);
      activeStage.status = outcome.status;
      if (outcome.status !== "done") {
        activeStage.error = outcome.reason ?? null;
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

  await advancePipeline(pipeline);
}

async function advancePipeline(pipeline: Pipeline): Promise<void> {
  const nextStage = pipeline.stages.find(s => s.status === "pending");

  if (!nextStage) {
    await finishPipeline(pipeline, "done");
    return;
  }

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
  nextStage.workerId = workerId!;
  nextStage.startTime = now();
  saveState();
}

async function resumePipelines(): Promise<void> {
  let hasRunning = false;
  for (const p of pipelines.values()) {
    if (p.status !== "running") continue;
    hasRunning = true;
    await tickPipeline(p);
  }
  if (hasRunning) startPollLoop();
}

if (!IS_TEST_MODE) {
  reconcileRecoveredWorkers();
  void resumePipelines().catch((error: Error) => {
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
  const a = (args ?? {}) as Record<string, unknown>;

  if (name === "run_pipeline") {
    const {
      repo_path,
      description = "",
      stages = ["implement", "qa", "update-docs"],
      agent = null,
    } = a as { repo_path: string; description?: string; stages?: string[]; agent?: string | null };

    try {
      const pipeline = await startSingleRepoPipeline({
        repoPath: repo_path,
        description: description as string,
        stages: stages as string[],
        agent: agent as string | null,
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
      return err((e as Error).message);
    }
  }

  if (name === "run_batch") {
    const {
      batch_name = "",
      description = "",
      runs = [],
    } = a as { batch_name?: string; description?: string; runs?: Array<{ repo_path: string; description?: string; stages?: string[]; agent?: string }> };

    if (!Array.isArray(runs) || runs.length === 0) {
      return err("runs must be a non-empty array");
    }

    const batchId = genId();
    const batch: Batch = {
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

    const failures: string[] = [];

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

  if (name === "get_pipeline_status") {
    const p = pipelines.get(a.pipeline_id as string);
    if (!p) return err(`No pipeline: ${a.pipeline_id}`);

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
    const format = a.format === "markdown" ? "markdown" : "json";
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

  if (name === "get_batch_status") {
    refreshBatchStatuses();
    const batch = batches.get(a.batch_id as string);
    if (!batch) return err(`No batch: ${a.batch_id}`);
    if (a.format === "markdown") {
      return ok(buildBatchMarkdown(batch));
    }
    return ok(buildBatchSummary(batch));
  }

  if (name === "list_batches") {
    refreshBatchStatuses();
    if (!batches.size) return ok("No batches registered.");
    return ok([...batches.values()].map((batch) => buildBatchSummary(batch)));
  }

  if (name === "archive_history") {
    const result = archiveHistory({
      scope: (a.scope || "all") as ArchiveScope,
      olderThanDays: Number.isFinite(a.older_than_days) ? a.older_than_days as number : null,
    });
    return ok({
      ok: true,
      action: "archive_history",
      scope: a.scope || "all",
      archived: result,
    });
  }

  if (name === "purge_history") {
    const result = purgeHistory({
      scope: (a.scope || "all") as ArchiveScope,
      olderThanDays: Number.isFinite(a.older_than_days) ? a.older_than_days as number : null,
      dryRun: a.dry_run === true,
    });
    return ok({
      ok: true,
      action: "purge_history",
      scope: a.scope || "all",
      dry_run: a.dry_run === true,
      purged: result,
    });
  }

  if (name === "list_history") {
    const scope = (a.scope || "all") as ArchiveScope;
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

  if (name === "cancel_pipeline") {
    const p = pipelines.get(a.pipeline_id as string);
    if (!p) return err(`No pipeline: ${a.pipeline_id}`);
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

    void finishPipeline(p, "cancelled").catch((error: Error) => {
      process.stderr.write(`finishPipeline failed: ${error.stack || error.message}\n`);
    });
    recordTelemetry("manual", "cancels", {
      type: "manual_cancel_pipeline",
      id: p.id,
      note: p.repoPath,
    });
    return ok(`Pipeline ${p.id} cancelled.`);
  }

  if (name === "spawn_worker") {
    const { name: workerName, task, agent, repo_path, base_branch } = a as {
      name: string; task: string; agent: string; repo_path: string; base_branch?: string;
    };
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

  if (name === "get_worker_status") {
    const w = workers.get(a.worker_id as string);
    if (!w) return err(`No worker: ${a.worker_id}`);
    if (w.status === "running") {
      let alive = false;
      try { process.kill(w.pid!, 0); alive = true; } catch {}
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

  if (name === "get_worker_log") {
    const w = workers.get(a.worker_id as string);
    if (!w) return err(`No worker: ${a.worker_id}`);
    try {
      const raw = existsSync(w.logFile) ? readFileSync(w.logFile, "utf8") : "";
      const lines = raw.split("\n");
      const tailN = a.tail as number ?? 100;
      return ok((tailN === 0 ? lines : lines.slice(-tailN)).join("\n") || "(no output yet)");
    } catch (e) {
      return err(`Cannot read log: ${(e as Error).message}`);
    }
  }

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

  if (name === "terminate_worker") {
    const w = workers.get(a.worker_id as string);
    if (!w) return err(`No worker: ${a.worker_id}`);
    if (w.status !== "running") return ok(`Worker is not running (status: ${w.status}).`);
    try {
      process.kill(w.pid!, "SIGTERM");
      w.status = "terminated"; w.endTime = now();
      recordTelemetry("manual", "terminations", {
        type: "manual_terminate_worker",
        id: w.id,
        note: w.repoPath,
      });
      saveState();
      return ok(`Worker ${w.id} (${w.name}) terminated.`);
    } catch (e) {
      return err(`Failed to terminate: ${(e as Error).message}`);
    }
  }

  if (name === "cleanup_worker") {
    const w = workers.get(a.worker_id as string);
    if (!w) return err(`No worker: ${a.worker_id}`);
    if (w.status === "running") return err("Worker is still running. Terminate it first.");
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

function ok(data: unknown): { content: Array<{ type: string; text: string }> } {
  return {
    content: [{
      type: "text",
      text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
    }],
  };
}

function err(msg: string): { content: Array<{ type: string; text: string }>; isError: boolean } {
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
