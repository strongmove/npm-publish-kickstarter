// ─────────────────────────────────────────────────────────────────────────────
// Core type contracts for @strongmove/crawler-core
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Item & page parse types
// ---------------------------------------------------------------------------

/** A single discovered resource on a crawled page. */
export interface ParsedItem {
  /** Optional plugin-provided identifier (e.g., filename or provider id). */
  idHint?: string | null;
  /** Human-readable title (free text). */
  title?: string | null;
  /** Pre-normalized title; if absent the core will run normalizeTitle. */
  normalizedTitle?: string | null;
  /** One or more URLs/locations representing the resource. */
  locations: string[];
  /** Plugin-specific metadata. */
  meta?: Record<string, unknown>;
  /** The page URL where this item was found. */
  sourceUrl?: string;
}

/** The canonical return type from a SitePlugin.parsePage call. */
export interface PageParseResult {
  /** Items discovered on this page. */
  items: ParsedItem[];
  /** Outgoing URLs to enqueue for further crawling. */
  links: string[];
  /** Base URL for resolving relative hrefs (if the plugin knows it). */
  baseUrl?: string;
  /** Optional page-level metadata captured during parsing. */
  meta?: {
    contentHash?: string;
    etag?: string;
    title?: string;
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/** Known page families the crawler routes by URL pattern. */
export type PageType = "listing" | "detail" | "other";

/** A URL matcher used to select a plugin for a page. */
export interface PluginMatcher {
  /** Matcher mode. */
  type: "exact" | "path" | "regex";
  /** Exact URL, pathname, or regular expression to match against. */
  value: string | RegExp;
}

/** Plugin-specific runtime options. */
export type PluginOptions = Record<string, unknown>;

/** A site-specific parsing plugin registered with the crawl engine. */
export interface SitePlugin {
  /** Unique name for this plugin (used in logs and registry). */
  name: string;
  /** Page family the plugin handles. */
  pageType: PageType;
  /** URL matchers used to select this plugin. */
  matchers?: PluginMatcher[];
  /** Plugin-specific configuration. */
  options?: PluginOptions;
  /** Additional HTTP headers injected for all requests routed to this plugin. */
  defaultHeaders?: Record<string, string>;
  /** Override the base URL used for relative-href resolution. */
  resolveBaseUrl?(url: string): string;
  /** Parse an HTML page and return items + outgoing links. */
  parsePage(
    html: string,
    url: string,
    baseUrl: string
  ): Promise<PageParseResult> | PageParseResult;
}

// ---------------------------------------------------------------------------
// Persistence adapter
// ---------------------------------------------------------------------------

/** Saved-item result returned by PersistenceAdapter.saveItem. */
export interface SaveItemResult {
  id: string;
  created: boolean;
}

/** Adapter interface for persisting crawl state and discovered items. */
export interface PersistenceAdapter {
  /**
   * Attempt to claim a URL for processing.
   * Returns true if the caller should process it; false if it should be skipped.
   */
  tryClaim(
    url: string,
    opts?: { recheckWindowMs?: number; inProgressStaleMs?: number }
  ): Promise<boolean>;

  /** Mark a URL as successfully processed. */
  markDone(
    url: string,
    meta?: {
      contentHash?: string;
      etag?: string;
      lastItemLocation?: string;
      canonicalId?: string | null;
    }
  ): Promise<void>;

  /** Mark a URL as failed. */
  markFailed(url: string, error?: string): Promise<void>;

  /**
   * Get or create a canonical record for a normalized title.
   * Returns the canonical id string, or empty string if not applicable.
   */
  getOrCreateCanonical(
    normalizedTitle: string,
    suggestedType?: string | null,
    category?: string | null
  ): Promise<string>;

  /** Persist a parsed item. */
  saveItem(item: ParsedItem): Promise<SaveItemResult | void>;

  /** Find pending items by parsed title (optional helper for approval flow). */
  findPendingByParsedTitle?(parsedTitle: string): Promise<unknown[]>;
}

// ---------------------------------------------------------------------------
// Queue adapter
// ---------------------------------------------------------------------------

/** A single item in the crawl queue. */
export interface QueueItem {
  /** Unique identifier for this queue entry. */
  id: string;
  /** URL to crawl. */
  url: string;
  /** Optional priority (higher = processed sooner). */
  priority?: number;
  /** Crawl depth from the seed URL. */
  depth: number;
}

/** Adapter interface for the URL crawl queue. */
export interface QueueAdapter {
  /** Add a URL to the queue. */
  enqueue(
    url: string,
    opts?: { priority?: number; depth?: number }
  ): Promise<void>;
  /** Retrieve the next URL to process. Returns null when the queue is empty. */
  dequeue(): Promise<QueueItem | null>;
  /** Acknowledge successful processing of a queue item. */
  ack(itemId: string): Promise<void>;
  /** Return an item to the queue (e.g., after a transient failure). */
  requeue(itemId: string, opts?: { delay?: number }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Logger / event emitter
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Structured log event emitted by the core. */
export interface CrawlEvent {
  level: LogLevel;
  event: string;
  message: string;
  meta?: Record<string, unknown>;
  timestamp: string;
}

/** Logger hook wired by the host application. */
export type Logger = (event: CrawlEvent) => void;

// ---------------------------------------------------------------------------
// Fetch options
// ---------------------------------------------------------------------------

/** Options passed to the internal fetcher. */
export interface FetchOptions {
  /** Additional HTTP headers to merge for this request. */
  headers?: Record<string, string>;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Number of retry attempts on transient errors. */
  retryAttempts?: number;
  /** Base delay (ms) for exponential back-off between retries. */
  retryBaseDelayMs?: number;
}

// ---------------------------------------------------------------------------
// Crawler options
// ---------------------------------------------------------------------------

/** Top-level configuration for a crawl run. */
export interface CrawlerOptions {
  /** Persistence adapter to use (defaults to NoopPersistenceAdapter). */
  persistence?: PersistenceAdapter;
  /** Queue adapter to use (defaults to InMemoryQueue). */
  queue?: QueueAdapter;
  /** Logger callback for all crawl events. */
  logger?: Logger;
  /** Maximum number of concurrent page workers. Default: 1. */
  globalConcurrency?: number;
  /** Minimum delay between requests to the same hostname (ms). Default: 500. */
  perHostDelayMs?: number;
  /** Request timeout per page (ms). Default: 10 000. */
  requestTimeoutMs?: number;
  /** Number of fetch retries on transient errors. Default: 2. */
  retryAttempts?: number;
  /** Maximum crawl depth from seed URLs. Default: 3. */
  maxDepth?: number;
  /** Maximum total pages to crawl per run. Default: 1 000. */
  maxPagesPerRun?: number;
  /** Window in ms within which a done URL is not re-crawled. Default: 30 days. */
  recheckWindowMs?: number;
  /** Duration in ms after which an in-progress claim is considered stale. Default: 5 min. */
  inProgressStaleMs?: number;
  /** Query-string parameter names to strip for URL deduplication. */
  stripQueryParams?: string[];
  /** Override the default User-Agent header. */
  userAgent?: string;
  /** Skip item persistence when the page content hash is unchanged. Default: false. */
  skipPersistOnUnchanged?: boolean;
  /** Extra HTTP headers injected for every request. */
  extraHeaders?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Crawl summary
// ---------------------------------------------------------------------------

/** Summary returned by runCrawl on completion. */
export interface CrawlSummary {
  /** Total pages visited (fetch attempted). */
  pagesVisited: number;
  /** Total pages successfully parsed. */
  pagesParsed: number;
  /** Total items saved. */
  itemsSaved: number;
  /** Total pages that failed. */
  pagesFailed: number;
  /** Elapsed time in milliseconds. */
  elapsedMs: number;
}
