import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  addOpenedSession,
  addRunItem,
  createRun,
  finishRun,
  getRun,
  getSystemConfig,
  listDashboardProfiles,
  listEnabledProfilesForRun,
  listRuns,
  setRunStopped,
  updateProfileBinding,
  updateProfileRunState,
  updateRunItem,
  upsertProfiles
} from "./db.js";

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

  const excelPath = path.join(folderPath, excelFilenameStandard);
  if (!fs.existsSync(excelPath)) {
    return {
      level: "warning",
      code: "excel_missing",
      message: `Missing standard Excel file: ${excelFilenameStandard}.`
    };
  }

  return {
    level: "ok",
    code: "ready",
    message: "Ready"
  };
}

export function createAppService({ db, gpmClient, config }) {
  const activeRuns = new Map();

  function getDashboardProfiles() {
    const systemConfig = getSystemConfig(db);
    return listDashboardProfiles(db).map((profile) => {
      const validation = buildValidation(profile, systemConfig.excel_filename_standard);
      return {
        ...profile,
        enabled: Boolean(profile.enabled),
        validation
      };
    });
  }

  async function syncProfiles() {
    const profiles = await gpmClient.listProfiles();
    upsertProfiles(db, profiles);
    return getDashboardProfiles();
  }

  function saveProfileBinding({ profileId, enabled, folderPath, displayOrder }) {
    updateProfileBinding(db, {
      profileId,
      enabled,
      folderPath,
      displayOrder
    });
  }

  async function startOpenProfilesRun(maxConcurrency) {
    const safeConcurrency = Math.max(1, Number(maxConcurrency) || 1);
    const runId = crypto.randomUUID();
    createRun(db, { runId, maxConcurrency: safeConcurrency });

    const control = {
      shouldStop: false,
      startedAt: new Date().toISOString()
    };
    activeRuns.set(runId, control);

    const task = runProfiles({ runId, maxConcurrency: safeConcurrency, control })
      .finally(() => {
        activeRuns.delete(runId);
      });

    control.promise = task;
    return { runId };
  }

  async function runProfiles({ runId, maxConcurrency, control }) {
    const systemConfig = getSystemConfig(db);
    const profiles = listEnabledProfilesForRun(db);
    const queue = [...profiles];
    let sawErrors = false;

    const worker = async () => {
      while (queue.length && !control.shouldStop) {
        const profile = queue.shift();
        await processProfile(runId, profile, systemConfig).catch(() => {
          sawErrors = true;
        });
      }
    };

    const workers = Array.from(
      { length: Math.min(maxConcurrency, Math.max(queue.length, 1)) },
      () => worker()
    );
    await Promise.all(workers);

    const finalStatus = control.shouldStop
      ? "stopped"
      : sawErrors
        ? "completed_with_errors"
        : "completed";
    finishRun(db, { runId, status: finalStatus });
  }

  async function processProfile(runId, profile, systemConfig) {
    const folderPath = profile.folder_path || "";
    const excelPath = folderPath
      ? path.join(folderPath, systemConfig.excel_filename_standard)
      : "";
    const now = new Date().toISOString();

    addRunItem(db, {
      runId,
      profileId: profile.profile_id,
      folderPath,
      excelPath,
      status: "validating",
      startedAt: now
    });

    const validation = buildValidation(profile, systemConfig.excel_filename_standard);
    if (validation.code !== "ready") {
      updateRunItem(db, {
        runId,
        profileId: profile.profile_id,
        folderPath,
        excelPath,
        status: "skipped_invalid_config",
        startedAt: now,
        endedAt: new Date().toISOString(),
        errorCode: validation.code,
        errorDetail: validation.message
      });
      updateProfileRunState(db, {
        profileId: profile.profile_id,
        lastStatus: "skipped_invalid_config"
      });
      throw new Error(validation.message);
    }

    updateRunItem(db, {
      runId,
      profileId: profile.profile_id,
      folderPath,
      excelPath,
      status: "opening",
      startedAt: now
    });

    try {
      const session = await gpmClient.startProfile(profile.profile_id);
      addOpenedSession(db, {
        runId,
        profileId: profile.profile_id,
        remoteDebuggingAddress: session.remoteDebuggingAddress,
        browserLocation: session.browserLocation,
        driverPath: session.driverPath
      });
      updateRunItem(db, {
        runId,
        profileId: profile.profile_id,
        folderPath,
        excelPath,
        status: "opened",
        startedAt: now,
        endedAt: new Date().toISOString()
      });
      updateProfileRunState(db, {
        profileId: profile.profile_id,
        lastStatus: "opened"
      });
      return session;
    } catch (error) {
      updateRunItem(db, {
        runId,
        profileId: profile.profile_id,
        folderPath,
        excelPath,
        status: "failed_open_profile",
        startedAt: now,
        endedAt: new Date().toISOString(),
        errorCode: "gpm_open_failed",
        errorDetail: error.message
      });
      updateProfileRunState(db, {
        profileId: profile.profile_id,
        lastStatus: "failed_open_profile"
      });
      throw error;
    }
  }

  function stopRun(runId) {
    const active = activeRuns.get(runId);
    if (!active) {
      return false;
    }
    active.shouldStop = true;
    setRunStopped(db, runId);
    return true;
  }

  function getRunStatus(runId) {
    return getRun(db, runId);
  }

  function getRunList() {
    return listRuns(db);
  }

  return {
    config,
    syncProfiles,
    getDashboardProfiles,
    saveProfileBinding,
    startOpenProfilesRun,
    stopRun,
    getRunStatus,
    getRunList
  };
}

