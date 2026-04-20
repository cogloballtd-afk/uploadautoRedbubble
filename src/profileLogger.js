import fs from "node:fs";
import path from "node:path";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function createProfileLogger({ artifactsDir, profileId, executionId }) {
  const executionDir = path.join(artifactsDir, "browser", profileId, executionId);
  ensureDir(executionDir);
  const logPath = path.join(executionDir, "steps.jsonl");

  function log(event, payload = {}) {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      profile_id: profileId,
      execution_id: executionId,
      event,
      ...payload
    });
    fs.appendFileSync(logPath, `${line}\n`);
  }

  return {
    executionDir,
    logPath,
    log
  };
}
