import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  closeProfileBrowserSession,
  createProfileBrowserSession,
  createProfileExecution,
  deleteProfileExecution,
  getActiveExecutionForProfile,
  getAiConfig,
  getLatestPaymentStatsByProfile,
  getProfileDashboardRow,
  getProfileExecution,
  getProfileExecutions,
  getSystemConfig,
  insertPaymentStat,
  listDashboardProfiles,
  recordProfileRowExecution,
  updateAiConfig,
  updateSystemConfig,
  updateProfileExecution,
  updateProfileSettings,
  updateRuntimeState,
  upsertProfiles
} from "./db.js";
import { createAiClient, getProviderDefaults, SUPPORTED_PROVIDERS } from "./aiClient.js";
import { generateRedbubbleContent } from "./aiContent.js";
import { addRowValues, deleteRowAt, getExcelFilePath, listPendingRows, readAllRows, updateRowValues, validateExcelFile, writeRowResult } from "./excel.js";
import { buildExcelTemplate, listImageFiles } from "./excelTemplate.js";
import { PlaywrightBrowserClient } from "./browserAutomation.js";
import { createProfileLogger } from "./profileLogger.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeRange(min, max, fallback = 0) {
  const safeMin = Number.isFinite(min) ? min : fallback;
  const safeMax = Number.isFinite(max) ? max : safeMin;
  return {
    min: Math.min(safeMin, safeMax),
    max: Math.max(safeMin, safeMax)
  };
}

function randomBetween(min, max) {
  const range = normalizeRange(min, max);
  return range.min + (Math.random() * (range.max - range.min));
}

const PAYMENT_SCRAPE_BATCH_SIZE = 10;

function normalizeStatus(profile) {
  return {
    ...profile,
    enabled: Boolean(profile.enabled)
  };
}

export const STATS_RANGES = ["Last 7 days", "Last 30 days", "Last 12 months"];

function parseMoney(text) {
  if (text === null || text === undefined) return 0;
  const str = String(text).trim();
  if (!str) return 0;
  const negative = /^[-(]/.test(str) || /[-)]\s*$/.test(str);
  const digits = str.replace(/[^\d.]/g, "");
  if (!digits) return 0;
  const n = Number(digits);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

function parseInteger(text) {
  if (text === null || text === undefined) return 0;
  const str = String(text).trim();
  if (!str) return 0;
  const digits = str.replace(/[^\d]/g, "");
  if (!digits) return 0;
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

function summarizeProductsBreakdown(productCounts, productAmounts) {
  return Array.from(productCounts.entries())
    .map(([name, quantity]) => ({
      name,
      quantity,
      amount: productAmounts.get(name) || 0
    }))
    .sort((a, b) => b.quantity - a.quantity);
}

function findColumnIndex(headers, regex, fallback) {
  if (!Array.isArray(headers)) return fallback;
  const i = headers.findIndex((h) => regex.test(String(h).toLowerCase()));
  return i === -1 ? fallback : i;
}

function enrichArtwork(artwork, headers) {
  const cells = Array.isArray(artwork.cells) ? artwork.cells : [];
  const products = Array.isArray(artwork.products) ? artwork.products : [];
  const name = String(cells[0] ?? "").trim() || "(unnamed)";
  const thumbnailUrl = typeof artwork.thumbnailUrl === "string" ? artwork.thumbnailUrl : "";
  const artworkUrl = typeof artwork.artworkUrl === "string" ? artwork.artworkUrl : "";

  let productsSold = 0;
  let totalEarnings = 0;
  for (const p of products) {
    productsSold += parseInteger(p.quantity);
    totalEarnings += parseMoney(p.amount);
  }

  if (productsSold === 0 || totalEarnings === 0) {
    const earningsCol = findColumnIndex(headers, /earning|revenue|amount|payment/, 1);
    const qtyCol = findColumnIndex(headers, /sold|quantity|sales|orders|units/, 2);
    if (productsSold === 0) productsSold = parseInteger(cells[qtyCol]);
    if (totalEarnings === 0) totalEarnings = parseMoney(cells[earningsCol]);
  }

  return { name, productsSold, totalEarnings, products, cells, thumbnailUrl, artworkUrl };
}

function buildModernRangeStats(rangeData) {
  const rawArtworks = Array.isArray(rangeData.artworks) ? rangeData.artworks : [];
  const headers = rangeData.artworkHeaders || [];
  const enriched = rawArtworks.map((a) => enrichArtwork(a, headers));

  let totalSales = 0;
  let totalEarnings = 0;
  for (const a of enriched) {
    totalSales += a.productsSold;
    totalEarnings += a.totalEarnings;
  }

  const earningsValueText = rangeData.earningsSummary?.value || "";
  const summaryEarnings = parseMoney(earningsValueText);
  const finalEarnings = totalEarnings > 0 ? totalEarnings : summaryEarnings;

  return {
    artworkCount: enriched.length,
    totalSales,
    totalEarnings: finalEarnings,
    earningsLabel: rangeData.earningsSummary?.label || "",
    earningsValueText,
    artworks: enriched,
    source: "modern"
  };
}

function buildLegacyRangeStats(studio, range) {
  const snaps = Array.isArray(studio.snapshots) ? studio.snapshots : [];
  const targetLower = range.toLowerCase();
  const matchingSnap = snaps.find((s) =>
    !s?.error && (s?.selectedLabel || "").toLowerCase().includes(targetLower)
  );
  const td = studio.tableData;
  const lastSnap = snaps[snaps.length - 1];
  const tableMatchesRange = lastSnap
    && !lastSnap.error
    && (lastSnap.selectedLabel || "").toLowerCase().includes(targetLower)
    && td && !td.error
    && Array.isArray(td.rows);

  if (!matchingSnap && !tableMatchesRange) {
    return null;
  }

  const earningsValueText = matchingSnap?.value || "";
  const earningsLabel = matchingSnap?.label || "";
  const snapshotEarnings = parseMoney(earningsValueText);

  const enriched = [];
  let totalSales = 0;
  let totalEarningsFromTable = 0;

  if (tableMatchesRange) {
    const headers = td.headers || [];
    const dataRows = td.rows.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== ""));
    for (const row of dataRows) {
      const enrichedRow = enrichArtwork({ cells: row, products: [] }, headers);
      enriched.push(enrichedRow);
      totalSales += enrichedRow.productsSold;
      totalEarningsFromTable += enrichedRow.totalEarnings;
    }
  }

  const finalEarnings = totalEarningsFromTable > 0 ? totalEarningsFromTable : snapshotEarnings;

  return {
    artworkCount: enriched.length,
    totalSales,
    totalEarnings: finalEarnings,
    earningsLabel,
    earningsValueText,
    artworks: enriched,
    source: tableMatchesRange ? "legacy_full" : "legacy_earnings_only"
  };
}

