const state = {
  snapshot: null,
  autoRefreshTimer: null,
};

const elements = {
  repoFilter: document.getElementById("repoFilter"),
  refreshButton: document.getElementById("refreshButton"),
  clearButton: document.getElementById("clearButton"),
  stats: document.getElementById("stats"),
  blockers: document.getElementById("blockers"),
  batches: document.getElementById("batches"),
  pipelines: document.getElementById("pipelines"),
  workers: document.getElementById("workers"),
  batchCount: document.getElementById("batchCount"),
  pipelineCount: document.getElementById("pipelineCount"),
  workerCount: document.getElementById("workerCount"),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(value) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDuration(startTime, endTime) {
  if (!startTime) return "n/a";
  const start = new Date(startTime).getTime();
  const end = endTime ? new Date(endTime).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return "n/a";
  const diff = Math.max(0, Math.round((end - start) / 1000));
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const seconds = diff % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function badgeClass(status) {
  return `badge ${status || "pending"}`;
}

function renderEmptyGuide(snapshot) {
  if (snapshot.totals.batches || snapshot.totals.pipelines || snapshot.totals.workers) {
    return "";
  }

  return `
    <article class="blocker blocker-empty">
      <strong>No hay ejecuciones todavía</strong>
      <div class="muted">
        El dashboard está conectado y esperando datos del orquestador.
        Cuando lances una tarea larga, aquí verás batches, pipelines, workers, logs y bloqueos.
      </div>
      <div class="empty-actions">
        <span class="chip"><code>run_batch</code></span>
        <span class="chip"><code>run_pipeline</code></span>
        <span class="chip"><code>spawn_worker</code></span>
        <span class="chip"><code>get_pipeline_status</code></span>
      </div>
    </article>
  `;
}

function renderStats(snapshot) {
  const stats = [
    ["Batches", snapshot.totals.batches],
    ["Pipelines", snapshot.totals.pipelines],
    ["Running", snapshot.totals.running],
    ["Blocked", snapshot.totals.blocked],
    ["Failed", snapshot.totals.failed],
    ["Workers", snapshot.totals.workers],
    ["Live", snapshot.totals.liveWorkers],
  ];
  elements.stats.innerHTML = stats
    .map(
      ([label, value]) => `
        <article class="stat">
          <div class="label">${escapeHtml(label)}</div>
          <div class="value">${escapeHtml(value)}</div>
        </article>
      `
    )
    .join("");
}

function renderBatches(snapshot) {
  elements.batchCount.textContent = `${snapshot.batches.length} visible`;
  if (!snapshot.batches.length) {
    elements.batches.innerHTML = `
      <article class="card empty-card">
        <h3>Sin batches visibles</h3>
        <p>
          ${snapshot.repoFilter ? "Este filtro no devuelve batches." : "Los batches aparecerán cuando lances un trabajo multi-repo."}
        </p>
        <div class="empty-actions">
          <span class="chip"><code>run_batch</code></span>
        </div>
      </article>
    `;
    return;
  }

  elements.batches.innerHTML = snapshot.batches
    .map((batch) => {
      const repoChips = batch.pipelines
        .map(
          (item) =>
            `<span class="chip"><code>${escapeHtml(item.repoPath || "n/a")}</code> · ${escapeHtml(item.status)}</span>`
        )
        .join("");

      return `
        <article class="card">
          <div class="title-row">
            <h3>${escapeHtml(batch.name || batch.description || batch.id)}</h3>
            <span class="${badgeClass(batch.status)}">${escapeHtml(batch.status)}</span>
          </div>
          <div class="meta">
            <div><span class="inline-code">${escapeHtml(batch.id)}</span></div>
            <div>Mode: <code>${escapeHtml(batch.mode)}</code></div>
            <div>Repos: ${escapeHtml(batch.repoCount)}</div>
            <div>Started: ${escapeHtml(formatTime(batch.startTime))}</div>
            <div>Duration: ${escapeHtml(formatDuration(batch.startTime, batch.endTime))}</div>
          </div>
          <div class="chip-row">${repoChips}</div>
        </article>
      `;
    })
    .join("");
}

function renderBlockers(snapshot) {
  if (!snapshot.recentBlocked.length) {
    elements.blockers.innerHTML = renderEmptyGuide(snapshot);
    return;
  }

  elements.blockers.innerHTML = snapshot.recentBlocked
    .map(
      (item) => `
        <article class="blocker">
          <strong>Blocked pipeline ${escapeHtml(item.pipelineId)}</strong>
          <div class="muted">${escapeHtml(item.repoPath)}</div>
          <div>${escapeHtml(item.stageId || "unknown stage")} · ${escapeHtml(item.reason)}</div>
        </article>
      `
    )
    .join("");
}

function renderPipelines(snapshot) {
  elements.pipelineCount.textContent = `${snapshot.pipelines.length} visible`;
  if (!snapshot.pipelines.length) {
    elements.pipelines.innerHTML = `
      <article class="card empty-card">
        <h3>Sin pipelines visibles</h3>
        <p>
          ${snapshot.repoFilter ? "Este filtro no devuelve resultados." : "Todavía no has lanzado ninguna ejecución larga."}
        </p>
        <div class="empty-actions">
          <span class="chip"><code>open_dashboard</code></span>
          <span class="chip"><code>run_pipeline</code></span>
        </div>
      </article>
    `;
    return;
  }

  elements.pipelines.innerHTML = snapshot.pipelines
    .map((pipeline) => {
      const stageBadges = pipeline.stages
        .map(
          (stage) =>
            `<span class="chip"><code>${escapeHtml(stage.id)}</code> · ${escapeHtml(
              stage.status
            )}</span>`
        )
        .join("");

      const changedFiles = pipeline.stages
        .flatMap((stage) => stage.filesChanged || [])
        .slice(0, 6);

      const changedFilesMarkup = changedFiles.length
        ? `
          <div class="chip-row">
            ${changedFiles.map((file) => `<span class="chip"><code>${escapeHtml(file)}</code></span>`).join("")}
          </div>
        `
        : "";

      const runningStage = pipeline.stages.find((stage) => stage.status === "running");
      const blockedStage = pipeline.stages.find((stage) => stage.status === "blocked");
      const summaryStage = blockedStage || runningStage || pipeline.stages[pipeline.stages.length - 1];
      const summary = summaryStage?.blockerSummary || summaryStage?.result?.summary || "Awaiting progress";
      const primaryWorker = runningStage || blockedStage || [...pipeline.stages].reverse().find((stage) => stage.workerId);
      const openWorktree = primaryWorker?.workerWorktreePath
        ? `<button type="button" data-open-path="${escapeHtml(primaryWorker.workerWorktreePath)}">Open worktree</button>`
        : "";
      const logTail = summaryStage?.workerId
        ? `<div class="log">${escapeHtml(summaryStage.result?.summary || summaryStage.blockerSummary || summaryStage.error || "No log summary yet.")}</div>`
        : "";

      return `
        <article class="card">
          <div class="card-head">
            <div>
              <div class="title-row">
                <h3>${escapeHtml(pipeline.description || pipeline.id)}</h3>
                <span class="${badgeClass(pipeline.status)}">${escapeHtml(pipeline.status)}</span>
              </div>
              <div class="meta">
                <div><span class="inline-code">${escapeHtml(pipeline.id)}</span></div>
                <div>${escapeHtml(pipeline.repoPath)}</div>
                <div>Agent: <code>${escapeHtml(pipeline.agent)}</code></div>
              </div>
            </div>
            <div class="meta" style="text-align:right">
              <div>Stage: <code>${escapeHtml(pipeline.currentStage || "complete")}</code></div>
              <div>Started: ${escapeHtml(formatTime(pipeline.startTime))}</div>
              <div>Duration: ${escapeHtml(formatDuration(pipeline.startTime, pipeline.endTime))}</div>
            </div>
          </div>

          <div class="meta">
            <div><strong>Signal</strong>: ${escapeHtml(summary)}</div>
          </div>

          <div class="chip-row">${stageBadges}</div>
          ${changedFilesMarkup}
          ${logTail}

          <div class="row-actions">
            <button type="button" data-open-path="${escapeHtml(pipeline.repoPath)}">Open repo</button>
            ${
              primaryWorker?.workerId
                ? `<button type="button" data-focus-worker="${escapeHtml(primaryWorker.workerId)}">Focus worker</button>`
                : ""
            }
            ${openWorktree}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderWorkers(snapshot) {
  elements.workerCount.textContent = `${snapshot.workers.length} visible`;
  if (!snapshot.workers.length) {
    elements.workers.innerHTML = `
      <article class="card empty-card">
        <h3>Sin workers visibles</h3>
        <p>
          ${snapshot.repoFilter ? "Este filtro no devuelve workers." : "Los workers aparecerán cuando arranques una pipeline o un trabajo aislado."}
        </p>
        <div class="empty-actions">
          <span class="chip"><code>spawn_worker</code></span>
          <span class="chip"><code>get_worker_log</code></span>
        </div>
      </article>
    `;
    return;
  }

  elements.workers.innerHTML = snapshot.workers
    .map(
      (worker) => `
        <article class="card">
          <div class="title-row">
            <h3>${escapeHtml(worker.name)}</h3>
            <span class="${badgeClass(worker.status)}">${escapeHtml(worker.status)}</span>
          </div>
          <div class="meta">
            <div><span class="inline-code">${escapeHtml(worker.id)}</span></div>
            <div>Agent: <code>${escapeHtml(worker.agent)}</code></div>
            <div>Repo: ${escapeHtml(worker.repoPath)}</div>
            <div>Branch: <code>${escapeHtml(worker.branch || "n/a")}</code></div>
            <div>Worktree: ${escapeHtml(worker.worktreePath || "n/a")}</div>
            <div>PID: <code>${escapeHtml(worker.pid ?? "n/a")}</code> · Live: ${worker.live ? "yes" : "no"}</div>
            <div>Started: ${escapeHtml(formatTime(worker.startTime))}</div>
            <div>Duration: ${escapeHtml(formatDuration(worker.startTime, worker.endTime))}</div>
          </div>
          <div class="log">${escapeHtml(worker.logTail || "(no output yet)")}</div>
          <div class="row-actions">
            <button type="button" data-open-path="${escapeHtml(worker.repoPath)}">Open repo</button>
            ${
              worker.worktreePath
                ? `<button type="button" data-open-path="${escapeHtml(worker.worktreePath)}">Open worktree</button>`
                : ""
            }
            <button type="button" data-open-log="${escapeHtml(worker.id)}">Open log</button>
          </div>
        </article>
      `
    )
    .join("");
}

function wireActions() {
  document.querySelectorAll("[data-open-path]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = button.getAttribute("data-open-path");
      if (!target) return;
      await fetchJson("/api/open-path", {
        method: "POST",
        body: JSON.stringify({ path: target }),
      }).catch(() => {});
    });
  });

  document.querySelectorAll("[data-open-log]").forEach((button) => {
    button.addEventListener("click", async () => {
      const workerId = button.getAttribute("data-open-log");
      if (!workerId) return;
      const payload = await fetchJson(`/api/log?worker_id=${encodeURIComponent(workerId)}&tail=200`);
      alert(payload.content || "(no output)");
    });
  });

  document.querySelectorAll("[data-focus-worker]").forEach((button) => {
    button.addEventListener("click", () => {
      const workerId = button.getAttribute("data-focus-worker");
      if (!workerId) return;
      const worker = state.snapshot?.workers.find((item) => item.id === workerId);
      if (!worker) return;
      elements.repoFilter.value = worker.repoPath;
      refresh();
    });
  });
}

async function refresh() {
  const repo = elements.repoFilter.value.trim();
  if (repo) {
    localStorage.setItem("harness.dashboard.repoFilter", repo);
  } else {
    localStorage.removeItem("harness.dashboard.repoFilter");
  }

  const snapshot = await fetchJson(`/api/snapshot?repo=${encodeURIComponent(repo)}`);
  state.snapshot = snapshot;
  renderStats(snapshot);
  renderBatches(snapshot);
  renderBlockers(snapshot);
  renderPipelines(snapshot);
  renderWorkers(snapshot);
  wireActions();
}

function startAutoRefresh() {
  if (state.autoRefreshTimer) {
    clearInterval(state.autoRefreshTimer);
  }
  state.autoRefreshTimer = setInterval(() => {
    refresh().catch((error) => {
      console.error("refresh failed", error);
    });
  }, 5000);
}

elements.repoFilter.value = localStorage.getItem("harness.dashboard.repoFilter") || "";
const initialRepoFromUrl = new URLSearchParams(window.location.search).get("repo");
if (initialRepoFromUrl) {
  elements.repoFilter.value = initialRepoFromUrl;
  localStorage.setItem("harness.dashboard.repoFilter", initialRepoFromUrl);
}
elements.refreshButton.addEventListener("click", () => refresh().catch((error) => console.error(error)));
elements.clearButton.addEventListener("click", () => {
  elements.repoFilter.value = "";
  localStorage.removeItem("harness.dashboard.repoFilter");
  refresh().catch((error) => console.error(error));
});
elements.repoFilter.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    refresh().catch((error) => console.error(error));
  }
});

refresh()
  .then(startAutoRefresh)
  .catch((error) => {
    console.error(error);
    elements.pipelines.innerHTML = `<div class="empty">Failed to load dashboard: ${escapeHtml(error.message)}</div>`;
  });
