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

    // Click checkbox with selector input[type=checkbox]
    try {
      logger.log("action_start", {
        excel_row_number: row.rowNumber,
        action: "click_checkbox",
        selector: "input[type=checkbox]"
      });

      // Step 1: Find checkbox
      logger.log("step_info", {
        excel_row_number: row.rowNumber,
        step: "finding_checkbox",
        message: "Searching for checkbox with selector: input[type=checkbox]",
        timestamp: new Date().toISOString()
      });

      const checkboxSelector = "input[type=checkbox]";
      await attachment.page.waitForSelector(checkboxSelector, { state: "visible", timeout: 10000 });
      
      logger.log("step_info", {
        excel_row_number: row.rowNumber,
        step: "checkbox_found",
        message: "Checkbox found and visible",
        timestamp: new Date().toISOString()
      });

      // Step 2: Click checkbox
      logger.log("step_info", {
        excel_row_number: row.rowNumber,
        step: "clicking_checkbox",
        message: "Clicking on checkbox",
        timestamp: new Date().toISOString()
      });

      await attachment.page.click(checkboxSelector);
      
      logger.log("step_info", {
        excel_row_number: row.rowNumber,
        step: "checkbox_clicked",
        message: "Checkbox clicked successfully",
        timestamp: new Date().toISOString()
      });
      
      // Small delay to ensure click is registered
      await sleep(500);

      logger.log("action_completed", {
        excel_row_number: row.rowNumber,
        action: "click_checkbox",
        selector: checkboxSelector
      });
    } catch (error) {
      logger.log("step_error", {
        excel_row_number: row.rowNumber,
        step: "checkbox_operation_failed",
        message: `Failed during checkbox operation: ${error.message}`,
        timestamp: new Date().toISOString()
      });

      logger.log("action_failed", {
        excel_row_number: row.rowNumber,
        action: "click_checkbox",
        selector: "input[type=checkbox]",
        error: error.message
      });
      
      // Capture error screenshot
      const screenshotPath = await this.captureErrorScreenshot({
        attachment,
        artifactsDir,
        profileId: row.profileId,
        executionId: row.executionId,
        rowNumber: row.rowNumber
      });

      return {
        status: "error",
        statusDetail: `Failed to click checkbox: ${error.message}`,
        errorScreenshot: screenshotPath
      };
    }

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
      statusDetail: `Clicked checkbox and processed ${values.length} field(s) on ${attachment.page.url() || "current page"}`
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
