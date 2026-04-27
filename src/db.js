import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function createDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS system_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      gpm_api_base_url TEXT NOT NULL,
      excel_filename_standard TEXT NOT NULL,
      log_dir TEXT NOT NULL,
      artifacts_dir TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gpm_profiles_cache (
      profile_id TEXT PRIMARY KEY,
      profile_name TEXT NOT NULL,
      group_id TEXT,
      browser_type TEXT,
      browser_version TEXT,
      raw_payload TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile_bindings (
      profile_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      folder_path TEXT,
      display_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS profile_runtime_config (
      profile_id TEXT PRIMARY KEY,
      field_delay_min_seconds REAL NOT NULL DEFAULT 1,
      field_delay_max_seconds REAL NOT NULL DEFAULT 1,
      row_interval_min_minutes REAL NOT NULL DEFAULT 1,
      row_interval_max_minutes REAL NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS profile_runtime_state (
      profile_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'idle',
      active_execution_id TEXT,
      current_row_number INTEGER,
      last_error_code TEXT,
      last_error_detail TEXT,
      last_run_status TEXT,
      last_run_started_at TEXT,
      last_run_ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS profile_executions (
      execution_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      rows_total INTEGER NOT NULL DEFAULT 0,
      rows_completed INTEGER NOT NULL DEFAULT 0,
      rows_failed INTEGER NOT NULL DEFAULT 0,
      log_path TEXT
    );

    CREATE TABLE IF NOT EXISTS profile_row_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      excel_row_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      status_detail TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile_browser_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      remote_debugging_address TEXT NOT NULL,
      browser_location TEXT,
      driver_path TEXT,
      session_status TEXT NOT NULL,
      connected_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      active_provider TEXT,
      openai_api_key TEXT,
      openai_base_url TEXT,
      openai_model TEXT,
      openrouter_api_key TEXT,
      openrouter_base_url TEXT,
      openrouter_model TEXT,
      claude_api_key TEXT,
      claude_base_url TEXT,
      claude_model TEXT,
      temperature REAL NOT NULL DEFAULT 0.7,
      max_tokens INTEGER NOT NULL DEFAULT 1024,
      updated_at TEXT
    );
  `);

  migrateProfileRuntimeConfig(db);
  migrateProfileRuntimeState(db);

  return db;
}

function migrateProfileRuntimeState(db) {
  if (!columnExists(db, "profile_runtime_state", "next_row_at")) {
    db.exec(`ALTER TABLE profile_runtime_state ADD COLUMN next_row_at TEXT`);
  }
}

function columnExists(db, tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function migrateProfileRuntimeConfig(db) {
  if (!columnExists(db, "profile_runtime_config", "field_delay_min_seconds")) {
    db.exec(`ALTER TABLE profile_runtime_config ADD COLUMN field_delay_min_seconds REAL NOT NULL DEFAULT 1`);
  }
  if (!columnExists(db, "profile_runtime_config", "field_delay_max_seconds")) {
    db.exec(`ALTER TABLE profile_runtime_config ADD COLUMN field_delay_max_seconds REAL NOT NULL DEFAULT 1`);
  }
  if (!columnExists(db, "profile_runtime_config", "row_interval_min_minutes")) {
    db.exec(`ALTER TABLE profile_runtime_config ADD COLUMN row_interval_min_minutes REAL NOT NULL DEFAULT 1`);
  }
  if (!columnExists(db, "profile_runtime_config", "row_interval_max_minutes")) {
    db.exec(`ALTER TABLE profile_runtime_config ADD COLUMN row_interval_max_minutes REAL NOT NULL DEFAULT 1`);
  }

  const hasLegacyFieldDelay = columnExists(db, "profile_runtime_config", "field_delay_seconds");
  const hasLegacyRowInterval = columnExists(db, "profile_runtime_config", "row_interval_seconds");

  if (hasLegacyFieldDelay) {
    db.exec(`
      UPDATE profile_runtime_config
      SET field_delay_min_seconds = COALESCE(field_delay_min_seconds, field_delay_seconds, 1),
          field_delay_max_seconds = COALESCE(field_delay_max_seconds, field_delay_seconds, 1)
    `);
  }

  if (hasLegacyRowInterval) {
    db.exec(`
      UPDATE profile_runtime_config
      SET row_interval_min_minutes = COALESCE(row_interval_min_minutes, row_interval_seconds, 1),
          row_interval_max_minutes = COALESCE(row_interval_max_minutes, row_interval_seconds, 1)
    `);
  }
}

export function seedSystemConfig(db, config) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO system_config (
      id,
      gpm_api_base_url,
      excel_filename_standard,
      log_dir,
      artifacts_dir,
      updated_at
    )
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      gpm_api_base_url = excluded.gpm_api_base_url,
      excel_filename_standard = excluded.excel_filename_standard,
      log_dir = excluded.log_dir,
      artifacts_dir = excluded.artifacts_dir,
      updated_at = excluded.updated_at
  `).run(
    config.gpmApiBaseUrl,
    config.excelFilenameStandard,
    config.logDir,
    config.artifactsDir,
    now
  );
}

export function getSystemConfig(db) {
  return db.prepare(`
    SELECT gpm_api_base_url, excel_filename_standard, log_dir, artifacts_dir
    FROM system_config
    WHERE id = 1
  `).get();
}

export function updateSystemConfig(db, config) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO system_config (
      id,
      gpm_api_base_url,
      excel_filename_standard,
      log_dir,
      artifacts_dir,
      updated_at
    )
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      gpm_api_base_url = excluded.gpm_api_base_url,
      excel_filename_standard = excluded.excel_filename_standard,
      log_dir = excluded.log_dir,
      artifacts_dir = excluded.artifacts_dir,
      updated_at = excluded.updated_at
  `).run(
    config.gpmApiBaseUrl,
    config.excelFilenameStandard,
    config.logDir,
    config.artifactsDir,
    now
  );
}

function ensureProfileDefaults(db, profileId, displayOrder) {
  db.prepare(`
    INSERT INTO profile_bindings (profile_id, enabled, folder_path, display_order)
    VALUES (?, 0, NULL, ?)
    ON CONFLICT(profile_id) DO NOTHING
  `).run(profileId, displayOrder);

  db.prepare(`
    INSERT INTO profile_runtime_config (
      profile_id,
      field_delay_min_seconds,
      field_delay_max_seconds,
      row_interval_min_minutes,
      row_interval_max_minutes
    )
    VALUES (?, 1, 1, 1, 1)
    ON CONFLICT(profile_id) DO NOTHING
  `).run(profileId);

  db.prepare(`
    INSERT INTO profile_runtime_state (
      profile_id,
      status,
      active_execution_id,
      current_row_number,
      last_error_code,
      last_error_detail,
      last_run_status,
      last_run_started_at,
      last_run_ended_at
    )
    VALUES (?, 'idle', NULL, NULL, NULL, NULL, NULL, NULL, NULL)
    ON CONFLICT(profile_id) DO NOTHING
  `).run(profileId);
}

export function upsertProfiles(db, profiles) {
  const now = new Date().toISOString();
  const upsertCache = db.prepare(`
    INSERT INTO gpm_profiles_cache (
      profile_id,
      profile_name,
      group_id,
      browser_type,
      browser_version,
      raw_payload,
      synced_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET
      profile_name = excluded.profile_name,
      group_id = excluded.group_id,
      browser_type = excluded.browser_type,
      browser_version = excluded.browser_version,
      raw_payload = excluded.raw_payload,
      synced_at = excluded.synced_at
  `);

  db.exec("BEGIN");
  try {
    profiles.forEach((profile, index) => {
      upsertCache.run(
        profile.id,
        profile.name,
        profile.group_id ?? null,
        profile.browser_type ?? null,
        profile.browser_version ?? null,
        JSON.stringify(profile),
        now
      );
      ensureProfileDefaults(db, profile.id, index + 1);
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listDashboardProfiles(db) {
  return db.prepare(`
    SELECT
      c.profile_id,
      c.profile_name,
      c.group_id,
      c.browser_type,
      c.browser_version,
      COALESCE(b.enabled, 0) AS enabled,
      COALESCE(b.display_order, 999999) AS display_order,
      b.folder_path,
      COALESCE(cfg.field_delay_min_seconds, 1) AS field_delay_min_seconds,
      COALESCE(cfg.field_delay_max_seconds, 1) AS field_delay_max_seconds,
      COALESCE(cfg.row_interval_min_minutes, 1) AS row_interval_min_minutes,
      COALESCE(cfg.row_interval_max_minutes, 1) AS row_interval_max_minutes,
      COALESCE(st.status, 'idle') AS runtime_status,
      st.active_execution_id,
      st.current_row_number,
      st.last_error_code,
      st.last_error_detail,
      st.last_run_status,
      st.last_run_started_at,
      st.last_run_ended_at,
      st.next_row_at
    FROM gpm_profiles_cache c
    LEFT JOIN profile_bindings b ON b.profile_id = c.profile_id
    LEFT JOIN profile_runtime_config cfg ON cfg.profile_id = c.profile_id
    LEFT JOIN profile_runtime_state st ON st.profile_id = c.profile_id
    ORDER BY COALESCE(b.display_order, 999999), c.profile_name
  `).all();
}

export function getProfileDashboardRow(db, profileId) {
  return db.prepare(`
    SELECT
      c.profile_id,
      c.profile_name,
      c.group_id,
      c.browser_type,
      c.browser_version,
      COALESCE(b.enabled, 0) AS enabled,
      COALESCE(b.display_order, 999999) AS display_order,
      b.folder_path,
      COALESCE(cfg.field_delay_min_seconds, 1) AS field_delay_min_seconds,
      COALESCE(cfg.field_delay_max_seconds, 1) AS field_delay_max_seconds,
      COALESCE(cfg.row_interval_min_minutes, 1) AS row_interval_min_minutes,
      COALESCE(cfg.row_interval_max_minutes, 1) AS row_interval_max_minutes,
      COALESCE(st.status, 'idle') AS runtime_status,
      st.active_execution_id,
      st.current_row_number,
      st.last_error_code,
      st.last_error_detail,
      st.last_run_status,
      st.last_run_started_at,
      st.last_run_ended_at,
      st.next_row_at
    FROM gpm_profiles_cache c
    LEFT JOIN profile_bindings b ON b.profile_id = c.profile_id
    LEFT JOIN profile_runtime_config cfg ON cfg.profile_id = c.profile_id
    LEFT JOIN profile_runtime_state st ON st.profile_id = c.profile_id
    WHERE c.profile_id = ?
  `).get(profileId);
}

export function updateProfileSettings(db, {
  profileId,
  enabled,
  folderPath,
  displayOrder,
  fieldDelayMinSeconds,
  fieldDelayMaxSeconds,
  rowIntervalMinMinutes,
  rowIntervalMaxMinutes
}) {
  ensureProfileDefaults(db, profileId, displayOrder || 0);

  db.prepare(`
    UPDATE profile_bindings
    SET enabled = ?,
        folder_path = ?,
        display_order = ?
    WHERE profile_id = ?
  `).run(
    enabled ? 1 : 0,
    folderPath || null,
    Number.isFinite(displayOrder) ? displayOrder : 0,
    profileId
  );

  db.prepare(`
    UPDATE profile_runtime_config
    SET field_delay_min_seconds = ?,
        field_delay_max_seconds = ?,
        row_interval_min_minutes = ?,
        row_interval_max_minutes = ?
    WHERE profile_id = ?
  `).run(
    Number.isFinite(fieldDelayMinSeconds) ? fieldDelayMinSeconds : 1,
    Number.isFinite(fieldDelayMaxSeconds) ? fieldDelayMaxSeconds : 1,
    Number.isFinite(rowIntervalMinMinutes) ? rowIntervalMinMinutes : 1,
    Number.isFinite(rowIntervalMaxMinutes) ? rowIntervalMaxMinutes : 1,
    profileId
  );
}

export function updateRuntimeState(db, {
  profileId,
  status,
  activeExecutionId,
  currentRowNumber,
  lastErrorCode,
  lastErrorDetail,
  lastRunStatus,
  lastRunStartedAt,
  lastRunEndedAt,
  nextRowAt
}) {
  ensureProfileDefaults(db, profileId, 0);
  const current = db.prepare(`
    SELECT *
    FROM profile_runtime_state
    WHERE profile_id = ?
  `).get(profileId);

  db.prepare(`
    UPDATE profile_runtime_state
    SET status = ?,
        active_execution_id = ?,
        current_row_number = ?,
        last_error_code = ?,
        last_error_detail = ?,
        last_run_status = ?,
        last_run_started_at = ?,
        last_run_ended_at = ?,
        next_row_at = ?
    WHERE profile_id = ?
  `).run(
    status ?? current.status,
    activeExecutionId === undefined ? current.active_execution_id : activeExecutionId,
    currentRowNumber === undefined ? current.current_row_number : currentRowNumber,
    lastErrorCode === undefined ? current.last_error_code : lastErrorCode,
    lastErrorDetail === undefined ? current.last_error_detail : lastErrorDetail,
    lastRunStatus === undefined ? current.last_run_status : lastRunStatus,
    lastRunStartedAt === undefined ? current.last_run_started_at : lastRunStartedAt,
    lastRunEndedAt === undefined ? current.last_run_ended_at : lastRunEndedAt,
    nextRowAt === undefined ? current.next_row_at : nextRowAt,
    profileId
  );
}

export function createProfileExecution(db, {
  executionId,
  profileId,
  status,
  startedAt,
  logPath
}) {
  db.prepare(`
    INSERT INTO profile_executions (
      execution_id,
      profile_id,
      status,
      started_at,
      log_path
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(executionId, profileId, status, startedAt, logPath || null);
}

export function updateProfileExecution(db, {
  executionId,
  status,
  endedAt,
  rowsTotal,
  rowsCompleted,
  rowsFailed,
  logPath
}) {
  const current = db.prepare(`
    SELECT *
    FROM profile_executions
    WHERE execution_id = ?
  `).get(executionId);

  db.prepare(`
    UPDATE profile_executions
    SET status = ?,
        ended_at = ?,
        rows_total = ?,
        rows_completed = ?,
        rows_failed = ?,
        log_path = ?
    WHERE execution_id = ?
  `).run(
    status ?? current.status,
    endedAt === undefined ? current.ended_at : endedAt,
    rowsTotal === undefined ? current.rows_total : rowsTotal,
    rowsCompleted === undefined ? current.rows_completed : rowsCompleted,
    rowsFailed === undefined ? current.rows_failed : rowsFailed,
    logPath === undefined ? current.log_path : logPath,
    executionId
  );
}

export function recordProfileRowExecution(db, {
  executionId,
  profileId,
  excelRowNumber,
  status,
  statusDetail,
  startedAt,
  endedAt
}) {
  db.prepare(`
    INSERT INTO profile_row_executions (
      execution_id,
      profile_id,
      excel_row_number,
      status,
      status_detail,
      started_at,
      ended_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    executionId,
    profileId,
    excelRowNumber,
    status,
    statusDetail || null,
    startedAt,
    endedAt
  );
}

export function createProfileBrowserSession(db, {
  profileId,
  executionId,
  remoteDebuggingAddress,
  browserLocation,
  driverPath,
  sessionStatus,
  connectedAt
}) {
  db.prepare(`
    INSERT INTO profile_browser_sessions (
      profile_id,
      execution_id,
      remote_debugging_address,
      browser_location,
      driver_path,
      session_status,
      connected_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    profileId,
    executionId,
    remoteDebuggingAddress,
    browserLocation || null,
    driverPath || null,
    sessionStatus,
    connectedAt
  );
}

export function closeProfileBrowserSession(db, { executionId, sessionStatus, closedAt }) {
  db.prepare(`
    UPDATE profile_browser_sessions
    SET session_status = ?,
        closed_at = ?
    WHERE execution_id = ?
  `).run(sessionStatus, closedAt, executionId);
}

export function getProfileExecutions(db, profileId) {
  return db.prepare(`
    SELECT execution_id, profile_id, status, started_at, ended_at, rows_total, rows_completed, rows_failed, log_path
    FROM profile_executions
    WHERE profile_id = ?
    ORDER BY started_at DESC
  `).all(profileId);
}

export function getProfileExecution(db, executionId) {
  const execution = db.prepare(`
    SELECT execution_id, profile_id, status, started_at, ended_at, rows_total, rows_completed, rows_failed, log_path
    FROM profile_executions
    WHERE execution_id = ?
  `).get(executionId);

  if (!execution) {
    return null;
  }

  const rows = db.prepare(`
    SELECT execution_id, profile_id, excel_row_number, status, status_detail, started_at, ended_at
    FROM profile_row_executions
    WHERE execution_id = ?
    ORDER BY excel_row_number
  `).all(executionId);

  const session = db.prepare(`
    SELECT profile_id, execution_id, remote_debugging_address, browser_location, driver_path, session_status, connected_at, closed_at
    FROM profile_browser_sessions
    WHERE execution_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(executionId);

  return {
    ...execution,
    rows,
    session
  };
}

export function deleteProfileExecution(db, { profileId, executionId }) {
  const execution = db.prepare(`
    SELECT execution_id, profile_id, status
    FROM profile_executions
    WHERE execution_id = ?
  `).get(executionId);

  if (!execution || execution.profile_id !== profileId) {
    return false;
  }

  db.prepare(`
    DELETE FROM profile_row_executions
    WHERE execution_id = ?
  `).run(executionId);

  db.prepare(`
    DELETE FROM profile_browser_sessions
    WHERE execution_id = ?
  `).run(executionId);

  db.prepare(`
    DELETE FROM profile_executions
    WHERE execution_id = ? AND profile_id = ?
  `).run(executionId, profileId);

  return true;
}

export function getAiConfig(db) {
  const row = db.prepare(`
    SELECT
      active_provider,
      openai_api_key,
      openai_base_url,
      openai_model,
      openrouter_api_key,
      openrouter_base_url,
      openrouter_model,
      claude_api_key,
      claude_base_url,
      claude_model,
      temperature,
      max_tokens,
      updated_at
    FROM ai_config
    WHERE id = 1
  `).get();

  return row || {
    active_provider: null,
    openai_api_key: null,
    openai_base_url: null,
    openai_model: null,
    openrouter_api_key: null,
    openrouter_base_url: null,
    openrouter_model: null,
    claude_api_key: null,
    claude_base_url: null,
    claude_model: null,
    temperature: 0.7,
    max_tokens: 1024,
    updated_at: null
  };
}

export function updateAiConfig(db, config) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ai_config (
      id,
      active_provider,
      openai_api_key,
      openai_base_url,
      openai_model,
      openrouter_api_key,
      openrouter_base_url,
      openrouter_model,
      claude_api_key,
      claude_base_url,
      claude_model,
      temperature,
      max_tokens,
      updated_at
    )
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      active_provider = excluded.active_provider,
      openai_api_key = excluded.openai_api_key,
      openai_base_url = excluded.openai_base_url,
      openai_model = excluded.openai_model,
      openrouter_api_key = excluded.openrouter_api_key,
      openrouter_base_url = excluded.openrouter_base_url,
      openrouter_model = excluded.openrouter_model,
      claude_api_key = excluded.claude_api_key,
      claude_base_url = excluded.claude_base_url,
      claude_model = excluded.claude_model,
      temperature = excluded.temperature,
      max_tokens = excluded.max_tokens,
      updated_at = excluded.updated_at
  `).run(
    config.active_provider || null,
    config.openai_api_key || null,
    config.openai_base_url || null,
    config.openai_model || null,
    config.openrouter_api_key || null,
    config.openrouter_base_url || null,
    config.openrouter_model || null,
    config.claude_api_key || null,
    config.claude_base_url || null,
    config.claude_model || null,
    Number.isFinite(config.temperature) ? config.temperature : 0.7,
    Number.isFinite(config.max_tokens) ? config.max_tokens : 1024,
    now
  );
}

export function getActiveExecutionForProfile(db, profileId) {
  return db.prepare(`
    SELECT execution_id, profile_id, status, started_at, ended_at, rows_total, rows_completed, rows_failed, log_path
    FROM profile_executions
    WHERE profile_id = ? AND status = 'running'
    ORDER BY started_at DESC
    LIMIT 1
  `).get(profileId);
}
