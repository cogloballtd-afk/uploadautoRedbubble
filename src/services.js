import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  closeProfileBrowserSession,
  createProfileBrowserSession,
  createProfileExecution,
  deleteProfileExecution,
  getActiveExecutionForProfile,
  getProfileDashboardRow,
  getProfileExecution,
  getProfileExecutions,
  getSystemConfig,
  listDashboardProfiles,
  recordProfileRowExecution,
  updateSystemConfig,
  updateProfileExecution,
  updateProfileSettings,
  updateRuntimeState,
  upsertProfiles
} from "./db.js";
import { getExcelFilePath, listPendingRows, validateExcelFile, writeRowResult } from "./excel.js";
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

function normalizeStatus(profile) {
  return {
    ...profile,
    enabled: Boolean(profile.enabled)
  };
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
      throw new Error(`Profile is already ${profile.runtime_status}`);
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
            artifactsDir: logger.executionDir
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

        // Row interval is temporarily disabled so the next automation step can run
        // immediately after each processed row while the profile remains open.
        // Keep the original pacing block here for future re-enable.
        // if (!control.shouldPause && !control.shouldStop) {
        //   const rowIntervalMinutes = randomBetween(
        //     Number(profile.row_interval_min_minutes || 0),
        //     Number(profile.row_interval_max_minutes || 0)
        //   );
        //   logger.log("row_interval_wait", {
        //     excel_row_number: row.rowNumber,
        //     delay_minutes: rowIntervalMinutes
        //   });
        //   await sleep(rowIntervalMinutes * 60 * 1000);
        // }
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

  return {
    config,
    syncProfiles,
    getAdminSettings,
    getDashboardProfiles,
    getProfileDetail,
    getExecution,
    deleteExecution,
    saveAdminSettings,
    saveProfileSettings,
    startProfileRun,
    pauseProfileRun,
    stopProfileRun
  };
}
