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
      display_order INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      last_status TEXT
    );

    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      max_concurrency INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS run_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      folder_path TEXT,
      excel_path TEXT,
      status TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      error_code TEXT,
      error_detail TEXT
    );

    CREATE TABLE IF NOT EXISTS opened_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      remote_debugging_address TEXT NOT NULL,
      browser_location TEXT,
      driver_path TEXT,
      created_at TEXT NOT NULL
    );
  `);

  return db;
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
  const ensureBinding = db.prepare(`
    INSERT INTO profile_bindings (profile_id, enabled, folder_path, display_order, last_run_at, last_status)
    VALUES (?, 0, NULL, ?, NULL, NULL)
    ON CONFLICT(profile_id) DO NOTHING
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
      ensureBinding.run(profile.id, index + 1);
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
      b.last_run_at,
      b.last_status
    FROM gpm_profiles_cache c
    LEFT JOIN profile_bindings b ON b.profile_id = c.profile_id
    ORDER BY COALESCE(b.display_order, 999999), c.profile_name
  `).all();
}

export function updateProfileBinding(db, { profileId, enabled, folderPath, displayOrder }) {
  const existing = db.prepare(`
    SELECT profile_id, enabled, folder_path, display_order
    FROM profile_bindings
    WHERE profile_id = ?
  `).get(profileId);

  if (!existing) {
    db.prepare(`
      INSERT INTO profile_bindings (profile_id, enabled, folder_path, display_order)
      VALUES (?, ?, ?, ?)
    `).run(profileId, enabled ? 1 : 0, folderPath || null, displayOrder || 0);
    return;
  }

  db.prepare(`
    UPDATE profile_bindings
    SET enabled = ?,
        folder_path = ?,
        display_order = ?
    WHERE profile_id = ?
  `).run(
    enabled ? 1 : 0,
    folderPath || null,
    Number.isFinite(displayOrder) ? displayOrder : existing.display_order,
    profileId
  );
}

export function createRun(db, { runId, maxConcurrency }) {
  const startedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO runs (run_id, status, max_concurrency, started_at)
    VALUES (?, 'running', ?, ?)
  `).run(runId, maxConcurrency, startedAt);
}

export function finishRun(db, { runId, status }) {
  db.prepare(`
    UPDATE runs
    SET status = ?, ended_at = ?
    WHERE run_id = ?
  `).run(status, new Date().toISOString(), runId);
}

export function setRunStopped(db, runId) {
  db.prepare(`
    UPDATE runs
    SET status = 'stopped', ended_at = ?
    WHERE run_id = ? AND status = 'running'
  `).run(new Date().toISOString(), runId);
}

export function addRunItem(db, item) {
  db.prepare(`
    INSERT INTO run_items (
      run_id,
      profile_id,
      folder_path,
      excel_path,
      status,
      started_at,
      ended_at,
      error_code,
      error_detail
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.runId,
    item.profileId,
    item.folderPath || null,
    item.excelPath || null,
    item.status,
    item.startedAt || null,
    item.endedAt || null,
    item.errorCode || null,
    item.errorDetail || null
  );
}

export function updateRunItem(db, item) {
  db.prepare(`
    UPDATE run_items
    SET status = ?,
        folder_path = ?,
        excel_path = ?,
        started_at = ?,
        ended_at = ?,
        error_code = ?,
        error_detail = ?
    WHERE run_id = ? AND profile_id = ?
  `).run(
    item.status,
    item.folderPath || null,
    item.excelPath || null,
    item.startedAt || null,
    item.endedAt || null,
    item.errorCode || null,
    item.errorDetail || null,
    item.runId,
    item.profileId
  );
}

export function addOpenedSession(db, session) {
  db.prepare(`
    INSERT INTO opened_sessions (
      run_id,
      profile_id,
      remote_debugging_address,
      browser_location,
      driver_path,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    session.runId,
    session.profileId,
    session.remoteDebuggingAddress,
    session.browserLocation || null,
    session.driverPath || null,
    new Date().toISOString()
  );
}

export function updateProfileRunState(db, { profileId, lastStatus }) {
  db.prepare(`
    UPDATE profile_bindings
    SET last_run_at = ?, last_status = ?
    WHERE profile_id = ?
  `).run(new Date().toISOString(), lastStatus, profileId);
}

export function getRun(db, runId) {
  const run = db.prepare(`
    SELECT run_id, status, max_concurrency, started_at, ended_at
    FROM runs
    WHERE run_id = ?
  `).get(runId);

  if (!run) {
    return null;
  }

  const items = db.prepare(`
    SELECT run_id, profile_id, folder_path, excel_path, status, started_at, ended_at, error_code, error_detail
    FROM run_items
    WHERE run_id = ?
    ORDER BY id
  `).all(runId);

  const sessions = db.prepare(`
    SELECT run_id, profile_id, remote_debugging_address, browser_location, driver_path, created_at
    FROM opened_sessions
    WHERE run_id = ?
    ORDER BY id
  `).all(runId);

  return {
    ...run,
    items,
    sessions
  };
}

export function listRuns(db) {
  return db.prepare(`
    SELECT run_id, status, max_concurrency, started_at, ended_at
    FROM runs
    ORDER BY started_at DESC
  `).all();
}

export function listEnabledProfilesForRun(db) {
  return db.prepare(`
    SELECT
      c.profile_id,
      c.profile_name,
      c.group_id,
      c.browser_type,
      c.browser_version,
      b.enabled,
      b.display_order,
      b.folder_path,
      b.last_run_at,
      b.last_status
    FROM gpm_profiles_cache c
    INNER JOIN profile_bindings b ON b.profile_id = c.profile_id
    WHERE b.enabled = 1
    ORDER BY b.display_order, c.profile_name
  `).all();
}
