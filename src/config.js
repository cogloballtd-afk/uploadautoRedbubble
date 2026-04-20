import path from "node:path";

const rootDir = process.cwd();

export function getConfig() {
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

