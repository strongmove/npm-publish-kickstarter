// ─────────────────────────────────────────────────────────────────────────────
// Public API surface for @strongmove/crawler-core
// ─────────────────────────────────────────────────────────────────────────────

// Types
export type {
  ParsedItem,
  PageParseResult,
  PageType,
  PluginMatcher,
  PluginOptions,
  SitePlugin,
  PersistenceAdapter,
  QueueAdapter,
  QueueItem,
  SaveItemResult,
  CrawlerOptions,
  CrawlSummary,
  FetchOptions,
  FetchContext,
  FetchMode,
  FetchModeDecisionContext,
  FetchModeDecisionCallback,
  Logger,
  CrawlEvent,
  LogLevel,
} from "./types";

// Utilities
export {
  resolveHref,
  normalizeTitle,
  computeContentHash,
  safeUrl,
} from "./utils";
export type { ResolveHrefOptions, NormalizeTitleOptions } from "./utils";

// Fetcher
export { fetchPage } from "./fetcher";
export type { FetchResult } from "./fetcher";

// Plugin registry
export {
  registerPlugin,
  clearPlugins,
  getPlugins,
  findPlugin,
} from "./pluginRegistry";

// Crawler engine
export { runCrawl, runWorkerLoop } from "./crawler";

// Event emitter
export { EventEmitter } from "./EventEmitter";

// In-memory / dev adapters
export { InMemoryQueue } from "./adapters/InMemoryQueue";
export { NoopPersistenceAdapter } from "./adapters/NoopPersistenceAdapter";
