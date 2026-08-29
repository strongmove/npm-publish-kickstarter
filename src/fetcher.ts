import { createHash } from "crypto";
import { chromium } from "playwright";
import type { FetchMode, FetchOptions } from "./types";

/** Result of a successful fetch operation. */
export interface FetchResult {
  html: string;
  status: number;
  etag?: string;
  contentHash: string;
  finalUrl: string;
  mode?: FetchMode;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; crawler-core/1.0; +https://your-org.example)";

async function getBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const msg =
      error instanceof Error
        ? error.message
        : "Unknown Playwright launch error";
    throw new Error(
      `Browser fetch mode requires Playwright Chromium. Install it with "npx playwright install --with-deps chromium". Original error: ${msg}`
    );
  }
}

/** Delay helper. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute SHA-256 hex hash of a string.
 * Used for change-detection across crawl runs.
 */
export function computeContentHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

async function fetchPageBrowser(
  url: string,
  opts: { timeoutMs?: number; userAgent?: string; extraHeaders?: Record<string, string> }
): Promise<FetchResult> {
  const {
    timeoutMs = 10_000,
    userAgent = DEFAULT_USER_AGENT,
    extraHeaders = {},
  } = opts;

  const browser = await getBrowser();

  try {
    const page = await browser.newPage({
      userAgent,
    });

    try {
      await page.setExtraHTTPHeaders(extraHeaders);
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });

      await page
        .waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 2_500) })
        .catch(() => undefined);

      const html = await page.content();
      const finalUrl = page.url() || url;
      const status = response?.status() ?? 200;
      const etag = response?.headers()["etag"];

      return {
        html,
        status,
        etag,
        contentHash: computeContentHash(html),
        finalUrl,
        mode: "browser",
      };
    } finally {
      try {
        await page.close();
      } catch {
        // ignore page close errors
      }
    }
  } finally {
    try {
      await browser.close();
    } catch {
      // ignore browser shutdown errors
    }
  }
}

/**
 * Fetch a page with retries, timeout, and content hashing.
 */
export async function fetchPage(
  url: string,
  opts: FetchOptions & { userAgent?: string; extraHeaders?: Record<string, string> } = {}
): Promise<FetchResult> {
  const {
    headers = {},
    timeoutMs = 10_000,
    retryAttempts = 2,
    retryBaseDelayMs = 300,
    userAgent = DEFAULT_USER_AGENT,
    extraHeaders = {},
    mode = "native",
  } = opts;

  if (mode === "browser") {
    return fetchPageBrowser(url, {
      timeoutMs,
      userAgent,
      extraHeaders: { ...extraHeaders, ...headers },
    });
  }

  const mergedHeaders: Record<string, string> = {
    "User-Agent": userAgent,
    ...extraHeaders,
    ...headers,
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= retryAttempts; attempt++) {
    if (attempt > 0) {
      const backoff = retryBaseDelayMs * Math.pow(2, attempt - 1);
      await delay(backoff);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: mergedHeaders,
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timer);

      const html = await response.text();
      const contentHash = computeContentHash(html);
      const etag = response.headers.get("etag") ?? undefined;

      return {
        html,
        status: response.status,
        etag,
        contentHash,
        finalUrl: response.url || url,
        mode,
      };
    } catch (err) {
      clearTimeout(timer);
      lastError = err;

      // Non-retriable errors: abort (timeout) is retriable, but we check for
      // response-level issues via status above.
      const isAbort = err instanceof Error && err.name === "AbortError";
      const isNetwork = err instanceof TypeError;

      if (!isAbort && !isNetwork) {
        throw err;
      }
    }
  }

  throw lastError;
}
