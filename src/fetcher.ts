import { createHash } from "crypto";
import { chromium } from "playwright";
import type {
  BrowserActionPlan,
  BrowserFlowResult,
  FetchMode,
  FetchOptions,
} from "./types";

export interface MediaManifest {
  url: string;
  kind: "m3u8" | "mpd" | "mp4" | "other";
  contentType?: string;
  status?: number;
  body?: string;
}

export interface MediaCapture {
  url: string;
  kind: "manifest" | "segment";
  contentType?: string;
  status?: number;
}

/** Result of a successful fetch operation. */
export interface FetchResult {
  html: string;
  status: number;
  etag?: string;
  contentHash: string;
  finalUrl: string;
  mode?: FetchMode;
  manifest?: MediaManifest;
  mediaUrls?: MediaCapture[];
  networkLog?: MediaCapture[];
  browserFlow?: BrowserFlowResult;
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

function classifyManifestKind(url: string, contentType?: string): MediaManifest["kind"] | null {
  const normalizedUrl = url.toLowerCase();
  const normalizedType = (contentType ?? "").toLowerCase();

  if (normalizedUrl.includes(".m3u8") || normalizedType.includes("application/vnd.apple.mpegurl")) {
    return "m3u8";
  }

  if (normalizedUrl.includes(".mpd") || normalizedType.includes("application/dash+xml")) {
    return "mpd";
  }

  if (normalizedUrl.includes(".mp4") || normalizedType.includes("video/mp4")) {
    return "mp4";
  }

  return null;
}

function classifyMediaCapture(url: string, contentType?: string): MediaCapture["kind"] | null {
  const normalizedUrl = url.toLowerCase();
  const normalizedType = (contentType ?? "").toLowerCase();

  if (normalizedUrl.includes(".m3u8") || normalizedType.includes("application/vnd.apple.mpegurl")) {
    return "manifest";
  }

  if (normalizedUrl.includes(".mpd") || normalizedType.includes("application/dash+xml")) {
    return "manifest";
  }

  if (
    normalizedUrl.includes(".ts") ||
    normalizedUrl.includes(".m4s") ||
    normalizedUrl.includes(".mp4") ||
    normalizedUrl.includes(".m4a") ||
    normalizedType.includes("video/") ||
    normalizedType.includes("audio/")
  ) {
    return "segment";
  }

  return null;
}

async function runBrowserActionPlan(
  page: any,
  plan: BrowserActionPlan
): Promise<BrowserFlowResult> {
  const errors: string[] = [];
  const totalSteps = Math.min(plan.steps.length, plan.maxSteps ?? plan.steps.length);
  let stepsExecuted = 0;

  for (let index = 0; index < totalSteps; index++) {
    const step = plan.steps[index];
    const stepTimeout = step.timeoutMs ?? plan.timeoutMs ?? 5_000;
    const previousUrl = page.url();

    try {
      switch (step.kind) {
        case "waitForSelector": {
          if (!step.selector) {
            throw new Error("waitForSelector requires a selector");
          }
          await page.waitForSelector(step.selector, { state: "visible", timeout: stepTimeout });
          break;
        }
        case "click": {
          if (!step.selector) {
            throw new Error("click requires a selector");
          }
          const target =
            step.index !== undefined
              ? page.locator(step.selector).nth(step.index)
              : page.locator(step.selector);
          await target.click({ timeout: stepTimeout });
          if (step.waitForUrlPattern) {
            await page.waitForURL(step.waitForUrlPattern, { timeout: stepTimeout });
          }
          break;
        }
        case "type": {
          if (!step.selector) {
            throw new Error("type requires a selector");
          }
          const target =
            step.index !== undefined
              ? page.locator(step.selector).nth(step.index)
              : page.locator(step.selector);
          await target.fill(step.text ?? "", { timeout: stepTimeout });
          break;
        }
        case "press": {
          if (!step.selector) {
            throw new Error("press requires a selector");
          }
          const target =
            step.index !== undefined
              ? page.locator(step.selector).nth(step.index)
              : page.locator(step.selector);
          await target.press(step.text ?? "Enter", { timeout: stepTimeout });
          break;
        }
        case "waitForNavigation": {
          await page.waitForNavigation({ timeout: stepTimeout, waitUntil: "domcontentloaded" });
          break;
        }
        case "evaluate": {
          await page.evaluate(step.text ?? "() => undefined");
          break;
        }
        default: {
          errors.push(`Unsupported browser action: ${String((step as { kind?: string }).kind)}`);
          break;
        }
      }

      if (plan.waitForNetworkIdleAfterStep) {
        await page.waitForLoadState("networkidle", { timeout: Math.min(stepTimeout, 2_500) }).catch(() => undefined);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Step ${index + 1} (${step.kind}) failed: ${message}`);
      break;
    }

    stepsExecuted += 1;

    if (plan.stopOnNavigation && page.url() !== previousUrl) {
      break;
    }
  }

  return {
    finalUrl: page.url() || "",
    html: await page.content(),
    status: undefined,
    stepsExecuted,
    errors,
  };
}

async function fetchPageBrowser(
  url: string,
  opts: {
    timeoutMs?: number;
    userAgent?: string;
    extraHeaders?: Record<string, string>;
    browserFlow?: BrowserActionPlan;
  }
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

    const captures: MediaCapture[] = [];
    const manifestByUrl = new Map<string, MediaManifest>();
    const pendingBodyReads: Promise<void>[] = [];
    const seen = new Set<string>();

    page.on("response", async (response) => {
      const responseUrl = response.url();
      const contentType = response.headers()["content-type"] ?? "";
      const kind = classifyMediaCapture(responseUrl, contentType);

      if (!kind) {
        return;
      }

      const dedupeKey = `${kind}:${responseUrl}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        captures.push({
          url: responseUrl,
          kind,
          contentType: contentType || undefined,
          status: response.status(),
        });
      }

      const manifestKind = classifyManifestKind(responseUrl, contentType);
      if (!manifestKind || manifestByUrl.has(responseUrl) || manifestKind === "mp4") {
        return;
      }

      pendingBodyReads.push(
        response
          .text()
          .then((body) => {
            manifestByUrl.set(responseUrl, {
              url: responseUrl,
              kind: manifestKind,
              contentType: contentType || undefined,
              status: response.status(),
              body,
            });
          })
          .catch(() => {
            manifestByUrl.set(responseUrl, {
              url: responseUrl,
              kind: manifestKind,
              contentType: contentType || undefined,
              status: response.status(),
            });
          })
      );
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

      const browserFlow = opts.browserFlow;
      let browserFlowResult: BrowserFlowResult | undefined;
      if (browserFlow && browserFlow.steps.length > 0) {
        browserFlowResult = await runBrowserActionPlan(page, browserFlow);
      }

      await Promise.allSettled(pendingBodyReads);

      const manifestCandidates = Array.from(manifestByUrl.values());
      const manifest =
        manifestCandidates.find((entry) => entry.url === url) ??
        manifestCandidates.find((entry) => entry.url.includes(".m3u8") || entry.url.includes(".mpd")) ??
        manifestCandidates[0];
      const mediaUrls = captures.filter((capture) => capture.kind !== "manifest");
      const html = browserFlowResult?.html ?? (await page.content());
      const finalUrl = browserFlowResult?.finalUrl || page.url() || url;
      const status = response?.status() ?? 200;
      const etag = response?.headers()["etag"];

      const result: FetchResult = {
        html,
        status,
        etag,
        contentHash: computeContentHash(html),
        finalUrl,
        mode: "browser",
        manifest,
        mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
        networkLog: captures.length > 0 ? captures : undefined,
        browserFlow: browserFlowResult,
      };
      return result;
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
    browserFlow,
  } = opts;

  if (mode === "browser") {
    return fetchPageBrowser(url, {
      timeoutMs,
      userAgent,
      extraHeaders: { ...extraHeaders, ...headers },
      browserFlow,
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
