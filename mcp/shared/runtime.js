import { readFileSync } from "node:fs";

export function now() {
  return new Date().toISOString();
}

export function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readReadySignal(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Dashboard did not start in time"));
    }, timeoutMs);

    let buf = "";
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      clearTimeout(timer);
      try {
        const { url } = JSON.parse(buf.slice(0, nl));
        if (!url) throw new Error("missing url");
        child.unref();
        resolve(url);
      } catch {
        reject(new Error(`Dashboard ready signal malformed: ${buf.slice(0, nl)}`));
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== null) {
        reject(new Error(`Dashboard exited with code ${code}`));
      }
    });
  });
}
