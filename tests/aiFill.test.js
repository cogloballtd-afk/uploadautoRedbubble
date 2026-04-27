import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import { createDatabase, seedSystemConfig, upsertProfiles } from "../src/db.js";
import { createAppService } from "../src/services.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ai-fill-test-"));
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

function writeTemplate(excelPath, dataRows) {
  const workbook = XLSX.utils.book_new();
  const rows = [
    ["TT", "Title", "Main Tag", "Supporting Tags", "Description", "Image path", "color", "status", "status_detail", "executed_at"],
    ...dataRows
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  XLSX.writeFile(workbook, excelPath);
}

function readTemplate(excelPath) {
  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

function makeService(root, folder) {
  const db = createDatabase(path.join(root, "app.sqlite"));
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

  service.saveAiSettings({
    activeProvider: "openai",
    temperature: 0.2,
    maxTokens: 256,
    openai: { apiKey: "sk-test", baseUrl: "https://api.test/v1", model: "gpt-4o-mini" },
    openrouter: { apiKey: "", baseUrl: "", model: "" },
    claude: { apiKey: "", baseUrl: "", model: "" }
  });

  return service;
}

test("service.aiFillRow analyzes Title and updates Main Tag, Supporting Tags, Description", async () => {
  const root = makeTempDir();
  const folder = path.join(root, "profile");
  fs.mkdirSync(folder, { recursive: true });
  const excelPath = path.join(folder, "input.xlsx");
  writeTemplate(excelPath, [
    [1, "Cute Frog Birthday", "", "", "", "C:\\frog.png", "", "", "", ""]
  ]);

  const service = makeService(root, folder);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({
        model: "gpt-4o-mini",
        choices: [
          {
            message: {
              content: '{"mainTag":"frog birthday","supportingTags":"cute frog, frog party, birthday gift","description":"A cute frog birthday design for party lovers."}'
            }
          }
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      })
    };
  };

  const result = await service.aiFillRow("p1", 2, { fetchImpl });
  assert.equal(result.skipped, false);
  assert.equal(result.mainTag, "frog birthday");
  assert.equal(result.supportingTags, "cute frog, frog party, birthday gift");
  assert.equal(result.description, "A cute frog birthday design for party lovers.");

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, "gpt-4o-mini");
  assert.match(body.messages[1].content, /Cute Frog Birthday/);
  assert.match(body.messages[1].content, /cot C, D, E/);

  const rows = readTemplate(excelPath);
  assert.equal(rows[0]["Main Tag"], "frog birthday");
  assert.equal(rows[0]["Supporting Tags"], "cute frog, frog party, birthday gift");
  assert.equal(rows[0].Description, "A cute frog birthday design for party lovers.");
});

test("service.aiFillAllRows fills only eligible rows and reports failed/skipped counts", async () => {
  const root = makeTempDir();
  const folder = path.join(root, "profile");
  fs.mkdirSync(folder, { recursive: true });
  const excelPath = path.join(folder, "input.xlsx");
  writeTemplate(excelPath, [
    [1, "Retro Cat Mom", "", "", "", "C:\\cat.png", "", "", "", ""],
    [2, "Already Filled", "main", "support", "desc", "C:\\done.png", "", "", "", ""],
    [3, "", "", "", "", "C:\\empty-title.png", "", "", "", ""],
    [4, "Failing Row", "", "", "", "C:\\fail.png", "", "", "", ""]
  ]);

  const service = makeService(root, folder);
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.messages[1].content;
    if (prompt.includes("Failing Row")) {
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          model: "gpt-4o-mini",
          choices: [{ message: { content: "not-json" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        })
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({
        model: "gpt-4o-mini",
        choices: [
          {
            message: {
              content: '{"mainTag":"retro cat","supportingTags":"cat mom, vintage cat, cat lover","description":"A retro cat design for proud cat moms."}'
            }
          }
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      })
    };
  };

  const summary = await service.aiFillAllRows("p1", { delayMs: 0, fetchImpl });
  assert.equal(summary.total, 2);
  assert.equal(summary.filled, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.skipped, 0);
  assert.equal(summary.results[0].ok, true);
  assert.equal(summary.results[1].ok, false);
  assert.match(summary.results[1].error, /parseable JSON/);

  const rows = readTemplate(excelPath);
  assert.equal(rows[0]["Main Tag"], "retro cat");
  assert.equal(rows[1]["Main Tag"], "main");
  assert.equal(rows[3]["Main Tag"], "");
});
