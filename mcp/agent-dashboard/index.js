#!/usr/bin/env node
"use strict";

const http = require("node:http");
const { spawn } = require("node:child_process");
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

function readState() {
  const state = readJson(STATE_FILE, {});
  const workers = Array.isArray(state.workerList) ? state.workerList : [];
  const pipelines = Array.isArray(state.pipelineList) ? state.pipelineList : [];
  return { workers, pipelines };
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

function buildSnapshot(repoFilter = "") {
  const { workers, pipelines } = readState();
  const workerById = new Map();
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

  const filteredWorkers = normalizedWorkers.filter(
    (worker) => !repoFilter || worker.repoPath === repoFilter
  );

  const totals = {
    pipelines: normalizedPipelines.length,
    running: normalizedPipelines.filter((pipeline) => pipeline.status === "running").length,
    blocked: normalizedPipelines.filter((pipeline) => pipeline.status === "blocked").length,
    failed: normalizedPipelines.filter((pipeline) => pipeline.status === "failed").length,
    workers: filteredWorkers.length,
    liveWorkers: filteredWorkers.filter((worker) => worker.live).length,
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
    recentBlocked,
    pipelines: normalizedPipelines,
    workers: filteredWorkers,
  };
}

function getActivitySnapshot() {
  const { workers, pipelines } = readState();
  const activeWorkers = workers.filter((worker) => worker.status === "running" && pidAlive(worker.pid));
  const activePipelines = pipelines.filter((pipeline) => pipeline.status === "running");
  return {
    activeWorkers: activeWorkers.length,
    activePipelines: activePipelines.length,
  };
}

function scheduleIdleShutdown() {
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    if (shutdownRequested) {
      return;
    }

    const { activeWorkers, activePipelines } = getActivitySnapshot();
    const hasActivity = activeWorkers > 0 || activePipelines > 0;

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
        "Start the local dashboard server and return the URL for the precompiled UI. The dashboard is a read-only control plane over pipelines and workers.",
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
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(buildSnapshot(repoPath), null, 2),
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
