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
  readFileSync,
  writeFileSync,
  existsSync,
  createWriteStream,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// ── Paths ──────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS_DIR = resolve(__dirname, "../..");
const DATA_DIR = join(homedir(), ".claude", "orchestrator");
const WORKTREES_DIR = join(DATA_DIR, "worktrees");
const LOGS_DIR = join(DATA_DIR, "logs");
const STATE_FILE = join(DATA_DIR, "state.json");

for (const d of [DATA_DIR, WORKTREES_DIR, LOGS_DIR]) {
  mkdirSync(d, { recursive: true });
}

// ── Harness pipeline ───────────────────────────────────────────────────────────

// Ordered stages available for pipeline composition.
const ALL_STAGES = ["dev-plan", "implement", "qa", "update-docs"];

/**
 * Build the prompt sent to a worker for a given harness stage.
 * Embeds the actual SKILL.md content so the worker has the full instructions.
 */
function stagePrompt(stageId, repoPath) {
  const skillFile = join(HARNESS_DIR, "skills", stageId, "SKILL.md");
  const skillContent = existsSync(skillFile)
    ? readFileSync(skillFile, "utf8")
    : `Execute the '${stageId}' stage of the harness workflow on the project.`;

  return [
    `You are an autonomous agent executing the "${stageId}" stage of the harness pipeline.`,
    `Project repository: ${repoPath}`,
    ``,
    `Follow the skill instructions below exactly:`,
    ``,
    `--- SKILL: ${stageId} ---`,
    skillContent,
    `--- END SKILL ---`,
    ``,
    `AFK MODE — critical constraints:`,
    `- You MUST complete this stage fully autonomously. Do NOT pause for user input.`,
    `- Read .harness/ for all context needed to make decisions independently.`,
    `- If you hit a genuine blocker, document it in .harness/pipeline/${stageId}-blockers.md`,
    `  and continue with everything you can still do.`,
    `- When the stage is finished, write a brief completion note to`,
    `  .harness/pipeline/${stageId}-done.md containing: what was done, files changed,`,
    `  any blockers encountered, suggested next step.`,
    `- Then commit all changes with a descriptive message.`,
  ].join("\n");
}

// ── State ──────────────────────────────────────────────────────────────────────

const workers = new Map();   // id → Worker
const pipelines = new Map(); // id → Pipeline

function loadState() {
  if (!existsSync(STATE_FILE)) return;
  try {
    const { workerList = [], pipelineList = [] } = JSON.parse(
      readFileSync(STATE_FILE, "utf8")
    );
    for (const w of workerList) {
      if (w.status === "running") {
        let alive = false;
        try { process.kill(w.pid, 0); alive = true; } catch {}
        if (!alive) { w.status = "failed"; w.endTime = now(); }
      }
      workers.set(w.id, w);
    }
    for (const p of pipelineList) pipelines.set(p.id, p);
  } catch {}
}

function saveState() {
  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      { workerList: [...workers.values()], pipelineList: [...pipelines.values()] },
      null,
      2
    )
  );
}

loadState();

// ── Helpers ────────────────────────────────────────────────────────────────────

function genId() { return randomBytes(4).toString("hex"); }
function now() { return new Date().toISOString(); }

