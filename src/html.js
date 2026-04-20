function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function layout({ title, body, script = "" }) {
  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(title)}</title>
      <style>
        :root {
          --bg: #f4efe7;
          --panel: #fff9f1;
          --text: #1e1b18;
          --muted: #6f655d;
          --accent: #b3472d;
          --accent-2: #205b4f;
          --line: #ddcfbe;
          --warn: #a55620;
          --ok: #1f6b45;
          --bad: #a12a2a;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          background:
            radial-gradient(circle at top left, rgba(179,71,45,0.15), transparent 30%),
            radial-gradient(circle at bottom right, rgba(32,91,79,0.18), transparent 35%),
            var(--bg);
          color: var(--text);
          font-family: Georgia, "Times New Roman", serif;
        }
        .shell { max-width: 1380px; margin: 0 auto; padding: 32px 20px 48px; }
        .hero {
          display: grid;
          grid-template-columns: 1.45fr 0.85fr;
          gap: 18px;
          margin-bottom: 20px;
        }
        .card {
          background: color-mix(in srgb, var(--panel) 92%, white 8%);
          border: 1px solid var(--line);
          border-radius: 20px;
          padding: 18px;
          box-shadow: 0 8px 30px rgba(62, 44, 26, 0.08);
        }
        h1, h2, h3, p { margin-top: 0; }
        h1 { font-size: clamp(2rem, 3vw, 3.4rem); line-height: 0.95; letter-spacing: -0.04em; margin-bottom: 12px; }
        .lede { color: var(--muted); max-width: 64ch; }
        .toolbar, .stats { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .toolbar form { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .pill {
          border-radius: 999px;
          padding: 8px 12px;
          font-size: 0.92rem;
          border: 1px solid var(--line);
          background: rgba(255,255,255,0.7);
        }
        button, .button {
          border: 0;
          border-radius: 999px;
          background: var(--accent);
          color: white;
          padding: 10px 16px;
          font: inherit;
          cursor: pointer;
          text-decoration: none;
        }
        button.secondary, .button.secondary { background: var(--accent-2); }
        button.ghost, .button.ghost {
          background: transparent;
          color: var(--text);
          border: 1px solid var(--line);
        }
        button.warn { background: #7a5b21; }
        button.danger { background: #7c2121; }
        .table-wrap { overflow: auto; }
        table { width: 100%; border-collapse: collapse; min-width: 1180px; }
        th, td { text-align: left; padding: 12px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
        th { color: var(--muted); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.08em; }
        input[type="text"], input[type="number"] {
          width: 100%;
          border: 1px solid var(--line);
          border-radius: 12px;
          background: white;
          padding: 10px 12px;
          font: inherit;
        }
        .status {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 0.88rem;
          border: 1px solid var(--line);
          white-space: nowrap;
        }
        .status.ok { color: var(--ok); }
        .status.warning { color: var(--warn); }
        .status.error { color: var(--bad); }
        .status.neutral { color: var(--text); }
        .meta { color: var(--muted); font-size: 0.92rem; }
        .tabs { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
        .tabs a {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          padding: 9px 14px;
          text-decoration: none;
          color: var(--text);
          border: 1px solid var(--line);
          background: rgba(255,255,255,0.65);
        }
        .tabs a.active { background: var(--accent-2); border-color: var(--accent-2); color: white; }
        .mini { font-size: 0.85rem; color: var(--muted); }
        .cluster { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
        .actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .stack > * + * { margin-top: 12px; }
        @media (max-width: 900px) {
          .hero { grid-template-columns: 1fr; }
        }
      </style>
    </head>
    <body>
      <main class="shell">${body}</main>
      <script>${script}</script>
    </body>
  </html>`;
}

function validationClass(validation) {
  if (validation.level === "ok") {
    return "ok";
  }
  if (validation.level === "warning") {
    return "warning";
  }
  if (validation.level === "error") {
    return "error";
  }
  return "neutral";
}

export function renderDashboardPage({ profiles, config, filters }) {
  const enabledCount = profiles.filter((profile) => profile.enabled).length;
  const activeCount = profiles.filter((profile) => ["starting", "running", "pausing", "stopping"].includes(profile.runtime_status)).length;
  const query = filters.q || "";
  const view = filters.view === "selected" ? "selected" : "all";
  const allHref = query ? `/?view=all&q=${encodeURIComponent(query)}` : "/?view=all";
  const selectedHref = query ? `/?view=selected&q=${encodeURIComponent(query)}` : "/?view=selected";

  const rows = profiles.map((profile) => `
    <tr>
      <td>
        <form method="post" action="/profiles/${encodeURIComponent(profile.profile_id)}/settings" class="stack">
          <input type="checkbox" name="enabled" value="1" ${profile.enabled ? "checked" : ""} />
      </td>
      <td>
          <strong>${escapeHtml(profile.profile_name)}</strong>
          <div class="meta">${escapeHtml(profile.browser_type || "unknown")} ${escapeHtml(profile.browser_version || "")}</div>
          <div class="mini"><a href="/profiles/${encodeURIComponent(profile.profile_id)}">Execution detail</a></div>
      </td>
      <td><code>${escapeHtml(profile.profile_id)}</code></td>
      <td>
          <input type="text" name="folderPath" value="${escapeHtml(profile.folder_path || "")}" placeholder="C:\\data\\profile-01" />
      </td>
      <td>
          <span class="status ${validationClass(profile.validation)}">${escapeHtml(profile.validation.code)}</span>
          <div class="mini">${escapeHtml(profile.validation.message)}</div>
      </td>
      <td style="min-width: 180px">
          ${view === "selected" ? `
            <label class="mini">Field delay min (s)</label>
            <input type="number" min="0" step="0.1" name="fieldDelayMinSeconds" value="${escapeHtml(profile.field_delay_min_seconds)}" />
            <label class="mini">Field delay max (s)</label>
            <input type="number" min="0" step="0.1" name="fieldDelayMaxSeconds" value="${escapeHtml(profile.field_delay_max_seconds)}" />
            <label class="mini">Row interval min (min)</label>
            <input type="number" min="0" step="0.1" name="rowIntervalMinMinutes" value="${escapeHtml(profile.row_interval_min_minutes)}" />
            <label class="mini">Row interval max (min)</label>
            <input type="number" min="0" step="0.1" name="rowIntervalMaxMinutes" value="${escapeHtml(profile.row_interval_max_minutes)}" />
          ` : `
            <div class="mini">Visible in Selected Profiles</div>
          `}
      </td>
      <td>
          <input type="number" min="1" step="1" name="displayOrder" value="${escapeHtml(profile.display_order)}" />
      </td>
      <td>
          <span class="status neutral">${escapeHtml(profile.runtime_status)}</span>
          <div class="mini">Last run: ${escapeHtml(profile.last_run_status || "-")}</div>
          <div class="mini">Current row: ${escapeHtml(profile.current_row_number || "-")}</div>
      </td>
      <td>
          <div class="mini">Started: ${escapeHtml(profile.last_run_started_at || "-")}</div>
          <div class="mini">Ended: ${escapeHtml(profile.last_run_ended_at || "-")}</div>
          <div class="mini">${escapeHtml(profile.last_error_detail || "")}</div>
      </td>
      <td>
          <div class="actions">
            <button type="submit" class="ghost">Save</button>
        </form>
        <form method="post" action="/profiles/${encodeURIComponent(profile.profile_id)}/run">
          <button type="submit">Run</button>
        </form>
        <form method="post" action="/profiles/${encodeURIComponent(profile.profile_id)}/pause">
          <button type="submit" class="warn">Pause</button>
        </form>
        <form method="post" action="/profiles/${encodeURIComponent(profile.profile_id)}/stop">
          <button type="submit" class="danger">Stop</button>
        </form>
          </div>
      </td>
    </tr>
  `).join("");

  const body = `
    <section class="hero">
      <div class="card">
        <h1>Per-Profile GPM Runner</h1>
        <p class="lede">Each profile now owns its own execution lifecycle, Excel progress, GPM browser session, and graceful pause/stop behavior.</p>
        <div class="toolbar">
          <form method="post" action="/sync">
            <button type="submit">Sync GPM</button>
          </form>
          <a class="button secondary" href="/admin/settings">Admin Settings</a>
        </div>
      </div>
      <div class="card">
        <h3>System</h3>
        <div class="stats">
          <span class="pill">Profiles: ${profiles.length}</span>
          <span class="pill">Enabled: ${enabledCount}</span>
          <span class="pill">Active: ${activeCount}</span>
        </div>
        <p class="mini">GPM API: ${escapeHtml(config.gpmApiBaseUrl)}</p>
        <p class="mini">Excel filename: ${escapeHtml(config.excelFilenameStandard)}</p>
      </div>
    </section>

    <section class="card">
      <h2>Profiles Dashboard</h2>
      <div class="tabs">
        <a href="${allHref}" class="${view === "all" ? "active" : ""}">All Profiles</a>
        <a href="${selectedHref}" class="${view === "selected" ? "active" : ""}">Selected Profiles</a>
      </div>
      <form method="get" action="/" class="toolbar" style="margin-bottom: 16px;">
        <input type="hidden" name="view" value="${escapeHtml(view)}" />
        <input style="max-width: 320px" type="text" name="q" value="${escapeHtml(query)}" placeholder="Search by profile name" />
        <button type="submit" class="secondary">Search</button>
        <a class="button ghost" href="${view === "selected" ? "/?view=selected" : "/"}">Clear</a>
      </form>
      <p class="mini">Showing ${profiles.length} profile(s) in the current view.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Use</th>
              <th>Profile</th>
              <th>Profile ID</th>
              <th>Folder Path</th>
              <th>Validation</th>
              <th>Runtime Config</th>
              <th>Order</th>
              <th>Runtime Status</th>
              <th>Last Execution</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="10">No profiles synced yet.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;

  return layout({ title: "Per-Profile GPM Runner", body });
}

export function renderAdminSettingsPage({ settings }) {
  const body = `
    <section class="hero">
      <div class="card">
        <h1>Admin Settings</h1>
        <p class="lede">System-wide settings are stored in SQLite and take precedence over environment defaults on app startup.</p>
        <div class="actions">
          <a class="button secondary" href="/">Back to dashboard</a>
        </div>
      </div>
      <div class="card">
        <h3>Persistence</h3>
        <div class="cluster">
          <div class="pill">Storage: SQLite</div>
          <div class="pill">Priority: DB over env</div>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>System Config</h2>
      <form method="post" action="/admin/settings" class="stack">
        <div>
          <label class="mini">GPM API Base URL</label>
          <input type="text" name="gpmApiBaseUrl" value="${escapeHtml(settings.gpmApiBaseUrl)}" />
        </div>
        <div>
          <label class="mini">Excel filename standard</label>
          <input type="text" name="excelFilenameStandard" value="${escapeHtml(settings.excelFilenameStandard)}" />
        </div>
        <div>
          <label class="mini">Log directory</label>
          <input type="text" name="logDir" value="${escapeHtml(settings.logDir)}" />
        </div>
        <div>
          <label class="mini">Artifacts directory</label>
          <input type="text" name="artifactsDir" value="${escapeHtml(settings.artifactsDir)}" />
        </div>
        <div class="actions">
          <button type="submit">Save Settings</button>
        </div>
      </form>
    </section>
  `;

  return layout({ title: "Admin Settings", body });
}

export function renderProfilePage({ detail, selectedExecution }) {
  if (!detail) {
    return layout({
      title: "Profile Not Found",
      body: `
        <section class="card">
          <h1>Profile not found</h1>
          <a class="button" href="/">Back to dashboard</a>
        </section>
      `
    });
  }

  const selectedExecutionDetail = selectedExecution || detail.activeExecution || null;

  const executionRows = detail.executions.map((execution) => `
    <tr>
      <td><a href="/profiles/${encodeURIComponent(detail.profile.profile_id)}?executionId=${encodeURIComponent(execution.execution_id)}"><code>${escapeHtml(execution.execution_id)}</code></a></td>
      <td>${escapeHtml(execution.status)}</td>
      <td>${escapeHtml(execution.rows_completed)}</td>
      <td>${escapeHtml(execution.rows_failed)}</td>
      <td>${escapeHtml(execution.rows_total)}</td>
      <td>${escapeHtml(execution.started_at)}</td>
      <td>${escapeHtml(execution.ended_at || "-")}</td>
      <td>
        <form method="post" action="/profiles/${encodeURIComponent(detail.profile.profile_id)}/executions/${encodeURIComponent(execution.execution_id)}/delete" onsubmit="return ${execution.status === "running" ? "false" : `confirm('Delete this execution history?')`}">
          <button type="submit" class="danger" ${execution.status === "running" ? "disabled title=\"Stop this execution before deleting history\"" : ""}>Delete</button>
        </form>
        ${execution.status === "running" ? `<div class="mini">In progress</div>` : ``}
      </td>
    </tr>
  `).join("");

  const rowExecutionRows = (selectedExecutionDetail?.rows || []).map((row) => `
    <tr>
      <td>${escapeHtml(row.excel_row_number)}</td>
      <td>${escapeHtml(row.status)}</td>
      <td>${escapeHtml(row.status_detail || "-")}</td>
      <td>${escapeHtml(row.started_at)}</td>
      <td>${escapeHtml(row.ended_at)}</td>
    </tr>
  `).join("");

  const body = `
    <section class="hero">
      <div class="card">
        <h1>${escapeHtml(detail.profile.profile_name)}</h1>
        <p class="lede">Profile-centric execution detail with Excel progress, GPM session lifecycle, and graceful run controls.</p>
        <div class="actions">
          <a class="button secondary" href="/">Back to dashboard</a>
          <form method="post" action="/profiles/${encodeURIComponent(detail.profile.profile_id)}/run">
            <button type="submit">Run</button>
          </form>
          <form method="post" action="/profiles/${encodeURIComponent(detail.profile.profile_id)}/pause">
            <button type="submit" class="warn">Pause</button>
          </form>
          <form method="post" action="/profiles/${encodeURIComponent(detail.profile.profile_id)}/stop">
            <button type="submit" class="danger">Stop</button>
          </form>
        </div>
      </div>
      <div class="card">
        <h3>Runtime State</h3>
        <div class="cluster">
          <div class="pill">Status: ${escapeHtml(detail.profile.runtime_status)}</div>
          <div class="pill">Last run: ${escapeHtml(detail.profile.last_run_status || "-")}</div>
          <div class="pill">Current row: ${escapeHtml(detail.profile.current_row_number || "-")}</div>
          <div class="pill">Field delay: ${escapeHtml(detail.profile.field_delay_min_seconds)}s - ${escapeHtml(detail.profile.field_delay_max_seconds)}s</div>
          <div class="pill">Row interval: ${escapeHtml(detail.profile.row_interval_min_minutes)} - ${escapeHtml(detail.profile.row_interval_max_minutes)} min</div>
        </div>
        <p class="mini">Started: ${escapeHtml(detail.profile.last_run_started_at || "-")}</p>
        <p class="mini">Ended: ${escapeHtml(detail.profile.last_run_ended_at || "-")}</p>
        <p class="mini">${escapeHtml(detail.profile.last_error_detail || "")}</p>
      </div>
    </section>

    <section class="card" style="margin-bottom: 18px;">
      <h2>Execution History</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Execution ID</th>
              <th>Status</th>
              <th>Rows OK</th>
              <th>Rows Failed</th>
              <th>Rows Total</th>
              <th>Started</th>
              <th>Ended</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${executionRows || `<tr><td colspan="8">No executions yet.</td></tr>`}</tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h2>Selected Execution</h2>
      ${selectedExecutionDetail ? `
        <p class="mini">Execution: ${escapeHtml(selectedExecutionDetail.execution_id)}</p>
        <p class="mini">Log: ${escapeHtml(selectedExecutionDetail.log_path || "-")}</p>
        <p class="mini">Session: ${escapeHtml(selectedExecutionDetail.session?.remote_debugging_address || "-")} (${escapeHtml(selectedExecutionDetail.session?.session_status || "n/a")})</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Excel Row</th>
                <th>Status</th>
                <th>Detail</th>
                <th>Started</th>
                <th>Ended</th>
              </tr>
            </thead>
            <tbody>${rowExecutionRows || `<tr><td colspan="5">No row executions stored yet.</td></tr>`}</tbody>
          </table>
        </div>
      ` : `
        <p class="mini">No execution selected.</p>
      `}
    </section>
  `;

  const script = `
    if (${JSON.stringify(detail.profile.runtime_status)} !== "idle" && ${JSON.stringify(detail.profile.runtime_status)} !== "paused" && ${JSON.stringify(detail.profile.runtime_status)} !== "failed") {
      setTimeout(() => window.location.reload(), 3000);
    }
  `;

  return layout({ title: detail.profile.profile_name, body, script });
}
