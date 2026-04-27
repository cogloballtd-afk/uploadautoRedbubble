import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import { buildExcelTemplate, listImageFiles } from "../src/excelTemplate.js";
import { createDatabase, seedSystemConfig, upsertProfiles } from "../src/db.js";
import { createAppService } from "../src/services.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "excel-template-test-"));
}

function touch(filePath) {
  fs.writeFileSync(filePath, "");
}

function readSheetAsRows(excelPath) {
  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

test("listImageFiles returns only .png files sorted alphabetically", () => {
  const folder = makeTempDir();
  touch(path.join(folder, "Zebra.png"));
  touch(path.join(folder, "apple.png"));
  touch(path.join(folder, "Banana.png"));
  touch(path.join(folder, "ignored.jpg"));
  touch(path.join(folder, "ignored.txt"));
  fs.mkdirSync(path.join(folder, "subdir"));
  touch(path.join(folder, "subdir", "nested.png"));

  const files = listImageFiles(folder);
  assert.equal(files.length, 3);
  assert.deepEqual(
    files.map((f) => f.fileName),
    ["apple.png", "Banana.png", "Zebra.png"]
  );
  assert.equal(files[0].title, "apple");
  assert.equal(files[0].fullPath, path.join(folder, "apple.png"));
});

test("listImageFiles also accepts uppercase .PNG extension", () => {
  const folder = makeTempDir();
  touch(path.join(folder, "shouting.PNG"));
  touch(path.join(folder, "quiet.png"));

  const files = listImageFiles(folder);
  assert.equal(files.length, 2);
});

test("listImageFiles throws when folder does not exist", () => {
  assert.throws(() => listImageFiles(path.join(os.tmpdir(), "definitely-not-a-real-folder-xyz")));
});

test("buildExcelTemplate writes Excel with Title and Image path filled, other columns empty", () => {
  const folder = makeTempDir();
  touch(path.join(folder, "design-one.png"));
  touch(path.join(folder, "design-two.png"));

  const excelPath = path.join(folder, "input.xlsx");
  const result = buildExcelTemplate({ folderPath: folder, excelPath });

  assert.equal(result.rowsAdded, 2);
  assert.equal(result.excelPath, excelPath);
  assert.ok(fs.existsSync(excelPath));

  const rows = readSheetAsRows(excelPath);
  assert.deepEqual(rows[0], [
    "TT",
    "Title",
    "Main Tag",
    "Supporting Tags",
    "Description",
    "Image path",
    "color",
    "status",
    "status_detail",
    "executed_at"
  ]);

  assert.equal(rows[1][0], 1);
  assert.equal(rows[1][1], "design-one");
  assert.equal(rows[1][5], path.join(folder, "design-one.png"));
  assert.equal(rows[1][2], "");
  assert.equal(rows[1][6], "");

  assert.equal(rows[2][0], 2);
  assert.equal(rows[2][1], "design-two");
  assert.equal(rows[2][5], path.join(folder, "design-two.png"));
});

test("buildExcelTemplate overwrites existing Excel file", () => {
  const folder = makeTempDir();
  touch(path.join(folder, "fresh.png"));

  const excelPath = path.join(folder, "input.xlsx");
  fs.writeFileSync(excelPath, "garbage that is not a workbook");

  const result = buildExcelTemplate({ folderPath: folder, excelPath });
  assert.equal(result.rowsAdded, 1);

  const rows = readSheetAsRows(excelPath);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 1);
  assert.equal(rows[1][1], "fresh");
});

test("buildExcelTemplate produces empty data section when folder has no PNGs", () => {
  const folder = makeTempDir();
  touch(path.join(folder, "not-an-image.txt"));
  const excelPath = path.join(folder, "input.xlsx");

  const result = buildExcelTemplate({ folderPath: folder, excelPath });
  assert.equal(result.rowsAdded, 0);

  const rows = readSheetAsRows(excelPath);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], "TT");
  assert.equal(rows[0][1], "Title");
});

