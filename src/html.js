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
          <a class="button secondary" href="/templates">Tạo Template</a>
          <a class="button secondary" href="/stats">Stats</a>
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
        <a class="button ghost" href="${view === "all" ? "/?view=all" : "/"}">Clear</a>
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
          <a class="button secondary" href="/admin/ai-settings">AI Settings</a>
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

function renderTabGeneral(detail) {
  const profile = detail.profile;
  const profileId = encodeURIComponent(profile.profile_id);
  return `
    <section class="card">
      <h2>Cấu hình chung</h2>
      <p class="mini">Các tham số dưới đây áp dụng riêng cho profile này khi chạy automation.</p>
      <form method="post" action="/profiles/${profileId}/settings" class="stack">
        <div class="cluster">
          <div>
            <label class="mini">Selected (chạy automation)</label>
            <div><input type="checkbox" name="enabled" value="1" ${profile.enabled ? "checked" : ""} /> Use this profile</div>
          </div>
          <div>
            <label class="mini">Display order</label>
            <input type="number" min="1" step="1" name="displayOrder" value="${escapeHtml(profile.display_order)}" />
          </div>
        </div>
        <div>
          <label class="mini">Folder Path</label>
          <input type="text" name="folderPath" value="${escapeHtml(profile.folder_path || "")}" placeholder="C:\\GPM\\profile-folder" />
        </div>
        <div class="cluster">
          <div>
            <label class="mini">Field delay min (giây)</label>
            <input type="number" min="0" step="0.1" name="fieldDelayMinSeconds" value="${escapeHtml(profile.field_delay_min_seconds)}" />
          </div>
          <div>
            <label class="mini">Field delay max (giây)</label>
            <input type="number" min="0" step="0.1" name="fieldDelayMaxSeconds" value="${escapeHtml(profile.field_delay_max_seconds)}" />
          </div>
          <div>
            <label class="mini">Row interval min (phút)</label>
            <input type="number" min="0" step="0.1" name="rowIntervalMinMinutes" value="${escapeHtml(profile.row_interval_min_minutes)}" />
          </div>
          <div>
            <label class="mini">Row interval max (phút)</label>
            <input type="number" min="0" step="0.1" name="rowIntervalMaxMinutes" value="${escapeHtml(profile.row_interval_max_minutes)}" />
          </div>
        </div>
        <div class="cluster">
          <div class="pill">Profile ID: <code>${escapeHtml(profile.profile_id)}</code></div>
          <div class="pill">Browser: ${escapeHtml(profile.browser_type || "unknown")} ${escapeHtml(profile.browser_version || "")}</div>
          <div class="pill ${validationClass(profile.validation)}">${escapeHtml(profile.validation.code)}: ${escapeHtml(profile.validation.message || "ready")}</div>
        </div>
        <div class="actions">
          <button type="submit">Save Settings</button>
        </div>
      </form>
    </section>
  `;
}

