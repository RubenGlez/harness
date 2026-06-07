#!/usr/bin/env node
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChildProcess } from "node:child_process";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { now, readJson, pidAlive, readReadySignal } from "../shared/runtime.ts";
import {
  DATA_DIR,
  STATE_FILE,
  readState as storeReadState,
  writeState as storeWriteState,
} from "../shared/store.ts";
import type { Telemetry, HealthEvent } from "../shared/store.ts";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RawWorker {
  id: string;
  name?: string;
  agent?: string;
  status?: string;
  rawStatus?: string;
  pid?: number | null;
  logFile?: string;
  branch?: string | null;
  worktreePath?: string | null;
  repoPath?: string;
  exitCode?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  recoveryReason?: string;
  archived?: boolean;
  archivedAt?: string | null;
  archivedReason?: string | null;
}

interface RawStage {
  id: string;
  status?: string;
  workerId?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  error?: string | null;
  result?: RawStageResult | null;
}

interface RawStageResult {
  status?: string;
  summary?: string;
  blocked?: Array<{ item?: string; reason?: string }>;
  files_changed?: string[];
  recommendations?: string;
}

interface RawPipeline {
  id: string;
  description?: string | null;
  repoPath?: string;
  agent?: string;
  status?: string;
  stages?: RawStage[];
  recovery?: unknown;
  repoCapabilities?: unknown;
  archived?: boolean;
  archivedAt?: string | null;
  archivedReason?: string | null;
  tiza?: unknown;
  startTime?: string | null;
  endTime?: string | null;
  batchId?: string | null;
  mode?: string;
}

interface RawBatchItem {
  pipelineId?: string | null;
  repoPath?: string;
  status?: string;
  currentStage?: string | null;
}

interface RawBatch {
  id: string;
  name?: string | null;
  description?: string | null;
  status?: string;
  archived?: boolean;
  archivedAt?: string | null;
  archivedReason?: string | null;
  pipelines?: RawBatchItem[];
  startTime?: string | null;
  endTime?: string | null;
}

interface DashboardState {
  workers: RawWorker[];
  pipelines: RawPipeline[];
  batches: RawBatch[];
  telemetry: Telemetry;
}

interface ActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

interface OpenResult {
  ok: boolean;
  error?: string;
}

interface DashboardMeta {
  pid?: number;
  port?: number;
  url?: string;
  startedAt?: string;
}

// ── Init ───────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOGS_DIR = join(DATA_DIR, "logs");
const DASHBOARD_META_FILE = join(DATA_DIR, "dashboard.json");
const UI_DIR = join(__dirname, "public");
const IS_SERVE_MODE = process.argv.includes("--serve-ui");

let httpServer: http.Server | null = null;
let httpPort: number | null = null;
let idleSince: number | null = null;
let idleTimer: ReturnType<typeof setInterval> | null = null;
let shutdownRequested = false;

const IDLE_SHUTDOWN_MS = Number.parseInt(
  process.env.HARNESS_DASHBOARD_IDLE_SHUTDOWN_MS || "60000",
  10
);
const IDLE_CHECK_MS = Number.parseInt(
  process.env.HARNESS_DASHBOARD_IDLE_CHECK_MS || "5000",
  10
);

function safeText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length ? value : fallback;
}

function getMutableState(): DashboardState {
  const { workerList, pipelineList, batchList, telemetry } = storeReadState();
  return { workers: workerList as RawWorker[], pipelines: pipelineList as RawPipeline[], batches: batchList as RawBatch[], telemetry };
}

function updateBatchStatuses(state: DashboardState): void {
  const pipelineById = new Map((state.pipelineList || []).map((pipeline) => [pipeline.id, pipeline]));

  for (const batch of state.batchList || []) {
    const items = Array.isArray(batch.pipelines) ? batch.pipelines : [];
    let hasRunning = false;
    let hasFailed = false;
    let hasBlocked = false;
    let allDone = items.length > 0;
    let allCancelled = items.length > 0;

    for (const item of items) {
      const pipeline = pipelineById.get(item.pipelineId ?? "");
      if (!pipeline) {
        if (item.status === "running") hasRunning = true;
        if (item.status === "failed") hasFailed = true;
        if (item.status === "blocked") hasBlocked = true;
        if (item.status !== "done") allDone = false;
        if (item.status !== "cancelled") allCancelled = false;
        continue;
      }

      item.status = pipeline.status;
      item.currentStage =
        pipeline.stages?.find((stage) => stage.status === "running")?.id ?? item.currentStage ?? null;

      if (pipeline.status === "running") hasRunning = true;
      if (pipeline.status === "failed") hasFailed = true;
      if (pipeline.status === "blocked") hasBlocked = true;
      if (pipeline.status !== "done") allDone = false;
      if (pipeline.status !== "cancelled") allCancelled = false;
    }

    batch.status = hasRunning
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

    if (batch.status !== "running" && !batch.endTime && (hasFailed || hasBlocked || allDone || allCancelled)) {
      batch.endTime = now();
    }
  }
}

function persistState(state: DashboardState): boolean {
  updateBatchStatuses(state);
  return storeWriteState({
    workerList: state.workers,
    pipelineList: state.pipelines,
    batchList: state.batches,
    telemetry: state.telemetry,
  });
}

