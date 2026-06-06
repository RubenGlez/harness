import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { now, readJson } from "./runtime.js";

export const DATA_DIR = join(homedir(), ".claude", "orchestrator");
export const STATE_FILE = join(DATA_DIR, "state.json");

export function createTelemetry() {
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

export function normalizeHealthEvent(value) {
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

export function readState() {
  const raw = readJson(STATE_FILE, {});
  return {
    workerList: Array.isArray(raw.workerList) ? raw.workerList : [],
    pipelineList: Array.isArray(raw.pipelineList) ? raw.pipelineList : [],
    batchList: Array.isArray(raw.batchList) ? raw.batchList : [],
    telemetry: normalizeTelemetry(raw.telemetry ?? null),
  };
}

export function writeState(state) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    return true;
  } catch {
    return false;
  }
}
