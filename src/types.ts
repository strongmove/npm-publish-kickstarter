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

/** Strategy used to obtain page source before parsing. */
export type FetchMode = "native" | "browser" | "auto";

/** Metadata provided to custom fetch-strategy callbacks. */
export interface FetchModeDecisionContext {
  /** URL currently being processed. */
  url: string;
  /** The native HTML returned by the initial fetch. */
  html: string;
  /** HTTP status code from the native fetch, if available. */
  status?: number;
  /** List of selectors the plugin expects to find in a valid page. */
  selectors?: string[];
  /** Page family the plugin handles. */
  pageType?: PageType;
}

/** Richer fetch payload passed to content parsers. */
export interface FetchContext {
  /** Original request URL. */
  url: string;
  /** Base URL used to resolve relative links. */
  baseUrl: string;
  /** Page HTML source for the final fetch result. */
  html: string;
  /** HTTP status code from the response, if any. */
  status?: number;
  /** ETag from the response, if any. */
  etag?: string;
  /** SHA-256 hash of the page HTML. */
  contentHash?: string;
  /** Final URL after redirects or browser rendering. */
  finalUrl?: string;
  /** Fetch strategy used to produce the page. */
  mode?: FetchMode;
  /** Media manifest discovered for the page, if any. */
  manifest?: {
    url: string;
    kind: "m3u8" | "mpd" | "mp4" | "other";
    contentType?: string;
    status?: number;
    body?: string;
  };
  /** Media resources discovered while fetching the page. */
  mediaUrls?: Array<{
    url: string;
    kind: "manifest" | "segment";
    contentType?: string;
    status?: number;
  }>;
  /** Network log of captured media requests/responses. */
  networkLog?: Array<{
    url: string;
    kind: "manifest" | "segment";
    contentType?: string;
    status?: number;
  }>;
  /** Extra fetch metadata added by adapters or future fetchers. */
  metadata?: Record<string, unknown>;
  /** Optional browser interaction flow metadata captured during fetch. */
  browserFlow?: BrowserFlowResult;
}

/** Custom callback used by the automatic fetch strategy. */
export type FetchModeDecisionCallback = (
  context: FetchModeDecisionContext
) => FetchMode | Promise<FetchMode>;

export type BrowserActionKind =
  | "click"
  | "waitForSelector"
  | "type"
  | "press"
  | "waitForNavigation"
  | "evaluate";

export interface BrowserActionStep {
  /** Action kind to perform in the browser. */
  kind: BrowserActionKind;
  /** CSS selector to locate the target element. */
  selector?: string;
  /** Text value for type/press/evaluate actions. */
  text?: string;
  /** Optional index when targeting a collection. */
  index?: number;
  /** Timeout for this individual step, in milliseconds. */
  timeoutMs?: number;
  /** Optional URL pattern to wait for after the action completes. */
  waitForUrlPattern?: string | RegExp;
}

export interface BrowserActionPlan {
  /** Ordered browser steps to run before parsing. */
  steps: BrowserActionStep[];
  /** Maximum number of steps to execute. Defaults to the full plan length. */
  maxSteps?: number;
  /** Shared timeout for steps without an individual override. */
  timeoutMs?: number;
  /** Whether to stop once the page navigates away. */
  stopOnNavigation?: boolean;
  /** Whether to wait for network idle after each step. */
  waitForNetworkIdleAfterStep?: boolean;
}

export interface BrowserFlowResult {
  /** Final URL after interaction. */
  finalUrl: string;
  /** Final page HTML snapshot after interaction. */
  html: string;
  /** Final HTTP status code, when available. */
  status?: number;
  /** Number of steps executed before stopping or finishing. */
  stepsExecuted: number;
  /** Error messages captured while running the flow. */
  errors: string[];
}

/** Declarative crawl behavior for pages handled by a plugin. */
export interface SitePluginCrawlPolicy {
  /** Skip a page if it was already completed within this window. */
  recheckWindowMs?: number;
  /** Consider an in-progress claim stale after this many milliseconds. */
  inProgressStaleMs?: number;
  /** Maximum crawl depth for URLs matched by this plugin. */
  maxDepth?: number;
  /** Per-page request timeout for this plugin's matches. */
  requestTimeoutMs?: number;
  /** Retry budget for this plugin's fetches. */
  retryAttempts?: number;
  /** Skip persisting new items when the content hash has not changed. */
  skipPersistOnUnchanged?: boolean;
  /** Skip the network fetch entirely for matched pages. */
  skipFetch?: boolean;
  /** Whether to follow and enqueue links discovered on matched pages. */
  followLinks?: boolean;
  /** Preferred fetching strategy for this plugin. */
  fetchMode?: FetchMode;
  /** Optional declarative browser interaction flow used after the page loads. */
  browserFlow?: BrowserActionPlan;
  /** Browser interaction support mode for a plugin. */
  browserInteractionMode?: "disabled" | "basic";
  /** Optional selectors used to gauge whether native HTML is usable. */
  requiredSelectors?: string[];
  /** Minimum number of required selector matches before a page is considered usable. */
  minSelectorMatches?: number;
  /** Minimum meaningful text length before a native page is considered usable. */
  minTextLength?: number;
  /** Custom callback used when `fetchMode` is `auto`. */
  autoFetchDecision?: FetchModeDecisionCallback;
}

/** A site-specific parsing plugin registered with the crawl engine. */
export interface SitePlugin {
  /** Unique name for this plugin (used in logs and registry). */
  name: string;
  /** Page family the plugin handles. */
  pageType: PageType;
  /** URL matchers used to select this plugin. */
  matchers?: PluginMatcher[];
  /** Declarative crawl behavior for this plugin's matched pages. */
  crawlPolicy?: SitePluginCrawlPolicy;
  /** Plugin-specific configuration. */
  options?: PluginOptions;
  /** Additional HTTP headers injected for all requests routed to this plugin. */
  defaultHeaders?: Record<string, string>;
  /** Override the base URL used for relative-href resolution. */
  resolveBaseUrl?(url: string): string;
  /**
   * Legacy parse hook taking raw HTML and request metadata.
   *
   * Kept intentionally permissive because existing plugins historically used one
   * of several call signatures (`parsePage(html)`, `parsePage(html, url)`,
   * `parsePage(html, url, baseUrl)`) and newer plugins should prefer the richer
   * `parseFetchedData(context)` hook instead.
   */
  parsePage?: (...args: any[]) => Promise<PageParseResult> | PageParseResult;
  /** New richer parse hook receiving the full fetch context. */
  parseFetchedData?(context: FetchContext): Promise<PageParseResult> | PageParseResult;
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
  /** Which fetching strategy to prefer for this request. */
  mode?: FetchMode;
  /** Optional browser interaction plan to run before the final HTML is returned. */
  browserFlow?: BrowserActionPlan;
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
  /** Default fetch strategy for this crawl run. */
  defaultFetchMode?: FetchMode;
  /** Optional browser interaction plan to run when a browser fetch is selected. */
  browserFlow?: BrowserActionPlan;
  /** Browser interaction support mode for this crawl run. */
  browserInteractionMode?: "disabled" | "basic";
  /** Optional callback used when a plugin is configured with `fetchMode: "auto"`. */
  defaultAutoFetchDecision?: FetchModeDecisionCallback;
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