function noteManualTelemetry(state: DashboardState, type: string, id: string, note = ""): void {
  const manual = state.telemetry.manual as Record<string, number>;
  if (Object.prototype.hasOwnProperty.call(manual, type)) {
    manual[type] += 1;
  }
  state.telemetry.lastEvent = {
    type: `manual_${type}`,
    at: now(),
    scope: "manual",
    id: safeText(id, ""),
    status: type,
    note: safeText(note, ""),
  };
}

function removeDashboardMeta(): void {
  try {
    if (existsSync(DASHBOARD_META_FILE)) {
      unlinkSync(DASHBOARD_META_FILE);
    }
  } catch {}
}

function tailText(filePath: string, lines = 40): string {
  if (!existsSync(filePath)) return "";
  try {
    const raw = readFileSync(filePath, "utf8");
    if (!raw) return "";
    const parts = raw.split("\n");
    if (lines <= 0) return raw;
    return parts.slice(-lines).join("\n");
  } catch {
    return "";
  }
}

function openExternal(target: string): OpenResult {
  if (!target) return { ok: false, error: "Missing target" };

  const platform = process.platform;
  const opener =
    platform === "darwin"
      ? { command: "open", args: [target] }
      : platform === "win32"
        ? { command: "cmd", args: ["/c", "start", "", target] }
        : { command: "xdg-open", args: [target] };

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

const openPath = openExternal;
const openUrl = openExternal;

function killPid(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function findWorker(state: DashboardState, workerId: string): RawWorker | null {
  return (state.workers || []).find((worker) => worker.id === workerId) || null;
}

function findPipeline(state: DashboardState, pipelineId: string): RawPipeline | null {
  return (state.pipelines || []).find((pipeline) => pipeline.id === pipelineId) || null;
}

function cancelPipelineInState(state: DashboardState, pipelineId: string): ActionResult {
  const pipeline = findPipeline(state, pipelineId);
  if (!pipeline) return { ok: false, error: `No pipeline: ${pipelineId}` };
  if (pipeline.status !== "running") return { ok: false, error: `Pipeline is already ${pipeline.status}.` };

  const activeStage = Array.isArray(pipeline.stages)
    ? pipeline.stages.find((stage) => stage.status === "running")
    : null;
  const worker = activeStage?.workerId ? findWorker(state, activeStage.workerId) : null;
  if (worker?.pid) {
    killPid(worker.pid);
    worker.status = "terminated";
    worker.endTime = now();
    worker.recoveryReason = "cancelled from dashboard";
  }

  if (activeStage) {
    activeStage.status = "failed";
    activeStage.error = "Cancelled from dashboard";
    activeStage.endTime = now();
  }

  pipeline.status = "cancelled";
  pipeline.endTime = now();
  noteManualTelemetry(state, "cancels", pipeline.id, pipeline.repoPath);
  persistState(state);
  return { ok: true, message: `Pipeline ${pipeline.id} cancelled.` };
}

function terminateWorkerInState(state: DashboardState, workerId: string): ActionResult {
  const worker = findWorker(state, workerId);
  if (!worker) return { ok: false, error: `No worker: ${workerId}` };
  if (worker.status !== "running") return { ok: false, error: `Worker is not running (status: ${worker.status}).` };

  if (worker.pid) {
    killPid(worker.pid);
  }

  worker.status = "terminated";
  worker.endTime = now();
  worker.recoveryReason = "terminated from dashboard";

  const pipeline = (state.pipelines || []).find((item) =>
    Array.isArray(item.stages) && item.stages.some((stage) => stage.workerId === worker.id)
  );
  if (pipeline) {
    const stage = pipeline.stages!.find((item) => item.workerId === worker.id);
    if (stage) {
      stage.status = "failed";
      stage.error = "Worker terminated from dashboard";
      stage.endTime = now();
    }
    if (pipeline.status === "running") {
      pipeline.status = "failed";
      pipeline.endTime = now();
    }
  }

  noteManualTelemetry(state, "terminations", worker.id, worker.repoPath);
  persistState(state);
  return { ok: true, message: `Worker ${worker.id} terminated.` };
}

function cleanupWorkerInState(state: DashboardState, workerId: string): ActionResult {
  const worker = findWorker(state, workerId);
  if (!worker) return { ok: false, error: `No worker: ${workerId}` };
  if (worker.status === "running") return { ok: false, error: "Worker is still running. Terminate it first." };
  if (!worker.worktreePath) return { ok: false, error: "Only isolated worktree workers can be cleaned up from the dashboard." };

  try {
    execFileSync("git", ["worktree", "remove", "--force", worker.worktreePath], {
      cwd: worker.repoPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return { ok: false, error: `Failed to remove worktree: ${(error as Error).message}` };
  }

  state.workers = state.workers.filter((item) => item.id !== worker.id);
  noteManualTelemetry(state, "cleanups", worker.id, worker.repoPath ?? "");
  persistState(state);
  return { ok: true, message: `Worker ${worker.id} cleaned up.` };
}

function readState(): DashboardState {
  const { workerList, pipelineList, batchList, telemetry } = storeReadState();
  return { workers: workerList as RawWorker[], pipelines: pipelineList as RawPipeline[], batches: batchList as RawBatch[], telemetry };
}

interface NormalizedWorker {
  id: string;
  name: string;
  agent: string;
  status: string;
  rawStatus: string;
  archived: boolean;
  archivedAt: string | null;
  archivedReason: string | null;
  recoveryReason: string;
  branch: string | null;
  worktreePath: string | null;
  repoPath: string;
  pid: number | null;
  exitCode: number | null;
  startTime: string | null;
  endTime: string | null;
  logFile: string;
  live: boolean;
  logTail: string;
}

function normalizeWorker(worker: RawWorker): NormalizedWorker {
  const status = safeText(worker.status, "unknown");
  const pid = Number.isInteger(worker.pid) ? (worker.pid as number) : null;
  const live = status === "running" ? pidAlive(pid) : false;
  const effectiveStatus = status === "running" && !live ? "failed" : status;
  const logFile = safeText(worker.logFile, join(LOGS_DIR, `${worker.id}.log`));

  return {
    id: safeText(worker.id, ""),
    name: safeText(worker.name, "worker"),
    agent: safeText(worker.agent, "claude"),
    status: effectiveStatus,
    rawStatus: status,
    archived: worker.archived === true,
    archivedAt: worker.archivedAt ?? null,
    archivedReason: worker.archivedReason ?? null,
    recoveryReason: safeText(worker.recoveryReason, ""),
    branch: worker.branch ?? null,
    worktreePath: worker.worktreePath ?? null,
    repoPath: safeText(worker.repoPath, ""),
    pid,
    exitCode: worker.exitCode ?? null,
    startTime: worker.startTime ?? null,
    endTime: worker.endTime ?? null,
    logFile,
    live,
    logTail: tailText(logFile, effectiveStatus === "running" ? 80 : 24),
  };
}

function normalizePipeline(pipeline: RawPipeline, workerById: Map<string, NormalizedWorker>): Record<string, unknown> {
  const stages = Array.isArray(pipeline.stages) ? pipeline.stages : [];
  const normalizedStages = stages.map((stage) => {
    const worker = stage.workerId ? workerById.get(stage.workerId) : null;
    const result = stage.result ?? null;
    const blockers = Array.isArray(result?.blocked) ? result!.blocked! : [];
    const isBlocked = stage.status === "blocked" || result?.status === "blocked" || blockers.length > 0;

    return {
      id: safeText(stage.id, "stage"),
      status: safeText(stage.status, "pending"),
      workerId: stage.workerId ?? null,
      workerStatus: worker?.status ?? null,
      workerWorktreePath: worker?.worktreePath ?? null,
      workerRepoPath: worker?.repoPath ?? null,
      workerBranch: worker?.branch ?? null,
      startTime: stage.startTime ?? null,
      endTime: stage.endTime ?? null,
      result,
      error: stage.error ?? null,
      blockerSummary:
        isBlocked
          ? blockers.map((item) => item?.reason).filter(Boolean).join("; ") ||
            stage.error ||
            result?.summary ||
            result?.recommendations ||
            "Blocked"
          : null,
      filesChanged: Array.isArray(result?.files_changed) ? result!.files_changed! : [],
    };
  });

  const runningStage = normalizedStages.find((stage) => stage.status === "running") ?? null;
  const blockedStage = normalizedStages.find((stage) => stage.status === "blocked") ?? null;
  const lastDone = [...normalizedStages].reverse().find((stage) => stage.status === "done") ?? null;

  return {
    id: safeText(pipeline.id, ""),
    description: pipeline.description ?? null,
    repoPath: safeText(pipeline.repoPath, ""),
    agent: safeText(pipeline.agent, "mixed"),
    status: safeText(pipeline.status, "running"),
    recovery: pipeline.recovery ?? null,
    repoCapabilities: pipeline.repoCapabilities ?? null,
    archived: pipeline.archived === true,
    archivedAt: pipeline.archivedAt ?? null,
    archivedReason: pipeline.archivedReason ?? null,
    tiza: pipeline.tiza ?? null,
    currentStage:
      runningStage?.id ??
      (pipeline.status === "done" ? "complete" : pipeline.status === "blocked" ? "blocked" : null),
    startTime: pipeline.startTime ?? null,
    endTime: pipeline.endTime ?? null,
    stages: normalizedStages,
    runningWorkerId: runningStage?.workerId ?? null,
    blockedStageId: blockedStage?.id ?? null,
    lastDoneStageId: lastDone?.id ?? null,
  };
}

function normalizeBatch(batch: RawBatch, pipelineById: Map<string, Record<string, unknown>>): Record<string, unknown> {
  const items = Array.isArray(batch.pipelines) ? batch.pipelines : [];
  const normalizedPipelines = items.map((item) => {
    const pipeline = item.pipelineId ? pipelineById.get(item.pipelineId) : null;
    const pipelineStages = pipeline?.stages as Array<Record<string, unknown>> | undefined;
    const status = (pipeline?.status as string) || item.status || "unknown";
    const currentStage = pipelineStages?.find((stage) => stage.status === "running")?.id as string ?? item.currentStage ?? null;
    return {
      pipelineId: item.pipelineId ?? null,
      repoPath: (pipeline?.repoPath as string) ?? item.repoPath ?? "",
      status,
      currentStage,
      description: (pipeline?.description as string) ?? null,
    };
  });

  const counts = normalizedPipelines.reduce(
    (acc, item) => {
      if (item.status === "running") acc.running += 1;
      else if (item.status === "done") acc.done += 1;
      else if (item.status === "blocked") acc.blocked += 1;
      else if (item.status === "failed") acc.failed += 1;
      else if (item.status === "cancelled") acc.cancelled += 1;
      return acc;
    },
    { running: 0, done: 0, blocked: 0, failed: 0, cancelled: 0 }
  );

  return {
    id: safeText(batch.id, ""),
    mode: "batch",
    name: batch.name ?? null,
    description: batch.description ?? null,
    status: safeText(batch.status, "running"),
    archived: batch.archived === true,
    archivedAt: batch.archivedAt ?? null,
    archivedReason: batch.archivedReason ?? null,
    repoCount: normalizedPipelines.length,
    running: counts.running,
    done: counts.done,
    blocked: counts.blocked,
    failed: counts.failed,
    cancelled: counts.cancelled,
    startTime: batch.startTime ?? null,
    endTime: batch.endTime ?? null,
    pipelines: normalizedPipelines,
  };
}

function buildSnapshot(repoFilter = ""): Record<string, unknown> {
  const { workers, pipelines, batches, telemetry } = readState();
  const workerById = new Map<string, NormalizedWorker>();
  const pipelineById = new Map<string, Record<string, unknown>>();
  const normalizedWorkers = workers
    .map(normalizeWorker)
    .sort((a, b) => (b.startTime || "").localeCompare(a.startTime || ""));

  for (const worker of normalizedWorkers) {
    workerById.set(worker.id, worker);
  }

  const normalizedPipelines = pipelines
    .map((pipeline) => normalizePipeline(pipeline, workerById))
    .filter((pipeline) => !repoFilter || pipeline.repoPath === repoFilter)
    .sort((a, b) => ((b.startTime as string) || "").localeCompare((a.startTime as string) || ""));

  for (const pipeline of normalizedPipelines) {
    pipelineById.set(pipeline.id as string, pipeline);
  }

  const normalizedBatches = batches
    .map((batch) => normalizeBatch(batch, pipelineById))
    .filter((batch) => {
      if (!repoFilter) return true;
      return (batch.pipelines as Array<{ repoPath: string }>).some((pipeline) => pipeline.repoPath === repoFilter);
    })
    .sort((a, b) => ((b.startTime as string) || "").localeCompare((a.startTime as string) || ""));

  const filteredWorkers = normalizedWorkers.filter(
    (worker) => !repoFilter || worker.repoPath === repoFilter
  );

  const totals = {
    pipelines: normalizedPipelines.length,
    running: normalizedPipelines.filter((pipeline) => pipeline.status === "running").length,
    blocked: normalizedPipelines.filter((pipeline) => pipeline.status === "blocked").length,
    failed: normalizedPipelines.filter((pipeline) => pipeline.status === "failed").length,
    archivedPipelines: normalizedPipelines.filter((pipeline) => pipeline.archived).length,
    workers: filteredWorkers.length,
    liveWorkers: filteredWorkers.filter((worker) => worker.live).length,
    archivedWorkers: filteredWorkers.filter((worker) => worker.archived).length,
    batches: normalizedBatches.length,
    archivedBatches: normalizedBatches.filter((batch) => batch.archived).length,
  };

  const pipelineTerminalCount = (telemetry?.pipelines?.finished || 0) || (
    (telemetry?.pipelines?.done || 0) +
    (telemetry?.pipelines?.blocked || 0) +
    (telemetry?.pipelines?.failed || 0) +
    (telemetry?.pipelines?.cancelled || 0)
  );
  const batchTerminalCount = (telemetry?.batches?.finished || 0) || (
    (telemetry?.batches?.done || 0) +
    (telemetry?.batches?.blocked || 0) +
    (telemetry?.batches?.failed || 0) +
    (telemetry?.batches?.cancelled || 0)
  );
  const avgPipelineDurationMs = pipelineTerminalCount
    ? Math.round((telemetry?.pipelines?.durationMsTotal || 0) / pipelineTerminalCount)
    : 0;
  const avgBatchDurationMs = batchTerminalCount
    ? Math.round((telemetry?.batches?.durationMsTotal || 0) / batchTerminalCount)
    : 0;
  const pipelineSuccessRate = pipelineTerminalCount
    ? Math.round(((telemetry?.pipelines?.done || 0) / pipelineTerminalCount) * 100)
    : 0;
  const lastEvent = telemetry?.lastEvent || null;
  const healthHistory = Array.isArray(telemetry?.health?.recent) ? telemetry.health.recent : [];
  const filteredHealthHistory = healthHistory.filter((entry) => {
    if (!repoFilter) return true;
    return entry.repoPath === repoFilter;
  });
  const recentHealthHistory = [...filteredHealthHistory].slice(-8).reverse();
  const repoHealthMap = new Map<string, { repoPath: string | null; scope: string; total: number; good: number; warning: number; danger: number; lastAt: string | null; lastTitle: string }>();
  for (const entry of filteredHealthHistory) {
    const key = entry.repoPath || entry.scope || "global";
    if (!repoHealthMap.has(key)) {
      repoHealthMap.set(key, {
        repoPath: entry.repoPath || null,
        scope: entry.scope || "unknown",
        total: 0,
        good: 0,
        warning: 0,
        danger: 0,
        lastAt: entry.at || null,
        lastTitle: entry.title || "",
      });
    }
    const bucket = repoHealthMap.get(key)!;
    bucket.total += 1;
    bucket[entry.level === "danger" ? "danger" : entry.level === "warning" ? "warning" : "good"] += 1;
    bucket.lastAt = entry.at || bucket.lastAt;
    bucket.lastTitle = entry.title || bucket.lastTitle;
  }
  const repoHealthSummary = [...repoHealthMap.values()]
    .sort((a, b) => {
      const severityA = a.danger * 2 + a.warning;
      const severityB = b.danger * 2 + b.warning;
      if (severityA !== severityB) return severityB - severityA;
      return (b.lastAt || "").localeCompare(a.lastAt || "");
    })
    .slice(0, 5);
  const activePipelineAgesMs = normalizedPipelines
    .filter((pipeline) => pipeline.status === "running" && pipeline.startTime)
    .map((pipeline) => Math.max(0, Date.now() - new Date(pipeline.startTime as string).getTime()))
    .filter((value) => Number.isFinite(value));
  const longestRunningPipelineMs = activePipelineAgesMs.length ? Math.max(...activePipelineAgesMs) : 0;
  const staleRunningPipelines = normalizedPipelines.filter((pipeline) => {
    if (pipeline.status !== "running" || !pipeline.startTime) return false;
    const startedAt = new Date(pipeline.startTime as string).getTime();
    if (!Number.isFinite(startedAt)) return false;
    return Date.now() - startedAt >= 2 * 60 * 60 * 1000;
  });

  const pipelineFailureRate = pipelineTerminalCount
    ? Math.round((((telemetry?.pipelines?.failed || 0) + (telemetry?.pipelines?.blocked || 0)) / pipelineTerminalCount) * 100)
    : 0;
  const manualInterventionCount =
    (telemetry?.manual?.cancels || 0) +
    (telemetry?.manual?.terminations || 0) +
    (telemetry?.manual?.cleanups || 0);
  const manualInterventionRate = pipelineTerminalCount
    ? Math.round((manualInterventionCount / Math.max(1, pipelineTerminalCount)) * 100)
    : 0;
  const blockedRunningCount = normalizedPipelines.filter((pipeline) => pipeline.status === "blocked").length;

  const healthSignals: Array<{ level: string; title: string; detail: string }> = [];
  let healthLevel = "good";

  if (pipelineTerminalCount >= 5 && pipelineSuccessRate < 70) {
    healthSignals.push({
      level: "danger",
      title: "Success rate is low",
      detail: `Pipeline success rate is ${pipelineSuccessRate}% across ${pipelineTerminalCount} finished runs.`,
    });
    healthLevel = "danger";
  }

  if (pipelineFailureRate >= 40 && pipelineTerminalCount >= 3) {
    healthSignals.push({
      level: healthLevel === "danger" ? "danger" : "warning",
      title: "Failures and blocks are frequent",
      detail: `${pipelineFailureRate}% of finished pipelines ended blocked or failed.`,
    });
    if (healthLevel !== "danger") healthLevel = "warning";
  }

  if (staleRunningPipelines.length) {
    healthSignals.push({
      level: "warning",
      title: "Long-running pipelines detected",
      detail: `${staleRunningPipelines.length} pipeline${staleRunningPipelines.length === 1 ? "" : "s"} have been running for more than 2 hours.`,
    });
    if (healthLevel === "good") healthLevel = "warning";
  }

  if (manualInterventionRate >= 25 && pipelineTerminalCount >= 4) {
    healthSignals.push({
      level: healthLevel === "good" ? "warning" : healthLevel,
      title: "Manual intervention is high",
      detail: `${manualInterventionCount} manual dashboard actions so far (${manualInterventionRate}% of finished pipelines).`,
    });
    if (healthLevel === "good") healthLevel = "warning";
  }

  if (blockedRunningCount > 0 && healthLevel === "good") {
    healthLevel = "warning";
    healthSignals.push({
      level: "warning",
      title: "Blocked pipelines need attention",
      detail: `${blockedRunningCount} pipeline${blockedRunningCount === 1 ? "" : "s"} are currently blocked.`,
    });
  }

  if (!healthSignals.length) {
    healthSignals.push({
      level: "good",
      title: "No active health issues",
      detail: "No soft alerts triggered from the current snapshot.",
    });
  }

  const telemetrySummary = {
    pipeline_started: telemetry?.pipelines?.started || 0,
    pipeline_finished: pipelineTerminalCount,
    pipeline_success_rate: pipelineSuccessRate,
    pipeline_failure_rate: pipelineFailureRate,
    avg_pipeline_duration_ms: avgPipelineDurationMs,
    batch_started: telemetry?.batches?.started || 0,
    batch_finished: batchTerminalCount,
    avg_batch_duration_ms: avgBatchDurationMs,
    archived: telemetry?.lifecycle?.archived || 0,
    purged: telemetry?.lifecycle?.purged || 0,
    manual_cancels: telemetry?.manual?.cancels || 0,
    manual_terminations: telemetry?.manual?.terminations || 0,
    manual_cleanups: telemetry?.manual?.cleanups || 0,
    manual_interventions: manualInterventionCount,
    manual_intervention_rate: manualInterventionRate,
    longest_running_pipeline_ms: longestRunningPipelineMs,
    stale_running_pipelines: staleRunningPipelines.length,
    health_history_count: filteredHealthHistory.length,
    last_event: lastEvent,
  };

  const recentBlocked = normalizedPipelines
    .filter((pipeline) => pipeline.status === "blocked")
    .slice(0, 3)
    .map((pipeline) => {
      const pipelineStages = pipeline.stages as Array<Record<string, unknown>>;
      const stage = pipelineStages.find((item) => item.status === "blocked");
      return {
        pipelineId: pipeline.id,
        repoPath: pipeline.repoPath,
        stageId: stage?.id ?? null,
        reason: stage?.blockerSummary ?? "Blocked",
      };
    });

  return {
    generatedAt: now(),
    repoFilter: repoFilter || null,
    totals,
    telemetry: telemetrySummary,
    health: {
      level: healthLevel,
      signals: healthSignals,
      recent_history: recentHealthHistory,
      repo_summary: repoHealthSummary,
    },
    recentBlocked,
    batches: normalizedBatches,
    pipelines: normalizedPipelines,
    workers: filteredWorkers,
  };
}

function snapshotToMarkdown(snapshot: Record<string, unknown>): string {
  const telemetry = snapshot.telemetry as Record<string, unknown>;
  const health = snapshot.health as Record<string, unknown>;
  const totals = snapshot.totals as Record<string, number>;

  const lines = [
    `# Dashboard snapshot`,
    ``,
    `- generated_at: ${snapshot.generatedAt}`,
    `- repo_filter: ${snapshot.repoFilter || "n/a"}`,
    `- batches: ${totals.batches}`,
    `- archived_batches: ${totals.archivedBatches}`,
    `- pipelines: ${totals.pipelines}`,
    `- archived_pipelines: ${totals.archivedPipelines}`,
    `- running: ${totals.running}`,
    `- blocked: ${totals.blocked}`,
    `- failed: ${totals.failed}`,
    `- workers: ${totals.workers}`,
    `- archived_workers: ${totals.archivedWorkers}`,
    `- live_workers: ${totals.liveWorkers}`,
    `- pipeline_started: ${telemetry.pipeline_started}`,
    `- pipeline_finished: ${telemetry.pipeline_finished}`,
    `- pipeline_success_rate: ${telemetry.pipeline_success_rate}%`,
    `- pipeline_failure_rate: ${telemetry.pipeline_failure_rate}%`,
    `- avg_pipeline_duration_ms: ${telemetry.avg_pipeline_duration_ms}`,
    `- batch_started: ${telemetry.batch_started}`,
    `- batch_finished: ${telemetry.batch_finished}`,
    `- avg_batch_duration_ms: ${telemetry.avg_batch_duration_ms}`,
    `- archived_total: ${telemetry.archived}`,
    `- purged_total: ${telemetry.purged}`,
    `- manual_interventions: ${telemetry.manual_interventions}`,
    `- manual_intervention_rate: ${telemetry.manual_intervention_rate}%`,
    `- longest_running_pipeline_ms: ${telemetry.longest_running_pipeline_ms}`,
    `- stale_running_pipelines: ${telemetry.stale_running_pipelines}`,
    `- health_history_count: ${telemetry.health_history_count}`,
  ];

  if (telemetry.last_event) {
    const ev = telemetry.last_event as Record<string, unknown>;
    lines.push(`- last_event: ${ev.type} @ ${ev.at} (${ev.scope}${ev.status ? `:${ev.status}` : ""})`);
  }

  const recentBlocked = snapshot.recentBlocked as Array<Record<string, unknown>>;
  if (recentBlocked.length) {
    lines.push(``, `## Recent blocked pipelines`);
    for (const item of recentBlocked) {
      lines.push(`- ${item.pipelineId} · ${item.repoPath} · ${item.stageId || "unknown"} · ${item.reason}`);
    }
  }

  const signals = health?.signals as Array<Record<string, unknown>>;
  if (signals?.length) {
    lines.push(``, `## Health signals`);
    lines.push(`- level: ${health.level}`);
    for (const signal of signals) {
      lines.push(`- ${signal.level}: ${signal.title} — ${signal.detail}`);
    }
  }

  const recentHistory = health?.recent_history as HealthEvent[];
  if (recentHistory?.length) {
    lines.push(``, `## Recent health history`);
    for (const item of recentHistory) {
      lines.push(
        `- ${item.at}: ${item.level} · ${item.title} · ${item.repoPath || item.scope || "global"}` +
          (item.status ? ` · ${item.status}` : "") +
          (item.detail ? ` · ${item.detail}` : "")
      );
    }
  }

  const repoSummary = health?.repo_summary as Array<Record<string, unknown>>;
  if (repoSummary?.length) {
    lines.push(``, `## Repo health summary`);
    for (const item of repoSummary) {
      lines.push(
        `- ${item.repoPath || item.scope || "global"}: ${item.total} events (` +
          `good ${item.good}, warning ${item.warning}, danger ${item.danger})` +
          (item.lastTitle ? ` · last: ${item.lastTitle}` : "")
      );
    }
  }

  const batchesList = snapshot.batches as Array<Record<string, unknown>>;
  if (batchesList.length) {
    lines.push(``, `## Batches`);
    for (const batch of batchesList) {
      lines.push(`- ${batch.id}: ${batch.status} (${batch.repoCount} repos)`);
    }
  }

  const pipelinesList = snapshot.pipelines as Array<Record<string, unknown>>;
  if (pipelinesList.length) {
    lines.push(``, `## Pipelines`);
    for (const pipeline of pipelinesList) {
      const tiza = pipeline.tiza as Record<string, unknown> | null;
      const tizaLabel = tiza
        ? ` · tiza ${tiza.runId || "n/a"}${(tiza.summary as Record<string, unknown>)?.phase ? ` (${(tiza.summary as Record<string, unknown>).phase})` : ""}`
        : "";
      lines.push(`- ${pipeline.id}: ${pipeline.status} · ${pipeline.repoPath}${tizaLabel}`);
    }
  }

  const workersList = snapshot.workers as NormalizedWorker[];
  if (workersList.length) {
    lines.push(``, `## Workers`);
    for (const worker of workersList) {
      lines.push(`- ${worker.id}: ${worker.status} · ${worker.repoPath}`);
    }
  }

  return lines.join("\n");
}

function getActivitySnapshot(): { activeWorkers: number; activePipelines: number; activeBatches: number } {
  const { workers, pipelines, batches } = readState();
  const activeWorkers = workers.filter((worker) => worker.status === "running" && pidAlive(worker.pid ?? null));
  const activePipelines = pipelines.filter((pipeline) => pipeline.status === "running");
  const activeBatches = batches.filter((batch) => batch.status === "running");
  return {
    activeWorkers: activeWorkers.length,
    activePipelines: activePipelines.length,
    activeBatches: activeBatches.length,
  };
}

function scheduleIdleShutdown(): void {
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    if (shutdownRequested) {
      return;
    }

    const { activeWorkers, activePipelines, activeBatches } = getActivitySnapshot();
    const hasActivity = activeWorkers > 0 || activePipelines > 0 || activeBatches > 0;

    if (hasActivity) {
      idleSince = null;
      return;
    }

    if (!idleSince) {
      idleSince = Date.now();
      return;
    }

    if (Date.now() - idleSince >= IDLE_SHUTDOWN_MS) {
      shutdownRequested = true;
      removeDashboardMeta();
      if (httpServer) {
        try {
          httpServer.close(() => process.exit(0));
        } catch {
          process.exit(0);
        }
      } else {
        process.exit(0);
      }
    }
  }, IDLE_CHECK_MS);
  idleTimer.unref?.();
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendText(res: ServerResponse, statusCode: number, body: string, contentType = "text/plain; charset=utf-8"): void {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
}

function serveStatic(req: IncomingMessage, res: ServerResponse, fileName: string, contentType: string): void {
  const filePath = join(UI_DIR, fileName);
  try {
    const body = readFileSync(filePath);
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store",
    });
    res.end(body);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      sendText(res, 404, "Not found");
    } else {
      sendText(res, 500, `Failed to read asset: ${(error as Error).message}`);
    }
  }
}

