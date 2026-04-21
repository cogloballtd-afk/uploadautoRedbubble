import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import { createServer } from "../src/server.js";

function makeConfig(root) {
  return {
    port: 0,
    gpmApiBaseUrl: "http://127.0.0.1:19995",
    excelFilenameStandard: "input.xlsx",
    dataDir: path.join(root, "data"),
    dbPath: path.join(root, "data", "app.sqlite"),
    logDir: path.join(root, "logs"),
    artifactsDir: path.join(root, "artifacts")
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

async function waitFor(assertion, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      return await assertion();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  return assertion();
}

test("per-profile run endpoint starts execution and exposes profile detail", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gpm-server-profile-"));
  const config = makeConfig(root);
  const validFolder = path.join(root, "folder-ok");
  fs.mkdirSync(validFolder, { recursive: true });
  makeExcelFile(path.join(validFolder, "input.xlsx"), [
    ["row 1", "C:\\file1.png", "", "", ""]
  ]);

  const gpmClient = {
    listProfiles: async () => [
      { id: "p1", name: "Alpha", group_id: "g1", browser_type: "chromium", browser_version: "119" }
    ],
    startProfile: async (profileId) => ({
      profileId,
      browserLocation: "C:\\browser.exe",
      remoteDebuggingAddress: "127.0.0.1:9333",
      driverPath: "C:\\driver.exe"
    }),
    closeProfile: async () => ({ success: true })
  };

  const browserClient = {
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
  };

  const { app } = createServer({ config, gpmClient, browserClient });
  const server = app.listen(0);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const syncResponse = await fetch(`${baseUrl}/sync`, { method: "POST", redirect: "manual" });
    assert.equal(syncResponse.status, 302);

    const saveForm = new URLSearchParams({
      enabled: "1",
      folderPath: validFolder,
      displayOrder: "1",
      fieldDelayMinSeconds: "0",
      fieldDelayMaxSeconds: "0",
      rowIntervalMinMinutes: "0",
      rowIntervalMaxMinutes: "0"
    });
    const saveResponse = await fetch(`${baseUrl}/profiles/p1/settings`, {
      method: "POST",
      body: saveForm,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual"
    });
    assert.equal(saveResponse.status, 302);

    const runResponse = await fetch(`${baseUrl}/profiles/p1/run`, {
      method: "POST",
      redirect: "manual"
    });
    assert.equal(runResponse.status, 302);
    const location = runResponse.headers.get("location");
    assert.ok(location);

    await waitFor(async () => {
      const profileResponse = await fetch(`${baseUrl}/api/profiles/p1`);
      const detail = await profileResponse.json();
      assert.equal(detail.profile.last_run_status, "awaiting_automation");
      assert.equal(detail.executions[0].status, "awaiting_automation");
      return detail;
    });

    const profilePage = await fetch(`${baseUrl}/profiles/p1`);
    const html = await profilePage.text();
    assert.match(html, /Execution History/);
    assert.match(html, /Alpha/);
    assert.match(html, /awaiting_automation/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("dashboard profile API supports search and selected-only view with new settings route", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gpm-server-filter-"));
  const config = makeConfig(root);
  const alphaFolder = path.join(root, "folder-alpha");
  fs.mkdirSync(alphaFolder, { recursive: true });
  makeExcelFile(path.join(alphaFolder, "input.xlsx"), [
    ["row 1", "C:\\file1.png", "", "", ""]
  ]);

  const gpmClient = {
    listProfiles: async () => [
      { id: "p1", name: "Alpha Shop", group_id: "g1", browser_type: "chromium", browser_version: "119" },
      { id: "p2", name: "Beta Store", group_id: "g1", browser_type: "chromium", browser_version: "119" }
    ]
  };

  const { app } = createServer({ config, gpmClient, browserClient: {} });
  const server = app.listen(0);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fetch(`${baseUrl}/sync`, { method: "POST", redirect: "manual" });

    const saveAlpha = new URLSearchParams({
      enabled: "1",
      folderPath: alphaFolder,
      displayOrder: "1",
      fieldDelayMinSeconds: "0",
      fieldDelayMaxSeconds: "0",
      rowIntervalMinMinutes: "0",
      rowIntervalMaxMinutes: "0"
    });
    await fetch(`${baseUrl}/profiles/p1/settings`, {
      method: "POST",
      body: saveAlpha,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual"
    });

    const searchResponse = await fetch(`${baseUrl}/api/dashboard/profiles?q=alpha`);
    const searchProfiles = await searchResponse.json();
    assert.equal(searchProfiles.length, 1);
    assert.equal(searchProfiles[0].profile_name, "Alpha Shop");

    const selectedResponse = await fetch(`${baseUrl}/api/dashboard/profiles?view=selected`);
    const selectedProfiles = await selectedResponse.json();
    assert.equal(selectedProfiles.length, 1);
    assert.equal(selectedProfiles[0].profile_id, "p1");

    const pageResponse = await fetch(`${baseUrl}/?view=selected&q=alpha`);
    const pageHtml = await pageResponse.text();
    assert.match(pageHtml, /Selected Profiles/);
    assert.match(pageHtml, /Search by profile name/);
    assert.match(pageHtml, /Alpha Shop/);
    assert.doesNotMatch(pageHtml, /Beta Store/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("profile page exposes delete action for execution history and endpoint removes it", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gpm-server-delete-history-"));
  const config = makeConfig(root);
  const validFolder = path.join(root, "folder-delete");
  fs.mkdirSync(validFolder, { recursive: true });
  makeExcelFile(path.join(validFolder, "input.xlsx"), [
    ["row 1", "C:\\file1.png", "", "", ""]
  ]);

  const gpmClient = {
    listProfiles: async () => [
      { id: "p1", name: "Alpha", group_id: "g1", browser_type: "chromium", browser_version: "119" }
    ],
    startProfile: async (profileId) => ({
      profileId,
      browserLocation: "C:\\browser.exe",
      remoteDebuggingAddress: "127.0.0.1:9333",
      driverPath: "C:\\driver.exe"
    }),
    closeProfile: async () => ({ success: true })
  };

  const browserClient = {
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
  };

  const { app } = createServer({ config, gpmClient, browserClient });
  const server = app.listen(0);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fetch(`${baseUrl}/sync`, { method: "POST", redirect: "manual" });

    const saveForm = new URLSearchParams({
      enabled: "1",
      folderPath: validFolder,
      displayOrder: "1",
      fieldDelayMinSeconds: "0",
      fieldDelayMaxSeconds: "0",
      rowIntervalMinMinutes: "0",
      rowIntervalMaxMinutes: "0"
    });
    await fetch(`${baseUrl}/profiles/p1/settings`, {
      method: "POST",
      body: saveForm,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual"
    });

    const runResponse = await fetch(`${baseUrl}/profiles/p1/run`, {
      method: "POST",
      redirect: "manual"
    });
    const location = runResponse.headers.get("location");
    const executionId = new URL(`http://127.0.0.1${location}`).searchParams.get("executionId");
    assert.ok(executionId);

    await waitFor(async () => {
      const profileResponse = await fetch(`${baseUrl}/api/profiles/p1`);
      const detail = await profileResponse.json();
      assert.equal(detail.executions[0].status, "awaiting_automation");
      return detail;
    });

    const profilePage = await fetch(`${baseUrl}/profiles/p1`);
    const html = await profilePage.text();
    assert.match(html, /Delete/);
    assert.match(html, /executions\/.*\/delete/);

    const deleteResponse = await fetch(`${baseUrl}/profiles/p1/executions/${encodeURIComponent(executionId)}/delete`, {
      method: "POST",
      redirect: "manual"
    });
    assert.equal(deleteResponse.status, 302);

    const profileResponseAfterDelete = await fetch(`${baseUrl}/api/profiles/p1`);
    const detailAfterDelete = await profileResponseAfterDelete.json();
    assert.equal(detailAfterDelete.executions.length, 0);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("admin settings persist to DB and override environment defaults on restart", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gpm-admin-settings-"));
  const config = makeConfig(root);

  const { app } = createServer({
    config: {
      ...config,
      gpmApiBaseUrl: "http://env-default:19995",
      excelFilenameStandard: "env.xlsx",
      logDir: path.join(root, "env-logs"),
      artifactsDir: path.join(root, "env-artifacts")
    },
    gpmClient: {
      listProfiles: async () => []
    },
    browserClient: {}
  });

  const server = app.listen(0);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const settingsForm = new URLSearchParams({
      gpmApiBaseUrl: "http://stored-config:18888",
      excelFilenameStandard: "stored.xlsx",
      logDir: path.join(root, "stored-logs"),
      artifactsDir: path.join(root, "stored-artifacts")
    });

    const saveResponse = await fetch(`${baseUrl}/admin/settings`, {
      method: "POST",
      body: settingsForm,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual"
    });
    assert.equal(saveResponse.status, 302);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  const restarted = createServer({
    config: {
      ...config,
      gpmApiBaseUrl: "http://different-env:19995",
      excelFilenameStandard: "different-env.xlsx",
      logDir: path.join(root, "different-env-logs"),
      artifactsDir: path.join(root, "different-env-artifacts")
    },
    gpmClient: {
      listProfiles: async () => []
    },
    browserClient: {}
  });

  assert.equal(restarted.config.gpmApiBaseUrl, "http://stored-config:18888");
  assert.equal(restarted.config.excelFilenameStandard, "stored.xlsx");
  assert.equal(restarted.config.logDir, path.join(root, "stored-logs"));
  assert.equal(restarted.config.artifactsDir, path.join(root, "stored-artifacts"));
});
