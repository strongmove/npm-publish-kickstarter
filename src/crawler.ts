import type {
  CrawlerOptions,
  CrawlSummary,
  ParsedItem,
  PersistenceAdapter,
  QueueAdapter,
  QueueItem,
} from "./types";
import { NoopPersistenceAdapter } from "./adapters/NoopPersistenceAdapter";
import { InMemoryQueue } from "./adapters/InMemoryQueue";
import { EventEmitter } from "./EventEmitter";
import { fetchPage } from "./fetcher";
import { findPlugin } from "./pluginRegistry";
import { resolveHref } from "./utils";
import { normalizeTitle } from "./utils";
import { HostThrottle } from "./HostThrottle";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS = {
  globalConcurrency: 1,
  perHostDelayMs: 500,
  requestTimeoutMs: 10_000,
  retryAttempts: 2,
  maxDepth: 3,
  maxPagesPerRun: 1_000,
  recheckWindowMs: 30 * 24 * 60 * 60 * 1_000, // 30 days
  inProgressStaleMs: 5 * 60 * 1_000, // 5 minutes
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  skipPersistOnUnchanged: false,
} as const;

// ---------------------------------------------------------------------------
// Shared crawl state
// ---------------------------------------------------------------------------

interface CrawlState {
  visited: Set<string>;
  pagesVisited: number;
  pagesParsed: number;
  itemsSaved: number;
  pagesFailed: number;
}

// ---------------------------------------------------------------------------
// processPage — single page worker logic
// ---------------------------------------------------------------------------