async function ensureHttpServer(): Promise<{ port: number | null }> {
  if (httpServer) {
    return { port: httpPort };
  }

  httpServer = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/") {
      serveStatic(req, res, "index.html", "text/html; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname === "/styles.css") {
      serveStatic(req, res, "styles.css", "text/css; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname === "/app.js") {
      serveStatic(req, res, "app.js", "application/javascript; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/snapshot") {
      const repo = url.searchParams.get("repo") || "";
      sendJson(res, 200, buildSnapshot(repo));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/log") {
      const workerId = url.searchParams.get("worker_id") || "";
      const tail = Number.parseInt(url.searchParams.get("tail") || "60", 10);
      const { workers } = readState();
      const worker = workers.find((item) => item.id === workerId);
      if (!worker) {
        sendJson(res, 404, { error: "Unknown worker" });
        return;
      }
      const logFile = safeText(worker.logFile, join(LOGS_DIR, `${workerId}.log`));
      sendJson(res, 200, {
        workerId,
        logFile,
        tail: Number.isFinite(tail) ? tail : 60,
        content: tailText(logFile, Number.isFinite(tail) ? tail : 60),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/open-path") {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk;
      });
      req.on("end", () => {
        try {
          const payload = raw ? JSON.parse(raw) as Record<string, unknown> : {};
          const targetPath = safeText(payload.path, "");
          if (!targetPath) {
            sendJson(res, 400, { ok: false, error: "Missing path" });
            return;
          }
          const result = openPath(targetPath);
          sendJson(res, result.ok ? 200 : 500, result);
        } catch (error) {
          sendJson(res, 400, { ok: false, error: (error as Error).message });
        }
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/action") {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk;
      });
      req.on("end", () => {
        try {
          const payload = raw ? JSON.parse(raw) as Record<string, unknown> : {};
          const action = safeText(payload.action, "");
          const targetId = safeText(payload.target_id, "");
          const state = getMutableState();
          let result: ActionResult = { ok: false, error: "Unknown action" };
          if (action === "cancel_pipeline") {
            result = cancelPipelineInState(state, targetId);
          } else if (action === "terminate_worker") {
            result = terminateWorkerInState(state, targetId);
          } else if (action === "cleanup_worker") {
            result = cleanupWorkerInState(state, targetId);
          } else {
            result = { ok: false, error: `Unknown action: ${action}` };
          }
          sendJson(res, result.ok ? 200 : 400, result);
        } catch (error) {
          sendJson(res, 400, { ok: false, error: (error as Error).message });
        }
      });
      return;
    }

    sendText(res, 404, "Not found");
  });

  await new Promise<void>((resolve, reject) => {
    httpServer!.once("error", reject);
    httpServer!.listen(0, "127.0.0.1", () => {
      const address = httpServer!.address();
      httpPort = typeof address === "object" && address ? address.port : null;
      const dashUrl = `http://127.0.0.1:${httpPort}/`;
      try {
        mkdirSync(DATA_DIR, { recursive: true });
        writeFileSync(
          DASHBOARD_META_FILE,
          JSON.stringify(
            { pid: process.pid, port: httpPort, url: dashUrl, startedAt: now() },
            null,
            2
          )
        );
      } catch {}
      if (IS_SERVE_MODE) {
        process.stdout.write(JSON.stringify({ url: dashUrl, pid: process.pid }) + "\n");
      }
      resolve();
    });
  });

  scheduleIdleShutdown();
  process.on("exit", removeDashboardMeta);
  process.on("SIGTERM", () => {
    removeDashboardMeta();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    removeDashboardMeta();
    process.exit(0);
  });

  return { port: httpPort };
}

