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
        .shell {
          max-width: 1280px;
          margin: 0 auto;
          padding: 32px 20px 48px;
        }
        .hero {
          display: grid;
          grid-template-columns: 1.4fr 0.8fr;
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
        h1 {
          font-size: clamp(2rem, 3vw, 3.4rem);
          line-height: 0.95;
          letter-spacing: -0.04em;
          margin-bottom: 12px;
        }
        .lede {
          color: var(--muted);
          max-width: 64ch;
        }
        .toolbar, .stats {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
        }
        .stats .pill, .pill {
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
        button.secondary, .button.secondary {
          background: var(--accent-2);
        }
        button.ghost {
          background: transparent;
          color: var(--text);
          border: 1px solid var(--line);
        }
        .table-wrap {
          overflow: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          min-width: 900px;
        }
        th, td {
          text-align: left;
          padding: 12px 10px;
          border-bottom: 1px solid var(--line);
          vertical-align: top;
        }
        th {
          color: var(--muted);
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
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
        .meta {
          color: var(--muted);
          font-size: 0.92rem;
        }
        .run-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 14px;
        }
        .mini {
          font-size: 0.85rem;
          color: var(--muted);
        }
        @media (max-width: 900px) {
          .hero {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </head>
    <body>
      <main class="shell">${body}</main>
      <script>${script}</script>
    </body>
  </html>`;
}

export function renderDashboardPage({ profiles, runs, config }) {
  const enabledCount = profiles.filter((profile) => profile.enabled).length;
  const readyCount = profiles.filter((profile) => profile.validation.code === "ready").length;
  const latestRun = runs[0];

  const rows = profiles.map((profile) => {
    const validationClass = profile.validation.level === "ok"
      ? "ok"
      : profile.validation.level === "warning"
        ? "warning"
        : "error";
    return `
      <tr>
        <td>
          <form method="post" action="/profiles/${encodeURIComponent(profile.profile_id)}/binding">
            <input type="hidden" name="profileId" value="${escapeHtml(profile.profile_id)}" />
            <input type="checkbox" name="enabled" value="1" ${profile.enabled ? "checked" : ""} />
        </td>
        <td>
            <strong>${escapeHtml(profile.profile_name)}</strong>
            <div class="meta">${escapeHtml(profile.browser_type || "unknown")} ${escapeHtml(profile.browser_version || "")}</div>
        </td>
        <td><code>${escapeHtml(profile.profile_id)}</code></td>
        <td>
            <input type="text" name="folderPath" value="${escapeHtml(profile.folder_path || "")}" placeholder="C:\\data\\profile-01" />
        </td>
        <td style="max-width: 260px">
            <span class="status ${validationClass}">${escapeHtml(profile.validation.code)}</span>
            <div class="mini">${escapeHtml(profile.validation.message)}</div>
        </td>
        <td>
            <input type="number" min="1" step="1" name="displayOrder" value="${escapeHtml(profile.display_order)}" />
        </td>
        <td>
            <div>${escapeHtml(profile.last_status || "-")}</div>
            <div class="mini">${escapeHtml(profile.last_run_at || "")}</div>
        </td>
        <td>
            <button type="submit" class="ghost">Save</button>
          </form>
        </td>
      </tr>
    `;
  }).join("");

  const body = `
    <section class="hero">
      <div class="card">
        <h1>GPM Profile Queue Dashboard</h1>
        <p class="lede">Sync profiles from GPM, persist profile-to-folder mappings, validate the standard Excel file, and open enabled profiles through a concurrency-limited queue.</p>
        <div class="toolbar">
          <form method="post" action="/sync">
            <button type="submit">Sync GPM</button>
          </form>
          <a class="button secondary" href="/runs${latestRun ? `/${encodeURIComponent(latestRun.run_id)}` : ""}">Open Run Monitor</a>
        </div>
      </div>
      <div class="card">
        <h3>System</h3>
        <div class="stats">
          <span class="pill">Profiles: ${profiles.length}</span>
          <span class="pill">Enabled: ${enabledCount}</span>
          <span class="pill">Ready: ${readyCount}</span>
        </div>
        <p class="mini">GPM API: ${escapeHtml(config.gpmApiBaseUrl)}</p>
        <p class="mini">Excel filename: ${escapeHtml(config.excelFilenameStandard)}</p>
      </div>
    </section>

    <section class="card" style="margin-bottom: 20px;">
      <h2>Start Run</h2>
      <form method="post" action="/runs">
        <div class="toolbar">
          <input style="max-width: 220px" type="number" min="1" name="maxConcurrency" value="1" />
          <button type="submit">Start Opening Profiles</button>
        </div>
        <p class="mini">Concurrency is chosen per run. Invalid profiles are skipped, successful ones remain open for the next phase.</p>
      </form>
    </section>

    <section class="card">
      <h2>Profiles Dashboard</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Use</th>
              <th>Profile</th>
              <th>Profile ID</th>
              <th>Folder Path</th>
              <th>Validation</th>
              <th>Order</th>
              <th>Last Run</th>
              <th>Save</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="8">No profiles synced yet.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;

  return layout({ title: "GPM Profile Dashboard", body });
}

export function renderRunPage({ run }) {
  if (!run) {
    return layout({
      title: "Run Not Found",
      body: `
        <section class="card">
          <h1>Run not found</h1>
          <p class="lede">The requested run id does not exist.</p>
          <a class="button" href="/">Back to dashboard</a>
        </section>
      `
    });
  }

  const items = run.items || [];
  const sessions = run.sessions || [];
  const summary = {
    pending: items.filter((item) => item.status === "pending").length,
    validating: items.filter((item) => item.status === "validating").length,
    opening: items.filter((item) => item.status === "opening").length,
    opened: items.filter((item) => item.status === "opened").length,
    skipped: items.filter((item) => item.status === "skipped_invalid_config").length,
    failed: items.filter((item) => item.status === "failed_open_profile").length
  };

  const rows = items.map((item) => `
    <tr>
      <td><code>${escapeHtml(item.profile_id)}</code></td>
      <td>${escapeHtml(item.status)}</td>
      <td>${escapeHtml(item.folder_path || "-")}</td>
      <td>${escapeHtml(item.excel_path || "-")}</td>
      <td>${escapeHtml(item.error_code || "-")}</td>
      <td>${escapeHtml(item.error_detail || "-")}</td>
    </tr>
  `).join("");

  const sessionRows = sessions.map((session) => `
    <tr>
      <td><code>${escapeHtml(session.profile_id)}</code></td>
      <td>${escapeHtml(session.remote_debugging_address)}</td>
      <td>${escapeHtml(session.browser_location || "-")}</td>
      <td>${escapeHtml(session.driver_path || "-")}</td>
    </tr>
  `).join("");

  const body = `
    <section class="hero">
      <div class="card">
        <h1>Run ${escapeHtml(run.run_id)}</h1>
        <p class="lede">Monitor queue progress for opening GPM profiles and resolving the target folder and standard Excel file.</p>
        <div class="toolbar">
          <a class="button secondary" href="/">Back to dashboard</a>
          ${run.status === "running" ? `
            <form method="post" action="/runs/${encodeURIComponent(run.run_id)}/stop">
              <button type="submit">Stop Run</button>
            </form>
          ` : ""}
        </div>
      </div>
      <div class="card">
        <h3>Status</h3>
        <div class="stats">
          <span class="pill">Run: ${escapeHtml(run.status)}</span>
          <span class="pill">Concurrency: ${escapeHtml(run.max_concurrency)}</span>
          <span class="pill">Opened: ${summary.opened}</span>
          <span class="pill">Failed: ${summary.failed}</span>
          <span class="pill">Skipped: ${summary.skipped}</span>
        </div>
        <p class="mini">Started: ${escapeHtml(run.started_at)}</p>
        <p class="mini">Ended: ${escapeHtml(run.ended_at || "-")}</p>
      </div>
    </section>

    <section class="card" style="margin-bottom: 18px;">
      <h2>Run Items</h2>
      <div class="run-grid">
        <div class="pill">Validating: ${summary.validating}</div>
        <div class="pill">Opening: ${summary.opening}</div>
        <div class="pill">Opened: ${summary.opened}</div>
        <div class="pill">Skipped invalid: ${summary.skipped}</div>
        <div class="pill">Failed open: ${summary.failed}</div>
      </div>
      <div class="table-wrap" style="margin-top: 14px;">
        <table>
          <thead>
            <tr>
              <th>Profile ID</th>
              <th>Status</th>
              <th>Folder</th>
              <th>Excel</th>
              <th>Error Code</th>
              <th>Error Detail</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="6">No run items yet.</td></tr>`}</tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h2>Opened Sessions</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Profile ID</th>
              <th>Remote Debugging</th>
              <th>Browser Location</th>
              <th>Driver Path</th>
            </tr>
          </thead>
          <tbody>${sessionRows || `<tr><td colspan="4">No opened sessions yet.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;

  const script = `
    if (${JSON.stringify(run.status)} === "running") {
      setTimeout(() => window.location.reload(), 3000);
    }
  `;

  return layout({ title: `Run ${run.run_id}`, body, script });
}

