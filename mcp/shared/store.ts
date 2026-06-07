import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { now, readJson } from "./runtime.ts";

export const DATA_DIR = join(homedir(), ".claude", "orchestrator");
export const STATE_FILE = join(DATA_DIR, "state.json");

export type HealthLevel = "good" | "warning" | "danger";

export interface HealthEvent {
  at: string;
  scope: string;
  id: string;
  repoPath: string;
  level: HealthLevel;
  type: string;
  status: string;
  title: string;
  detail: string;
  durationMs: number | null;
}

export interface LastEvent {
  type: string;
  at: string;
  scope: string;
  id: string;
  status: string;
  note: string;
}

export interface Telemetry {
  pipelines: { started: number; done: number; blocked: number; failed: number; cancelled: number; durationMsTotal: number; finished: number };
  batches: { started: number; done: number; blocked: number; failed: number; cancelled: number; durationMsTotal: number; finished: number };
  workers: { started: number; done: number; failed: number; terminated: number; durationMsTotal: number; finished: number };
  lifecycle: { archived: number; purged: number };
  manual: { cancels: number; terminations: number; cleanups: number };
  health: { recent: HealthEvent[] };
  lastEvent: LastEvent | null;
}

interface RawState {
  workerList: unknown[];
  pipelineList: unknown[];
  batchList: unknown[];
  telemetry?: unknown;
}

export function createTelemetry(): Telemetry {
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

export function normalizeHealthEvent(value: unknown): HealthEvent | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const level = v.level === "danger" || v.level === "warning" || v.level === "good" ? v.level : "good";
  return {
    at: typeof v.at === "string" && v.at ? v.at : now(),
    scope: typeof v.scope === "string" && v.scope ? v.scope : "unknown",
    id: typeof v.id === "string" ? v.id : "",
    repoPath: typeof v.repoPath === "string" ? v.repoPath : "",
    level,
    type: typeof v.type === "string" && v.type ? v.type : "health_event",
    status: typeof v.status === "string" ? v.status : "",
    title: typeof v.title === "string" ? v.title : "",
    detail: typeof v.detail === "string" ? v.detail : "",
    durationMs: Number.isFinite(v.durationMs) ? (v.durationMs as number) : null,
  };
}

function normalizeTelemetry(value: unknown): Telemetry {
  const normalized = createTelemetry();
  if (!value || typeof value !== "object") return normalized;

  const v = value as Record<string, unknown>;
  for (const group of ["pipelines", "batches", "workers", "lifecycle", "manual"] as const) {
    const src = v[group];
    if (!src || typeof src !== "object") continue;
    const srcObj = src as Record<string, unknown>;
    const dest = normalized[group] as Record<string, number>;
    for (const key of Object.keys(dest)) {
      const nestedValue = srcObj[key];
      if (typeof nestedValue === "number" && Number.isFinite(nestedValue)) {
        dest[key] = nestedValue;
      }
    }
  }

  const health = v.health;
  if (health && typeof health === "object" && Array.isArray((health as Record<string, unknown>).recent)) {
    normalized.health.recent = ((health as Record<string, unknown>).recent as unknown[])
      .map(normalizeHealthEvent)
      .filter((e): e is HealthEvent => e !== null)
      .slice(-24);
  }

  const lastEvent = v.lastEvent;
  if (lastEvent && typeof lastEvent === "object") {
    const le = lastEvent as Record<string, unknown>;
    normalized.lastEvent = {
      type: typeof le.type === "string" && le.type ? le.type : "unknown",
      at: typeof le.at === "string" && le.at ? le.at : now(),
      scope: typeof le.scope === "string" && le.scope ? le.scope : "unknown",
      id: typeof le.id === "string" ? le.id : "",
      status: typeof le.status === "string" ? le.status : "",
      note: typeof le.note === "string" ? le.note : "",
    };
  }
  return normalized;
}

export function readState(): { workerList: unknown[]; pipelineList: unknown[]; batchList: unknown[]; telemetry: Telemetry } {
  const raw = readJson<RawState>(STATE_FILE, { workerList: [], pipelineList: [], batchList: [] });
  return {
    workerList: Array.isArray(raw.workerList) ? raw.workerList : [],
    pipelineList: Array.isArray(raw.pipelineList) ? raw.pipelineList : [],
    batchList: Array.isArray(raw.batchList) ? raw.batchList : [],
    telemetry: normalizeTelemetry(raw.telemetry ?? null),
  };
}

export function writeState(state: { workerList: unknown[]; pipelineList: unknown[]; batchList: unknown[]; telemetry: Telemetry }): boolean {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    return true;
  } catch {
    return false;
  }
}