const server = new Server(
  { name: "agent-dashboard", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "open_dashboard",
      description:
        "Start the local dashboard server and return the URL for the precompiled UI. The dashboard is a control plane over pipelines and workers, with safe operational actions like cancel, terminate, and cleanup.",
      inputSchema: {
        type: "object",
        properties: {
          repo_path: {
            type: "string",
            description: "Optional repo to prefilter the dashboard.",
          },
        },
      },
    },
    {
      name: "get_dashboard_snapshot",
      description:
        "Read the current dashboard snapshot from the orchestrator state, including pipelines, workers, blockers, and log tails.",
      inputSchema: {
        type: "object",
        properties: {
          repo_path: {
            type: "string",
            description: "Optional repo path filter.",
          },
          format: {
            type: "string",
            enum: ["json", "markdown"],
            description: "Output format for the snapshot. JSON is machine-friendly; Markdown is prompt-friendly.",
          },
        },
      },
    },
    {
      name: "open_path",
      description:
        "Open a local path in the system file browser. Useful for repos, worktrees, and log files.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute filesystem path to open.",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "cancel_pipeline",
      description: "Cancel a running pipeline by terminating its active worker and marking it cancelled.",
      inputSchema: {
        type: "object",
        properties: {
          pipeline_id: {
            type: "string",
            description: "Pipeline id to cancel.",
          },
        },
        required: ["pipeline_id"],
      },
    },
    {
      name: "terminate_worker",
      description: "Terminate a running worker process from the dashboard control plane.",
      inputSchema: {
        type: "object",
        properties: {
          worker_id: {
            type: "string",
            description: "Worker id to terminate.",
          },
        },
        required: ["worker_id"],
      },
    },
    {
      name: "cleanup_worker",
      description: "Remove a finished isolated worktree worker and clean its worktree path.",
      inputSchema: {
        type: "object",
        properties: {
          worker_id: {
            type: "string",
            description: "Worker id to clean up.",
          },
        },
        required: ["worker_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a = (args ?? {}) as Record<string, unknown>;

  if (name === "open_dashboard") {
    const repoPath = safeText(a.repo_path, "");
    const { dashboardUrl } = await startDashboardProcess(repoPath);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              dashboard_url: dashboardUrl.toString(),
              generated_at: now(),
              repo_filter: repoPath || null,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === "get_dashboard_snapshot") {
    const repoPath = safeText(a.repo_path, "");
    const snapshot = buildSnapshot(repoPath);
    if (a.format === "markdown") {
      return {
        content: [
          {
            type: "text",
            text: snapshotToMarkdown(snapshot),
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(snapshot, null, 2),
        },
      ],
    };
  }

  if (name === "open_path") {
    const result = openPath(safeText(a.path, ""));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
      isError: !result.ok,
    };
  }

  if (name === "cancel_pipeline") {
    const state = getMutableState();
    const result = cancelPipelineInState(state, safeText(a.pipeline_id, ""));
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    };
  }

  if (name === "terminate_worker") {
    const state = getMutableState();
    const result = terminateWorkerInState(state, safeText(a.worker_id, ""));
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    };
  }

  if (name === "cleanup_worker") {
    const state = getMutableState();
    const result = cleanupWorkerInState(state, safeText(a.worker_id, ""));
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    };
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

function spawnDetachedDashboard(repoPath = ""): ChildProcess {
  return spawn(process.execPath, ["--experimental-strip-types", __filename, "--serve-ui"], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, HARNESS_DASHBOARD_REPO: repoPath },
  });
}

