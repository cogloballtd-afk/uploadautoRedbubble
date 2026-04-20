import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
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

test("dashboard endpoints expose synced profiles and run monitor data", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gpm-server-"));
  const config = makeConfig(root);
  const validFolder = path.join(root, "folder-ok");
  fs.mkdirSync(validFolder, { recursive: true });
  fs.writeFileSync(path.join(validFolder, "input.xlsx"), "");

  const gpmClient = {
    listProfiles: async () => [
      { id: "p1", name: "Alpha", group_id: "g1", browser_type: "chromium", browser_version: "119" }
    ],
    startProfile: async (profileId) => ({
      profileId,
      browserLocation: "C:\\browser.exe",
      remoteDebuggingAddress: "127.0.0.1:9333",
      driverPath: "C:\\driver.exe"
    })
  };

  const { app } = createServer({ config, gpmClient });
  const server = app.listen(0);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const syncResponse = await fetch(`${baseUrl}/sync`, { method: "POST", redirect: "manual" });
    assert.equal(syncResponse.status, 302);

    const profilesResponse = await fetch(`${baseUrl}/api/dashboard/profiles`);
    const profiles = await profilesResponse.json();
    assert.equal(profiles.length, 1);

    const form = new URLSearchParams({
      enabled: "1",
      folderPath: validFolder,
      displayOrder: "1"
    });
    const saveResponse = await fetch(`${baseUrl}/profiles/p1/binding`, {
      method: "POST",
      body: form,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual"
    });
    assert.equal(saveResponse.status, 302);

    const startForm = new URLSearchParams({ maxConcurrency: "1" });
    const runResponse = await fetch(`${baseUrl}/runs`, {
      method: "POST",
      body: startForm,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual"
    });
    assert.equal(runResponse.status, 302);
    const location = runResponse.headers.get("location");
    assert.ok(location);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const statusResponse = await fetch(`${baseUrl}/api${location}`);
    const run = await statusResponse.json();
    assert.equal(run.items[0].status, "opened");
    assert.equal(run.sessions[0].remote_debugging_address, "127.0.0.1:9333");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