function renderTabTemplate(detail, excelData, message) {
  const profile = detail.profile;
  const profileId = encodeURIComponent(profile.profile_id);
  const flash = message ? `<p class="status ok" style="margin-bottom: 12px;">${escapeHtml(message)}</p>` : "";

  if (!excelData || !excelData.exists) {
    let reason = "";
    if (excelData?.reason === "no_folder") reason = "Profile chưa cấu hình Folder Path. Sang tab Chung để cấu hình.";
    else if (excelData?.reason === "no_excel") reason = `File ${escapeHtml(excelData.excelPath || "input.xlsx")} chưa tồn tại. Vào menu Tạo Template để sinh.`;
    else if (excelData?.reason === "invalid_excel") reason = `File Excel lỗi: ${escapeHtml(excelData.error || "unknown")}`;
    else reason = "Excel chưa sẵn sàng.";
    return `
      <section class="card">
        ${flash}
        <h2>Template (input.xlsx)</h2>
        <p class="mini">${reason}</p>
        <div class="actions">
          <a class="button secondary" href="/templates">Vào menu Tạo Template</a>
        </div>
      </section>
    `;
  }

  const headers = excelData.headers;
  const rows = excelData.rows;

  const headerCells = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("") + "<th>Action</th>";

  const needsAiFill = (values) => {
    const missing = (k) => String(values?.[k] ?? "").trim() === "";
    return missing("Main Tag") || missing("Supporting Tags") || missing("Description");
  };
  const emptyCount = rows.filter((r) => needsAiFill(r.values) && String(r.values.Title || "").trim() !== "").length;

  const dataRows = rows.map((row) => {
    const updateForm = `update-row-${row.rowNumber}`;
    const hasTitle = String(row.values.Title || "").trim() !== "";
    const aiNeeded = hasTitle && needsAiFill(row.values);
    const inputs = headers.map((h) => {
      const value = row.values[h] ?? "";
      const stringValue = String(value);
      const isLong = stringValue.length > 60 || h === "Description" || h === "status_detail";
      if (isLong) {
        return `<td><textarea form="${updateForm}" name="cell_${escapeHtml(h)}" rows="2" style="width:100%;min-width:200px;">${escapeHtml(stringValue)}</textarea></td>`;
      }
      return `<td><input form="${updateForm}" type="text" name="cell_${escapeHtml(h)}" value="${escapeHtml(stringValue)}" style="min-width:120px;" /></td>`;
    }).join("");

    return `
      <tr>
        ${inputs}
        <td style="white-space:nowrap;">
          <form id="${updateForm}" method="post" action="/profiles/${profileId}/excel/rows/${row.rowNumber}/update" style="display:inline-block;">
            <button type="submit" class="ghost">Save</button>
          </form>
          <form method="post" action="/profiles/${profileId}/excel/rows/${row.rowNumber}/ai-fill" style="display:inline-block;" title="${aiNeeded ? "AI điền Main Tag, Supporting Tags, Description" : "Bấm để AI điền (force ghi đè)"}">
            ${!aiNeeded && hasTitle ? `<input type="hidden" name="force" value="1" />` : ""}
            <button type="submit" class="secondary" ${hasTitle ? "" : "disabled title=\"Chưa có Title\""}>AI</button>
          </form>
          <form method="post" action="/profiles/${profileId}/excel/rows/${row.rowNumber}/delete" onsubmit="return confirm('Xóa dòng ${row.rowNumber}?')" style="display:inline-block;">
            <button type="submit" class="danger">Del</button>
          </form>
        </td>
      </tr>
    `;
  }).join("");

  const newRowInputs = headers.map((h) => {
    const isLong = h === "Description" || h === "status_detail";
    if (isLong) {
      return `<td><textarea name="cell_${escapeHtml(h)}" rows="2" style="width:100%;min-width:200px;"></textarea></td>`;
    }
    if (h === "TT") {
      return `<td><input type="text" name="cell_${escapeHtml(h)}" placeholder="auto" style="min-width:60px;" /></td>`;
    }
    return `<td><input type="text" name="cell_${escapeHtml(h)}" style="min-width:120px;" /></td>`;
  }).join("");

  return `
    <section class="card">
      ${flash}
      <h2>Template (input.xlsx)</h2>
      <p class="mini">CRUD trực tiếp vào file <code>${escapeHtml(excelData.excelPath || "input.xlsx")}</code>. Bấm <strong>Save</strong> mỗi dòng để lưu thay đổi. <span style="color: var(--warn);">Cảnh báo:</span> không nên sửa khi profile đang chạy automation.</p>
      <div class="cluster" style="margin-bottom: 12px;">
        <div class="pill">Tổng: ${rows.length} dòng</div>
        <div class="pill">Cột: ${headers.length}</div>
        <div class="pill">Cần AI điền: ${emptyCount}</div>
      </div>
      <div class="actions" style="margin-bottom: 12px;">
        <form method="post" action="/profiles/${profileId}/excel/ai-fill-all" onsubmit="return confirm('AI sẽ phân tích Title và điền Main Tag / Supporting Tags / Description cho ${emptyCount} dòng còn trống. Có thể mất vài phút. Tiếp tục?')" style="display:inline-block;">
          <button type="submit" class="secondary" ${emptyCount === 0 ? "disabled" : ""}>AI điền C/D/E (${emptyCount} dòng trống)</button>
        </form>
        <form method="post" action="/profiles/${profileId}/excel/ai-fill-all" onsubmit="return confirm('AI sẽ GHI ĐÈ Main Tag / Supporting Tags / Description cho TOÀN BỘ ${rows.length} dòng. Tiếp tục?')" style="display:inline-block;">
          <input type="hidden" name="force" value="1" />
          <button type="submit" class="warn" ${rows.length === 0 ? "disabled" : ""}>AI ghi đè TẤT CẢ</button>
        </form>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${dataRows || `<tr><td colspan="${headers.length + 1}">Chưa có dòng nào. Thêm dòng mới ở dưới.</td></tr>`}</tbody>
        </table>
      </div>

      <h3 style="margin-top: 24px;">Thêm dòng mới</h3>
      <form method="post" action="/profiles/${profileId}/excel/rows">
        <div class="table-wrap">
          <table>
            <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}<th>Action</th></tr></thead>
            <tbody>
              <tr>
                ${newRowInputs}
                <td><button type="submit">Add</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </form>
    </section>
  `;
}