async function processPage(
  item: QueueItem,
  state: CrawlState,
  opts: Required<
    Pick<
      CrawlerOptions,
      | "maxDepth"
      | "requestTimeoutMs"
      | "retryAttempts"
      | "recheckWindowMs"
      | "inProgressStaleMs"
      | "skipPersistOnUnchanged"
      | "userAgent"
      | "stripQueryParams"
    >
  > & { extraHeaders?: Record<string, string> },
  persistence: PersistenceAdapter,
  queue: QueueAdapter,
  throttle: HostThrottle,
  emitter: EventEmitter
): Promise<void> {
  const { url, depth, id: itemId } = item;

  // Depth guard.
  if (depth > opts.maxDepth) {
    await queue.ack(itemId);
    return;
  }

  // In-run dedup (visited set already checked before enqueue, but double-check).
  if (state.visited.has(url)) {
    await queue.ack(itemId);
    return;
  }
  state.visited.add(url);
  state.pagesVisited++;

  // Cross-run claim.
  const claimed = await persistence.tryClaim(url, {
    recheckWindowMs: opts.recheckWindowMs,
    inProgressStaleMs: opts.inProgressStaleMs,
  });

  if (!claimed) {
    emitter.debug("claim.skipped", `Skipping already-claimed URL`, { url });
    await queue.ack(itemId);
    return;
  }

  emitter.info("claim.taken", `Claimed URL for processing`, { url, depth });

  // Throttle per-host.
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    // ignore invalid URLs
  }
  await throttle.wait(hostname);

  // Find plugin.
  const plugin = findPlugin(url);
  if (!plugin) {
    emitter.warn("parse.error", `No plugin found for URL — skipping`, { url });
    await persistence.markFailed(url, "No plugin registered for this URL");
    state.pagesFailed++;
    await queue.ack(itemId);
    return;
  }

  // Merge plugin default headers.
  const pluginHeaders = plugin.defaultHeaders ?? {};

  emitter.info("fetch.start", `Fetching page`, { url });

  let fetchResult: Awaited<ReturnType<typeof fetchPage>>;
  try {
    fetchResult = await fetchPage(url, {
      headers: pluginHeaders,
      timeoutMs: opts.requestTimeoutMs,
      retryAttempts: opts.retryAttempts,
      userAgent: opts.userAgent,
      extraHeaders: opts.extraHeaders,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitter.error("url.failed", `Fetch failed`, { url, error: msg });
    await persistence.markFailed(url, msg);
    state.pagesFailed++;
    await queue.ack(itemId);
    return;
  }

  emitter.info("fetch.end", `Fetch complete`, {
    url,
    status: fetchResult.status,
    contentHash: fetchResult.contentHash,
  });

  // Parse page.
  const baseUrl =
    plugin.resolveBaseUrl?.(fetchResult.finalUrl) ?? fetchResult.finalUrl;

  let parseResult: Awaited<ReturnType<typeof plugin.parsePage>>;
  try {
    parseResult = await plugin.parsePage(fetchResult.html, url, baseUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitter.error("parse.error", `Plugin parse failed`, { url, error: msg });
    await persistence.markFailed(url, `Parse error: ${msg}`);
    state.pagesFailed++;
    await queue.ack(itemId);
    return;
  }

  state.pagesParsed++;

  emitter.info("parse.result", `Parse complete`, {
    url,
    items: parseResult.items.length,
    links: parseResult.links.length,
  });

  // Persist items.
  let lastItemLocation: string | undefined;
  let lastCanonicalId: string | undefined;

  const shouldSkipPersist =
    opts.skipPersistOnUnchanged &&
    parseResult.meta?.contentHash === fetchResult.contentHash;

  if (!shouldSkipPersist) {
    for (const rawItem of parseResult.items) {
      const item: ParsedItem = { ...rawItem, sourceUrl: url };

      // Ensure normalizedTitle.
      if (!item.normalizedTitle && item.title) {
        item.normalizedTitle = normalizeTitle(item.title);
      }

      // Get or create canonical record.
      let canonicalId = "";
      if (item.normalizedTitle) {
        try {
          canonicalId = await persistence.getOrCreateCanonical(
            item.normalizedTitle,
            null,
            null
          );
        } catch (err) {
          emitter.warn("item.skipped", `getOrCreateCanonical failed`, {
            url,
            normalizedTitle: item.normalizedTitle,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Save item.
      try {
        await persistence.saveItem(item);
        state.itemsSaved++;
        lastCanonicalId = canonicalId || undefined;
        lastItemLocation = item.locations[0] ?? undefined;
        emitter.info("item.saved", `Item saved`, {
          url,
          idHint: item.idHint,
          normalizedTitle: item.normalizedTitle,
        });
      } catch (err) {
        emitter.warn("item.skipped", `saveItem failed`, {
          url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Enqueue discovered links.
  const resolveBase = parseResult.baseUrl ?? baseUrl;

  for (const link of parseResult.links) {
    const resolved = resolveHref(resolveBase, link, {
      stripQueryParams: opts.stripQueryParams,
    });

    if (!resolved) continue;
    if (state.visited.has(resolved)) continue;

    await queue.enqueue(resolved, { depth: depth + 1 });
    emitter.debug("link.enqueue", `Enqueued link`, {
      from: url,
      to: resolved,
      depth: depth + 1,
    });
  }

  // Mark done.
  await persistence.markDone(url, {
    contentHash: fetchResult.contentHash,
    etag: fetchResult.etag,
    lastItemLocation,
    canonicalId: lastCanonicalId ?? null,
  });

  emitter.info("url.done", `URL processed`, { url });
  await queue.ack(itemId);
}

// ---------------------------------------------------------------------------
// runCrawl
// ---------------------------------------------------------------------------

/**
 * Run a full crawl starting from `seedUrls`.
 *
 * This is the primary entry-point. Call `registerPlugin` for each
 * SitePlugin before invoking this function.
 *
 * @returns A CrawlSummary with aggregate statistics.
 */
export async function runCrawl(
  seedUrls: string[],
  opts: CrawlerOptions = {}
): Promise<CrawlSummary> {
  const startTime = Date.now();

  const persistence: PersistenceAdapter =
    opts.persistence ?? new NoopPersistenceAdapter();
  const queue: QueueAdapter = opts.queue ?? new InMemoryQueue();
  const emitter = new EventEmitter(opts.logger);

  const concurrency = opts.globalConcurrency ?? DEFAULTS.globalConcurrency;
  const perHostDelayMs = opts.perHostDelayMs ?? DEFAULTS.perHostDelayMs;
  const maxPagesPerRun = opts.maxPagesPerRun ?? DEFAULTS.maxPagesPerRun;
  const maxDepth = opts.maxDepth ?? DEFAULTS.maxDepth;
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;
  const retryAttempts = opts.retryAttempts ?? DEFAULTS.retryAttempts;
  const recheckWindowMs = opts.recheckWindowMs ?? DEFAULTS.recheckWindowMs;
  const inProgressStaleMs = opts.inProgressStaleMs ?? DEFAULTS.inProgressStaleMs;
  const userAgent = opts.userAgent ?? DEFAULTS.userAgent;
  const skipPersistOnUnchanged =
    opts.skipPersistOnUnchanged ?? DEFAULTS.skipPersistOnUnchanged;
  const stripQueryParams = opts.stripQueryParams ?? [];

  const pageOpts = {
    maxDepth,
    requestTimeoutMs,
    retryAttempts,
    recheckWindowMs,
    inProgressStaleMs,
    skipPersistOnUnchanged,
    userAgent,
    stripQueryParams,
    extraHeaders: opts.extraHeaders,
  };

  const throttle = new HostThrottle(perHostDelayMs);

  const state: CrawlState = {
    visited: new Set<string>(),
    pagesVisited: 0,
    pagesParsed: 0,
    itemsSaved: 0,
    pagesFailed: 0,
  };

  // Seed the queue.
  for (const url of seedUrls) {
    await queue.enqueue(url, { depth: 0 });
  }

  emitter.info("crawl.start", `Crawl started`, {
    seeds: seedUrls.length,
    concurrency,
    maxDepth,
    maxPagesPerRun,
  });

  // Worker pool: up to `concurrency` workers pull from the queue concurrently.
  const runWorker = async (): Promise<void> => {
    while (state.pagesVisited < maxPagesPerRun) {
      const item = await queue.dequeue();
      if (!item) break;

      await processPage(
        item,
        state,
        pageOpts,
        persistence,
        queue,
        throttle,
        emitter
      );
    }
  };

  const workers = Array.from({ length: concurrency }, () => runWorker());
  await Promise.all(workers);

  const summary: CrawlSummary = {
    pagesVisited: state.pagesVisited,
    pagesParsed: state.pagesParsed,
    itemsSaved: state.itemsSaved,
    pagesFailed: state.pagesFailed,
    elapsedMs: Date.now() - startTime,
  };

  emitter.info("crawl.end", `Crawl finished`, summary as unknown as Record<string, unknown>);

  return summary;
}

// ---------------------------------------------------------------------------
// runWorkerLoop — background worker variant
// ---------------------------------------------------------------------------

/**
 * Run a long-lived background worker that continuously processes items from
 * the queue until it is empty or an optional `signal` is aborted.
 *
 * Useful for external queue adapters (e.g., Redis) where items are fed
 * externally. Pass an `AbortController.signal` to gracefully stop the loop.
 */
export async function runWorkerLoop(
  opts: CrawlerOptions & { signal?: AbortSignal } = {}
): Promise<void> {
  const persistence: PersistenceAdapter =
    opts.persistence ?? new NoopPersistenceAdapter();
  const queue: QueueAdapter = opts.queue ?? new InMemoryQueue();
  const emitter = new EventEmitter(opts.logger);
  const throttle = new HostThrottle(
    opts.perHostDelayMs ?? DEFAULTS.perHostDelayMs
  );

  const maxDepth = opts.maxDepth ?? DEFAULTS.maxDepth;
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;
  const retryAttempts = opts.retryAttempts ?? DEFAULTS.retryAttempts;
  const recheckWindowMs = opts.recheckWindowMs ?? DEFAULTS.recheckWindowMs;
  const inProgressStaleMs = opts.inProgressStaleMs ?? DEFAULTS.inProgressStaleMs;
  const userAgent = opts.userAgent ?? DEFAULTS.userAgent;
  const skipPersistOnUnchanged =
    opts.skipPersistOnUnchanged ?? DEFAULTS.skipPersistOnUnchanged;
  const stripQueryParams = opts.stripQueryParams ?? [];

  const pageOpts = {
    maxDepth,
    requestTimeoutMs,
    retryAttempts,
    recheckWindowMs,
    inProgressStaleMs,
    skipPersistOnUnchanged,
    userAgent,
    stripQueryParams,
    extraHeaders: opts.extraHeaders,
  };

  const state: CrawlState = {
    visited: new Set<string>(),
    pagesVisited: 0,
    pagesParsed: 0,
    itemsSaved: 0,
    pagesFailed: 0,
  };

  emitter.info("worker.start", "Worker loop started", {});

  while (!opts.signal?.aborted) {
    const item = await queue.dequeue();
    if (!item) {
      // No work: short idle wait before checking again.
      await new Promise<void>((r) => setTimeout(r, 200));
      continue;
    }

    await processPage(item, state, pageOpts, persistence, queue, throttle, emitter);
  }

  emitter.info("worker.stop", "Worker loop stopped", {});
}
