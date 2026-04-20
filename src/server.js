import fs from "node:fs";
import express from "express";
import { getConfig } from "./config.js";
import { createDatabase, seedSystemConfig } from "./db.js";
import { GpmClient } from "./gpmClient.js";
import { renderDashboardPage, renderRunPage } from "./html.js";
import { createAppService } from "./services.js";

export function createServer({ config = getConfig(), gpmClient } = {}) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.logDir, { recursive: true });
  fs.mkdirSync(config.artifactsDir, { recursive: true });

  const db = createDatabase(config.dbPath);
  seedSystemConfig(db, config);

  const service = createAppService({
    db,
    gpmClient: gpmClient || new GpmClient({ baseUrl: config.gpmApiBaseUrl }),
    config
  });

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.send(renderDashboardPage({
      profiles: service.getDashboardProfiles(),
      runs: service.getRunList(),
      config
    }));
  });

  app.post("/sync", async (_req, res, next) => {
    try {
      await service.syncProfiles();
      res.redirect("/");
    } catch (error) {
      next(error);
    }
  });

  app.post("/profiles/:profileId/binding", (req, res) => {
    service.saveProfileBinding({
      profileId: req.params.profileId,
      enabled: req.body.enabled === "1",
      folderPath: req.body.folderPath?.trim(),
      displayOrder: Number(req.body.displayOrder || 0)
    });
    res.redirect("/");
  });

  app.post("/runs", async (req, res, next) => {
    try {
      const { runId } = await service.startOpenProfilesRun(req.body.maxConcurrency);
      res.redirect(`/runs/${encodeURIComponent(runId)}`);
    } catch (error) {
      next(error);
    }
  });

  app.get("/runs/:runId", (req, res) => {
    res.send(renderRunPage({
      run: service.getRunStatus(req.params.runId)
    }));
  });

  app.post("/runs/:runId/stop", (req, res) => {
    service.stopRun(req.params.runId);
    res.redirect(`/runs/${encodeURIComponent(req.params.runId)}`);
  });

  app.get("/api/dashboard/profiles", (_req, res) => {
    res.json(service.getDashboardProfiles());
  });

  app.get("/api/runs/:runId", (req, res) => {
    const run = service.getRunStatus(req.params.runId);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json(run);
  });

  app.use((error, _req, res, _next) => {
    res.status(500).send(`
      <section style="font-family: sans-serif; padding: 24px">
        <h1>Server Error</h1>
        <pre>${String(error.stack || error.message || error)}</pre>
      </section>
    `);
  });

  return { app, service, db, config };
}

const isMainModule = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href;

if (isMainModule) {
  const { app, config } = createServer();
  app.listen(config.port, () => {
    console.log(`Dashboard listening on http://localhost:${config.port}`);
  });
}

