import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, seedSystemConfig, upsertProfiles } from "../src/db.js";
import { createAppService } from "../src/services.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gpm-phase1-"));
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
    config: {},
    gpmClient: {
      listProfiles: async () => [makeProfile("p1", "Alpha"), makeProfile("p2", "Beta")]
    }
  });

  const profiles = await service.syncProfiles();
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0].profile_name, "Alpha");
});

test("startOpenProfilesRun skips invalid folder config and opens valid profiles", async () => {
  const root = makeTempDir();
  const db = createDatabase(path.join(root, "app.sqlite"));
  const validFolder = path.join(root, "folder-ok");
  const invalidFolder = path.join(root, "folder-bad");
  fs.mkdirSync(validFolder, { recursive: true });
  fs.writeFileSync(path.join(validFolder, "input.xlsx"), "");

  seedSystemConfig(db, {
    gpmApiBaseUrl: "http://127.0.0.1:19995",
    excelFilenameStandard: "input.xlsx",
    logDir: path.join(root, "logs"),
    artifactsDir: path.join(root, "artifacts")
  });
  upsertProfiles(db, [makeProfile("p1", "Alpha"), makeProfile("p2", "Beta")]);
  db.prepare(`
    UPDATE profile_bindings
    SET enabled = 1,
        folder_path = CASE profile_id WHEN 'p1' THEN ? ELSE ? END,
        display_order = CASE profile_id WHEN 'p1' THEN 1 ELSE 2 END
  `).run(validFolder, invalidFolder);

  const opened = [];
  const service = createAppService({
    db,
    config: {},
    gpmClient: {
      startProfile: async (profileId) => {
        opened.push(profileId);
        return {
          profileId,
          browserLocation: "C:\\browser.exe",
          remoteDebuggingAddress: "127.0.0.1:9333",
          driverPath: "C:\\driver.exe"
        };
      }
    }
  });

  const { runId } = await service.startOpenProfilesRun(2);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const run = service.getRunStatus(runId);

  assert.deepEqual(opened, ["p1"]);
  assert.equal(run.status, "completed_with_errors");
  assert.equal(run.items.length, 2);
  assert.equal(run.items[0].status, "opened");
  assert.equal(run.items[1].status, "skipped_invalid_config");
  assert.equal(run.sessions.length, 1);
});