export function buildStatsAggregate({ profiles, latestByProfile }) {
  const safeProfiles = Array.isArray(profiles) ? profiles : [];
  const map = latestByProfile instanceof Map
    ? latestByProfile
    : new Map(Object.entries(latestByProfile || {}));

  const ranges = {};
  for (const range of STATS_RANGES) {
    const perProfile = [];
    const artworkRows = [];
    let globalEarnings = 0;
    let globalSales = 0;
    let globalArtworks = 0;
    let profilesWithData = 0;

    safeProfiles.forEach((profile, index) => {
      const stat = map.get(profile.profile_id);
      const studio = stat?.studioData;

      const base = {
        stt: index + 1,
        profileId: profile.profile_id,
        profileName: profile.profile_name,
        scrapedAt: stat?.scrapedAt || null,
        scrapeStatus: stat?.status || null
      };

      if (!stat) {
        perProfile.push({ ...base, hasData: false, reason: "not_scraped" });
        return;
      }
      if (stat.status !== "success") {
        perProfile.push({ ...base, hasData: false, reason: stat.status || "unknown" });
        return;
      }
      if (!studio || studio.error) {
        perProfile.push({ ...base, hasData: false, reason: "studio_error", error: studio?.error });
        return;
      }

      const modernRange = studio.byRange?.[range];
      let stats = null;
      if (modernRange) {
        if (modernRange.error) {
          perProfile.push({ ...base, hasData: false, reason: "range_error", error: modernRange.error });
          return;
        }
        stats = buildModernRangeStats(modernRange);
      } else {
        stats = buildLegacyRangeStats(studio, range);
      }

      if (!stats) {
        perProfile.push({ ...base, hasData: false, reason: "missing_range" });
        return;
      }

      perProfile.push({
        ...base,
        hasData: true,
        ...stats
      });

      for (const artwork of stats.artworks) {
        artworkRows.push({
          artworkName: artwork.name,
          profileId: profile.profile_id,
          profileName: profile.profile_name,
          productsSold: artwork.productsSold,
          totalEarnings: artwork.totalEarnings,
          products: artwork.products,
          cells: artwork.cells,
          thumbnailUrl: artwork.thumbnailUrl,
          artworkUrl: artwork.artworkUrl,
          source: stats.source
        });
      }

      profilesWithData += 1;
      globalArtworks += stats.artworkCount;
      globalSales += stats.totalSales;
      globalEarnings += stats.totalEarnings;
    });

    artworkRows.sort((a, b) => b.totalEarnings - a.totalEarnings || b.productsSold - a.productsSold);
    artworkRows.forEach((row, i) => { row.stt = i + 1; });

    ranges[range] = {
      perProfile,
      artworkRows,
      totals: {
        profilesWithData,
        artworks: globalArtworks,
        sales: globalSales,
        earnings: globalEarnings
      }
    };
  }

  return { ranges };
}

export function buildValidation(profile, excelFilenameStandard) {
  const folderPath = profile.folder_path;
  if (!folderPath) {
    return {
      level: profile.enabled ? "warning" : "none",
      code: "missing_folder",
      message: profile.enabled ? "Enabled but folder is not configured." : ""
    };
  }

  if (!fs.existsSync(folderPath)) {
    return {
      level: "warning",
      code: "folder_missing",
      message: "Folder does not exist."
    };
  }

  const excelPath = getExcelFilePath(folderPath, excelFilenameStandard);
  if (!fs.existsSync(excelPath)) {
    return {
      level: "warning",
      code: "excel_missing",
      message: `Missing standard Excel file: ${excelFilenameStandard}.`
    };
  }

  try {
    validateExcelFile(excelPath);
  } catch (error) {
    return {
      level: "error",
      code: "excel_invalid",
      message: error.message
    };
  }

  return {
    level: "ok",
    code: "ready",
    message: "Ready"
  };
}

