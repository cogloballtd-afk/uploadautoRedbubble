import path from "node:path";

const rootDir = process.cwd();

export function getDefaultConfig() {
  return {
    port: Number(process.env.PORT || 3000),
    gpmApiBaseUrl: process.env.GPM_API_BASE_URL || "http://127.0.0.1:19995",
    excelFilenameStandard: process.env.EXCEL_FILENAME_STANDARD || "input.xlsx",
    dataDir: path.resolve(process.env.DATA_DIR || path.join(rootDir, "data")),
    dbPath: path.resolve(process.env.DATA_DIR || path.join(rootDir, "data"), "app.sqlite"),
    logDir: path.resolve(process.env.LOG_DIR || path.join(rootDir, "logs")),
    artifactsDir: path.resolve(process.env.ARTIFACTS_DIR || path.join(rootDir, "artifacts"))
  };
}

export function mergeConfig(baseConfig, storedConfig = {}) {
  return {
    ...baseConfig,
    gpmApiBaseUrl: storedConfig.gpm_api_base_url || storedConfig.gpmApiBaseUrl || baseConfig.gpmApiBaseUrl,
    excelFilenameStandard: storedConfig.excel_filename_standard || storedConfig.excelFilenameStandard || baseConfig.excelFilenameStandard,
    logDir: storedConfig.log_dir || storedConfig.logDir || baseConfig.logDir,
    artifactsDir: storedConfig.artifacts_dir || storedConfig.artifactsDir || baseConfig.artifactsDir
  };
}

export function getConfig() {
  return getDefaultConfig();
}
