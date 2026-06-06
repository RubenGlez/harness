const state = {
  snapshot: null,
  autoRefreshTimer: null,
};

const elements = {
  repoFilter: document.getElementById("repoFilter"),
  refreshButton: document.getElementById("refreshButton"),
  clearButton: document.getElementById("clearButton"),
  stats: document.getElementById("stats"),
  health: document.getElementById("health"),
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

function formatMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "n/a";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
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
      <strong>No executions yet</strong>
      <div class="muted">
        The dashboard is connected and waiting for data from the orchestrator.
        When you launch a long-running task, this area will show batches, pipelines, workers, logs, and blockers.
      </div>
      <div class="empty-actions">
        <span class="chip"><code>run_batch</code></span>
        <span class="chip"><code>run_pipeline</code></span>
        <span class="chip"><code>spawn_worker</code></span>
        <span class="chip"><code>get_pipeline_status</code></span>
        <span class="chip"><code>cancel_pipeline</code></span>
        <span class="chip"><code>terminate_worker</code></span>
      </div>
    </article>
  `;
}

function renderStats(snapshot) {
  const telemetry = snapshot.telemetry || {};
  const lastEvent = telemetry.last_event
    ? `${telemetry.last_event.type} · ${formatTime(telemetry.last_event.at)}`
    : "n/a";
  const stats = [
    ["Batches", snapshot.totals.batches],
    ["Archived Batches", snapshot.totals.archivedBatches],
    ["Pipelines", snapshot.totals.pipelines],
    ["Archived Pipelines", snapshot.totals.archivedPipelines],
    ["Running", snapshot.totals.running],
    ["Blocked", snapshot.totals.blocked],
    ["Failed", snapshot.totals.failed],
    ["Workers", snapshot.totals.workers],
    ["Archived Workers", snapshot.totals.archivedWorkers],
    ["Live", snapshot.totals.liveWorkers],
    ["Pipeline Runs", telemetry.pipeline_finished ?? 0],
    ["Success %", `${telemetry.pipeline_success_rate ?? 0}%`],
    ["Avg Pipeline", formatMs(telemetry.avg_pipeline_duration_ms ?? 0)],
    ["Avg Batch", formatMs(telemetry.avg_batch_duration_ms ?? 0)],
    ["Archived Total", telemetry.archived ?? 0],
    ["Purged Total", telemetry.purged ?? 0],
    ["Last Event", lastEvent],
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

function renderHealth(snapshot) {
  const health = snapshot.health || { level: "good", signals: [] };
  if (!health.signals.length) {
    elements.health.innerHTML = "";
    return;
  }

  const titleByLevel = {
    good: "Healthy",
    warning: "Needs attention",
    danger: "At risk",
  };

  const summaryByLevel = {
    good: "No soft alerts were triggered from the current snapshot.",
    warning: "There are soft signals that deserve a look.",
    danger: "The current snapshot shows meaningful instability.",
  };

  const recentHistory = (health.recent_history || []).length
    ? `
      <div class="health-history">
        <div class="health-section-title">Recent history</div>
        <div class="health-history-list">
          ${(health.recent_history || [])
            .map(
              (item) => `
                <div class="health-history-item ${escapeHtml(item.level || "good")}">
                  <div class="health-history-top">
                    <span class="badge ${escapeHtml(item.level || "good")}">${escapeHtml(item.level || "good")}</span>
                    <span class="muted">${escapeHtml(formatTime(item.at))}</span>
                  </div>
                  <div class="health-history-body">
                    <strong>${escapeHtml(item.title || item.type || "event")}</strong>
                    <span>${escapeHtml(item.repoPath || item.scope || "global")}${item.status ? ` · ${escapeHtml(item.status)}` : ""}</span>
                  </div>
                  ${item.detail ? `<div class="muted">${escapeHtml(item.detail)}</div>` : ""}
                </div>
              `
            )
            .join("")}
        </div>
      </div>
    `
    : "";

  const repoSummary = (health.repo_summary || []).length
    ? `
      <div class="health-history">
        <div class="health-section-title">Repo summary</div>
        <div class="health-summary-grid">
          ${(health.repo_summary || [])
            .map(
              (item) => `
                <div class="health-summary-item">
                  <div class="health-summary-top">
                    <strong>${escapeHtml(item.repoPath || item.scope || "global")}</strong>
                    <span class="muted">${escapeHtml(item.total)} events</span>
                  </div>
                  <div class="health-summary-metrics">
                    <span class="chip"><code>good</code> ${escapeHtml(item.good)}</span>
                    <span class="chip"><code>warning</code> ${escapeHtml(item.warning)}</span>
                    <span class="chip"><code>danger</code> ${escapeHtml(item.danger)}</span>
                  </div>
                  ${item.lastTitle ? `<div class="muted">Last: ${escapeHtml(item.lastTitle)}</div>` : ""}
                </div>
              `
            )
            .join("")}
        </div>
      </div>
    `
    : "";

  elements.health.innerHTML = `
    <article class="health-panel">
      <div class="health-head">
        <div class="health-title">
          <strong>${escapeHtml(titleByLevel[health.level] || "Healthy")}</strong>
          <span class="badge ${escapeHtml(health.level || "good")}">${escapeHtml(health.level || "good")}</span>
        </div>
        <div class="health-summary">${escapeHtml(summaryByLevel[health.level] || summaryByLevel.good)}</div>
      </div>
      <div class="health-list">
        ${health.signals
          .map(
            (signal) => `
              <div class="health-item ${escapeHtml(signal.level || "good")}">
                <div class="health-label">
                  <span>${escapeHtml(signal.level || "good")}</span>
                  <span>${escapeHtml(signal.title)}</span>
                </div>
                <div class="health-body">${escapeHtml(signal.detail)}</div>
              </div>
            `
          )
          .join("")}
      </div>
      ${recentHistory}
      ${repoSummary}
    </article>
  `;
}

function renderBatches(snapshot) {
  elements.batchCount.textContent = `${snapshot.batches.length} visible`;
  if (!snapshot.batches.length) {
    elements.batches.innerHTML = `
      <article class="card empty-card">
        <h3>No batches visible</h3>
        <p>
          ${snapshot.repoFilter ? "This filter does not return any batches." : "Batches will appear when you launch a multi-repo job."}
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
            <span class="${badgeClass(batch.status)}">${escapeHtml(batch.archived ? "archived" : batch.status)}</span>
          </div>
          <div class="meta">
            <div><span class="inline-code">${escapeHtml(batch.id)}</span></div>
            <div>Mode: <code>${escapeHtml(batch.mode)}</code></div>
            <div>Repos: ${escapeHtml(batch.repoCount)}</div>
            <div>Started: ${escapeHtml(formatTime(batch.startTime))}</div>
            <div>Duration: ${escapeHtml(formatDuration(batch.startTime, batch.endTime))}</div>
          </div>
          ${
            batch.archived
              ? `<div class="muted">Archived: ${escapeHtml(formatTime(batch.archivedAt))} · ${escapeHtml(batch.archivedReason || "n/a")}</div>`
              : ""
          }
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
        <h3>No pipelines visible</h3>
        <p>
          ${snapshot.repoFilter ? "This filter does not return any results." : "You have not launched any long-running execution yet."}
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
      const recoveryNote = pipeline.recovery?.note
        ? `<div class="muted">Recovery: ${escapeHtml(pipeline.recovery.note)}</div>`
        : "";
      const repoCaps = pipeline.repoCapabilities
        ? `
          <div class="muted">
            Repo: ${escapeHtml(pipeline.repoCapabilities.gitRoot || pipeline.repoPath)} ·
            Branch: ${escapeHtml(pipeline.repoCapabilities.gitBranch || "n/a")} ·
            Remote: ${escapeHtml(pipeline.repoCapabilities.gitRemote || "n/a")}
          </div>
        `
        : "";
      const primaryWorker = runningStage || blockedStage || [...pipeline.stages].reverse().find((stage) => stage.workerId);
      const openWorktree = primaryWorker?.workerWorktreePath
        ? `<button type="button" data-open-path="${escapeHtml(primaryWorker.workerWorktreePath)}">Open worktree</button>`
        : "";
      const cancelButton =
        pipeline.status === "running"
          ? `<button type="button" class="danger" data-action="cancel_pipeline" data-target-id="${escapeHtml(pipeline.id)}">Cancel pipeline</button>`
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
                <span class="${badgeClass(pipeline.status)}">${escapeHtml(pipeline.archived ? "archived" : pipeline.status)}</span>
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
          ${recoveryNote}
          ${repoCaps}
          ${
            pipeline.archived
              ? `<div class="muted">Archived: ${escapeHtml(formatTime(pipeline.archivedAt))} · ${escapeHtml(pipeline.archivedReason || "n/a")}</div>`
              : ""
          }

          <div class="chip-row">${stageBadges}</div>
          ${changedFilesMarkup}
          ${logTail}

          <div class="row-actions">
            <button type="button" data-open-path="${escapeHtml(pipeline.repoPath)}">Open repo</button>
            ${cancelButton}
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
        <h3>No workers visible</h3>
        <p>
          ${snapshot.repoFilter ? "This filter does not return any workers." : "Workers will appear when you start a pipeline or an isolated job."}
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
            <span class="${badgeClass(worker.status)}">${escapeHtml(worker.archived ? "archived" : worker.status)}</span>
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
          ${
            worker.archived
              ? `<div class="muted">Archived: ${escapeHtml(formatTime(worker.archivedAt))} · ${escapeHtml(worker.archivedReason || "n/a")}</div>`
              : ""
          }
          ${
            worker.recoveryReason
              ? `<div class="muted">Recovery: ${escapeHtml(worker.recoveryReason)}</div>`
              : ""
          }
          <div class="log">${escapeHtml(worker.logTail || "(no output yet)")}</div>
          <div class="row-actions">
            <button type="button" data-open-path="${escapeHtml(worker.repoPath)}">Open repo</button>
            ${
              worker.status === "running"
                ? `<button type="button" class="danger" data-action="terminate_worker" data-target-id="${escapeHtml(worker.id)}">Terminate</button>`
                : ""
            }
            ${
              worker.worktreePath
                ? `<button type="button" data-open-path="${escapeHtml(worker.worktreePath)}">Open worktree</button>${
                    worker.status !== "running"
                      ? `<button type="button" class="secondary" data-action="cleanup_worker" data-target-id="${escapeHtml(worker.id)}">Cleanup worktree</button>`
                      : ""
                  }`
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

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.getAttribute("data-action");
      const targetId = button.getAttribute("data-target-id");
      if (!action || !targetId) return;
      const label = action === "cancel_pipeline"
        ? "Cancelar pipeline"
        : action === "terminate_worker"
          ? "Terminar worker"
          : "Limpiar worktree";
      if (!window.confirm(`${label}?`)) return;
      await fetchJson("/api/action", {
        method: "POST",
        body: JSON.stringify({ action, target_id: targetId }),
      }).catch((error) => {
        alert(error.message);
      });
      await refresh().catch((error) => console.error(error));
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
  renderHealth(snapshot);
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