export function createAppService({
  db,
  gpmClient,
  config,
  browserClient = new PlaywrightBrowserClient()
}) {
  const activeExecutions = new Map();
  let paymentScrapeInProgress = false;
  let paymentScrapeProgress = null;
  let lastPaymentScrapeReport = null;

  function getDashboardProfiles() {
    const systemConfig = getSystemConfig(db);
    return listDashboardProfiles(db)
      .map(normalizeStatus)
      .map((profile) => ({
        ...profile,
        validation: buildValidation(profile, systemConfig.excel_filename_standard)
      }));
  }

  function getProfileDetail(profileId) {
    const systemConfig = getSystemConfig(db);
    const profile = getProfileDashboardRow(db, profileId);
    if (!profile) {
      return null;
    }

    const normalized = normalizeStatus(profile);
    return {
      profile: {
        ...normalized,
        validation: buildValidation(normalized, systemConfig.excel_filename_standard)
      },
      executions: getProfileExecutions(db, profileId),
      activeExecution: normalized.active_execution_id
        ? getProfileExecution(db, normalized.active_execution_id)
        : null
    };
  }

  function getExecution(executionId) {
    return getProfileExecution(db, executionId);
  }

  function deleteExecution(profileId, executionId) {
    const execution = getProfileExecution(db, executionId);
    if (!execution || execution.profile_id !== profileId) {
      return false;
    }

    if (activeExecutions.has(profileId) || execution.status === "running") {
      return false;
    }

    return deleteProfileExecution(db, { profileId, executionId });
  }

  function getAdminSettings() {
    const systemConfig = getSystemConfig(db);
    return {
      gpmApiBaseUrl: systemConfig.gpm_api_base_url,
      excelFilenameStandard: systemConfig.excel_filename_standard,
      logDir: systemConfig.log_dir,
      artifactsDir: systemConfig.artifacts_dir
    };
  }

  async function syncProfiles() {
    const profiles = await gpmClient.listProfiles();
    upsertProfiles(db, profiles);
    return getDashboardProfiles();
  }

  function saveProfileSettings({
    profileId,
    enabled,
    folderPath,
    displayOrder,
    fieldDelayMinSeconds,
    fieldDelayMaxSeconds,
    rowIntervalMinMinutes,
    rowIntervalMaxMinutes
  }) {
    const fieldDelayRange = normalizeRange(fieldDelayMinSeconds, fieldDelayMaxSeconds, 1);
    const rowIntervalRange = normalizeRange(rowIntervalMinMinutes, rowIntervalMaxMinutes, 1);
    updateProfileSettings(db, {
      profileId,
      enabled,
      folderPath,
      displayOrder,
      fieldDelayMinSeconds: fieldDelayRange.min,
      fieldDelayMaxSeconds: fieldDelayRange.max,
      rowIntervalMinMinutes: rowIntervalRange.min,
      rowIntervalMaxMinutes: rowIntervalRange.max
    });
  }

  function generateExcelTemplate(profileId) {
    const profile = getProfileDashboardRow(db, profileId);
    if (!profile) {
      throw new Error(`Unknown profile: ${profileId}`);
    }
    if (!profile.folder_path) {
      throw new Error("Profile has no folder configured.");
    }
    if (!fs.existsSync(profile.folder_path)) {
      throw new Error(`Folder does not exist: ${profile.folder_path}`);
    }

    const systemConfig = getSystemConfig(db);
    const excelPath = getExcelFilePath(profile.folder_path, systemConfig.excel_filename_standard);
    const result = buildExcelTemplate({
      folderPath: profile.folder_path,
      excelPath
    });

    return {
      excelPath: result.excelPath,
      rowsAdded: result.rowsAdded
    };
  }

  async function generateExcelTemplateWithAi(profileId, { force = false, delayMs = 500, fetchImpl } = {}) {
    const template = generateExcelTemplate(profileId);
    const aiSummary = await aiFillAllRows(profileId, { force, delayMs, fetchImpl });
    return {
      ...template,
      aiSummary
    };
  }

  function getTemplateProfiles() {
    return listDashboardProfiles(db)
      .map(normalizeStatus)
      .filter((profile) => profile.enabled)
      .map((profile) => {
        const preview = previewExcelTemplate(profile.profile_id);
        return {
          profile_id: profile.profile_id,
          profile_name: profile.profile_name,
          folder_path: profile.folder_path,
          enabled: profile.enabled,
          imageCount: preview.imageCount,
          excelExists: preview.excelExists,
          excelPath: preview.excelPath || null
        };
      });
  }

  function previewExcelTemplate(profileId) {
    const profile = getProfileDashboardRow(db, profileId);
    if (!profile || !profile.folder_path || !fs.existsSync(profile.folder_path)) {
      return { imageCount: 0, excelExists: false };
    }
    const systemConfig = getSystemConfig(db);
    const excelPath = getExcelFilePath(profile.folder_path, systemConfig.excel_filename_standard);
    let imageCount = 0;
    try {
      imageCount = listImageFiles(profile.folder_path).length;
    } catch {
      imageCount = 0;
    }
    return {
      imageCount,
      excelExists: fs.existsSync(excelPath),
      excelPath
    };
  }

  function getProfileExcelPath(profileId) {
    const profile = getProfileDashboardRow(db, profileId);
    if (!profile) {
      throw new Error(`Unknown profile: ${profileId}`);
    }
    if (!profile.folder_path) {
      throw new Error("Profile has no folder configured.");
    }
    const systemConfig = getSystemConfig(db);
    return {
      profile,
      excelPath: getExcelFilePath(profile.folder_path, systemConfig.excel_filename_standard)
    };
  }

  function getProfileExcelData(profileId) {
    const profile = getProfileDashboardRow(db, profileId);
    if (!profile) return { exists: false, headers: [], rows: [] };
    if (!profile.folder_path) return { exists: false, headers: [], rows: [], reason: "no_folder" };
    const systemConfig = getSystemConfig(db);
    const excelPath = getExcelFilePath(profile.folder_path, systemConfig.excel_filename_standard);
    if (!fs.existsSync(excelPath)) {
      return { exists: false, headers: [], rows: [], reason: "no_excel", excelPath };
    }
    try {
      const data = readAllRows(excelPath);
      return { exists: true, headers: data.headers, rows: data.rows, excelPath };
    } catch (error) {
      return { exists: false, headers: [], rows: [], reason: "invalid_excel", error: error.message, excelPath };
    }
  }

  function addProfileExcelRow(profileId, values) {
    const { excelPath } = getProfileExcelPath(profileId);
    return addRowValues(excelPath, values);
  }

  function updateProfileExcelRow(profileId, rowNumber, values) {
    const { excelPath } = getProfileExcelPath(profileId);
    updateRowValues(excelPath, rowNumber, values);
  }

  function deleteProfileExcelRow(profileId, rowNumber) {
    const { excelPath } = getProfileExcelPath(profileId);
    deleteRowAt(excelPath, rowNumber);
  }

  function saveAdminSettings(settings) {
    updateSystemConfig(db, settings);
    config.gpmApiBaseUrl = settings.gpmApiBaseUrl;
    config.excelFilenameStandard = settings.excelFilenameStandard;
    config.logDir = settings.logDir;
    config.artifactsDir = settings.artifactsDir;
  }

  async function startProfileRun(profileId) {
    let profile = getProfileDashboardRow(db, profileId);
    if (!profile) {
      throw new Error(`Unknown profile: ${profileId}`);
    }

    if (activeExecutions.has(profileId)) {
      return { executionId: activeExecutions.get(profileId).executionId };
    }

    if (profile.runtime_status === "awaiting_automation") {
      const latestExecution = getProfileExecutions(db, profileId)[0];
      const execution = latestExecution
        ? getProfileExecution(db, latestExecution.execution_id)
        : null;

      if (execution?.session?.session_status === "detached") {
        const logger = createProfileLogger({
          artifactsDir: config.artifactsDir,
          profileId,
          executionId: latestExecution.execution_id
        });

        logger.log("awaiting_automation_restart_requested");
        await gpmClient.closeProfile(profileId)
          .then(() => {
            logger.log("awaiting_automation_profile_closed_for_restart");
          })
          .catch((error) => {
            logger.log("awaiting_automation_profile_close_for_restart_failed", {
              message: error.message
            });
          });

        closeProfileBrowserSession(db, {
          executionId: latestExecution.execution_id,
          sessionStatus: "closed",
          closedAt: new Date().toISOString()
        });
        updateRuntimeState(db, {
          profileId,
          status: "idle",
          currentRowNumber: null,
          lastErrorCode: null,
          lastErrorDetail: null
        });
        logger.log("awaiting_automation_session_closed_for_restart");
        profile = getProfileDashboardRow(db, profileId);
      }
    }

    if (!["idle", "paused", "failed"].includes(profile.runtime_status)) {
      // The runtime state says we're mid-execution, but no in-memory control entry exists —
      // the previous server process or the GPM browser was killed. Treat as orphan and reset.
      if (!activeExecutions.has(profileId)) {
        const latestExecution = getProfileExecutions(db, profileId)[0];
        if (latestExecution) {
          const orphanLogger = createProfileLogger({
            artifactsDir: config.artifactsDir,
            profileId,
            executionId: latestExecution.execution_id
          });
          orphanLogger.log("orphan_state_reset", {
            previous_runtime_status: profile.runtime_status,
            previous_execution_status: latestExecution.status
          });
          updateProfileExecution(db, {
            executionId: latestExecution.execution_id,
            status: "failed",
            endedAt: new Date().toISOString()
          });
          closeProfileBrowserSession(db, {
            executionId: latestExecution.execution_id,
            sessionStatus: "closed",
            closedAt: new Date().toISOString()
          });
        }
        await gpmClient.closeProfile(profileId).catch(() => {});
        updateRuntimeState(db, {
          profileId,
          status: "idle",
          activeExecutionId: null,
          currentRowNumber: null,
          lastErrorCode: null,
          lastErrorDetail: null
        });
        profile = getProfileDashboardRow(db, profileId);
      } else {
        throw new Error(`Profile is already ${profile.runtime_status}`);
      }
    }

    const executionId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const logger = createProfileLogger({
      artifactsDir: config.artifactsDir,
      profileId,
      executionId
    });

    createProfileExecution(db, {
      executionId,
      profileId,
      status: "opening_profile",
      startedAt,
      logPath: logger.logPath
    });
    updateRuntimeState(db, {
      profileId,
      status: "opening_profile",
      activeExecutionId: executionId,
      currentRowNumber: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      lastRunStatus: "opening_profile",
      lastRunStartedAt: startedAt,
      lastRunEndedAt: null
    });

    const control = {
      profileId,
      executionId,
      shouldPause: false,
      shouldStop: false
    };
    activeExecutions.set(profileId, control);

    runProfileExecution(control, logger)
      .catch((error) => {
        logger.log("execution_uncaught_error", { message: error.message });
      })
      .finally(() => {
        activeExecutions.delete(profileId);
      });

    return { executionId };
  }

  function pauseProfileRun(profileId) {
    const control = activeExecutions.get(profileId);
    if (!control) {
      return false;
    }
    control.shouldPause = true;
    updateRuntimeState(db, {
      profileId,
      status: "pausing"
    });
    return true;
  }

  function stopProfileRun(profileId) {
    const control = activeExecutions.get(profileId);
    if (!control) {
      const profile = getProfileDashboardRow(db, profileId);
      if (!profile || profile.runtime_status !== "awaiting_automation") {
        return false;
      }

      const latestExecution = getProfileExecutions(db, profileId)[0];
      if (!latestExecution) {
        return false;
      }

      const execution = getProfileExecution(db, latestExecution.execution_id);
      if (!execution?.session || execution.session.session_status !== "detached") {
        return false;
      }

      const logger = createProfileLogger({
        artifactsDir: config.artifactsDir,
        profileId,
        executionId: latestExecution.execution_id
      });

      logger.log("awaiting_automation_stop_requested");
      updateRuntimeState(db, {
        profileId,
        status: "stopping"
      });

      gpmClient.closeProfile(profileId)
        .then(() => {
          logger.log("awaiting_automation_profile_closed");
        })
        .catch((error) => {
          logger.log("awaiting_automation_profile_close_failed", {
            message: error.message
          });
        })
        .finally(() => {
          closeProfileBrowserSession(db, {
            executionId: latestExecution.execution_id,
            sessionStatus: "closed",
            closedAt: new Date().toISOString()
          });
          updateRuntimeState(db, {
            profileId,
            status: "idle",
            currentRowNumber: null,
            lastErrorCode: null,
            lastErrorDetail: null
          });
          logger.log("awaiting_automation_session_closed");
        });

      return true;
    }
    control.shouldStop = true;
    updateRuntimeState(db, {
      profileId,
      status: "stopping"
    });
    return true;
  }

  async function runProfileExecution(control, logger) {
    const systemConfig = getSystemConfig(db);
    const profile = normalizeStatus(getProfileDashboardRow(db, control.profileId));
    const validation = buildValidation(profile, systemConfig.excel_filename_standard);
    const startedAt = new Date().toISOString();

    logger.log("execution_started", {
      profile_id: control.profileId,
      execution_id: control.executionId
    });

    if (validation.code !== "ready") {
      await finalizeExecution({
        control,
        logger,
        finalStatus: "failed",
        runtimeStatus: "failed",
        lastErrorCode: validation.code,
        lastErrorDetail: validation.message
      });
      return;
    }

    const excelPath = getExcelFilePath(profile.folder_path, systemConfig.excel_filename_standard);
    let session;
    let attachment;
    let shouldKeepProfileOpen = false;

    try {
      updateRuntimeState(db, {
        profileId: control.profileId,
        status: "opening_profile",
        lastRunStartedAt: startedAt
      });

      session = await gpmClient.startProfile(control.profileId);
      logger.log("gpm_profile_started", {
        remote_debugging_address: session.remoteDebuggingAddress
      });

      createProfileBrowserSession(db, {
        profileId: control.profileId,
        executionId: control.executionId,
        remoteDebuggingAddress: session.remoteDebuggingAddress,
        browserLocation: session.browserLocation,
        driverPath: session.driverPath,
        sessionStatus: "open",
        connectedAt: new Date().toISOString()
      });

      attachment = await browserClient.attachToSession({
        session,
        profileId: control.profileId,
        executionId: control.executionId,
        logger
      });

      logger.log("browser_attached", {
        page_url: attachment.pageUrl,
        page_title: attachment.pageTitle
      });

      // Navigate straight to the first pending row's URL from the `color` column —
      // never use a static fallback (e.g. /portfolio/images/new/edit) because that route 404s.
      const initialPendingRows = listPendingRows(excelPath);
      const firstRowUrl = initialPendingRows.find((r) => /^https?:\/\//i.test(String(r.values.color || "").trim()))?.values.color?.trim();

      if (firstRowUrl) {
        updateRuntimeState(db, {
          profileId: control.profileId,
          status: "passing_cloudflare"
        });

        await browserClient.navigateAndPassCloudflare({
          attachment,
          targetUrl: firstRowUrl,
          logger,
          onCloudflarePending: ({ targetUrl }) => {
            updateRuntimeState(db, {
              profileId: control.profileId,
              status: "pending_cf",
              lastErrorCode: "pending_cf",
              lastErrorDetail: `Admin must click Cloudflare checkbox in the GPM browser at ${targetUrl}`
            });
          }
        });

        updateRuntimeState(db, {
          profileId: control.profileId,
          status: "reading_excel",
          lastErrorCode: null,
          lastErrorDetail: null
        });
      } else {
        logger.log("cf_skipped_no_pending_rows", { reason: "no pending row with a valid http URL in the color column" });
      }

      // Excel remains in this route for now. We are only tagging the current phase
      // explicitly so we can reorder "open profile -> automation -> Excel" later.
      updateProfileExecution(db, {
        executionId: control.executionId,
        status: "reading_excel"
      });
      updateRuntimeState(db, {
        profileId: control.profileId,
        status: "reading_excel"
      });

      const pendingRows = listPendingRows(excelPath);
      updateProfileExecution(db, {
        executionId: control.executionId,
        rowsTotal: pendingRows.length
      });

      let rowsCompleted = 0;
      let rowsFailed = 0;

      if (pendingRows.length > 0) {
        updateProfileExecution(db, {
          executionId: control.executionId,
          status: "processing_rows"
        });
        updateRuntimeState(db, {
          profileId: control.profileId,
          status: "processing_rows"
        });
      }

      for (const row of pendingRows) {
        if (control.shouldPause || control.shouldStop) {
          break;
        }

        const rowStartedAt = new Date().toISOString();
        updateRuntimeState(db, {
          profileId: control.profileId,
          status: "processing_rows",
          currentRowNumber: row.rowNumber
        });

        try {
          const result = await browserClient.processRow({
            attachment,
            row,
            fieldDelayMinSeconds: Number(profile.field_delay_min_seconds || 0),
            fieldDelayMaxSeconds: Number(profile.field_delay_max_seconds || 0),
            logger,
            artifactsDir: logger.executionDir,
            folderPath: profile.folder_path
          });

          writeRowResult(excelPath, row.rowNumber, {
            status: result.status,
            statusDetail: result.statusDetail,
            executedAt: new Date().toISOString()
          });
          recordProfileRowExecution(db, {
            executionId: control.executionId,
            profileId: control.profileId,
            excelRowNumber: row.rowNumber,
            status: result.status,
            statusDetail: result.statusDetail,
            startedAt: rowStartedAt,
            endedAt: new Date().toISOString()
          });
          rowsCompleted += 1;
          updateProfileExecution(db, {
            executionId: control.executionId,
            rowsCompleted
          });
        } catch (error) {
          const screenshotPath = await browserClient.captureErrorScreenshot({
            attachment,
            artifactsDir: logger.executionDir,
            profileId: control.profileId,
            executionId: control.executionId,
            rowNumber: row.rowNumber
          }).catch(() => null);
          const detail = screenshotPath
            ? `${error.message} (screenshot: ${screenshotPath})`
            : error.message;

          writeRowResult(excelPath, row.rowNumber, {
            status: "error",
            statusDetail: detail,
            executedAt: new Date().toISOString()
          });
          recordProfileRowExecution(db, {
            executionId: control.executionId,
            profileId: control.profileId,
            excelRowNumber: row.rowNumber,
            status: "error",
            statusDetail: detail,
            startedAt: rowStartedAt,
            endedAt: new Date().toISOString()
          });
          rowsFailed += 1;
          updateProfileExecution(db, {
            executionId: control.executionId,
            rowsFailed
          });
          logger.log("row_failed", {
            excel_row_number: row.rowNumber,
            message: error.message
          });
          updateRuntimeState(db, {
            profileId: control.profileId,
            lastErrorCode: "row_failed",
            lastErrorDetail: error.message
          });
        }

        if (!control.shouldPause && !control.shouldStop) {
          const rowIntervalMinutes = randomBetween(
            Number(profile.row_interval_min_minutes || 0),
            Number(profile.row_interval_max_minutes || 0)
          );
          if (rowIntervalMinutes > 0) {
            const nextRowAt = new Date(Date.now() + rowIntervalMinutes * 60 * 1000).toISOString();
            logger.log("row_interval_wait", {
              excel_row_number: row.rowNumber,
              delay_minutes: Number(rowIntervalMinutes.toFixed(2)),
              next_row_at: nextRowAt
            });
            updateRuntimeState(db, { profileId: control.profileId, nextRowAt });
            await sleep(rowIntervalMinutes * 60 * 1000);
            updateRuntimeState(db, { profileId: control.profileId, nextRowAt: null });
          }
        }
      }

      const refreshedPendingRows = listPendingRows(excelPath);
      const hasErrors = getProfileExecution(db, control.executionId).rows_failed > 0;
      const endedByPause = control.shouldPause;
      const endedByStop = control.shouldStop;

      if (endedByPause) {
        await finalizeExecution({
          control,
          logger,
          finalStatus: "paused",
          runtimeStatus: "paused"
        });
      } else if (endedByStop) {
        await finalizeExecution({
          control,
          logger,
          finalStatus: "stopped",
          runtimeStatus: "idle"
        });
      } else if (refreshedPendingRows.length === 0) {
        shouldKeepProfileOpen = true;
        await finalizeExecution({
          control,
          logger,
          finalStatus: hasErrors ? "awaiting_automation_with_errors" : "awaiting_automation",
          runtimeStatus: "awaiting_automation"
        });
      } else {
        await finalizeExecution({
          control,
          logger,
          finalStatus: "failed",
          runtimeStatus: "failed",
          lastErrorCode: "rows_remaining",
          lastErrorDetail: "Execution ended before all rows were processed."
        });
      }
    } catch (error) {
      logger.log("execution_failed", { message: error.message });
      await finalizeExecution({
        control,
        logger,
        finalStatus: "failed",
        runtimeStatus: "failed",
        lastErrorCode: "execution_failed",
        lastErrorDetail: error.message
      });
    } finally {
      logger.log("cleanup_started", {
        keep_profile_open: shouldKeepProfileOpen,
        has_attachment: Boolean(attachment),
        has_session: Boolean(session)
      });

      if (attachment) {
        if (shouldKeepProfileOpen) {
          logger.log("cleanup_attachment_skipped", {
            reason: "keep_profile_open"
          });
        } else {
          logger.log("cleanup_attachment_closing");
          await browserClient.closeAttachment(attachment)
            .then(() => {
              logger.log("cleanup_attachment_closed");
            })
            .catch((error) => {
              logger.log("cleanup_attachment_close_failed", {
                message: error.message
              });
            });
        }
      }

      if (session) {
        if (!shouldKeepProfileOpen) {
          logger.log("cleanup_profile_closing");
          await gpmClient.closeProfile(control.profileId)
            .then(() => {
              logger.log("cleanup_profile_closed");
            })
            .catch((error) => {
              logger.log("cleanup_profile_close_failed", {
                message: error.message
              });
            });
        } else {
          logger.log("cleanup_profile_kept_open");
        }
        closeProfileBrowserSession(db, {
          executionId: control.executionId,
          sessionStatus: shouldKeepProfileOpen ? "detached" : "closed",
          closedAt: new Date().toISOString()
        });
        logger.log("cleanup_session_state_recorded", {
          session_status: shouldKeepProfileOpen ? "detached" : "closed"
        });
      }
    }
  }

  async function finalizeExecution({
    control,
    logger,
    finalStatus,
    runtimeStatus,
    lastErrorCode = null,
    lastErrorDetail = null
  }) {
    const endedAt = new Date().toISOString();
    updateProfileExecution(db, {
      executionId: control.executionId,
      status: finalStatus,
      endedAt
    });
    updateRuntimeState(db, {
      profileId: control.profileId,
      status: runtimeStatus,
      activeExecutionId: null,
      currentRowNumber: null,
      lastErrorCode,
      lastErrorDetail,
      lastRunStatus: finalStatus,
      lastRunEndedAt: endedAt
    });
    logger.log(`execution_${finalStatus}`, {
      status: finalStatus
    });
  }

  function getPaymentStatsByProfile() {
    return getLatestPaymentStatsByProfile(db);
  }

  function isPaymentScrapeRunning() {
    return paymentScrapeInProgress;
  }

  function getPaymentScrapeProgress() {
    return paymentScrapeProgress ? { ...paymentScrapeProgress } : null;
  }

  function getLastPaymentScrapeReport() {
    return lastPaymentScrapeReport ? { ...lastPaymentScrapeReport } : null;
  }

  function getStatsAggregateByRange() {
    const latest = getLatestPaymentStatsByProfile(db);
    const profiles = listDashboardProfiles(db).map(normalizeStatus).filter((p) => p.enabled);
    return buildStatsAggregate({ profiles, latestByProfile: latest });
  }

  async function scrapeOnePaymentProfile(profile) {
    const profileId = profile.profile_id;

    if (profile.runtime_status === "running" || profile.runtime_status === "opening_profile") {
      insertPaymentStat(db, {
        profileId,
        lineItems: null,
        pageUrl: null,
        status: "skipped",
        errorMessage: "Profile đang chạy upload — bỏ qua scrape",
        studioData: null
      });
      console.log(`[payment-scrape] skip ${profileId}: runtime_status=${profile.runtime_status}`);
      return { status: "skipped" };
    }

    let session;
    let attachment;
    try {
      console.log(`[payment-scrape] starting profile ${profileId}`);
      session = await gpmClient.startProfile(profileId);
      attachment = await browserClient.attachToSession({ session });

      const result = await browserClient.scrapePaymentHistory(attachment);
      const paymentLineItems = Array.isArray(result?.lineItems) ? result.lineItems : [];
      console.log(`[payment-scrape] payment_history ok ${profileId}: ${paymentLineItems.length} items`);

      let studioData = null;
      try {
        studioData = await browserClient.scrapeStudioDashboard(attachment);
        const optionLabels = Array.isArray(studioData?.optionLabels) ? studioData.optionLabels : [];
        const snapshots = Array.isArray(studioData?.snapshots) ? studioData.snapshots : [];
        console.log(`[payment-scrape] studio_dashboard ok ${profileId}: control=${studioData?.controlTag || ""}, options=${optionLabels.length}, snapshots=${snapshots.length}`);
      } catch (studioErr) {
        studioData = { error: studioErr.message };
        console.error(`[payment-scrape] studio_dashboard error ${profileId}: ${studioErr.message}`);
      }

      insertPaymentStat(db, {
        profileId,
        lineItems: paymentLineItems,
        pageUrl: result.pageUrl,
        status: "success",
        errorMessage: null,
        studioData
      });
      return { status: "success", count: paymentLineItems.length };
    } catch (error) {
      insertPaymentStat(db, {
        profileId,
        lineItems: null,
        pageUrl: null,
        status: "error",
        errorMessage: error.message,
        studioData: null
      });
      console.error(`[payment-scrape] error ${profileId}: ${error.message}`);
      return { status: "error", errorMessage: error.message };
    } finally {
      console.log(`[payment-scrape] cleanup ${profileId}: starting (attachment=${Boolean(attachment)}, session=${Boolean(session)})`);
      if (attachment) {
        try {
          await browserClient.closeAttachment(attachment);
          console.log(`[payment-scrape] cleanup ${profileId}: attachment closed`);
        } catch (err) {
          console.error(`[payment-scrape] closeAttachment ${profileId}: ${err.message}`);
        }
      }
      // Luôn gọi closeProfile nếu đã startProfile, kể cả khi closeAttachment fail.
      // Race với timeout 15s vì GPM API đôi khi treo.
      if (session) {
        try {
          const startedProfileId = session.profileId || profileId;
          await Promise.race([
            gpmClient.closeProfile(startedProfileId),
            new Promise((_, reject) => setTimeout(() => reject(new Error("GPM closeProfile timeout 15s")), 15000))
          ]);
          console.log(`[payment-scrape] cleanup ${profileId}: GPM profile closed`);
        } catch (err) {
          console.error(`[payment-scrape] closeProfile ${profileId}: ${err.message}`);
        }
      }
      console.log(`[payment-scrape] cleanup ${profileId}: done`);
    }
  }

  async function runPaymentScrapeForSelected() {
    if (paymentScrapeInProgress) {
      const err = new Error("Payment scrape đang chạy, vui lòng đợi.");
      err.code = "scrape_in_progress";
      throw err;
    }

    paymentScrapeInProgress = true;
    const summary = { total: 0, success: 0, skipped: 0, errors: 0 };

    try {
      const profiles = getDashboardProfiles().filter((p) => p.enabled);
      summary.total = profiles.length;
      paymentScrapeProgress = {
        status: "running",
        batchSize: PAYMENT_SCRAPE_BATCH_SIZE,
        totalProfiles: profiles.length,
        processedProfiles: 0,
        currentBatch: profiles.length > 0 ? 1 : 0,
        totalBatches: Math.ceil(profiles.length / PAYMENT_SCRAPE_BATCH_SIZE),
        success: 0,
        skipped: 0,
        errors: 0,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        currentBatchProfileIds: []
      };

      for (let i = 0; i < profiles.length; i += PAYMENT_SCRAPE_BATCH_SIZE) {
        const batch = profiles.slice(i, i + PAYMENT_SCRAPE_BATCH_SIZE);
        paymentScrapeProgress = {
          ...paymentScrapeProgress,
          currentBatch: Math.floor(i / PAYMENT_SCRAPE_BATCH_SIZE) + 1,
          currentBatchProfileIds: batch.map((profile) => profile.profile_id)
        };
        const results = await Promise.all(batch.map((profile) => scrapeOnePaymentProfile(profile)));

        for (const result of results) {
          if (result.status === "success") summary.success += 1;
          else if (result.status === "skipped") summary.skipped += 1;
          else summary.errors += 1;
        }

        paymentScrapeProgress = {
          ...paymentScrapeProgress,
          processedProfiles: Math.min(i + batch.length, profiles.length),
          success: summary.success,
          skipped: summary.skipped,
          errors: summary.errors
        };
      }

      lastPaymentScrapeReport = {
        status: "completed",
        total: summary.total,
        success: summary.success,
        skipped: summary.skipped,
        errors: summary.errors,
        startedAt: paymentScrapeProgress?.startedAt || new Date().toISOString(),
        finishedAt: new Date().toISOString()
      };
      return summary;
    } catch (error) {
      lastPaymentScrapeReport = {
        status: "failed",
        total: summary.total,
        success: summary.success,
        skipped: summary.skipped,
        errors: summary.errors,
        startedAt: paymentScrapeProgress?.startedAt || new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        errorMessage: error.message
      };
      throw error;
    } finally {
      if (paymentScrapeProgress) {
        paymentScrapeProgress = {
          ...paymentScrapeProgress,
          status: "completed",
          finishedAt: new Date().toISOString(),
          currentBatchProfileIds: []
        };
      }
      paymentScrapeInProgress = false;
    }
  }

  async function runPaymentScrapeForProfile(profileId) {
    if (paymentScrapeInProgress) {
      const err = new Error("Payment scrape đang chạy, vui lòng đợi.");
      err.code = "scrape_in_progress";
      throw err;
    }

    const profile = getDashboardProfiles().find((p) => p.profile_id === profileId);
    if (!profile) {
      const err = new Error(`Profile not found: ${profileId}`);
      err.code = "profile_not_found";
      throw err;
    }
    if (!profile.enabled) {
      const err = new Error(`Profile ${profileId} chưa được enabled`);
      err.code = "profile_not_enabled";
      throw err;
    }

    paymentScrapeInProgress = true;
    try {
      return await scrapeOnePaymentProfile(profile);
    } finally {
      paymentScrapeInProgress = false;
    }
  }

  return {
    config,
    syncProfiles,
    getAdminSettings,
    getDashboardProfiles,
    getPaymentStatsByProfile,
    getStatsAggregateByRange,
    isPaymentScrapeRunning,
    getPaymentScrapeProgress,
    getLastPaymentScrapeReport,
    runPaymentScrapeForSelected,
    runPaymentScrapeForProfile,
    getProfileDetail,
    getExecution,
    deleteExecution,
    saveAdminSettings,
    saveProfileSettings,
    startProfileRun,
    pauseProfileRun,
    stopProfileRun,
    generateExcelTemplate,
    generateExcelTemplateWithAi,
    previewExcelTemplate,
    getTemplateProfiles,
    getProfileExcelData,
    addProfileExcelRow,
    updateProfileExcelRow,
    deleteProfileExcelRow,
    getAiSettings,
    saveAiSettings,
    aiChat,
    testAiConnection,
    aiFillRow,
    aiFillAllRows
  };

  function rowNeedsAiFill(values) {
    const missing = (key) => String(values?.[key] ?? "").trim() === "";
    return missing("Main Tag") || missing("Supporting Tags") || missing("Description");
  }

  async function aiFillRow(profileId, rowNumber, { force = false, fetchImpl } = {}) {
    const data = getProfileExcelData(profileId);
    if (!data.exists) {
      throw new Error("Excel template chưa tồn tại cho profile này.");
    }
    const target = data.rows.find((r) => r.rowNumber === Number(rowNumber));
    if (!target) {
      throw new Error(`Không tìm thấy dòng ${rowNumber} trong Excel.`);
    }
    const title = String(target.values.Title || "").trim();
    if (!title) {
      throw new Error(`Dòng ${rowNumber} chưa có Title — không thể sinh nội dung.`);
    }
    if (!force && !rowNeedsAiFill(target.values)) {
      return { rowNumber: target.rowNumber, skipped: true, reason: "already_filled" };
    }

    const generated = await generateRedbubbleContent({
      title,
      aiChat: (input) => aiChat({ ...input, fetchImpl })
    });

    updateProfileExcelRow(profileId, target.rowNumber, {
      "Main Tag": generated.mainTag,
      "Supporting Tags": generated.supportingTags,
      Description: generated.description
    });

    return {
      rowNumber: target.rowNumber,
      skipped: false,
      mainTag: generated.mainTag,
      supportingTags: generated.supportingTags,
      description: generated.description,
      model: generated.aiModel
    };
  }

  async function aiFillAllRows(profileId, { force = false, delayMs = 500, fetchImpl } = {}) {
    const data = getProfileExcelData(profileId);
    if (!data.exists) {
      throw new Error("Excel template chưa tồn tại cho profile này.");
    }
    const targets = data.rows.filter((r) => {
      if (!String(r.values.Title || "").trim()) return false;
      return force || rowNeedsAiFill(r.values);
    });

    const results = [];
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i];
      try {
        const result = await aiFillRow(profileId, target.rowNumber, { force, fetchImpl });
        results.push({ rowNumber: target.rowNumber, ok: true, ...result });
      } catch (error) {
        results.push({ rowNumber: target.rowNumber, ok: false, error: error.message });
      }
      if (i < targets.length - 1 && delayMs > 0) {
        await sleep(delayMs);
      }
    }

    const filled = results.filter((r) => r.ok && !r.skipped).length;
    const skipped = results.filter((r) => r.ok && r.skipped).length;
    const failed = results.filter((r) => !r.ok).length;
    return { total: targets.length, filled, skipped, failed, results };
  }

  function getAiSettings() {
    const row = getAiConfig(db);
    const providers = SUPPORTED_PROVIDERS.map((provider) => {
      const defaults = getProviderDefaults(provider);
      const apiKey = row[`${provider}_api_key`] || "";
      return {
        provider,
        label: defaults.label,
        defaultBaseUrl: defaults.baseUrl,
        defaultModel: defaults.model,
        apiKey,
        hasApiKey: Boolean(apiKey),
        baseUrl: row[`${provider}_base_url`] || "",
        model: row[`${provider}_model`] || ""
      };
    });
    return {
      activeProvider: row.active_provider,
      temperature: row.temperature,
      maxTokens: row.max_tokens,
      updatedAt: row.updated_at,
      providers
    };
  }

  function saveAiSettings(input) {
    const config = {
      active_provider: SUPPORTED_PROVIDERS.includes(input.activeProvider) ? input.activeProvider : null,
      openai_api_key: input.openai?.apiKey ?? null,
      openai_base_url: input.openai?.baseUrl || null,
      openai_model: input.openai?.model || null,
      openrouter_api_key: input.openrouter?.apiKey ?? null,
      openrouter_base_url: input.openrouter?.baseUrl || null,
      openrouter_model: input.openrouter?.model || null,
      claude_api_key: input.claude?.apiKey ?? null,
      claude_base_url: input.claude?.baseUrl || null,
      claude_model: input.claude?.model || null,
      temperature: Number.isFinite(input.temperature) ? input.temperature : 0.7,
      max_tokens: Number.isFinite(input.maxTokens) ? Math.round(input.maxTokens) : 1024
    };
    updateAiConfig(db, config);
  }

  function buildAiClientForProvider(provider, { fetchImpl } = {}) {
    const settings = getAiSettings();
    const targetProvider = provider || settings.activeProvider;
    if (!targetProvider) {
      throw new Error("AI provider chưa được chọn. Cấu hình ở Admin > AI Settings.");
    }
    const providerCfg = settings.providers.find((p) => p.provider === targetProvider);
    if (!providerCfg) {
      throw new Error(`Unknown AI provider: ${targetProvider}`);
    }
    if (!providerCfg.apiKey) {
      throw new Error(`API key cho ${providerCfg.label} chưa được cấu hình.`);
    }
    return createAiClient({
      provider: targetProvider,
      apiKey: providerCfg.apiKey,
      baseUrl: providerCfg.baseUrl || providerCfg.defaultBaseUrl,
      model: providerCfg.model || providerCfg.defaultModel,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      fetchImpl
    });
  }

  async function aiChat({ provider, system, messages, model, temperature, maxTokens, fetchImpl } = {}) {
    const client = buildAiClientForProvider(provider, { fetchImpl });
    return client.chat({ system, messages, model, temperature, maxTokens });
  }

  async function testAiConnection({ provider, fetchImpl } = {}) {
    const client = buildAiClientForProvider(provider, { fetchImpl });
    const result = await client.chat({
      system: "You are a connectivity probe. Respond with the single word: ok.",
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 16
    });
    return {
      ok: true,
      provider: client.provider,
      model: client.model,
      content: result.content,
      usage: result.usage
    };
  }
}
