import { readFileSync } from "node:fs";
import type { ChildProcess } from "node:child_process";

export function now(): string {
  return new Date().toISOString();
}

export function readJson<T = unknown>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function pidAlive(pid: number | null): boolean {
  if (!Number.isInteger(pid) || (pid as number) <= 0) return false;
  try {
    process.kill(pid as number, 0);
    return true;
  } catch {
    return false;
  }
}

export function readReadySignal(child: ChildProcess, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Dashboard did not start in time"));
    }, timeoutMs);

    let buf = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      clearTimeout(timer);
      try {
        const { url } = JSON.parse(buf.slice(0, nl)) as { url?: string };
        if (!url) throw new Error("missing url");
        child.unref();
        resolve(url);
      } catch {
        reject(new Error(`Dashboard ready signal malformed: ${buf.slice(0, nl)}`));
      }
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0 && code !== null) {
        reject(new Error(`Dashboard exited with code ${code}`));
      }
    });
  });
}
