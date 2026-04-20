import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import { createDatabase, seedSystemConfig, upsertProfiles } from "../src/db.js";
import { createAppService } from "../src/services.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gpm-profile-runner-"));
}

function makeProfile(id, name) {
  return {
    id,
    name,
    group_id: "group-1",
    browser_type: "chromium",
    browser_version: "119"
  };
}

function makeExcelFile(excelPath, dataRows) {
  const workbook = XLSX.utils.book_new();
  const rows = [
    ["title", "file_path", "status", "status_detail", "executed_at"],
    ...dataRows
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  XLSX.writeFile(workbook, excelPath);
}

function readSheetRows(excelPath) {
  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

async function waitFor(assertion, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      return assertion();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  return assertion();
}

test("syncProfiles stores fetched profiles in the dashboard cache", async () => {
  const root = makeTempDir();
  const db = createDatabase(path.join(root, "app.sqlite"));
  seedSystemConfig(db, {
    gpmApiBaseUrl: "http://127.0.0.1:19995",
    excelFilenameStandard: "input.xlsx",
    logDir: path.join(root, "logs"),
    artifactsDir: path.join(root, "artifacts")
  });

  const service = createAppService({
    db,
    config: { artifactsDir: path.join(root, "artifacts") },
    gpmClient: {
      listProfiles: async () => [makeProfile("p1", "Alpha"), makeProfile("p2", "Beta")]
    },
    browserClient: {}
  });

  const profiles = await service.syncProfiles();
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0].profile_name, "Alpha");
});

test("startProfileRun processes all pending Excel rows, updates status, and closes profile", async () => {
  const root = makeTempDir();
  const db = createDatabase(path.join(root, "app.sqlite"));
  const folder = path.join(root, "profile-a");
  fs.mkdirSync(folder, { recursive: true });
  const excelPath = path.join(folder, "input.xlsx");
  makeExcelFile(excelPath, [
    ["row 1", "C:\\file1.png", "", "", ""],
    ["row 2", "C:\\file2.png", "", "", ""]
  ]);

  seedSystemConfig(db, {
    gpmApiBaseUrl: "http://127.0.0.1:19995",
    excelFilenameStandard: "input.xlsx",
    logDir: path.join(root, "logs"),
    artifactsDir: path.join(root, "artifacts")
  });

  upsertProfiles(db, [makeProfile("p1", "Alpha")]);
  const service = createAppService({
    db,
    config: { artifactsDir: path.join(root, "artifacts") },
    gpmClient: {
      startProfile: async (profileId) => ({
        profileId,
        browserLocation: "C:\\browser.exe",
        remoteDebuggingAddress: "127.0.0.1:9333",
        driverPath: "C:\\driver.exe"
      }),
      closeProfile: async () => ({ success: true })
    },
    browserClient: {
      attachToSession: async () => ({
        pageUrl: "https://example.test",
        pageTitle: "Attached"
      }),
      processRow: async ({ row }) => ({
        status: "ok",
        statusDetail: `processed row ${row.rowNumber}`
      }),
      closeAttachment: async () => undefined,
      captureErrorScreenshot: async () => null
    }
  });

  service.saveProfileSettings({
    profileId: "p1",
    enabled: true,
    folderPath: folder,
    displayOrder: 1,
    fieldDelayMinSeconds: 0,
    fieldDelayMaxSeconds: 0,
    rowIntervalMinMinutes: 0,
    rowIntervalMaxMinutes: 0
  });

  const { executionId } = await service.startProfileRun("p1");
  await waitFor(() => {
    const detail = service.getProfileDetail("p1");
    assert.equal(detail.profile.runtime_status, "idle");
    assert.equal(detail.profile.last_run_status, "completed");
    return detail;
  });

  const execution = service.getExecution(executionId);
  assert.equal(execution.status, "completed");
  assert.equal(execution.rows_completed, 2);
  assert.equal(execution.rows_failed, 0);
  assert.equal(execution.session.session_status, "closed");

  const rows = readSheetRows(excelPath);
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[1].status, "ok");
});

