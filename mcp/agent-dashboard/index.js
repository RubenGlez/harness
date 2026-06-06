#!/usr/bin/env node
"use strict";

const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");
const {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { Server } = require("../agent-orchestrator/node_modules/@modelcontextprotocol/sdk/dist/cjs/server/index.js");
const { StdioServerTransport } = require("../agent-orchestrator/node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("../agent-orchestrator/node_modules/@modelcontextprotocol/sdk/dist/cjs/types.js");

const HOME = os.homedir();
const DATA_DIR = path.join(HOME, ".claude", "orchestrator");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const LOGS_DIR = path.join(DATA_DIR, "logs");
const DASHBOARD_META_FILE = path.join(DATA_DIR, "dashboard.json");
const UI_DIR = path.join(__dirname, "public");
const IS_SERVE_MODE = process.argv.includes("--serve-ui");

let httpServer = null;
let httpPort = null;
let idleSince = null;
let idleTimer = null;
let shutdownRequested = false;

const IDLE_SHUTDOWN_MS = Number.parseInt(
  process.env.HARNESS_DASHBOARD_IDLE_SHUTDOWN_MS || "60000",
  10
);
const IDLE_CHECK_MS = Number.parseInt(
  process.env.HARNESS_DASHBOARD_IDLE_CHECK_MS || "5000",
  10
);

function now() {
  return new Date().toISOString();
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function safeText(value, fallback = "") {
  return typeof value === "string" && value.length ? value : fallback;
}

function getMutableState() {
  const state = readJson(STATE_FILE, {});
  state.workerList = Array.isArray(state.workerList) ? state.workerList : [];
  state.pipelineList = Array.isArray(state.pipelineList) ? state.pipelineList : [];
  state.batchList = Array.isArray(state.batchList) ? state.batchList : [];
  state.telemetry = state.telemetry && typeof state.telemetry === "object" ? state.telemetry : {};
  state.telemetry.manual = state.telemetry.manual && typeof state.telemetry.manual === "object"
    ? state.telemetry.manual
    : { cancels: 0, terminations: 0, cleanups: 0 };
  state.telemetry.lastEvent = state.telemetry.lastEvent && typeof state.telemetry.lastEvent === "object"
    ? state.telemetry.lastEvent
    : null;
  return state;
}

function saveState(state) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    return true;
  } catch {
    return false;
  }
}

function updateBatchStatuses(state) {
  const pipelineById = new Map((state.pipelineList || []).map((pipeline) => [pipeline.id, pipeline]));

  for (const batch of state.batchList || []) {
    const items = Array.isArray(batch.pipelines) ? batch.pipelines : [];
    let hasRunning = false;
    let hasFailed = false;
    let hasBlocked = false;
    let allDone = items.length > 0;
    let allCancelled = items.length > 0;

    for (const item of items) {
      const pipeline = pipelineById.get(item.pipelineId);
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

function persistState(state) {
  updateBatchStatuses(state);
  return saveState(state);
}

function noteManualTelemetry(state, type, id, note = "") {
  state.telemetry = state.telemetry && typeof state.telemetry === "object" ? state.telemetry : {};
  state.telemetry.manual = state.telemetry.manual && typeof state.telemetry.manual === "object"
    ? state.telemetry.manual
    : { cancels: 0, terminations: 0, cleanups: 0 };
  if (Object.prototype.hasOwnProperty.call(state.telemetry.manual, type)) {
    state.telemetry.manual[type] += 1;
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

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeDashboardMeta() {
  try {
    if (existsSync(DASHBOARD_META_FILE)) {
      unlinkSync(DASHBOARD_META_FILE);
    }
  } catch {}
}

function tailText(filePath, lines = 40) {
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

function openPath(targetPath) {
  if (!targetPath) return { ok: false, error: "Missing path" };

  const platform = process.platform;
  const opener =
    platform === "darwin"
      ? { command: "open", args: [targetPath] }
      : platform === "win32"
        ? { command: "cmd", args: ["/c", "start", "", targetPath] }
        : { command: "xdg-open", args: [targetPath] };

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

function killPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function findWorker(state, workerId) {
  return (state.workerList || []).find((worker) => worker.id === workerId) || null;
}

function findPipeline(state, pipelineId) {
  return (state.pipelineList || []).find((pipeline) => pipeline.id === pipelineId) || null;
}

function cancelPipelineInState(state, pipelineId) {
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

function terminateWorkerInState(state, workerId) {
  const worker = findWorker(state, workerId);
  if (!worker) return { ok: false, error: `No worker: ${workerId}` };
  if (worker.status !== "running") return { ok: false, error: `Worker is not running (status: ${worker.status}).` };

  if (worker.pid) {
    killPid(worker.pid);
  }

  worker.status = "terminated";
  worker.endTime = now();
  worker.recoveryReason = "terminated from dashboard";

  const pipeline = (state.pipelineList || []).find((item) =>
    Array.isArray(item.stages) && item.stages.some((stage) => stage.workerId === worker.id)
  );
  if (pipeline) {
    const stage = pipeline.stages.find((item) => item.workerId === worker.id);
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

function cleanupWorkerInState(state, workerId) {
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
    return { ok: false, error: `Failed to remove worktree: ${error.message}` };
  }

  state.workerList = state.workerList.filter((item) => item.id !== worker.id);
  noteManualTelemetry(state, "cleanups", worker.id, worker.repoPath);
  persistState(state);
  return { ok: true, message: `Worker ${worker.id} cleaned up.` };
}

function readState() {
  const state = readJson(STATE_FILE, {});
  const workers = Array.isArray(state.workerList) ? state.workerList : [];
  const pipelines = Array.isArray(state.pipelineList) ? state.pipelineList : [];
  const batches = Array.isArray(state.batchList) ? state.batchList : [];
  const telemetry = state.telemetry && typeof state.telemetry === "object" ? state.telemetry : null;
  return { workers, pipelines, batches, telemetry };
}

function normalizeWorker(worker) {
  const status = safeText(worker.status, "unknown");
  const pid = Number.isInteger(worker.pid) ? worker.pid : null;
  const live = status === "running" ? pidAlive(pid) : false;
  const effectiveStatus = status === "running" && !live ? "failed" : status;
  const logFile = safeText(worker.logFile, path.join(LOGS_DIR, `${worker.id}.log`));

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

function normalizePipeline(pipeline, workerById) {
  const stages = Array.isArray(pipeline.stages) ? pipeline.stages : [];
  const normalizedStages = stages.map((stage) => {
    const worker = stage.workerId ? workerById.get(stage.workerId) : null;
    const result = stage.result ?? null;
    const blockers = Array.isArray(result?.blocked) ? result.blocked : [];
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
      filesChanged: Array.isArray(result?.files_changed) ? result.files_changed : [],
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

function normalizeBatch(batch, pipelineById) {
  const items = Array.isArray(batch.pipelines) ? batch.pipelines : [];
  const normalizedPipelines = items.map((item) => {
    const pipeline = item.pipelineId ? pipelineById.get(item.pipelineId) : null;
    const status = pipeline?.status || item.status || "unknown";
    const currentStage = pipeline?.stages?.find((stage) => stage.status === "running")?.id ?? item.currentStage ?? null;
    return {
      pipelineId: item.pipelineId ?? null,
      repoPath: pipeline?.repoPath ?? item.repoPath ?? "",
      status,
      currentStage,
      description: pipeline?.description ?? null,
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

function buildSnapshot(repoFilter = "") {
  const { workers, pipelines, batches, telemetry } = readState();
  const workerById = new Map();
  const pipelineById = new Map();
  const normalizedWorkers = workers
    .map(normalizeWorker)
    .sort((a, b) => (b.startTime || "").localeCompare(a.startTime || ""));

  for (const worker of normalizedWorkers) {
    workerById.set(worker.id, worker);
  }

  const normalizedPipelines = pipelines
    .map((pipeline) => normalizePipeline(pipeline, workerById))
    .filter((pipeline) => !repoFilter || pipeline.repoPath === repoFilter)
    .sort((a, b) => (b.startTime || "").localeCompare(a.startTime || ""));

  for (const pipeline of normalizedPipelines) {
    pipelineById.set(pipeline.id, pipeline);
  }

  const normalizedBatches = batches
    .map((batch) => normalizeBatch(batch, pipelineById))
    .filter((batch) => {
      if (!repoFilter) return true;
      return batch.pipelines.some((pipeline) => pipeline.repoPath === repoFilter);
    })
    .sort((a, b) => (b.startTime || "").localeCompare(a.startTime || ""));

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
  const activePipelineAgesMs = normalizedPipelines
    .filter((pipeline) => pipeline.status === "running" && pipeline.startTime)
    .map((pipeline) => Math.max(0, Date.now() - new Date(pipeline.startTime).getTime()))
    .filter((value) => Number.isFinite(value));
  const longestRunningPipelineMs = activePipelineAgesMs.length ? Math.max(...activePipelineAgesMs) : 0;
  const staleRunningPipelines = normalizedPipelines.filter((pipeline) => {
    if (pipeline.status !== "running" || !pipeline.startTime) return false;
    const startedAt = new Date(pipeline.startTime).getTime();
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

  const healthSignals = [];
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
    last_event: lastEvent,
  };

  const recentBlocked = normalizedPipelines
    .filter((pipeline) => pipeline.status === "blocked")
    .slice(0, 3)
    .map((pipeline) => {
      const stage = pipeline.stages.find((item) => item.status === "blocked");
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
    },
    recentBlocked,
    batches: normalizedBatches,
    pipelines: normalizedPipelines,
    workers: filteredWorkers,
  };
}

function snapshotToMarkdown(snapshot) {
  const lines = [
    `# Dashboard snapshot`,
    ``,
    `- generated_at: ${snapshot.generatedAt}`,
    `- repo_filter: ${snapshot.repoFilter || "n/a"}`,
    `- batches: ${snapshot.totals.batches}`,
    `- archived_batches: ${snapshot.totals.archivedBatches}`,
    `- pipelines: ${snapshot.totals.pipelines}`,
    `- archived_pipelines: ${snapshot.totals.archivedPipelines}`,
    `- running: ${snapshot.totals.running}`,
    `- blocked: ${snapshot.totals.blocked}`,
    `- failed: ${snapshot.totals.failed}`,
    `- workers: ${snapshot.totals.workers}`,
    `- archived_workers: ${snapshot.totals.archivedWorkers}`,
    `- live_workers: ${snapshot.totals.liveWorkers}`,
    `- pipeline_started: ${snapshot.telemetry.pipeline_started}`,
    `- pipeline_finished: ${snapshot.telemetry.pipeline_finished}`,
    `- pipeline_success_rate: ${snapshot.telemetry.pipeline_success_rate}%`,
    `- pipeline_failure_rate: ${snapshot.telemetry.pipeline_failure_rate}%`,
    `- avg_pipeline_duration_ms: ${snapshot.telemetry.avg_pipeline_duration_ms}`,
    `- batch_started: ${snapshot.telemetry.batch_started}`,
    `- batch_finished: ${snapshot.telemetry.batch_finished}`,
    `- avg_batch_duration_ms: ${snapshot.telemetry.avg_batch_duration_ms}`,
    `- archived_total: ${snapshot.telemetry.archived}`,
    `- purged_total: ${snapshot.telemetry.purged}`,
    `- manual_interventions: ${snapshot.telemetry.manual_interventions}`,
    `- manual_intervention_rate: ${snapshot.telemetry.manual_intervention_rate}%`,
    `- longest_running_pipeline_ms: ${snapshot.telemetry.longest_running_pipeline_ms}`,
    `- stale_running_pipelines: ${snapshot.telemetry.stale_running_pipelines}`,
  ];

  if (snapshot.telemetry.last_event) {
    const ev = snapshot.telemetry.last_event;
    lines.push(`- last_event: ${ev.type} @ ${ev.at} (${ev.scope}${ev.status ? `:${ev.status}` : ""})`);
  }

  if (snapshot.recentBlocked.length) {
    lines.push(``, `## Recent blocked pipelines`);
    for (const item of snapshot.recentBlocked) {
      lines.push(`- ${item.pipelineId} · ${item.repoPath} · ${item.stageId || "unknown"} · ${item.reason}`);
    }
  }

  if (snapshot.health?.signals?.length) {
    lines.push(``, `## Health signals`);
    lines.push(`- level: ${snapshot.health.level}`);
    for (const signal of snapshot.health.signals) {
      lines.push(`- ${signal.level}: ${signal.title} — ${signal.detail}`);
    }
  }

  if (snapshot.batches.length) {
    lines.push(``, `## Batches`);
    for (const batch of snapshot.batches) {
      lines.push(`- ${batch.id}: ${batch.status} (${batch.repoCount} repos)`);
    }
  }

  if (snapshot.pipelines.length) {
    lines.push(``, `## Pipelines`);
    for (const pipeline of snapshot.pipelines) {
      lines.push(`- ${pipeline.id}: ${pipeline.status} · ${pipeline.repoPath}`);
    }
  }

  if (snapshot.workers.length) {
    lines.push(``, `## Workers`);
    for (const worker of snapshot.workers) {
      lines.push(`- ${worker.id}: ${worker.status} · ${worker.repoPath}`);
    }
  }

  return lines.join("\n");
}

function getActivitySnapshot() {
  const { workers, pipelines, batches } = readState();
  const activeWorkers = workers.filter((worker) => worker.status === "running" && pidAlive(worker.pid));
  const activePipelines = pipelines.filter((pipeline) => pipeline.status === "running");
  const activeBatches = batches.filter((batch) => batch.status === "running");
  return {
    activeWorkers: activeWorkers.length,
    activePipelines: activePipelines.length,
    activeBatches: activeBatches.length,
  };
}

function scheduleIdleShutdown() {
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

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
}

function serveStatic(req, res, fileName, contentType) {
  const filePath = path.join(UI_DIR, fileName);
  if (!existsSync(filePath)) {
    sendText(res, 404, "Not found");
    return;
  }
  try {
    const body = readFileSync(filePath);
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store",
    });
    res.end(body);
  } catch (error) {
    sendText(res, 500, `Failed to read asset: ${error.message}`);
  }
}

async function ensureHttpServer() {
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
      const logFile = safeText(worker.logFile, path.join(LOGS_DIR, `${workerId}.log`));
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
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        try {
          const payload = raw ? JSON.parse(raw) : {};
          const targetPath = safeText(payload.path, "");
          if (!targetPath) {
            sendJson(res, 400, { ok: false, error: "Missing path" });
            return;
          }
          const result = openPath(targetPath);
          sendJson(res, result.ok ? 200 : 500, result);
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message });
        }
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/action") {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        try {
          const payload = raw ? JSON.parse(raw) : {};
          const action = safeText(payload.action, "");
          const targetId = safeText(payload.target_id, "");
          const state = getMutableState();
          let result = { ok: false, error: "Unknown action" };
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
          sendJson(res, 400, { ok: false, error: error.message });
        }
      });
      return;
    }

    sendText(res, 404, "Not found");
  });

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address();
      httpPort = typeof address === "object" && address ? address.port : null;
      try {
        mkdirSync(DATA_DIR, { recursive: true });
        writeFileSync(
          DASHBOARD_META_FILE,
          JSON.stringify(
            {
              pid: process.pid,
              port: httpPort,
              url: `http://127.0.0.1:${httpPort}/`,
              startedAt: now(),
            },
            null,
            2
          )
        );
      } catch {}
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

  if (name === "open_dashboard") {
    const repoPath = safeText(args?.repo_path, "");
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
    const repoPath = safeText(args?.repo_path, "");
    const snapshot = buildSnapshot(repoPath);
    if (args?.format === "markdown") {
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
    const result = openPath(safeText(args?.path, ""));
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
    const result = cancelPipelineInState(state, safeText(args?.pipeline_id, ""));
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    };
  }

  if (name === "terminate_worker") {
    const state = getMutableState();
    const result = terminateWorkerInState(state, safeText(args?.worker_id, ""));
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    };
  }

  if (name === "cleanup_worker") {
    const state = getMutableState();
    const result = cleanupWorkerInState(state, safeText(args?.worker_id, ""));
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

function spawnDetachedDashboard(repoPath = "") {
  const child = spawn(process.execPath, [__filename, "--serve-ui"], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      HARNESS_DASHBOARD_REPO: repoPath,
    },
  });
  child.unref();
  return child.pid ?? null;
}

async function startDashboardProcess(repoPath = "") {
  const existing = readJson(DASHBOARD_META_FILE, null);
  if (existing?.pid && pidAlive(existing.pid) && existing?.url) {
    const dashboardUrl = new URL(existing.url);
    if (repoPath) dashboardUrl.searchParams.set("repo", repoPath);
    const opened = openUrl(dashboardUrl.toString());
    return {
      dashboardUrl: dashboardUrl.toString(),
      pid: existing.pid,
      reused: true,
      opened,
    };
  }

  try {
    mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
  try {
    writeFileSync(DASHBOARD_META_FILE, JSON.stringify({ starting: true, startedAt: now() }, null, 2));
  } catch {}

  const pid = spawnDetachedDashboard(repoPath);
  const url = await waitForDashboardUrl();
  const dashboardUrl = new URL(url);
  if (repoPath) dashboardUrl.searchParams.set("repo", repoPath);
  const opened = openUrl(dashboardUrl.toString());
  return {
    dashboardUrl: dashboardUrl.toString(),
    pid,
    reused: false,
    opened,
  };
}

if (IS_SERVE_MODE) {
  ensureHttpServer().catch((error) => {
    process.stderr.write(`dashboard serve failed: ${error.stack || error.message}\n`);
    process.exit(1);
  });
} else {
  const transport = new StdioServerTransport();

  (async () => {
    await server.connect(transport);
  })().catch((error) => {
    process.stderr.write(`agent-dashboard failed: ${error.stack || error.message}\n`);
    process.exit(1);
  });
}