function sh(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

// ── Worker spawning ────────────────────────────────────────────────────────────

/**
 * Create a git worktree and spawn an agent inside it.
 * Returns { workerId, branch, worktreePath } on success, or { error } on failure.
 */
function spawnWorker({ name, task, agent, repoPath, baseBranch = null }) {
  const workerId = genId();
  const branch = `agent/${name}-${workerId}`;
  const worktreePath = join(WORKTREES_DIR, workerId);
  const logFile = join(LOGS_DIR, `${workerId}.log`);

  try {
    sh(
      `git worktree add -b "${branch}" "${worktreePath}" ${baseBranch || "HEAD"}`,
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

  const [cmd, ...cmdArgs] =
    agent === "codex"
      ? ["codex", "--full-auto", fullTask]
      : ["claude", "-p", fullTask];

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
  saveState();

  proc.on("exit", (code) => {
    logStream.end();
    const w = workers.get(workerId);
    if (!w) return;
    // Auto-commit any uncommitted work left by the agent
    if (code === 0) {
      try {
        if (sh("git status --porcelain", w.worktreePath)) {
          sh("git add -A", w.worktreePath);
          sh(`git commit -m "agent(${w.name}): auto-commit remaining changes"`, w.worktreePath);
        }
      } catch {}
    }
    w.status = code === 0 ? "done" : "failed";
    w.exitCode = code ?? null;
    w.endTime = now();
    saveState();
  });

  return { workerId, branch, worktreePath };
}

// ── Pipeline state machine ─────────────────────────────────────────────────────

let pollTimer = null;

function startPollLoop() {
  if (pollTimer) return;
  pollTimer = setInterval(tickAllPipelines, 30_000);
}

function maybeStopPollLoop() {
  if ([...pipelines.values()].every(p => p.status !== "running")) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function tickAllPipelines() {
  for (const p of pipelines.values()) {
    if (p.status === "running") tickPipeline(p);
  }
  maybeStopPollLoop();
}

function tickPipeline(pipeline) {
  const activeStage = pipeline.stages.find(s => s.status === "running");

  if (activeStage) {
    const worker = activeStage.workerId ? workers.get(activeStage.workerId) : null;
    if (!worker) return;

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
      // Merge the worker's branch into the repo so the next stage starts clean
      try {
        sh(
          `git merge --no-ff "${worker.branch}" -m "pipeline(${pipeline.id}): merge ${activeStage.id}"`,
          pipeline.repoPath
        );
        sh(`git worktree remove --force "${worker.worktreePath}"`, pipeline.repoPath);
        sh(`git branch -d "${worker.branch}"`, pipeline.repoPath);
      } catch (mergeErr) {
        // Merge conflict — pause and let user know
        activeStage.status = "merge-failed";
        activeStage.mergeError = mergeErr.message;
        activeStage.endTime = now();
        pipeline.status = "merge-failed";
        pipeline.endTime = now();
        saveState();
        return;
      }
      activeStage.status = "done";
      activeStage.endTime = now();
      saveState();
      advancePipeline(pipeline);
    } else if (worker.status === "failed" || worker.status === "terminated") {
      activeStage.status = "failed";
      activeStage.endTime = now();
      pipeline.status = "failed";
      pipeline.endTime = now();
      saveState();
    }
    return;
  }

  // No stage currently running — try to advance
  advancePipeline(pipeline);
}

function advancePipeline(pipeline) {
  const nextStage = pipeline.stages.find(s => s.status === "pending");

  if (!nextStage) {
    pipeline.status = "done";
    pipeline.endTime = now();
    saveState();
    return;
  }

  const prompt = stagePrompt(nextStage.id, pipeline.repoPath);
  const result = spawnWorker({
    name: nextStage.id,
    task: prompt,
    agent: pipeline.agent,
    repoPath: pipeline.repoPath,
  });

  if (result.error) {
    nextStage.status = "failed";
    nextStage.error = result.error;
    nextStage.endTime = now();
    pipeline.status = "failed";
    pipeline.endTime = now();
    saveState();
    return;
  }

  nextStage.status = "running";
  nextStage.workerId = result.workerId;
  nextStage.startTime = now();
  saveState();
}

/** On MCP server restart, resume polling for any pipelines that were mid-flight. */
function resumePipelines() {
  let hasRunning = false;
  for (const p of pipelines.values()) {
    if (p.status !== "running") continue;
    hasRunning = true;
    // Tick immediately — a stage's worker may have completed while we were down
    tickPipeline(p);
  }
  if (hasRunning) startPollLoop();
}

resumePipelines();

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
        "Start an AFK harness pipeline. Stages run sequentially and autonomously: each stage",
        "spawns a worker agent that executes the corresponding harness skill (reading SKILL.md),",
        "commits its work, and the pipeline auto-merges before starting the next stage.",
        "",
        "Returns immediately with a pipeline_id. Use get_pipeline_status to monitor.",
        "Default stage sequence: implement → qa → update-docs.",
        "The pipeline reads .harness/ for context — run /dev-plan first if it hasn't been done.",
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
            description: "Brief description of the goal, added as context for each stage agent.",
          },
          stages: {
            type: "array",
            items: { type: "string", enum: ALL_STAGES },
            description: `Harness stages to run in order. Defaults to ["implement","qa","update-docs"]. Options: ${ALL_STAGES.join(", ")}.`,
          },
          agent: {
            type: "string",
            enum: ["claude", "codex"],
            description: "Agent to use for every stage. Default: 'claude'.",
          },
        },
        required: ["repo_path"],
      },
    },
    {
      name: "get_pipeline_status",
      description: "Get the full status of a pipeline: current stage, per-stage results, and worker IDs for log access.",
      inputSchema: {
        type: "object",
        properties: {
          pipeline_id: { type: "string" },
        },
        required: ["pipeline_id"],
      },
    },
    {
      name: "list_pipelines",
      description: "List all pipelines (running, done, failed, cancelled).",
      inputSchema: { type: "object", properties: {} },
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
      agent = "claude",
    } = args;

    const badStages = stages.filter(s => !ALL_STAGES.includes(s));
    if (badStages.length) {
      return err(`Unknown stages: ${badStages.join(", ")}. Valid: ${ALL_STAGES.join(", ")}`);
    }
    if (!existsSync(repo_path)) {
      return err(`repo_path not found: ${repo_path}`);
    }

    // Ensure the .harness/pipeline/ status dir exists in the project
    try { mkdirSync(join(repo_path, ".harness", "pipeline"), { recursive: true }); } catch {}

    const pipelineId = genId();
    const pipeline = {
      id: pipelineId,
      description,
      repoPath: repo_path,
      agent,
      status: "running",
      stages: stages.map(id => ({
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
    pipelines.set(pipelineId, pipeline);
    saveState();

    advancePipeline(pipeline);
    startPollLoop();

    const first = pipeline.stages[0];
    return ok({
      pipeline_id: pipelineId,
      status: "running",
      stages,
      current_stage: first.id,
      first_worker_id: first.workerId,
      agent,
      tip: `Poll get_pipeline_status("${pipelineId}") to check progress. Each stage runs a full harness skill autonomously and merges before the next begins.`,
    });
  }

  // ── get_pipeline_status ────────────────────────────────────────────────────
  if (name === "get_pipeline_status") {
    const p = pipelines.get(args.pipeline_id);
    if (!p) return err(`No pipeline: ${args.pipeline_id}`);

    // Force a fresh tick so the status is always up to date
    if (p.status === "running") tickPipeline(p);

    const activeStage = p.stages.find(s => s.status === "running");
    const stageDetails = p.stages.map(s => {
      const w = s.workerId ? workers.get(s.workerId) : null;
      return {
        id: s.id,
        status: s.status,
        worker_id: s.workerId,
        worker_status: w?.status ?? null,
        branch: w?.branch ?? null,
        start_time: s.startTime,
        end_time: s.endTime,
        error: s.error ?? null,
      };
    });

    return ok({
      pipeline_id: p.id,
      status: p.status,
      description: p.description || null,
      repo_path: p.repoPath,
      agent: p.agent,
      current_stage: activeStage?.id ?? (p.status === "done" ? "complete" : null),
      stages: stageDetails,
      start_time: p.startTime,
      end_time: p.endTime,
    });
  }

  // ── list_pipelines ─────────────────────────────────────────────────────────
  if (name === "list_pipelines") {
    if (!pipelines.size) return ok("No pipelines registered.");
    return ok(
      [...pipelines.values()].map(p => ({
        id: p.id,
        status: p.status,
        description: p.description || null,
        stages: p.stages.map(s => `${s.id}:${s.status}`).join(" → "),
        start_time: p.startTime,
        end_time: p.endTime ?? "-",
      }))
    );
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

    p.status = "cancelled";
    p.endTime = now();
    saveState();
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
      worktree_path: w.worktreePath, repo_path: w.repoPath,
      pid: w.pid, exit_code: w.exitCode,
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
    try { sh(`git worktree remove --force "${w.worktreePath}"`, w.repoPath); } catch {}
    workers.delete(w.id);
    saveState();
    return ok(
      `Worker ${w.id} (${w.name}) cleaned up.\n` +
      `Branch '${w.branch}' still exists — merge or delete when ready:\n` +
      `  git merge ${w.branch}\n` +
      `  git branch -d ${w.branch}`
    );
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

const transport = new StdioServerTransport();
await server.connect(transport);