test("pauseProfileRun waits for the current row, then resumes from the next pending row", async () => {
  const root = makeTempDir();
  const db = createDatabase(path.join(root, "app.sqlite"));
  const folder = path.join(root, "profile-b");
  fs.mkdirSync(folder, { recursive: true });
  const excelPath = path.join(folder, "input.xlsx");
  makeExcelFile(excelPath, [
    ["row 1", "C:\\file1.png", "", "", ""],
    ["row 2", "C:\\file2.png", "", "", ""]
  ]);

  seedSystemConfig(db, {
    gpmApiBaseUrl: "http://127.0.0.1:19995",
    excelFilenameStandard: "input.xlsx",
    logDir: path.join(root, "logs"),
    artifactsDir: path.join(root, "artifacts")
  });

  upsertProfiles(db, [makeProfile("p2", "Beta")]);
  const service = createAppService({
    db,
    config: { artifactsDir: path.join(root, "artifacts") },
    gpmClient: {
      startProfile: async (profileId) => ({
        profileId,
        browserLocation: "C:\\browser.exe",
        remoteDebuggingAddress: "127.0.0.1:9444",
        driverPath: "C:\\driver.exe"
      }),
      closeProfile: async () => ({ success: true })
    },
    browserClient: {
      attachToSession: async () => ({
        pageUrl: "https://example.test",
        pageTitle: "Attached"
      }),
      processRow: async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return {
          status: "ok",
          statusDetail: "done"
        };
      },
      closeAttachment: async () => undefined,
      captureErrorScreenshot: async () => null
    }
  });

  service.saveProfileSettings({
    profileId: "p2",
    enabled: true,
    folderPath: folder,
    displayOrder: 1,
    fieldDelayMinSeconds: 0,
    fieldDelayMaxSeconds: 0,
    rowIntervalMinMinutes: 0,
    rowIntervalMaxMinutes: 0
  });

  await service.startProfileRun("p2");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(service.pauseProfileRun("p2"), true);

  await waitFor(() => {
    const detail = service.getProfileDetail("p2");
    assert.equal(detail.profile.runtime_status, "paused");
    assert.equal(detail.profile.last_run_status, "paused");
    return detail;
  });

  let rows = readSheetRows(excelPath);
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[1].status, "");

  const detailAfterPause = service.getProfileDetail("p2");
  const pausedExecution = detailAfterPause.executions[0];
  assert.equal(pausedExecution.status, "paused");
  assert.equal(pausedExecution.rows_completed, 1);

  const resumed = await service.startProfileRun("p2");
  await waitFor(() => {
    const detail = service.getProfileDetail("p2");
    assert.equal(detail.profile.runtime_status, "idle");
    assert.equal(detail.profile.last_run_status, "completed");
    return detail;
  });

  const resumedExecution = service.getExecution(resumed.executionId);
  assert.equal(resumedExecution.status, "completed");
  assert.equal(resumedExecution.rows_completed, 1);

  rows = readSheetRows(excelPath);
  assert.equal(rows[1].status, "ok");
});

test("saveProfileSettings normalizes min max ranges for delays", async () => {
  const root = makeTempDir();
  const db = createDatabase(path.join(root, "app.sqlite"));
  seedSystemConfig(db, {
    gpmApiBaseUrl: "http://127.0.0.1:19995",
    excelFilenameStandard: "input.xlsx",
    logDir: path.join(root, "logs"),
    artifactsDir: path.join(root, "artifacts")
  });
  upsertProfiles(db, [makeProfile("p3", "Gamma")]);

  const service = createAppService({
    db,
    config: { artifactsDir: path.join(root, "artifacts") },
    gpmClient: {
      listProfiles: async () => []
    },
    browserClient: {}
  });

  service.saveProfileSettings({
    profileId: "p3",
    enabled: true,
    folderPath: path.join(root, "folder"),
    displayOrder: 3,
    fieldDelayMinSeconds: 10,
    fieldDelayMaxSeconds: 2,
    rowIntervalMinMinutes: 12,
    rowIntervalMaxMinutes: 3
  });

  const detail = service.getProfileDetail("p3");
  assert.equal(detail.profile.field_delay_min_seconds, 2);
  assert.equal(detail.profile.field_delay_max_seconds, 10);
  assert.equal(detail.profile.row_interval_min_minutes, 3);
  assert.equal(detail.profile.row_interval_max_minutes, 12);
});
