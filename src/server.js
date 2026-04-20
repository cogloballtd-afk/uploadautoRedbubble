import fs from "node:fs";
import express from "express";
import { getDefaultConfig, mergeConfig } from "./config.js";
import { createDatabase, getSystemConfig, seedSystemConfig } from "./db.js";
import { GpmClient } from "./gpmClient.js";
import { renderAdminSettingsPage, renderDashboardPage, renderProfilePage } from "./html.js";
import { createAppService } from "./services.js";

export function createServer({ config = getDefaultConfig(), gpmClient, browserClient } = {}) {
  fs.mkdirSync(config.dataDir, { recursive: true });

  const db = createDatabase(config.dbPath);
  const storedConfig = getSystemConfig(db);
  const effectiveConfig = mergeConfig(config, storedConfig);
  fs.mkdirSync(effectiveConfig.logDir, { recursive: true });
  fs.mkdirSync(effectiveConfig.artifactsDir, { recursive: true });
  if (!storedConfig) {
    seedSystemConfig(db, effectiveConfig);
  }

  const service = createAppService({
    db,
    gpmClient: gpmClient || new GpmClient({ baseUrl: effectiveConfig.gpmApiBaseUrl }),
    browserClient,
    config: effectiveConfig
  });

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  function applyDashboardFilters(profiles, query) {
    const q = typeof query.q === "string" ? query.q.trim().toLowerCase() : "";
    const view = query.view === "selected" ? "selected" : "all";

    return profiles.filter((profile) => {
      if (view === "selected" && !profile.enabled) {
        return false;
      }
      if (!q) {
        return true;
      }
      return profile.profile_name.toLowerCase().includes(q);
    });
  }

  app.get("/", (req, res) => {
    const profiles = applyDashboardFilters(service.getDashboardProfiles(), req.query);
    res.send(renderDashboardPage({
      profiles,
      config: effectiveConfig,
      filters: {
        q: typeof req.query.q === "string" ? req.query.q : "",
        view: req.query.view === "selected" ? "selected" : "all"
      }
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

  app.get("/admin/settings", (_req, res) => {
    res.send(renderAdminSettingsPage({
      settings: service.getAdminSettings()
    }));
  });

  app.post("/admin/settings", (req, res) => {
    service.saveAdminSettings({
      gpmApiBaseUrl: req.body.gpmApiBaseUrl?.trim(),
      excelFilenameStandard: req.body.excelFilenameStandard?.trim(),
      logDir: req.body.logDir?.trim(),
      artifactsDir: req.body.artifactsDir?.trim()
    });
    fs.mkdirSync(service.config.logDir, { recursive: true });
    fs.mkdirSync(service.config.artifactsDir, { recursive: true });
    res.redirect("/admin/settings");
  });

  app.post("/profiles/:profileId/settings", (req, res) => {
    service.saveProfileSettings({
      profileId: req.params.profileId,
      enabled: req.body.enabled === "1",
      folderPath: req.body.folderPath?.trim(),
      displayOrder: Number(req.body.displayOrder || 0),
      fieldDelayMinSeconds: Number(req.body.fieldDelayMinSeconds || 1),
      fieldDelayMaxSeconds: Number(req.body.fieldDelayMaxSeconds || 1),
      rowIntervalMinMinutes: Number(req.body.rowIntervalMinMinutes || 1),
      rowIntervalMaxMinutes: Number(req.body.rowIntervalMaxMinutes || 1)
    });
    res.redirect("/");
  });

  app.post("/profiles/:profileId/run", async (req, res, next) => {
    try {
      const { executionId } = await service.startProfileRun(req.params.profileId);
      res.redirect(`/profiles/${encodeURIComponent(req.params.profileId)}?executionId=${encodeURIComponent(executionId)}`);
    } catch (error) {
      next(error);
    }
  });

  app.post("/profiles/:profileId/pause", (req, res) => {
    service.pauseProfileRun(req.params.profileId);
    res.redirect(`/profiles/${encodeURIComponent(req.params.profileId)}`);
  });

  app.post("/profiles/:profileId/stop", (req, res) => {
    service.stopProfileRun(req.params.profileId);
    res.redirect(`/profiles/${encodeURIComponent(req.params.profileId)}`);
  });

  app.post("/profiles/:profileId/executions/:executionId/delete", (req, res) => {
    service.deleteExecution(req.params.profileId, req.params.executionId);
    res.redirect(`/profiles/${encodeURIComponent(req.params.profileId)}`);
  });

  app.get("/profiles/:profileId", (req, res) => {
    const detail = service.getProfileDetail(req.params.profileId);
    const selectedExecution = typeof req.query.executionId === "string"
      ? service.getExecution(req.query.executionId)
      : detail?.activeExecution || null;
    res.send(renderProfilePage({
      detail,
      selectedExecution
    }));
  });

  app.get("/api/dashboard/profiles", (req, res) => {
    const profiles = applyDashboardFilters(service.getDashboardProfiles(), req.query);
    res.json(profiles);
  });

  app.get("/api/profiles/:profileId", (req, res) => {
    const detail = service.getProfileDetail(req.params.profileId);
    if (!detail) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    res.json(detail);
  });

  app.use((error, _req, res, _next) => {
    res.status(500).send(`
      <section style="font-family: sans-serif; padding: 24px">
        <h1>Server Error</h1>
        <pre>${String(error.stack || error.message || error)}</pre>
      </section>
    `);
  });

  return { app, service, db, config: effectiveConfig };
}

const isMainModule = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href;

if (isMainModule) {
  const { app, config } = createServer();
  app.listen(config.port, () => {
    console.log(`Dashboard listening on http://localhost:${config.port}`);
  });
}
