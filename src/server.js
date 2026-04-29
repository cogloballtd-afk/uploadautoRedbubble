import fs from "node:fs";
import express from "express";
import { getDefaultConfig, mergeConfig } from "./config.js";
import { createDatabase, getSystemConfig, seedSystemConfig } from "./db.js";
import { GpmClient } from "./gpmClient.js";
import { renderAdminSettingsPage, renderAiSettingsPage, renderDashboardPage, renderProfilePage, renderStatsPage, renderTemplatesPage } from "./html.js";
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
    const view = query.view === "all" ? "all" : "selected";

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
        view: req.query.view === "all" ? "all" : "selected"
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

  app.get("/stats", (req, res) => {
    const profiles = service.getDashboardProfiles().filter((p) => p.enabled);
    const latestByProfile = service.getPaymentStatsByProfile();
    const scrapeProgress = service.getPaymentScrapeProgress();
    const lastScrapeReport = service.getLastPaymentScrapeReport();
    let banner = null;
    if (scrapeProgress?.status === "running") {
      banner = null;
    } else if (lastScrapeReport?.status === "failed") {
      banner = { kind: "error", text: `Lá»—i scrape: ${lastScrapeReport.errorMessage || "unknown"}` };
    } else if (lastScrapeReport?.status === "completed") {
      banner = {
        kind: lastScrapeReport.errors > 0 ? "warning" : "ok",
        text: `ÄÃ£ cháº¡y: ${lastScrapeReport.total} profile â€” thÃ nh cÃ´ng ${lastScrapeReport.success}, bá» qua ${lastScrapeReport.skipped}, lá»—i ${lastScrapeReport.errors}.`
      };
    } else if (req.query.busy === "1") {
      banner = { kind: "warning", text: "Đang chạy scrape, vui lòng đợi rồi reload." };
    } else if (typeof req.query.fatal === "string" && req.query.fatal) {
      banner = { kind: "error", text: `Lỗi: ${req.query.fatal}` };
    } else if (typeof req.query.one === "string" && req.query.one) {
      const status = String(req.query.oneStatus || "");
      const errorText = typeof req.query.oneError === "string" ? req.query.oneError : "";
      const kind = status === "success" ? "ok" : status === "skipped" ? "warning" : "error";
      const detail = errorText ? ` — ${errorText}` : "";
      banner = { kind, text: `Profile ${req.query.one}: ${status || "unknown"}${detail}` };
    } else if (req.query.total !== undefined) {
      const total = Number(req.query.total) || 0;
      const success = Number(req.query.success) || 0;
      const skipped = Number(req.query.skipped) || 0;
      const errors = Number(req.query.errors) || 0;
      banner = {
        kind: errors > 0 ? "warning" : "ok",
        text: `Đã chạy: ${total} profile — thành công ${success}, bỏ qua ${skipped}, lỗi ${errors}.`
      };
    }
    res.send(renderStatsPage({
      profiles,
      latestByProfile,
      aggregate: service.getStatsAggregateByRange(),
      scrapeInProgress: service.isPaymentScrapeRunning(),
      scrapeProgress,
      banner
    }));
  });

  app.post("/stats/scrape", async (_req, res) => {
    if (service.isPaymentScrapeRunning()) {
      res.redirect("/stats?busy=1");
      return;
    }

    const task = service.runPaymentScrapeForSelected();
    task.catch((error) => {
      console.error(`[stats] batch scrape failed: ${error.message}`);
    });
    res.redirect("/stats?busy=1");
  });

  app.post("/stats/scrape/:profileId", async (req, res) => {
    try {
      const result = await service.runPaymentScrapeForProfile(req.params.profileId);
      const params = new URLSearchParams({
        one: req.params.profileId,
        oneStatus: result.status
      });
      if (result.errorMessage) params.set("oneError", result.errorMessage);
      res.redirect(`/stats?${params.toString()}`);
    } catch (error) {
      if (error.code === "scrape_in_progress") {
        res.redirect("/stats?busy=1");
        return;
      }
      res.redirect(`/stats?fatal=${encodeURIComponent(error.message)}`);
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

  app.get("/admin/ai-settings", (req, res) => {
    const flash = typeof req.query.msg === "string" ? { type: "info", message: req.query.msg } : null;
    const testResult = typeof req.query.test === "string" ? safeJsonParse(req.query.test) : null;
    res.send(renderAiSettingsPage({
      settings: service.getAiSettings(),
      flash,
      testResult
    }));
  });

  app.post("/admin/ai-settings", (req, res) => {
    const body = req.body || {};
    service.saveAiSettings({
      activeProvider: typeof body.activeProvider === "string" ? body.activeProvider.trim() : null,
      temperature: Number(body.temperature),
      maxTokens: Number(body.maxTokens),
      openai: {
        apiKey: typeof body.openai_api_key === "string" ? body.openai_api_key.trim() : "",
        baseUrl: typeof body.openai_base_url === "string" ? body.openai_base_url.trim() : "",
        model: typeof body.openai_model === "string" ? body.openai_model.trim() : ""
      },
      openrouter: {
        apiKey: typeof body.openrouter_api_key === "string" ? body.openrouter_api_key.trim() : "",
        baseUrl: typeof body.openrouter_base_url === "string" ? body.openrouter_base_url.trim() : "",
        model: typeof body.openrouter_model === "string" ? body.openrouter_model.trim() : ""
      },
      claude: {
        apiKey: typeof body.claude_api_key === "string" ? body.claude_api_key.trim() : "",
        baseUrl: typeof body.claude_base_url === "string" ? body.claude_base_url.trim() : "",
        model: typeof body.claude_model === "string" ? body.claude_model.trim() : ""
      }
    });
    res.redirect("/admin/ai-settings?msg=" + encodeURIComponent("Đã lưu AI settings"));
  });

  app.post("/admin/ai-test", async (req, res) => {
    const provider = typeof req.body?.provider === "string" ? req.body.provider.trim() : null;
    try {
      const result = await service.testAiConnection({ provider });
      const payload = JSON.stringify({
        ok: true,
        provider: result.provider,
        model: result.model,
        content: result.content,
        usage: result.usage
      });
      res.redirect("/admin/ai-settings?test=" + encodeURIComponent(payload));
    } catch (error) {
      const payload = JSON.stringify({ ok: false, message: error.message });
      res.redirect("/admin/ai-settings?test=" + encodeURIComponent(payload));
    }
  });

  function safeJsonParse(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

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

  app.get("/templates", (_req, res) => {
    const profiles = service.getTemplateProfiles();
    const flash = typeof _req.query.generated === "string"
      ? {
          type: "generated",
          profileId: typeof _req.query.profileId === "string" ? _req.query.profileId : "",
          count: Number(_req.query.generated),
          aiFilled: typeof _req.query.aiFilled === "string" ? Number(_req.query.aiFilled) : null,
          aiTotal: typeof _req.query.aiTotal === "string" ? Number(_req.query.aiTotal) : null,
          aiFailed: typeof _req.query.aiFailed === "string" ? Number(_req.query.aiFailed) : null,
          aiSkipped: typeof _req.query.aiSkipped === "string" ? Number(_req.query.aiSkipped) : null
        }
      : typeof _req.query.error === "string"
        ? { type: "error", message: _req.query.error }
        : null;
    res.send(renderTemplatesPage({ profiles, flash }));
  });

  app.post("/profiles/:profileId/generate-excel", async (req, res) => {
    const returnTo = req.query.return === "profile" ? "profile" : "templates";
    try {
      const result = await service.generateExcelTemplateWithAi(req.params.profileId);
      if (returnTo === "profile") {
        res.redirect(`/profiles/${encodeURIComponent(req.params.profileId)}?tab=template&msg=${encodeURIComponent(`Đã tạo input.xlsx với ${result.rowsAdded} dòng`)}`);
      } else {
        res.redirect(`/templates?generated=${encodeURIComponent(result.rowsAdded)}&profileId=${encodeURIComponent(req.params.profileId)}`);
      }
    } catch (error) {
      if (returnTo === "profile") {
        res.redirect(`/profiles/${encodeURIComponent(req.params.profileId)}?tab=template&msg=${encodeURIComponent(`Lỗi: ${error.message}`)}`);
      } else {
        res.redirect(`/templates?error=${encodeURIComponent(error.message)}`);
      }
    }
  });

  function extractRowValuesFromBody(body, headers) {
    const values = {};
    for (const header of headers) {
      const fieldName = `cell_${header}`;
      if (Object.prototype.hasOwnProperty.call(body, fieldName)) {
        values[header] = typeof body[fieldName] === "string" ? body[fieldName] : "";
      }
    }
    return values;
  }

  function redirectTemplate(res, profileId, message = null) {
    const base = `/profiles/${encodeURIComponent(profileId)}?tab=template`;
    res.redirect(message ? `${base}&msg=${encodeURIComponent(message)}` : base);
  }

  app.post("/profiles/:profileId/excel/rows", (req, res, next) => {
    try {
      const data = service.getProfileExcelData(req.params.profileId);
      if (!data.exists) {
        return redirectTemplate(res, req.params.profileId, "Excel chưa tồn tại. Vào menu Tạo Template để sinh file.");
      }
      const values = extractRowValuesFromBody(req.body, data.headers);
      service.addProfileExcelRow(req.params.profileId, values);
      redirectTemplate(res, req.params.profileId, "Đã thêm dòng mới");
    } catch (error) {
      next(error);
    }
  });

  app.post("/profiles/:profileId/excel/rows/:rowNumber/update", (req, res, next) => {
    try {
      const rowNumber = Number(req.params.rowNumber);
      const data = service.getProfileExcelData(req.params.profileId);
      if (!data.exists) {
        return redirectTemplate(res, req.params.profileId, "Excel không tồn tại");
      }
      const values = extractRowValuesFromBody(req.body, data.headers);
      service.updateProfileExcelRow(req.params.profileId, rowNumber, values);
      redirectTemplate(res, req.params.profileId, `Đã cập nhật dòng ${rowNumber}`);
    } catch (error) {
      next(error);
    }
  });

  app.post("/profiles/:profileId/excel/rows/:rowNumber/ai-fill", async (req, res) => {
    const profileId = req.params.profileId;
    const rowNumber = Number(req.params.rowNumber);
    const force = req.body?.force === "1" || req.query.force === "1";
    try {
      const result = await service.aiFillRow(profileId, rowNumber, { force });
      const msg = result.skipped
        ? `Bỏ qua dòng ${rowNumber} (đã có nội dung)`
        : `AI đã điền dòng ${rowNumber}`;
      redirectTemplate(res, profileId, msg);
    } catch (error) {
      redirectTemplate(res, profileId, `Lỗi AI dòng ${rowNumber}: ${error.message}`);
    }
  });

  app.post("/profiles/:profileId/excel/ai-fill-all", async (req, res) => {
    const profileId = req.params.profileId;
    const force = req.body?.force === "1";
    try {
      const summary = await service.aiFillAllRows(profileId, { force });
      const msg = `AI fill xong: ${summary.filled}/${summary.total} thành công, ${summary.failed} lỗi, ${summary.skipped} bỏ qua`;
      redirectTemplate(res, profileId, msg);
    } catch (error) {
      redirectTemplate(res, profileId, `Lỗi AI fill all: ${error.message}`);
    }
  });

  app.post("/profiles/:profileId/excel/rows/:rowNumber/delete", (req, res, next) => {
    try {
      const rowNumber = Number(req.params.rowNumber);
      service.deleteProfileExcelRow(req.params.profileId, rowNumber);
      redirectTemplate(res, req.params.profileId, `Đã xóa dòng ${rowNumber}`);
    } catch (error) {
      next(error);
    }
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
    const tab = ["general", "template", "execution"].includes(req.query.tab) ? req.query.tab : "general";
    const message = typeof req.query.msg === "string" ? req.query.msg : null;
    const excelData = tab === "template" ? service.getProfileExcelData(req.params.profileId) : null;
    res.send(renderProfilePage({
      detail,
      selectedExecution,
      tab,
      message,
      excelData
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