test("service.generateExcelTemplate writes input.xlsx into the profile folder", async () => {
  const root = makeTempDir();
  const folder = path.join(root, "profile-folder");
  fs.mkdirSync(folder, { recursive: true });
  touch(path.join(folder, "alpha.png"));
  touch(path.join(folder, "beta.png"));

  const db = createDatabase(path.join(root, "app.sqlite"));
  seedSystemConfig(db, {
    gpmApiBaseUrl: "http://127.0.0.1:19995",
    excelFilenameStandard: "input.xlsx",
    logDir: path.join(root, "logs"),
    artifactsDir: path.join(root, "artifacts")
  });
  upsertProfiles(db, [
    { id: "p1", name: "Alpha", group_id: "g1", browser_type: "chromium", browser_version: "119" }
  ]);

  const service = createAppService({
    db,
    config: { artifactsDir: path.join(root, "artifacts") },
    gpmClient: { listProfiles: async () => [] },
    browserClient: {}
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

  const result = service.generateExcelTemplate("p1");
  assert.equal(result.rowsAdded, 2);
  assert.equal(result.excelPath, path.join(folder, "input.xlsx"));
  assert.ok(fs.existsSync(result.excelPath));

  const rows = readSheetAsRows(result.excelPath);
  assert.equal(rows[1][0], 1);
  assert.equal(rows[1][1], "alpha");
  assert.equal(rows[1][5], path.join(folder, "alpha.png"));
});

test("service.generateExcelTemplateWithAi creates template then fills SEO columns", async () => {
  const root = makeTempDir();
  const folder = path.join(root, "profile-folder-ai");
  fs.mkdirSync(folder, { recursive: true });
  touch(path.join(folder, "alpha ghost.png"));
  touch(path.join(folder, "beta bat.png"));

  const db = createDatabase(path.join(root, "app.sqlite"));
  seedSystemConfig(db, {
    gpmApiBaseUrl: "http://127.0.0.1:19995",
    excelFilenameStandard: "input.xlsx",
    logDir: path.join(root, "logs"),
    artifactsDir: path.join(root, "artifacts")
  });
  upsertProfiles(db, [
    { id: "p9", name: "AI Alpha", group_id: "g1", browser_type: "chromium", browser_version: "119" }
  ]);

  const service = createAppService({
    db,
    config: { artifactsDir: path.join(root, "artifacts") },
    gpmClient: { listProfiles: async () => [] },
    browserClient: {}
  });

  service.saveProfileSettings({
    profileId: "p9",
    enabled: true,
    folderPath: folder,
    displayOrder: 1,
    fieldDelayMinSeconds: 0,
    fieldDelayMaxSeconds: 0,
    rowIntervalMinMinutes: 0,
    rowIntervalMaxMinutes: 0
  });

  service.saveAiSettings({
    activeProvider: "openai",
    temperature: 0.2,
    maxTokens: 256,
    openai: { apiKey: "sk-test", baseUrl: "https://api.test/v1", model: "gpt-4o-mini" },
    openrouter: { apiKey: "", baseUrl: "", model: "" },
    claude: { apiKey: "", baseUrl: "", model: "" }
  });

  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.messages[1].content;
    const content = prompt.includes("alpha ghost")
      ? '{"mainTag":"alpha ghost","supportingTags":"ghost art, halloween ghost","description":"Alpha ghost design."}'
      : '{"mainTag":"beta bat","supportingTags":"bat art, halloween bat","description":"Beta bat design."}';
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({
        model: "gpt-4o-mini",
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      })
    };
  };

  const result = await service.generateExcelTemplateWithAi("p9", { delayMs: 0, fetchImpl });
  assert.equal(result.rowsAdded, 2);
  assert.equal(result.aiSummary.total, 2);
  assert.equal(result.aiSummary.filled, 2);
  assert.equal(result.aiSummary.failed, 0);

  const rows = readSheetAsRows(result.excelPath);
  assert.equal(rows[1][2], "alpha ghost");
  assert.equal(rows[1][3], "ghost art, halloween ghost");
  assert.equal(rows[1][4], "Alpha ghost design.");
  assert.equal(rows[2][2], "beta bat");
  assert.equal(rows[2][3], "bat art, halloween bat");
  assert.equal(rows[2][4], "Beta bat design.");
});

test("service.generateExcelTemplate rejects profile without folder_path", () => {
  const root = makeTempDir();
  const db = createDatabase(path.join(root, "app.sqlite"));
  seedSystemConfig(db, {
    gpmApiBaseUrl: "http://127.0.0.1:19995",
    excelFilenameStandard: "input.xlsx",
    logDir: path.join(root, "logs"),
    artifactsDir: path.join(root, "artifacts")
  });
  upsertProfiles(db, [
    { id: "p2", name: "Beta", group_id: "g1", browser_type: "chromium", browser_version: "119" }
  ]);

  const service = createAppService({
    db,
    config: { artifactsDir: path.join(root, "artifacts") },
    gpmClient: { listProfiles: async () => [] },
    browserClient: {}
  });

  assert.throws(() => service.generateExcelTemplate("p2"), /folder/i);
});

test("service.previewExcelTemplate reports image count and excel existence", () => {
  const root = makeTempDir();
  const folder = path.join(root, "preview-folder");
  fs.mkdirSync(folder, { recursive: true });
  touch(path.join(folder, "one.png"));
  touch(path.join(folder, "two.png"));
  touch(path.join(folder, "three.png"));

  const db = createDatabase(path.join(root, "app.sqlite"));
  seedSystemConfig(db, {
    gpmApiBaseUrl: "http://127.0.0.1:19995",
    excelFilenameStandard: "input.xlsx",
    logDir: path.join(root, "logs"),
    artifactsDir: path.join(root, "artifacts")
  });
  upsertProfiles(db, [
    { id: "p3", name: "Gamma", group_id: "g1", browser_type: "chromium", browser_version: "119" }
  ]);

  const service = createAppService({
    db,
    config: { artifactsDir: path.join(root, "artifacts") },
    gpmClient: { listProfiles: async () => [] },
    browserClient: {}
  });

  service.saveProfileSettings({
    profileId: "p3",
    enabled: true,
    folderPath: folder,
    displayOrder: 1,
    fieldDelayMinSeconds: 0,
    fieldDelayMaxSeconds: 0,
    rowIntervalMinMinutes: 0,
    rowIntervalMaxMinutes: 0
  });

  let preview = service.previewExcelTemplate("p3");
  assert.equal(preview.imageCount, 3);
  assert.equal(preview.excelExists, false);

  service.generateExcelTemplate("p3");
  preview = service.previewExcelTemplate("p3");
  assert.equal(preview.excelExists, true);
});
