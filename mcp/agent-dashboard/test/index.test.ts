import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const dashboardDir = fileURLToPath(new URL("..", import.meta.url));
const dashboardIndex = join(dashboardDir, "index.ts");

async function readReadyLine(proc: ReturnType<typeof spawn>): Promise<{ url: string; pid: number }> {
  return await new Promise((resolve, reject) => {
    let buffer = "";

    const cleanup = (): void => {
      proc.stdout?.off("data", onData);
      proc.off("error", onError);
      proc.off("exit", onExit);
    };

    const onExit = (code: number | null): void => {
      cleanup();
      reject(new Error(`dashboard exited before ready with code ${code}`));
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;

      cleanup();
      resolve(JSON.parse(buffer.slice(0, newlineIndex)));
    };

    proc.stdout?.on("data", onData);
    proc.once("error", onError);
    proc.once("exit", onExit);
  });
}

test("serves the transpiled dashboard bundle and snapshot endpoint", async (t) => {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-dashboard-test-"));
  const proc = spawn(
    process.execPath,
    ["--experimental-strip-types", dashboardIndex, "--serve-ui"],
    {
      cwd: dashboardDir,
      env: {
        ...process.env,
        HOME: homeDir,
        HARNESS_TEST_MODE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  t.after(async () => {
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        resolve();
        return;
      }

      proc.once("exit", () => resolve());
      proc.kill("SIGTERM");
    });
    await rm(homeDir, { recursive: true, force: true });
  });

  const ready = await readReadyLine(proc);
  const appResponse = await fetch(`${ready.url}app.js`);
  assert.equal(appResponse.status, 200);
  const appJs = await appResponse.text();
  assert.match(appJs, /const state = \{/);
  assert.doesNotMatch(appJs, /type AutoRefreshTimer/);
  assert.doesNotMatch(appJs, /as AutoRefreshTimer/);

  const snapshotResponse = await fetch(`${ready.url}api/snapshot`);
  assert.equal(snapshotResponse.status, 200);
  const snapshot = (await snapshotResponse.json()) as { generatedAt?: string; totals?: { batches?: number } };
  assert.equal(typeof snapshot.generatedAt, "string");
  assert.equal(snapshot.totals?.batches, 0);
});
