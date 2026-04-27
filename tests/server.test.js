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

    const profilePage = await fetch(`${baseUrl}/profiles/p1?tab=execution`);
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

    const profilePage = await fetch(`${baseUrl}/profiles/p1?tab=execution`);
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

test("template tab exposes per-row and bulk AI fill actions", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gpm-server-ai-template-"));
  const config = makeConfig(root);
  const validFolder = path.join(root, "folder-ai");
  fs.mkdirSync(validFolder, { recursive: true });

  const workbook = XLSX.utils.book_new();
  const rows = [
    ["TT", "Title", "Main Tag", "Supporting Tags", "Description", "Image path", "color", "status", "status_detail", "executed_at"],
    [1, "Cute Frog Birthday", "", "", "", "C:\\frog.png", "", "", "", ""]
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  XLSX.writeFile(workbook, path.join(validFolder, "input.xlsx"));

  const gpmClient = {
    listProfiles: async () => [
      { id: "p1", name: "Alpha", group_id: "g1", browser_type: "chromium", browser_version: "119" }
    ]
  };

  const { app } = createServer({ config, gpmClient, browserClient: {} });
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

    const pageResponse = await fetch(`${baseUrl}/profiles/p1?tab=template`);
    const html = await pageResponse.text();
    assert.match(html, /\/profiles\/p1\/excel\/ai-fill-all/);
    assert.match(html, /\/profiles\/p1\/excel\/rows\/2\/ai-fill/);
    assert.match(html, />AI</);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("generate-excel route creates template and auto-fills C D E", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gpm-server-generate-ai-"));
  const config = makeConfig(root);
  const validFolder = path.join(root, "folder-auto-ai");
  fs.mkdirSync(validFolder, { recursive: true });
  fs.writeFileSync(path.join(validFolder, "ghost party.png"), "");

  const gpmClient = {
    listProfiles: async () => [
      { id: "p1", name: "Alpha", group_id: "g1", browser_type: "chromium", browser_version: "119" }
    ]
  };

  const { app } = createServer({ config, gpmClient, browserClient: {} });
  const server = app.listen(0);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (typeof url === "string" && url === "https://api.test/v1/chat/completions") {
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          model: "gpt-4o-mini",
          choices: [
            {
              message: {
                content: '{"mainTag":"ghost party","supportingTags":"ghost art, halloween party","description":"Ghost party design."}'
              }
            }
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        })
      };
    }
    return originalFetch(url, options);
  };

  try {
    await fetch(`${baseUrl}/sync`, { method: "POST", redirect: "manual" });

    const saveSettings = new URLSearchParams({
      activeProvider: "openai",
      temperature: "0.2",
      maxTokens: "256",
      openai_api_key: "sk-test",
      openai_base_url: "https://api.test/v1",
      openai_model: "gpt-4o-mini",
      openrouter_api_key: "",
      openrouter_base_url: "",
      openrouter_model: "",
      claude_api_key: "",
      claude_base_url: "",
      claude_model: ""
    });
    await fetch(`${baseUrl}/admin/ai-settings`, {
      method: "POST",
      body: saveSettings,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual"
    });

    const saveProfile = new URLSearchParams({
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
      body: saveProfile,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual"
    });

    const response = await fetch(`${baseUrl}/profiles/p1/generate-excel?return=profile`, {
      method: "POST",
      redirect: "manual"
    });
    assert.equal(response.status, 302);

    const workbook = XLSX.readFile(path.join(validFolder, "input.xlsx"));
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    assert.equal(rows[0]["Main Tag"], "ghost party");
    assert.equal(rows[0]["Supporting Tags"], "ghost art, halloween party");
    assert.equal(rows[0]["Description"], "Ghost party design.");
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