async function startDashboardProcess(repoPath = ""): Promise<{ dashboardUrl: string; pid: number | undefined; reused: boolean; opened: OpenResult }> {
  const existing = readJson<DashboardMeta | null>(DASHBOARD_META_FILE, null);
  if (existing?.pid && pidAlive(existing.pid) && existing?.url) {
    const dashboardUrl = new URL(existing.url);
    if (repoPath) dashboardUrl.searchParams.set("repo", repoPath);
    const opened = openUrl(dashboardUrl.toString());
    return { dashboardUrl: dashboardUrl.toString(), pid: existing.pid, reused: true, opened };
  }

  try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}

  const child = spawnDetachedDashboard(repoPath);
  const url = await readReadySignal(child);
  const dashboardUrl = new URL(url);
  if (repoPath) dashboardUrl.searchParams.set("repo", repoPath);
  const opened = openUrl(dashboardUrl.toString());
  return { dashboardUrl: dashboardUrl.toString(), pid: child.pid, reused: false, opened };
}

if (IS_SERVE_MODE) {
  ensureHttpServer().catch((error: Error) => {
    process.stderr.write(`dashboard serve failed: ${error.stack || error.message}\n`);
    process.exit(1);
  });
} else {
  const transport = new StdioServerTransport();

  (async () => {
    await server.connect(transport);
  })().catch((error: Error) => {
    process.stderr.write(`agent-dashboard failed: ${error.stack || error.message}\n`);
    process.exit(1);
  });
}
