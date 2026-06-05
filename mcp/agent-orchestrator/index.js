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
import { join } from "node:path";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";

// ── Directories ────────────────────────────────────────────────────────────────

const WORKTREES_DIR = join(homedir(), ".claude", "agent-worktrees");
const LOGS_DIR = join(homedir(), ".claude", "agent-logs");
const STATE_FILE = join(homedir(), ".claude", "orchestrator-state.json");

mkdirSync(WORKTREES_DIR, { recursive: true });
mkdirSync(LOGS_DIR, { recursive: true });

// ── State ──────────────────────────────────────────────────────────────────────

const workers = new Map();

function loadState() {
  if (!existsSync(STATE_FILE)) return;
  try {
    for (const w of JSON.parse(readFileSync(STATE_FILE, "utf8"))) {
      // Workers marked running but whose PID is gone are failed
      if (w.status === "running") {
        let alive = false;
        try { process.kill(w.pid, 0); alive = true; } catch {}
        if (!alive) {
          w.status = "failed";
          w.endTime = new Date().toISOString();
        }
      }
      workers.set(w.id, w);
    }
  } catch {}
}

function saveState() {
  writeFileSync(STATE_FILE, JSON.stringify([...workers.values()], null, 2));
}

loadState();

// ── Helpers ────────────────────────────────────────────────────────────────────

function genId() {
  return randomBytes(4).toString("hex");
}

function exec(cmd, cwd) {
  return execSync(cmd, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function autoCommit(worktreePath, workerName) {
  try {
    const status = exec("git status --porcelain", worktreePath);
    if (status) {
      exec("git add -A", worktreePath);
      exec(`git commit -m "agent(${workerName}): auto-commit remaining changes"`, worktreePath);
    }
  } catch {}
}

// ── MCP server ─────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "agent-orchestrator", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ── Tool list ──────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "spawn_worker",
      description:
        "Spawn a Codex or Claude Code agent in an isolated git worktree. " +
        "Returns immediately with a worker_id; use get_worker_status to poll for completion. " +
        "The agent's branch can be merged into the main branch once status is 'done'.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Short slug for this worker (used in branch name, e.g. 'auth', 'tests'). No spaces.",
          },
          task: {
            type: "string",
            description: "Full task description / prompt to send to the agent.",
          },
          agent: {
            type: "string",
            enum: ["codex", "claude"],
            description: "Which agent to use: 'codex' (OpenAI Codex CLI) or 'claude' (Claude Code CLI).",
          },
          repo_path: {
            type: "string",
            description: "Absolute path to the git repository root where the worktree will be created.",
          },
          base_branch: {
            type: "string",
            description:
              "Branch or ref to base the worktree on. Defaults to HEAD of the repo.",
          },
        },
        required: ["name", "task", "agent", "repo_path"],
      },
    },
    {
      name: "get_worker_status",
      description: "Get the current status of a worker: running, done, failed, or terminated.",
      inputSchema: {
        type: "object",
        properties: {
          worker_id: { type: "string", description: "Worker ID returned by spawn_worker." },
        },
        required: ["worker_id"],
      },
    },
    {
      name: "get_worker_log",
      description: "Get captured stdout/stderr output from a worker process.",
      inputSchema: {
        type: "object",
        properties: {
          worker_id: { type: "string" },
          tail: {
            type: "number",
            description: "Return only the last N lines (default: 100, 0 = all).",
          },
        },
        required: ["worker_id"],
      },
    },
    {
      name: "list_workers",
      description: "List all known workers and their current statuses.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "terminate_worker",
      description: "Send SIGTERM to a running worker process.",
      inputSchema: {
        type: "object",
        properties: {
          worker_id: { type: "string" },
        },
        required: ["worker_id"],
      },
    },
    {
      name: "cleanup_worker",
      description:
        "Remove a worker's git worktree from disk after its branch has been merged or discarded. " +
        "The branch itself is kept — delete it manually when no longer needed.",
      inputSchema: {
        type: "object",
        properties: {
          worker_id: { type: "string" },
        },
        required: ["worker_id"],
      },
    },
  ],
}));

