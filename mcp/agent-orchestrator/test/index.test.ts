import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const homeDir = await mkdtemp(join(tmpdir(), "harness-orchestrator-test-"));
process.env.HOME = homeDir;
process.env.HARNESS_TEST_MODE = "1";

const moduleUrl = new URL("../index.ts", import.meta.url);
const orch = await import(`${moduleUrl.href}?t=${Date.now()}`);
const core = orch.__test as typeof import("../index.ts")["__test"];

const stateDir = join(homeDir, ".claude", "orchestrator");
const stateFile = join(stateDir, "state.json");

async function resetStateTree(): Promise<void> {
  core.workers.clear();
  core.pipelines.clear();
  core.batches.clear();
  const freshTelemetry = core.createTelemetry();
  for (const key of Object.keys(core.telemetry)) {
    delete (core.telemetry as Record<string, unknown>)[key];
  }
  Object.assign(core.telemetry, freshTelemetry);
  await rm(stateDir, { recursive: true, force: true });
  await mkdir(join(stateDir, "logs"), { recursive: true });
  await mkdir(join(stateDir, "locks"), { recursive: true });
  await mkdir(join(stateDir, "worktrees"), { recursive: true });
}

beforeEach(resetStateTree);

after(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

test("saveState/loadState round trips workers, pipelines, and batches", async () => {
  const worker = {
    id: "worker-1",
    name: "implement",
    agent: "claude",
    task: "test task",
    branch: null,
    worktreePath: null,
    repoPath: "/tmp/repo",
    status: "done" as const,
    pid: 1234,
    logFile: join(stateDir, "logs", "worker-1.log"),
    exitCode: 0,
    startTime: "2026-01-01T00:00:00.000Z",
    endTime: "2026-01-01T00:01:00.000Z",
  };
  const pipeline = {
    id: "pipeline-1",
    description: "round trip",
    repoPath: "/tmp/repo",
    agent: "claude",
    repoCapabilities: { gitRoot: "/tmp/repo", gitBranch: "main", gitRemote: null },
    recovery: null,
    mode: "single_repo",
    batchId: null,
    status: "done" as const,
    stages: [],
    startTime: "2026-01-01T00:00:00.000Z",
    endTime: "2026-01-01T00:01:00.000Z",
  };
  const batch = {
    id: "batch-1",
    name: "batch",
    description: "round trip",
    status: "done",
    startTime: "2026-01-01T00:00:00.000Z",
    endTime: "2026-01-01T00:01:00.000Z",
    pipelines: [{ pipelineId: pipeline.id, repoPath: pipeline.repoPath, status: "done", currentStage: null }],
  };

  core.workers.set(worker.id, worker);
  core.pipelines.set(pipeline.id, pipeline);
  core.batches.set(batch.id, batch);
  core.saveState();

  core.workers.clear();
  core.pipelines.clear();
  core.batches.clear();
  core.loadState();

  assert.equal(core.workers.get(worker.id)?.name, worker.name);
  assert.equal(core.pipelines.get(pipeline.id)?.description, pipeline.description);
  assert.equal(core.batches.get(batch.id)?.name, batch.name);

  const saved = JSON.parse(await readFile(stateFile, "utf8")) as Record<string, unknown[]>;
  assert.equal(saved.workerList.length, 1);
  assert.equal(saved.pipelineList.length, 1);
  assert.equal(saved.batchList.length, 1);
});

test("acquireRepoLock rejects concurrent pipelines for the same repo", () => {
  const repoPath = join(homeDir, "repo-a");

  core.acquireRepoLock(repoPath, "pipeline-a");
  assert.throws(
    () => core.acquireRepoLock(repoPath, "pipeline-b"),
    /Another AFK pipeline is already running/
  );
  core.releaseRepoLock(repoPath);
});

test("loadState marks dead running workers as failed", async () => {
  const worker = {
    id: "worker-dead",
    name: "qa",
    agent: "codex",
    task: "test task",
    branch: null,
    worktreePath: null,
    repoPath: "/tmp/repo",
    status: "running",
    pid: 999999,
    logFile: join(stateDir, "logs", "worker-dead.log"),
    exitCode: null,
    startTime: "2026-01-01T00:00:00.000Z",
    endTime: null,
  };

  await writeFile(
    stateFile,
    JSON.stringify({ workerList: [worker], pipelineList: [], batchList: [] }, null, 2)
  );

  core.workers.clear();
  core.pipelines.clear();
  core.batches.clear();
  core.loadState();

  const loaded = core.workers.get(worker.id);
  assert.equal(loaded?.status, "failed");
  assert.ok(loaded?.endTime);
});

test("tickPipeline recovers a missing worker from result.json", async () => {
  const repoPath = join(homeDir, "repo-b");
  await mkdir(join(repoPath, ".harness", "pipeline"), { recursive: true });

  const resultFile = join(repoPath, ".harness", "pipeline", "implement-result.json");
  await writeFile(
    resultFile,
    JSON.stringify(
      {
        stage: "implement",
        status: "blocked",
        summary: "needs human input",
        completed: [],
        blocked: [{ item: "release", reason: "missing approval" }],
        files_changed: [],
        recommendations: "wait",
      },
      null,
      2
    )
  );

  const pipeline = {
    id: "pipeline-recover",
    description: "recover blocked stage",
    repoPath,
    agent: "claude",
    repoCapabilities: null,
    recovery: null,
    mode: "single_repo",
    batchId: null,
    status: "running" as const,
    stages: [
      {
        id: "implement",
        status: "running" as const,
        workerId: "missing-worker",
        startTime: "2026-01-01T00:00:00.000Z",
        endTime: null,
        error: null,
      },
    ],
    startTime: "2026-01-01T00:00:00.000Z",
    endTime: null,
  };

  core.pipelines.set(pipeline.id, pipeline);
  await core.tickPipeline(pipeline);

  assert.equal(pipeline.status, "blocked");
  assert.equal(pipeline.stages[0].status, "blocked");
  assert.equal((pipeline.stages[0] as Record<string, unknown>).result && ((pipeline.stages[0] as Record<string, unknown>).result as Record<string, unknown>).summary, "needs human input");
  assert.match((pipeline as unknown as Record<string, unknown>).recovery && ((pipeline as unknown as Record<string, unknown>).recovery as Record<string, unknown>).note as string || "", /Recovered stage/);
  assert.ok(existsSync(stateFile));
});

test("telemetry persists aggregated counters", async () => {
  core.recordTelemetry("pipelines", "started", {
    type: "pipeline_started",
    id: "pipeline-telemetry",
    note: "/tmp/repo",
  });
  core.recordTelemetry("pipelines", "done", {
    type: "pipeline_finished",
    id: "pipeline-telemetry",
    durationMs: 5000,
    note: "/tmp/repo",
  });
  core.recordTelemetry("manual", "cancels", {
    type: "manual_cancel_pipeline",
    id: "pipeline-telemetry",
    note: "/tmp/repo",
  });
  core.saveState();

  const saved = JSON.parse(await readFile(stateFile, "utf8")) as {
    telemetry: {
      pipelines: { started: number; done: number; finished: number; durationMsTotal: number };
      manual: { cancels: number };
      lastEvent: { type: string };
    };
  };
  assert.equal(saved.telemetry.pipelines.started, 1);
  assert.equal(saved.telemetry.pipelines.done, 1);
  assert.equal(saved.telemetry.pipelines.finished, 1);
  assert.equal(saved.telemetry.pipelines.durationMsTotal, 5000);
  assert.equal(saved.telemetry.manual.cancels, 1);
  assert.equal(saved.telemetry.lastEvent.type, "manual_cancel_pipeline");
});

test("health history persists and stays bounded", async () => {
  for (let index = 0; index < 30; index += 1) {
    core.recordHealthEvent({
      scope: "pipeline",
      id: `pipeline-${index}`,
      repoPath: `/tmp/repo-${index % 3}`,
      level: index % 5 === 0 ? "danger" : index % 2 === 0 ? "warning" : "good",
      type: "pipeline_health",
      status: index % 5 === 0 ? "failed" : "done",
      title: `Pipeline ${index}`,
      detail: `Event ${index}`,
    });
  }
  core.saveState();

  const saved = JSON.parse(await readFile(stateFile, "utf8")) as {
    telemetry: { health: { recent: Array<{ id: string }> } };
  };
  assert.ok(Array.isArray(saved.telemetry.health.recent));
  assert.equal(saved.telemetry.health.recent.length, 24);
  assert.equal(saved.telemetry.health.recent[0].id, "pipeline-6");
  assert.equal(saved.telemetry.health.recent.at(-1)!.id, "pipeline-29");
});
