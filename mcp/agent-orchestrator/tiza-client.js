import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DEFAULT_TIZA_COMMAND = process.env.HARNESS_TIZA_COMMAND || "npx";
const DEFAULT_TIZA_ARGS = parseTizaArgs(process.env.HARNESS_TIZA_ARGS_JSON) || ["-y", "@tiza/mcp"];
const DEFAULT_TIZA_STATE_DIR = process.env.HARNESS_TIZA_STATE_DIR || null;
const REQUIRED_TOOLS = new Set([
  "tiza_open_run",
  "tiza_set_active_run",
  "tiza_write",
  "tiza_read",
  "tiza_get_run",
  "tiza_get_stage_context",
  "tiza_prompt",
  "tiza_done",
]);

function parseTizaArgs(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {}
  return null;
}

function firstText(result) {
  if (!result) return "";
  if (typeof result.text === "string" && result.text) return result.text;
  if (Array.isArray(result.content)) {
    const item = result.content.find((entry) => typeof entry?.text === "string" && entry.text);
    if (item?.text) return item.text;
  }
  return "";
}

function parseMaybeJson(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function previewText(value, limit = 1200) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1)}…`;
}

function normalizeCallResult(result) {
  const text = firstText(result);
  return {
    raw: result ?? null,
    text,
    json: parseMaybeJson(text),
    isError: result?.isError === true,
  };
}

export class TizaBridge {
  constructor({
    command = DEFAULT_TIZA_COMMAND,
    args = DEFAULT_TIZA_ARGS,
    stateDir = DEFAULT_TIZA_STATE_DIR,
  } = {}) {
    this.command = command;
    this.args = Array.isArray(args) ? [...args] : [...DEFAULT_TIZA_ARGS];
    this.stateDir = stateDir || null;
    this.client = null;
    this.transport = null;
    this.readyPromise = null;
    this.available = false;
    this.toolNames = new Set();
    this.error = null;
  }

  async ensureReady() {
    if (this.available && this.client) return this;
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = (async () => {
      try {
        this.transport = new StdioClientTransport({
          command: this.command,
          args: this.args,
          env: {
            ...(this.stateDir ? { TIZA_STATE_DIR: this.stateDir } : {}),
          },
          stderr: "pipe",
        });
        this.client = new Client({
          name: "harness-orchestrator",
          version: "2.0.0",
        });
        const stderr = this.transport.stderr;
        if (stderr && typeof stderr.on === "function") {
          stderr.on("data", (chunk) => {
            const text = chunk.toString("utf8").trim();
            if (text) process.stderr.write(`[tiza] ${text}\n`);
          });
        }
        await this.client.connect(this.transport);
        const tools = await this.client.listTools();
        this.toolNames = new Set(Array.isArray(tools?.tools) ? tools.tools.map((tool) => tool.name) : []);
        for (const tool of REQUIRED_TOOLS) {
          if (!this.toolNames.has(tool)) {
            throw new Error(`Tiza tool missing: ${tool}`);
          }
        }
        this.available = true;
        this.error = null;
        return this;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        await this.close().catch(() => {});
        return null;
      } finally {
        this.readyPromise = null;
      }
    })();

    return this.readyPromise;
  }

  async close() {
    this.available = false;
    this.toolNames.clear();
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    if (client) {
      try {
        await client.close();
      } catch {}
    } else if (transport) {
      try {
        await transport.close();
      } catch {}
    }
  }

  async call(name, args = {}) {
    const ready = await this.ensureReady();
    if (!ready || !this.client) {
      throw new Error(this.error || "Tiza MCP is unavailable");
    }
    const result = await this.client.callTool({ name, arguments: args });
    if (result?.isError) {
      throw new Error(firstText(result) || `Tiza tool failed: ${name}`);
    }
    return normalizeCallResult(result);
  }

  async openRun({ runId, task, agents, repoPath, batchId = null, reset = false, activate = true }) {
    return this.call("tiza_open_run", {
      run_id: runId,
      task,
      agents,
      repo_path: repoPath,
      batch_id: batchId || undefined,
      reset,
      activate,
    });
  }

  async setActiveRun(runId) {
    return this.call("tiza_set_active_run", { run_id: runId });
  }

  async write({ runId, agent, type, payload }) {
    return this.call("tiza_write", {
      run_id: runId,
      agent,
      type,
      payload,
    });
  }

  async read({ runId = null, type = null, agent = null, severity = null } = {}) {
    return this.call("tiza_read", {
      run_id: runId || undefined,
      type: type || undefined,
      agent: agent || undefined,
      severity: severity || undefined,
    });
  }

  async getRun(runId = null) {
    return this.call("tiza_get_run", {
      run_id: runId || undefined,
    });
  }

  async getStageContext({ stage, runId = null }) {
    return this.call("tiza_get_stage_context", {
      stage,
      run_id: runId || undefined,
    });
  }

  async prompt(runId = null) {
    return this.call("tiza_prompt", {
      run_id: runId || undefined,
    });
  }

  async done({ runId = null, agent }) {
    return this.call("tiza_done", {
      run_id: runId || undefined,
      agent,
    });
  }

  snapshotPreview(text, limit) {
    return previewText(text, limit);
  }
}

export function createTizaBridge(options = {}) {
  return new TizaBridge(options);
}