// ── Tool handlers ──────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  // ─── spawn_worker ──────────────────────────────────────────────────────────
  if (name === "spawn_worker") {
    const { name: workerName, task, agent, repo_path, base_branch } = args;

    const workerId = genId();
    const branch = `agent/${workerName}-${workerId}`;
    const worktreePath = join(WORKTREES_DIR, workerId);
    const logFile = join(LOGS_DIR, `${workerId}.log`);

    // Create branch + worktree
    try {
      const startPoint = base_branch || "HEAD";
      exec(
        `git worktree add -b "${branch}" "${worktreePath}" ${startPoint}`,
        repo_path
      );
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to create worktree: ${err.message}` }],
        isError: true,
      };
    }

    // Build agent command — append commit instruction to task
    const fullTask =
      `${task}\n\nIMPORTANT: When you have finished all changes, create a git commit ` +
      `with a clear, descriptive commit message summarising what was done.`;

    let cmd, cmdArgs;
    if (agent === "codex") {
      cmd = "codex";
      cmdArgs = ["--full-auto", fullTask];
    } else {
      cmd = "claude";
      cmdArgs = ["-p", fullTask];
    }

    // Spawn agent, capture output to log file
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
      name: workerName,
      agent,
      task,
      branch,
      worktreePath,
      repoPath: repo_path,
      status: "running",
      pid: proc.pid ?? null,
      logFile,
      exitCode: null,
      startTime: new Date().toISOString(),
      endTime: null,
    };
    workers.set(workerId, record);
    saveState();

    proc.on("exit", (code) => {
      logStream.end();
      const w = workers.get(workerId);
      if (!w) return;
      if (code === 0) autoCommit(w.worktreePath, w.name);
      w.status = code === 0 ? "done" : "failed";
      w.exitCode = code ?? null;
      w.endTime = new Date().toISOString();
      saveState();
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify(
          { worker_id: workerId, branch, worktree_path: worktreePath, status: "running" },
          null, 2
        ),
      }],
    };
  }

  // ─── get_worker_status ─────────────────────────────────────────────────────
  if (name === "get_worker_status") {
    const w = workers.get(args.worker_id);
    if (!w) {
      return {
        content: [{ type: "text", text: `No worker found with id: ${args.worker_id}` }],
        isError: true,
      };
    }

    // Re-check liveness if still marked running
    if (w.status === "running") {
      let alive = false;
      try { process.kill(w.pid, 0); alive = true; } catch {}
      if (!alive) {
        w.status = "failed";
        w.endTime = new Date().toISOString();
        saveState();
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          id: w.id,
          name: w.name,
          agent: w.agent,
          status: w.status,
          branch: w.branch,
          worktree_path: w.worktreePath,
          repo_path: w.repoPath,
          pid: w.pid,
          exit_code: w.exitCode,
          start_time: w.startTime,
          end_time: w.endTime,
        }, null, 2),
      }],
    };
  }

  // ─── get_worker_log ────────────────────────────────────────────────────────
  if (name === "get_worker_log") {
    const w = workers.get(args.worker_id);
    if (!w) {
      return {
        content: [{ type: "text", text: `No worker found with id: ${args.worker_id}` }],
        isError: true,
      };
    }
    try {
      const raw = existsSync(w.logFile) ? readFileSync(w.logFile, "utf8") : "";
      const lines = raw.split("\n");
      const tailN = args.tail ?? 100;
      const out = tailN === 0 ? lines : lines.slice(-tailN);
      return { content: [{ type: "text", text: out.join("\n") || "(no output yet)" }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Could not read log: ${err.message}` }],
        isError: true,
      };
    }
  }

  // ─── list_workers ──────────────────────────────────────────────────────────
  if (name === "list_workers") {
    if (workers.size === 0) {
      return { content: [{ type: "text", text: "No workers registered." }] };
    }
    const rows = [...workers.values()].map((w) => ({
      id: w.id,
      name: w.name,
      agent: w.agent,
      status: w.status,
      branch: w.branch,
      start_time: w.startTime,
      end_time: w.endTime ?? "-",
    }));
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }

  // ─── terminate_worker ──────────────────────────────────────────────────────
  if (name === "terminate_worker") {
    const w = workers.get(args.worker_id);
    if (!w) {
      return {
        content: [{ type: "text", text: `No worker found with id: ${args.worker_id}` }],
        isError: true,
      };
    }
    if (w.status !== "running") {
      return {
        content: [{ type: "text", text: `Worker ${w.id} is not running (status: ${w.status}).` }],
      };
    }
    try {
      process.kill(w.pid, "SIGTERM");
      w.status = "terminated";
      w.endTime = new Date().toISOString();
      saveState();
      return { content: [{ type: "text", text: `Worker ${w.id} (${w.name}) terminated.` }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to terminate: ${err.message}` }],
        isError: true,
      };
    }
  }

  // ─── cleanup_worker ────────────────────────────────────────────────────────
  if (name === "cleanup_worker") {
    const w = workers.get(args.worker_id);
    if (!w) {
      return {
        content: [{ type: "text", text: `No worker found with id: ${args.worker_id}` }],
        isError: true,
      };
    }
    if (w.status === "running") {
      return {
        content: [{ type: "text", text: "Worker is still running. Terminate it first." }],
        isError: true,
      };
    }
    try {
      exec(`git worktree remove --force "${w.worktreePath}"`, w.repoPath);
    } catch {}
    workers.delete(w.id);
    saveState();
    return {
      content: [{
        type: "text",
        text:
          `Worker ${w.id} (${w.name}) cleaned up. ` +
          `Branch '${w.branch}' still exists — merge or delete it when ready:\n` +
          `  git merge ${w.branch}\n` +
          `  git branch -d ${w.branch}`,
      }],
    };
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// ── Start ──────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