function renderTabExecution(detail, selectedExecution) {
  const profileId = encodeURIComponent(detail.profile.profile_id);
  const selectedExecutionDetail = selectedExecution || detail.activeExecution || null;

  const executionRows = detail.executions.map((execution) => `
    <tr>
      <td><a href="/profiles/${profileId}?tab=execution&executionId=${encodeURIComponent(execution.execution_id)}"><code>${escapeHtml(execution.execution_id)}</code></a></td>
      <td>${escapeHtml(execution.status)}</td>
      <td>${escapeHtml(execution.rows_completed)}</td>
      <td>${escapeHtml(execution.rows_failed)}</td>
      <td>${escapeHtml(execution.rows_total)}</td>
      <td>${escapeHtml(execution.started_at)}</td>
      <td>${escapeHtml(execution.ended_at || "-")}</td>
      <td>
        <form method="post" action="/profiles/${profileId}/executions/${encodeURIComponent(execution.execution_id)}/delete" onsubmit="return ${execution.status === "running" ? "false" : `confirm('Delete this execution history?')`}">
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

  return `
    <section class="card">
      <h3>Runtime State</h3>
      <div class="cluster">
        <div class="pill">Status: ${escapeHtml(detail.profile.runtime_status)}</div>
        <div class="pill">Last run: ${escapeHtml(detail.profile.last_run_status || "-")}</div>
        <div class="pill">Current row: ${escapeHtml(detail.profile.current_row_number || "-")}</div>
        <div class="pill">Field delay: ${escapeHtml(detail.profile.field_delay_min_seconds)}s - ${escapeHtml(detail.profile.field_delay_max_seconds)}s</div>
        <div class="pill">Row interval: ${escapeHtml(detail.profile.row_interval_min_minutes)} - ${escapeHtml(detail.profile.row_interval_max_minutes)} min</div>
        <div class="pill">Folder: <code>${escapeHtml(detail.profile.folder_path || "-")}</code></div>
        ${(() => {
          const ae = detail.activeExecution;
          if (!ae) return "";
          return `
            <div class="pill">Rows total: ${escapeHtml(ae.rows_total)}</div>
            <div class="pill">Rows ok: ${escapeHtml(ae.rows_completed)}</div>
            <div class="pill">Rows failed: ${escapeHtml(ae.rows_failed)}</div>
          `;
        })()}
        ${detail.profile.next_row_at ? `<div class="pill" id="next-row-countdown" data-next-row-at="${escapeHtml(detail.profile.next_row_at)}">Next row in: calculating…</div>` : ""}
      </div>
      <p class="mini">Started: ${escapeHtml(detail.profile.last_run_started_at || "-")}</p>
      <p class="mini">Ended: ${escapeHtml(detail.profile.last_run_ended_at || "-")}</p>
      <p class="mini">${escapeHtml(detail.profile.last_error_detail || "")}</p>
      ${detail.profile.next_row_at ? `
      <script>
        (function() {
          var el = document.getElementById('next-row-countdown');
          if (!el) return;
          var target = new Date(el.getAttribute('data-next-row-at')).getTime();
          function tick() {
            var ms = target - Date.now();
            if (ms <= 0) { el.textContent = 'Next row starting…'; return; }
            var s = Math.floor(ms/1000);
            var m = Math.floor(s/60); s = s%60;
            el.textContent = 'Next row in: ' + m + 'm ' + s + 's';
          }
          tick(); setInterval(tick, 1000);
        })();
      </script>` : ""}
    </section>

    <section class="card" style="margin-top: 18px;">
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

    <section class="card" style="margin-top: 18px;">
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
}

export function renderProfilePage({ detail, selectedExecution, tab = "general", message = null, excelData = null }) {
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

  const profileId = encodeURIComponent(detail.profile.profile_id);
  const tabs = [
    { id: "general", label: "Chung" },
    { id: "template", label: "Template" },
    { id: "execution", label: "Execution" }
  ];

  const tabNav = tabs.map((t) => {
    const href = `/profiles/${profileId}?tab=${t.id}`;
    const cls = tab === t.id ? "active" : "";
    return `<a href="${href}" class="${cls}">${escapeHtml(t.label)}</a>`;
  }).join("");

  let tabContent = "";
  if (tab === "general") tabContent = renderTabGeneral(detail);
  else if (tab === "template") tabContent = renderTabTemplate(detail, excelData, message);
  else if (tab === "execution") tabContent = renderTabExecution(detail, selectedExecution);

  const body = `
    <section class="hero">
      <div class="card">
        <h1>${escapeHtml(detail.profile.profile_name)}</h1>
        <p class="lede">Cấu hình profile, chỉnh sửa Excel template và theo dõi automation.</p>
        <div class="actions">
          <a class="button secondary" href="/">Back to dashboard</a>
          <form method="post" action="/profiles/${profileId}/generate-excel?return=profile" onsubmit="return confirm('Quét folder và (ghi đè) tạo input.xlsx từ các file PNG?')">
            <button type="submit" class="secondary" ${detail.profile.folder_path ? "" : "disabled title=\"Chưa cấu hình Folder Path\""}>Tạo Template</button>
          </form>
          <form method="post" action="/profiles/${profileId}/run">
            <button type="submit">Run</button>
          </form>
          <form method="post" action="/profiles/${profileId}/pause">
            <button type="submit" class="warn">Pause</button>
          </form>
          <form method="post" action="/profiles/${profileId}/stop">
            <button type="submit" class="danger">Stop</button>
          </form>
        </div>
      </div>
      <div class="card">
        <h3>Quick status</h3>
        <div class="cluster">
          <div class="pill">Status: ${escapeHtml(detail.profile.runtime_status)}</div>
          <div class="pill">Last run: ${escapeHtml(detail.profile.last_run_status || "-")}</div>
          <div class="pill">Folder: <code>${escapeHtml(detail.profile.folder_path || "-")}</code></div>
          <div class="pill ${validationClass(detail.profile.validation)}">${escapeHtml(detail.profile.validation.code)}</div>
        </div>
      </div>
    </section>

    <div class="tabs">${tabNav}</div>

    ${tabContent}
  `;

  const shouldAutoReload = tab === "execution"
    && !["idle", "paused", "failed", "awaiting_automation"].includes(detail.profile.runtime_status);
  const script = shouldAutoReload ? `setTimeout(() => window.location.reload(), 3000);` : "";

  return layout({ title: detail.profile.profile_name, body, script });
}

export function renderTemplatesPage({ profiles, flash = null }) {
  const totalProfiles = profiles.length;
  const withFolder = profiles.filter((p) => p.folder_path).length;
  const withExcel = profiles.filter((p) => p.excelExists).length;
  const totalImages = profiles.reduce((sum, p) => sum + (p.imageCount || 0), 0);

  const flashBanner = (() => {
    if (!flash) return "";
    if (flash.type === "generated") {
      return `<p class="status ok" style="margin-bottom: 12px;">Đã tạo input.xlsx với ${escapeHtml(flash.count)} dòng cho profile <code>${escapeHtml(flash.profileId)}</code>.</p>`;
    }
    if (flash.type === "error") {
      return `<p class="status error" style="margin-bottom: 12px;">Lỗi: ${escapeHtml(flash.message)}</p>`;
    }
    return "";
  })();

  const rows = profiles.map((profile) => {
    const folderConfigured = Boolean(profile.folder_path);
    const canGenerate = folderConfigured && profile.imageCount > 0;
    const confirmMsg = profile.excelExists
      ? "File input.xlsx đã tồn tại và sẽ bị GHI ĐÈ. Tiếp tục?"
      : "Tạo input.xlsx từ các file PNG trong thư mục?";
    const folderCell = folderConfigured
      ? `<code>${escapeHtml(profile.folder_path)}</code>`
      : `<span class="meta">(chưa cấu hình)</span>`;
    const imageCountCell = folderConfigured
      ? `<span class="status ${profile.imageCount > 0 ? "ok" : "warning"}">${escapeHtml(profile.imageCount)} PNG</span>`
      : `<span class="meta">-</span>`;
    const excelCell = profile.excelExists
      ? `<span class="status ok">đã có</span>`
      : `<span class="status neutral">chưa có</span>`;

    return `
      <tr>
        <td>
          <strong>${escapeHtml(profile.profile_name)}</strong>
          <div class="mini"><a href="/profiles/${encodeURIComponent(profile.profile_id)}">Chi tiết</a></div>
        </td>
        <td><code>${escapeHtml(profile.profile_id)}</code></td>
        <td>${folderCell}</td>
        <td>${imageCountCell}</td>
        <td>${excelCell}</td>
        <td>
          <form method="post" action="/profiles/${encodeURIComponent(profile.profile_id)}/generate-excel" onsubmit="return confirm(${JSON.stringify(confirmMsg)})">
            <button type="submit" class="secondary" ${canGenerate ? "" : "disabled"}>Tạo Template</button>
          </form>
          ${!folderConfigured ? `<div class="mini" style="color: var(--warn);">Cấu hình Folder Path ở dashboard trước</div>` : ""}
          ${folderConfigured && profile.imageCount === 0 ? `<div class="mini" style="color: var(--warn);">Không có file PNG trong thư mục</div>` : ""}
        </td>
      </tr>
    `;
  }).join("");

  const body = `
    <section class="hero">
      <div class="card">
        <h1>Tạo Template Excel</h1>
        <p class="lede">Quét thư mục của từng profile để tìm file <code>.png</code> và sinh ra <code>input.xlsx</code> với 2 cột <strong>Title</strong> (tên file) và <strong>Image path</strong> (full path). Các cột khác (Description, Main Tag, Supporting Tags, color) để trống cho bạn điền sau.</p>
        <div class="actions">
          <a class="button secondary" href="/">Back to dashboard</a>
        </div>
      </div>
      <div class="card">
        <h3>Tổng quan</h3>
        <div class="stats">
          <span class="pill">Selected profiles: ${totalProfiles}</span>
          <span class="pill">Có folder: ${withFolder}</span>
          <span class="pill">Đã có Excel: ${withExcel}</span>
          <span class="pill">Tổng PNG: ${totalImages}</span>
        </div>
        <p class="mini">Chỉ hiển thị các profile đã <strong>Selected</strong> ở dashboard. Mỗi lần bấm "Tạo Template" sẽ <strong>ghi đè</strong> file <code>input.xlsx</code> hiện có trong thư mục.</p>
      </div>
    </section>

    <section class="card">
      ${flashBanner}
      <h2>Profiles</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Profile</th>
              <th>Profile ID</th>
              <th>Folder</th>
              <th>PNG</th>
              <th>input.xlsx</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="6">Chưa có profile nào được Selected. Vào dashboard, tick checkbox "Use" và Save để chọn profile.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;

  return layout({ title: "Tạo Template Excel", body });
}

export function renderStatsPage({ profiles, latestByProfile, scrapeInProgress, banner = null }) {
  const totalSelected = profiles.length;
  const scrapedCount = profiles.filter((p) => latestByProfile.has(p.profile_id)).length;

  const bannerHtml = banner
    ? `<p class="status ${banner.kind}" style="margin-bottom: 12px;">${escapeHtml(banner.text)}</p>`
    : "";

  const rows = profiles.map((profile) => {
    const stat = latestByProfile.get(profile.profile_id);
    let lineItemsCell = `<span class="mini">Chưa có dữ liệu</span>`;
    let statusCell = `<span class="status neutral">chưa cào</span>`;
    let scrapedAtCell = "";
    let errorCell = "";

    if (stat) {
      if (stat.status === "success" && Array.isArray(stat.lineItems) && stat.lineItems.length > 0) {
        const paymentBlock = `<div class="stack">${stat.lineItems.map((item) => `
          <div>
            <div style="font-weight: 600;">${escapeHtml(item.heading || "(no heading)")}</div>
            <div>${escapeHtml(item.value || "")}</div>
            ${item.info ? `<div class="mini">${escapeHtml(item.info)}</div>` : ""}
          </div>
        `).join("")}</div>`;

        let studioBlock = "";
        if (stat.studioData) {
          if (stat.studioData.error) {
            studioBlock = `<details style="margin-top: 12px;"><summary class="mini">Studio dashboard: lỗi</summary><div class="mini" style="color: var(--bad); white-space: pre-wrap;">${escapeHtml(stat.studioData.error)}</div></details>`;
          } else {
            const opts = Array.isArray(stat.studioData.optionLabels) ? stat.studioData.optionLabels : [];
            const snaps = Array.isArray(stat.studioData.snapshots) ? stat.studioData.snapshots : [];
            const optsHtml = opts.length
              ? `<div class="mini">Options: ${opts.map((o) => escapeHtml(o.label || o.value || "")).filter(Boolean).join(" | ")}</div>`
              : `<div class="mini">Options: (rỗng)</div>`;
            const snapsHtml = snaps.map((s) => {
              if (s.error) {
                return `<div style="margin-top: 6px;"><span class="mini">Item[${s.index}]:</span> <span class="mini" style="color: var(--bad);">${escapeHtml(s.error)}</span></div>`;
              }
              const labelText = s.label || "(no label)";
              const valueText = s.value || "(no value)";
              const fallbackBadge = (s.labelSelectorUsed === "fallback" || s.valueSelectorUsed === "fallback")
                ? ` <span class="mini" style="color: var(--warn);">[fallback selector]</span>`
                : "";
              return `
                <div style="margin-top: 6px; padding: 6px 8px; background: rgba(0,0,0,0.04); border-radius: 8px;">
                  <div class="mini">Item[${s.index}]${s.selectedLabel ? ` — ${escapeHtml(s.selectedLabel)}` : ""}${fallbackBadge}</div>
                  <div class="mini" style="color: var(--muted);">${escapeHtml(labelText)}</div>
                  <div style="font-weight: 600;">${escapeHtml(valueText)}</div>
                </div>
              `;
            }).join("");
            let tableHtml = "";
            const td = stat.studioData.tableData;
            if (td) {
              if (td.error) {
                tableHtml = `<div style="margin-top: 8px;"><span class="mini" style="color: var(--bad);">Table: ${escapeHtml(td.error)}</span></div>`;
              } else {
                const headers = Array.isArray(td.headers) ? td.headers : [];
                const rowsArr = Array.isArray(td.rows) ? td.rows : [];
                const headerRow = headers.length
                  ? `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`
                  : "";
                const bodyRows = rowsArr.map((r) =>
                  `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`
                ).join("");
                const fallbackBadge = td.tableSelectorUsed === "fallback"
                  ? ` <span class="mini" style="color: var(--warn);">[fallback]</span>`
                  : "";
                tableHtml = `
                  <details style="margin-top: 8px;">
                    <summary class="mini">Table — ${rowsArr.length} dòng / ${td.pages} trang${fallbackBadge}</summary>
                    <div class="table-wrap" style="max-height: 320px; overflow: auto; margin-top: 6px;">
                      <table style="min-width: 0; font-size: 0.85rem;">
                        ${headerRow ? `<thead>${headerRow}</thead>` : ""}
                        <tbody>${bodyRows || `<tr><td>(rỗng)</td></tr>`}</tbody>
                      </table>
                    </div>
                  </details>
                `;
              }
            }
            studioBlock = `<details style="margin-top: 12px;"><summary class="mini">Studio dashboard (option selector: <code>${escapeHtml(stat.studioData.optionSelector || "?")}</code>)</summary>${optsHtml}${snapsHtml}${tableHtml}</details>`;
          }
        }

        lineItemsCell = paymentBlock + studioBlock;
      } else if (stat.status === "success") {
        lineItemsCell = `<span class="mini">Trang load nhưng không tìm thấy item</span>`;
      } else {
        lineItemsCell = `<span class="mini">—</span>`;
      }

      statusCell = `<span class="status ${stat.status === "success" ? "ok" : stat.status === "skipped" ? "warning" : "error"}">${escapeHtml(stat.status)}</span>`;
      scrapedAtCell = `<span class="meta">${escapeHtml(stat.scrapedAt || "")}</span>`;
      errorCell = stat.errorMessage
        ? `<span class="mini" style="color: var(--bad);">${escapeHtml(stat.errorMessage)}</span>`
        : "";
    }

    const rerunDisabled = scrapeInProgress ? "disabled" : "";
    const rerunLabel = stat ? "Chạy lại" : "Lấy dữ liệu";

    return `
      <tr>
        <td>
          <div><a href="/profiles/${encodeURIComponent(profile.profile_id)}">${escapeHtml(profile.profile_name)}</a></div>
          <div class="mini"><code>${escapeHtml(profile.profile_id)}</code></div>
        </td>
        <td>${lineItemsCell}</td>
        <td>${statusCell}${errorCell ? `<div style="margin-top: 4px;">${errorCell}</div>` : ""}</td>
        <td>${scrapedAtCell}</td>
        <td>
          <form method="post" action="/stats/scrape/${encodeURIComponent(profile.profile_id)}">
            <button type="submit" class="ghost" ${rerunDisabled}>${escapeHtml(rerunLabel)}</button>
          </form>
        </td>
      </tr>
    `;
  }).join("");

  const buttonAttrs = scrapeInProgress ? "disabled" : "";
  const buttonLabel = scrapeInProgress ? "Đang chạy..." : "Lấy dữ liệu";

  const body = `
    <section class="hero">
      <div class="card">
        <h1>Profile Statistics</h1>
        <p class="lede">Cào dữ liệu từ <code>redbubble.com/account/payment_history</code> cho các profile selected. Nhấn nút để chạy tuần tự.</p>
        <div class="toolbar">
          <form method="post" action="/stats/scrape">
            <button type="submit" ${buttonAttrs}>${escapeHtml(buttonLabel)}</button>
          </form>
          <a class="button ghost" href="/">Về dashboard</a>
        </div>
      </div>
      <div class="card">
        <h3>Tổng quan</h3>
        <div class="stats">
          <span class="pill">Profile selected: ${totalSelected}</span>
          <span class="pill">Đã có dữ liệu: ${scrapedCount}</span>
          <span class="pill">${scrapeInProgress ? "Đang scrape" : "Sẵn sàng"}</span>
        </div>
      </div>
    </section>

    <section class="card">
      ${bannerHtml}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Profile</th>
              <th>Line items</th>
              <th>Trạng thái</th>
              <th>Thời điểm cào</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="5">Chưa có profile nào được selected.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;

  return layout({ title: "Profile Statistics", body });
}

export function renderAiSettingsPage({ settings, flash = null, testResult = null }) {
  const SAVE_FORM_ID = "ai-save-form";

  const providerCard = (cfg) => {
    const isActive = settings.activeProvider === cfg.provider;
    return `
      <div class="card" style="border-color: ${isActive ? "var(--accent-2)" : "var(--line)"}">
        <h3>${escapeHtml(cfg.label)} ${isActive ? `<span class="status ok">active</span>` : ""}</h3>
        <div class="stack">
          <div>
            <label class="mini">API Key</label>
            <input form="${SAVE_FORM_ID}" type="password" name="${cfg.provider}_api_key" value="${escapeHtml(cfg.apiKey)}" placeholder="${cfg.hasApiKey ? "(đã có – nhập để thay)" : "sk-..."}" autocomplete="off" />
          </div>
          <div>
            <label class="mini">Base URL (để trống dùng mặc định)</label>
            <input form="${SAVE_FORM_ID}" type="text" name="${cfg.provider}_base_url" value="${escapeHtml(cfg.baseUrl)}" placeholder="${escapeHtml(cfg.defaultBaseUrl)}" />
          </div>
          <div>
            <label class="mini">Model (để trống dùng mặc định)</label>
            <input form="${SAVE_FORM_ID}" type="text" name="${cfg.provider}_model" value="${escapeHtml(cfg.model)}" placeholder="${escapeHtml(cfg.defaultModel)}" />
          </div>
        </div>
        <form method="post" action="/admin/ai-test" class="actions" style="margin-top: 10px;">
          <input type="hidden" name="provider" value="${escapeHtml(cfg.provider)}" />
          <button type="submit" class="ghost" ${cfg.hasApiKey ? "" : "disabled title=\"Lưu API key trước khi test\""}>Test connection</button>
        </form>
      </div>
    `;
  };

  const flashBanner = flash
    ? `<p class="status ok" style="margin-bottom: 12px;">${escapeHtml(flash.message)}</p>`
    : "";

  const testBanner = testResult
    ? (testResult.ok
        ? `<div class="card" style="margin-bottom: 12px; border-color: var(--ok);">
             <h3 class="status ok">Test OK – ${escapeHtml(testResult.provider)}</h3>
             <p class="mini">Model: <code>${escapeHtml(testResult.model || "-")}</code></p>
             <p class="mini">Reply: ${escapeHtml(testResult.content || "(empty)")}</p>
             <p class="mini">Tokens in/out: ${escapeHtml(testResult.usage?.input_tokens ?? "-")} / ${escapeHtml(testResult.usage?.output_tokens ?? "-")}</p>
           </div>`
        : `<div class="card" style="margin-bottom: 12px; border-color: var(--bad);">
             <h3 class="status error">Test FAIL</h3>
             <p class="mini">${escapeHtml(testResult.message || "unknown error")}</p>
           </div>`)
    : "";

  const activeOptions = ["", ...settings.providers.map((p) => p.provider)]
    .map((value) => {
      const label = value === "" ? "(none)" : settings.providers.find((p) => p.provider === value)?.label || value;
      const selected = (settings.activeProvider || "") === value ? "selected" : "";
      return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");

  const body = `
    <section class="hero">
      <div class="card">
        <h1>AI Settings</h1>
        <p class="lede">Cấu hình tích hợp AI theo chuẩn OpenAI-compatible. Hỗ trợ <strong>OpenAI</strong>, <strong>OpenRouter</strong> và <strong>Claude (Anthropic)</strong>. API key lưu trong SQLite cục bộ.</p>
        <div class="actions">
          <a class="button secondary" href="/admin/settings">Back to admin</a>
          <a class="button secondary" href="/">Dashboard</a>
        </div>
      </div>
      <div class="card">
        <h3>Trạng thái</h3>
        <div class="cluster">
          <div class="pill">Active provider: ${escapeHtml(settings.activeProvider || "(none)")}</div>
          <div class="pill">Temperature: ${escapeHtml(settings.temperature)}</div>
          <div class="pill">Max tokens: ${escapeHtml(settings.maxTokens)}</div>
          <div class="pill">Updated: ${escapeHtml(settings.updatedAt || "never")}</div>
        </div>
      </div>
    </section>

    ${flashBanner}
    ${testBanner}

    <form id="${SAVE_FORM_ID}" method="post" action="/admin/ai-settings"></form>

    <section class="card" style="margin-bottom: 18px;">
      <h2>Cấu hình chung</h2>
      <div class="cluster">
        <div>
          <label class="mini">Active provider</label>
          <select form="${SAVE_FORM_ID}" name="activeProvider" style="width:100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: white;">
            ${activeOptions}
          </select>
        </div>
        <div>
          <label class="mini">Temperature</label>
          <input form="${SAVE_FORM_ID}" type="number" min="0" max="2" step="0.05" name="temperature" value="${escapeHtml(settings.temperature)}" />
        </div>
        <div>
          <label class="mini">Max tokens</label>
          <input form="${SAVE_FORM_ID}" type="number" min="1" max="32768" step="1" name="maxTokens" value="${escapeHtml(settings.maxTokens)}" />
        </div>
      </div>
    </section>

    <section class="card" style="margin-bottom: 18px;">
      <h2>Providers</h2>
      <p class="mini">Mỗi provider lưu API key riêng. <strong>Save</strong> trước, sau đó bấm <strong>Test connection</strong> để gửi 1 prompt thử.</p>
      <div class="cluster">
        ${settings.providers.map(providerCard).join("")}
      </div>
    </section>

    <div class="actions">
      <button type="submit" form="${SAVE_FORM_ID}">Save AI Settings</button>
    </div>
  `;

  return layout({ title: "AI Settings", body });
}

