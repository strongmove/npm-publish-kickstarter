import type { CrawlEvent, Logger, LogLevel } from "./types";

/**
 * Internal event emitter used throughout the core engine.
 *
 * Callers wire a Logger callback via CrawlerOptions.logger to receive all
 * structured events. The emitter is also usable standalone for tests.
 */
export class EventEmitter {
  private logger: Logger | undefined;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  emit(
    level: LogLevel,
    event: string,
    message: string,
    meta?: Record<string, unknown>
  ): void {
    if (!this.logger) return;

    const crawlEvent: CrawlEvent = {
      level,
      event,
      message,
      meta,
      timestamp: new Date().toISOString(),
    };

    try {
      this.logger(crawlEvent);
    } catch {
      // Swallow logger errors to prevent them from crashing the crawl.
    }
  }

  info(event: string, message: string, meta?: Record<string, unknown>): void {
    this.emit("info", event, message, meta);
  }

  warn(event: string, message: string, meta?: Record<string, unknown>): void {
    this.emit("warn", event, message, meta);
  }

  error(event: string, message: string, meta?: Record<string, unknown>): void {
    this.emit("error", event, message, meta);
  }

  debug(event: string, message: string, meta?: Record<string, unknown>): void {
    this.emit("debug", event, message, meta);
  }
}
