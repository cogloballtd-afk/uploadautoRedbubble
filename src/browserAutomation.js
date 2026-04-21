import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : safeMin;
  const normalizedMin = Math.min(safeMin, safeMax);
  const normalizedMax = Math.max(safeMin, safeMax);
  return normalizedMin + (Math.random() * (normalizedMax - normalizedMin));
}

function sanitizeFilePart(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "_");
}

export class PlaywrightBrowserClient {
  async attachToSession({ session }) {
    const browser = await chromium.connectOverCDP(`http://${session.remoteDebuggingAddress}`);
    const contexts = browser.contexts();
    const pages = contexts.flatMap((context) => context.pages());
    const page = pages.find((candidate) => candidate.url() !== "about:blank") || pages.at(-1);

    if (!page) {
      await browser.close();
      throw new Error("No active page found in browser session");
    }

    return {
      browser,
      page,
      pageUrl: page.url(),
      pageTitle: await page.title()
    };
  }

  async processRow({ attachment, row, fieldDelayMinSeconds, fieldDelayMaxSeconds, logger, artifactsDir }) {
    const values = Object.entries(row.values)
      .filter(([key]) => !["status", "status_detail", "executed_at"].includes(key))
      .filter(([, value]) => String(value ?? "").trim() !== "");

    logger.log("row_started", {
      excel_row_number: row.rowNumber,
      fields_count: values.length,
      page_url: attachment.page.url()
    });

    for (const [field, value] of values) {
      logger.log("field_ready", {
        excel_row_number: row.rowNumber,
        field,
        value_preview: String(value).slice(0, 120)
      });

      // Field delay is temporarily disabled so downstream automation can continue
      // immediately on the same open profile/session. Keep the config plumbing in
      // place so we can restore per-field pacing later if needed.
      // const fieldDelaySeconds = randomBetween(fieldDelayMinSeconds, fieldDelayMaxSeconds);
      // logger.log("field_delay_wait", {
      //   excel_row_number: row.rowNumber,
      //   field,
      //   delay_seconds: fieldDelaySeconds
      // });
      // await sleep(fieldDelaySeconds * 1000);
    }

    logger.log("row_completed", {
      excel_row_number: row.rowNumber
    });

    return {
      status: "ok",
      statusDetail: `Processed ${values.length} field(s) on ${attachment.page.url() || "current page"}`
    };
  }

  async captureErrorScreenshot({ attachment, artifactsDir, profileId, executionId, rowNumber }) {
    if (!attachment?.page) {
      return null;
    }

    fs.mkdirSync(artifactsDir, { recursive: true });
    const screenshotPath = path.join(
      artifactsDir,
      `${sanitizeFilePart(profileId)}_${sanitizeFilePart(executionId)}_row_${rowNumber}_error.png`
    );

    await attachment.page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  }

  async closeAttachment(attachment) {
    if (attachment?.browser) {
      await attachment.browser.close();
    }
  }
}
