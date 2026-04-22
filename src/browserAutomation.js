import fs from "node:fs";
import path from "node:path";
import { chromium as playwrightChromium } from "playwright-core";
import { chromium as rebrowserChromium } from "rebrowser-playwright-core";

// BROWSER_DRIVER=playwright (default) | rebrowser (kept for rollback)
const selectedDriver = (process.env.BROWSER_DRIVER || "playwright").toLowerCase();
const chromium = selectedDriver === "rebrowser" ? rebrowserChromium : playwrightChromium;

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
  async attachToSession({ session, connectTimeoutMs = 30000, connectRetryDelayMs = 500 }) {
    const endpoint = `http://${session.remoteDebuggingAddress}`;
    const deadline = Date.now() + connectTimeoutMs;
    let browser;
    let lastError;

    while (!browser) {
      try {
        browser = await chromium.connectOverCDP(endpoint);
      } catch (error) {
        lastError = error;
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for CDP at ${endpoint} after ${connectTimeoutMs}ms: ${error.message}`);
        }
        await sleep(connectRetryDelayMs);
      }
    }

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

  async navigateAndPassCloudflare({
    attachment,
    targetUrl,
    logger,
    onCloudflarePending,
    autoPassWaitMs = 8000,
    humanPassTimeoutMs = 15 * 60 * 1000,
    pollIntervalMs = 3000
  }) {
    const page = attachment.page;
    const targetPathname = new URL(targetUrl).pathname;
    logger.log("cf_navigate_start", { target_url: targetUrl, current_url: page.url() });

    if (!page.url().includes(targetPathname)) {
      try {
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch (error) {
        logger.log("cf_navigate_warning", { message: error.message });
      }
    }

    const isCfTitle = (title) => /just a moment|verifying|verify you are human|attention required/i.test(title || "");
    const isReady = async () => {
      const title = await page.title().catch(() => "");
      const url = page.url();
      return { ready: !isCfTitle(title) && url.includes(targetPathname), title, url };
    };

    // Phase 1: short auto-pass window — for sites where CF resolves on its own
    const autoDeadline = Date.now() + autoPassWaitMs;
    while (Date.now() < autoDeadline) {
      const state = await isReady();
      if (state.ready) {
        logger.log("cf_auto_passed", state);
        return { passed: true, requiredHuman: false, ...state };
      }
      await sleep(1000);
    }

    // Phase 2: human-required CF — surface to admin, wait for them to click in GPM browser
    logger.log("cf_pending_human", { message: "Cloudflare requires manual click. Waiting for admin to pass it in the GPM browser.", target_url: targetUrl });
    if (typeof onCloudflarePending === "function") {
      try { await onCloudflarePending({ targetUrl }); } catch (err) {
        logger.log("cf_pending_callback_error", { message: err.message });
      }
    }

    const humanDeadline = Date.now() + humanPassTimeoutMs;
    while (Date.now() < humanDeadline) {
      const state = await isReady();
      if (state.ready) {
        logger.log("cf_passed_by_human", state);
        return { passed: true, requiredHuman: true, ...state };
      }
      await sleep(pollIntervalMs);
    }

    throw new Error(`Cloudflare not resolved by admin within ${Math.round(humanPassTimeoutMs/1000)}s`);
  }

  async processRow({ attachment, row, fieldDelayMinSeconds, fieldDelayMaxSeconds, logger, artifactsDir, folderPath }) {
    const values = Object.entries(row.values)
      .filter(([key]) => !["status", "status_detail", "executed_at"].includes(key))
      .filter(([, value]) => String(value ?? "").trim() !== "");

    logger.log("row_started", {
      excel_row_number: row.rowNumber,
      fields_count: values.length,
      page_url: attachment.page.url()
    });

    const page = attachment.page;
    const rowTargetUrl = String(row.values.color || "").trim();
    if (/^https?:\/\//i.test(rowTargetUrl) && !page.url().startsWith(rowTargetUrl)) {
      logger.log("row_navigate", { excel_row_number: row.rowNumber, target_url: rowTargetUrl });
      try {
        await page.goto(rowTargetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch (error) {
        logger.log("row_navigate_warning", { excel_row_number: row.rowNumber, message: error.message });
      }
    }

    // 404 detection: if landed on Redbubble's "Houston, we have a problem" page, retry navigation once.
    const is404Page = async () => {
      const t = await page.title().catch(() => "");
      const body = await page.evaluate(() => (document.body?.innerText || "").slice(0, 600)).catch(() => "");
      return /404|page not found|houston, we have a problem/i.test(t) || /houston, we have a problem/i.test(body);
    };

    if (/^https?:\/\//i.test(rowTargetUrl) && await is404Page()) {
      logger.log("row_404_retry", { excel_row_number: row.rowNumber, target_url: rowTargetUrl, landed_url: page.url() });
      try {
        await page.goto(rowTargetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch (error) {
        logger.log("row_404_retry_warning", { excel_row_number: row.rowNumber, message: error.message });
      }
    }

    try {
      await page.waitForSelector("#work_title_en", { timeout: 30000 });
    } catch (error) {
      const finalTitle = await page.title().catch(() => "");
      logger.log("form_not_ready", { excel_row_number: row.rowNumber, target_url: rowTargetUrl, landed_url: page.url(), page_title: finalTitle, message: error.message });
      const screenshotPath = await this.captureErrorScreenshot({
        attachment, artifactsDir, profileId: row.profileId, executionId: row.executionId, rowNumber: row.rowNumber
      }).catch(() => null);
      return { status: "error", statusDetail: `Form not loaded at ${rowTargetUrl}: ${error.message}`, errorScreenshot: screenshotPath };
    }

    const filled = [];
    const errors = [];

    const fieldDelay = async () => {
      const seconds = randomBetween(Number(fieldDelayMinSeconds || 0), Number(fieldDelayMaxSeconds || 0));
      if (seconds > 0) {
        logger.log("field_delay_wait", { excel_row_number: row.rowNumber, delay_seconds: Number(seconds.toFixed(2)) });
        await sleep(seconds * 1000);
      }
    };

    const fillTextField = async (selector, value, label) => {
      const v = String(value ?? "").trim();
      if (!v) return;
      try {
        await page.fill(selector, "");
        await page.fill(selector, v);
        filled.push(label);
        logger.log("field_filled", { excel_row_number: row.rowNumber, field: label, selector, value_preview: v.slice(0, 80) });
      } catch (error) {
        errors.push(`${label}: ${error.message}`);
        logger.log("field_fill_error", { excel_row_number: row.rowNumber, field: label, message: error.message });
      }
    };

    const clearTagWidget = async (editSelector) => {
      await page.evaluate((sel) => {
        const edit = document.querySelector(sel);
        if (!edit) return;
        const container = edit.parentElement;
        if (!container) return;
        const deleteButtons = Array.from(container.querySelectorAll('span[class*=delete-button]'));
        deleteButtons.reverse().forEach((btn) => btn.click());
      }, editSelector);
      await sleep(300);
    };

    const addTags = async (editSelector, tags, label) => {
      try {
        await clearTagWidget(editSelector);
        for (const tag of tags) {
          await page.click(editSelector);
          await page.keyboard.type(tag);
          await page.keyboard.press("Enter");
          await sleep(150);
        }
        filled.push(label);
        logger.log("tags_filled", { excel_row_number: row.rowNumber, field: label, selector: editSelector, count: tags.length, tags: tags.slice(0, 20) });
      } catch (error) {
        errors.push(`${label}: ${error.message}`);
        logger.log("tags_fill_error", { excel_row_number: row.rowNumber, field: label, message: error.message });
      }
    };

    // Replace all images FIRST so the rest of the fields fill while the upload finishes server-side.
    const rawImagePath = String(row.values["Image path"] || "").trim();
    if (rawImagePath) {
      let resolvedPath = rawImagePath;
      if (!fs.existsSync(resolvedPath) && folderPath) {
        const fallback = path.join(folderPath, path.basename(rawImagePath));
        if (fs.existsSync(fallback)) {
          logger.log("image_path_fallback", { excel_row_number: row.rowNumber, original: rawImagePath, resolved: fallback });
          resolvedPath = fallback;
        }
      }
      if (!fs.existsSync(resolvedPath)) {
        const msg = `Image file not found: ${rawImagePath}`;
        errors.push(`Image: ${msg}`);
        logger.log("image_not_found", { excel_row_number: row.rowNumber, path: rawImagePath });
      } else {
        try {
          await page.setInputFiles("#select-image-base", resolvedPath);
          logger.log("image_set_input", { excel_row_number: row.rowNumber, path: resolvedPath });

          // Give the upload time to start (progress bar appears).
          await sleep(2500);

          // Wait until no circle-progress is mid-upload (0 < v < 100) and submit button is enabled.
          await page.waitForFunction(() => {
            const progresses = Array.from(document.querySelectorAll('.circle-progress'));
            const anyInProgress = progresses.some((p) => {
              const v = Number(p.getAttribute('data-value') || '0');
              return v > 0 && v < 100;
            });
            if (anyInProgress) return false;
            const submit = document.querySelector('#submit-work');
            if (submit && (submit.disabled || submit.getAttribute('aria-disabled') === 'true')) return false;
            return true;
          }, null, { timeout: 120000, polling: 500 });

          filled.push("Image");
          logger.log("image_uploaded", { excel_row_number: row.rowNumber, path: resolvedPath });
        } catch (error) {
          errors.push(`Image: ${error.message}`);
          logger.log("image_upload_error", { excel_row_number: row.rowNumber, path: resolvedPath, message: error.message });
        }
      }
      await fieldDelay();
    }

    // Title
    await fillTextField("#work_title_en", row.values.Title, "Title");
    await fieldDelay();
    // Description
    await fillTextField("#work_description_en", row.values.Description, "Description");
    await fieldDelay();
    // Main Tag (single chip)
    const mainTag = String(row.values["Main Tag"] || "").trim();
    if (mainTag) {
      await addTags("#main-tag-en", [mainTag], "Main Tag");
      await fieldDelay();
    }
    // Supporting Tags (multi chip, comma separated)
    const suppRaw = String(row.values["Supporting Tags"] || "").trim();
    if (suppRaw) {
      const tags = suppRaw.split(",").map((s) => s.trim()).filter(Boolean);
      if (tags.length > 0) {
        await addTags("#supporting-tags-en", tags, "Supporting Tags");
        await fieldDelay();
      }
    }

    // Final steps: tick the rights declaration checkbox, then submit the form via "Save Work".
    try {
      const rightsCheckbox = page.locator("#rightsDeclaration");
      await rightsCheckbox.scrollIntoViewIfNeeded({ timeout: 5000 });
      await rightsCheckbox.check({ timeout: 5000 });
      filled.push("Rights Declaration");
      logger.log("rights_checked", { excel_row_number: row.rowNumber });
    } catch (error) {
      errors.push(`Rights Declaration: ${error.message}`);
      logger.log("rights_check_error", { excel_row_number: row.rowNumber, message: error.message });
    }
    await fieldDelay();

    let saveConfirmed = false;
    try {
      const saveButton = page.locator('#submit-work').first();
      await saveButton.scrollIntoViewIfNeeded({ timeout: 5000 });
      const urlBeforeSave = page.url();
      logger.log("save_clicking", { excel_row_number: row.rowNumber, url_before: urlBeforeSave });

      // Click + wait for navigation concurrently. Submit triggers a full page nav;
      // racing both avoids "Execution context destroyed" when the page tears down during click.
      const [navResult] = await Promise.all([
        page.waitForURL((u) => u.toString() !== urlBeforeSave, { timeout: 60000 }).then(() => "navigated").catch((err) => `nav_error:${err.message}`),
        saveButton.click({ timeout: 10000 }).catch((err) => { logger.log("save_click_warning", { excel_row_number: row.rowNumber, message: err.message }); })
      ]);

      const urlAfterSave = page.url();
      if (urlAfterSave !== urlBeforeSave) {
        saveConfirmed = true;
        filled.push("Save Work");
        logger.log("save_confirmed", { excel_row_number: row.rowNumber, url_after: urlAfterSave, nav_result: navResult });
      } else {
        throw new Error(`URL did not change after clicking Save Work (nav_result=${navResult})`);
      }
    } catch (error) {
      errors.push(`Save Work: ${error.message}`);
      logger.log("save_click_error", { excel_row_number: row.rowNumber, message: error.message, url: page.url() });
    }

    logger.log("row_completed", { excel_row_number: row.rowNumber, filled, errors, save_confirmed: saveConfirmed });

    // Status=ok ONLY when Save Work was confirmed (URL navigated away). Any earlier failure or
    // unconfirmed save => error, so the row stays pending for retry.
    if (!saveConfirmed) {
      const detail = errors.length > 0
        ? `Filled [${filled.join(", ")}]; not saved. errors: ${errors.join(" | ")}`
        : `Filled [${filled.join(", ")}]; save not confirmed (URL did not change)`;
      const screenshotPath = await this.captureErrorScreenshot({
        attachment, artifactsDir, profileId: row.profileId, executionId: row.executionId, rowNumber: row.rowNumber
      }).catch(() => null);
      return { status: "error", statusDetail: detail, errorScreenshot: screenshotPath };
    }

    if (errors.length > 0) {
      const screenshotPath = await this.captureErrorScreenshot({
        attachment, artifactsDir, profileId: row.profileId, executionId: row.executionId, rowNumber: row.rowNumber
      }).catch(() => null);
      return { status: "error", statusDetail: `Filled [${filled.join(", ")}]; errors: ${errors.join(" | ")}`, errorScreenshot: screenshotPath };
    }

    return { status: "ok", statusDetail: `Filled [${filled.join(", ")}] on ${page.url()}` };
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
