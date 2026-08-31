# arachnis — `@strongmove/crawler-core`

A small, well-factored crawl engine + plugin API.  
Fetches pages, parses them via **site plugins**, persists discovered **items** via a pluggable **persistence adapter**, and discovers new URLs to crawl.  
No domain-specific logic bundled — bring your own parser and database.

---

## Table of Contents

1. [Package Goal](#1-package-goal)
2. [Quick Start](#2-quick-start)
3. [Overall Workflow](#3-overall-workflow)
4. [Component Reference](#4-component-reference)
   - [Types](#41-types)
   - [Utilities](#42-utilities)
   - [Plugin Registry](#43-plugin-registry)
   - [Crawler Engine](#44-crawler-engine)
   - [Fetcher](#45-fetcher)
   - [In-Memory Dev Adapters](#46-in-memory-dev-adapters)
   - [Event Emitter](#47-event-emitter)
   - [Test Harness](#48-test-harness)
5. [Adapter Contracts](#5-adapter-contracts)
   - [PersistenceAdapter](#51-persistenceadapter)
   - [QueueAdapter](#52-queueadapter)
6. [Plugin Author Guide](#6-plugin-author-guide)
7. [Configuration Defaults](#7-configuration-defaults)
8. [Publishing to GitHub Packages (Private NPM)](#8-publishing-to-github-packages-private-npm)
9. [Adapting Existing Projects](#9-adapting-existing-projects)
10. [Testing Guide](#10-testing-guide)
11. [Security & Legal](#11-security--legal)
12. [Migration Guide](#12-migration-guide)

---

## 1. Package Goal

`@strongmove/crawler-core` provides:

- A **fetcher** (native `fetch`, browser-render fallback, retries, timeout, content-hash, etag capture).
- A **plugin registry** for site-specific HTML parsers.
- A **worker pool** that manages concurrency, per-host throttling, depth limiting, and URL deduplication.
- Pluggable **PersistenceAdapter** and **QueueAdapter** interfaces.
- In-memory dev adapters (`InMemoryQueue`, `NoopPersistenceAdapter`).
- Utility functions: `resolveHref`, `normalizeTitle`, `computeContentHash`, `safeUrl`.
- A structured **event/logging** hook.
- A **test harness** (`runPluginTest`) for plugin unit tests.

---

## 2. Quick Start

### Install

```bash
# In your consumer project:
npm install @strongmove/crawler-core
```

> For private GitHub Packages, see [Section 8](#8-publishing-to-github-packages-private-npm).

### Minimal Example

```typescript
import {
  registerPlugin,
  runCrawl,
  NoopPersistenceAdapter,
} from "@strongmove/crawler-core";
import type { SitePlugin } from "@strongmove/crawler-core";

// 1. Define a plugin for your target site.
const MyPlugin: SitePlugin = {
  name: "my-site",
  pageType: "listing",
  matchers: [{ type: "path", value: "/products" }],
  crawlPolicy: {
    recheckWindowMs: 60_000,
    maxDepth: 1,
    followLinks: true,
  },
  parsePage(html, url, baseUrl) {
    // Use cheerio, regex, or any HTML parser here.
    return {
      items: [],   // Discovered resources
      links: [],   // URLs to crawl next
      baseUrl,
    };
  },
};

// 2. Register the plugin.
registerPlugin(MyPlugin);

// 3. Run the crawl.
const summary = await runCrawl(["https://mysite.com/"], {
  persistence: new NoopPersistenceAdapter(), // swap with your real adapter
  globalConcurrency: 2,
  maxDepth: 3,
  logger: (event) => console.log(`[${event.level}] ${event.event}: ${event.message}`),
});

console.log(summary);
// { pagesVisited: 42, pagesParsed: 42, itemsSaved: 17, pagesFailed: 0, elapsedMs: 1234 }
```

---

## 3. Overall Workflow

```
seedUrls[]
    │
    ▼
┌────────────────────────────────────────────────────────────────────┐
│                          runCrawl()                                │
│                                                                    │
│  QueueAdapter.enqueue(seed, depth=0)                               │
│                                                                    │
│  ┌─── Worker Pool (globalConcurrency workers) ──────────────────┐  │
│  │                                                              │  │
│  │  dequeue() ──▶ visited? ──yes──▶ ack & continue             │  │
│  │      │                                                       │  │
│  │      no                                                      │  │
│  │      │                                                       │  │
│  │  tryClaim(url) ──false──▶ ack & continue (claim.skipped)    │  │
│  │      │                                                       │  │
│  │      true                                                    │  │
│  │      │                                                       │  │
│  │  throttle.wait(hostname)   ← per-host delay                 │  │
│  │      │                                                       │  │
│  │  fetchPage(url) ──error──▶ markFailed() & continue          │  │
│  │      │                                                       │  │
│  │  plugin.parsePage(html, url, baseUrl)                        │  │
│  │      │                                                       │  │
│  │  for each ParsedItem:                                        │  │
│  │    normalizeTitle() if needed                                │  │
│  │    getOrCreateCanonical(normalizedTitle)                     │  │
│  │    saveItem(item)                                            │  │
│  │      │                                                       │  │
│  │  for each link:                                              │  │
│  │    resolveHref(base, link)                                   │  │
│  │    enqueue(resolved, depth+1)                                │  │
│  │      │                                                       │  │
│  │  markDone(url)                                               │  │
│  │  ack(itemId)                                                 │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
    │
    ▼
CrawlSummary { pagesVisited, pagesParsed, itemsSaved, pagesFailed, elapsedMs }
```

**Key rules:**

| Rule | Value |
|---|---|
| In-run dedup | `Set<string>` of visited URLs per run |
| Cross-run dedup | `persistence.tryClaim()` — coordinates across workers/runs |
| Per-host politeness | `perHostDelayMs` (default 500 ms) |
| Global workers | `globalConcurrency` (default 1) |
| Max depth | `maxDepth` (default 3) |
| Max pages/run | `maxPagesPerRun` (default 1 000) |

---

## 4. Component Reference

### 4.1 Types

All types are exported from `@strongmove/crawler-core`.

#### `ParsedItem`

A single resource discovered on a crawled page.

```typescript
interface ParsedItem {
  idHint?: string | null;          // Plugin-provided identifier
  title?: string | null;           // Human-readable title
  normalizedTitle?: string | null; // Core sets this if absent
  locations: string[];             // One or more resource URLs
  meta?: Record<string, unknown>;  // Plugin-specific metadata
  sourceUrl?: string;              // Page where item was found (set by core)
}
```

#### `PageParseResult`

Returned by every `SitePlugin.parsePage` call.

```typescript
interface PageParseResult {
  items: ParsedItem[];   // Discovered resources (may be empty)
  links: string[];       // URLs to enqueue for further crawling
  baseUrl?: string;      // Base for relative-href resolution
  meta?: {
    contentHash?: string;
    etag?: string;
    title?: string;
  };
}
```

#### `SitePlugin`

```typescript
interface SitePlugin {
  name: string;
  pageType: "listing" | "detail" | "other";
  matchers?: Array<{
    type: "exact" | "path" | "regex";
    value: string | RegExp;
  }>;
  crawlPolicy?: {
    recheckWindowMs?: number;
    inProgressStaleMs?: number;
    maxDepth?: number;
    requestTimeoutMs?: number;
    retryAttempts?: number;
    skipPersistOnUnchanged?: boolean;
    skipFetch?: boolean;
    followLinks?: boolean;
    fetchMode?: "native" | "browser" | "auto";
    requiredSelectors?: string[];
    minSelectorMatches?: number;
    minTextLength?: number;
    autoFetchDecision?: (ctx: {
      url: string;
      html: string;
      status?: number;
      selectors?: string[];
      pageType?: "listing" | "detail" | "other";
    }) => "native" | "browser" | "auto" | Promise<"native" | "browser" | "auto">;
  };
  defaultHeaders?: Record<string, string>; // Injected for every request
  resolveBaseUrl?(url: string): string;    // Override base URL computation
  parsePage(html: string, url: string, baseUrl: string): Promise<PageParseResult> | PageParseResult;
}
```

#### Request strategies

The crawler supports three request strategies for source acquisition:

- `native`: use the lightweight HTTP fetch path by default. This is the fastest and easiest choice for server-rendered pages.
- `browser`: use the browser-rendered path. This is appropriate for pages where the content is injected after JS runs.
- `auto`: try `native` first, then decide whether the HTML is usable. If the page looks like an empty shell or the expected selectors are missing, switch to the browser path.

`auto` is intended to preserve the static-first default while still handling JS-heavy pages. It supports a simple built-in heuristic and an optional custom callback for unusual cases.

```typescript
const MyPlugin: SitePlugin = {
  name: "example",
  pageType: "detail",
  matchers: [{ type: "path", value: "/products" }],
  crawlPolicy: {
    fetchMode: "auto",
    requiredSelectors: [".product-card", "article"],
    minSelectorMatches: 1,
    minTextLength: 200,
    autoFetchDecision: async ({ html, url }) => {
      if (html.includes("__NEXT_DATA__") && !html.includes("product-card")) {
        return "browser";
      }
      return "native";
    },
  },
  parsePage(html) {
    return { items: [], links: [] };
  },
};
```

#### `CrawlerOptions`

All fields are optional — sensible defaults apply.

```typescript
interface CrawlerOptions {
  persistence?: PersistenceAdapter; // Default: NoopPersistenceAdapter
  queue?: QueueAdapter;             // Default: InMemoryQueue
  logger?: Logger;                  // Default: silent
  globalConcurrency?: number;       // Default: 1
  perHostDelayMs?: number;          // Default: 500
  requestTimeoutMs?: number;        // Default: 10 000
  retryAttempts?: number;           // Default: 2
  maxDepth?: number;                // Default: 3
  maxPagesPerRun?: number;          // Default: 1 000
  recheckWindowMs?: number;         // Default: 30 days
  inProgressStaleMs?: number;       // Default: 5 min
  stripQueryParams?: string[];      // Query params stripped for dedup
  userAgent?: string;
  skipPersistOnUnchanged?: boolean; // Default: false
  extraHeaders?: Record<string, string>;
  defaultFetchMode?: "native" | "browser" | "auto"; // Default: "native"
  defaultAutoFetchDecision?: (ctx: {
    url: string;
    html: string;
    status?: number;
    selectors?: string[];
    pageType?: "listing" | "detail" | "other";
  }) => "native" | "browser" | "auto" | Promise<"native" | "browser" | "auto">;
}
```

#### `CrawlSummary`

```typescript
interface CrawlSummary {
  pagesVisited: number;
  pagesParsed: number;
  itemsSaved: number;
  pagesFailed: number;
  elapsedMs: number;
}
```

#### `Logger` / `CrawlEvent`

```typescript
type Logger = (event: CrawlEvent) => void;

interface CrawlEvent {
  level: "debug" | "info" | "warn" | "error";
  event: string;   // e.g. "fetch.start", "item.saved", "url.failed"
  message: string;
  meta?: Record<string, unknown>;
  timestamp: string; // ISO 8601
}
```

**Standard event names:** `fetch.start`, `fetch.end`, `parse.error`, `parse.result`, `item.saved`, `item.skipped`, `link.enqueue`, `claim.taken`, `claim.skipped`, `url.done`, `url.failed`, `crawl.start`, `crawl.end`, `worker.start`, `worker.stop`.

---

### 4.2 Utilities

#### `resolveHref(base, href, options?)`

Produces a canonical absolute URL suitable for queueing and deduplication.

```typescript
import { resolveHref } from "@strongmove/crawler-core";

resolveHref("https://example.com/path/page", "sibling")
// → "https://example.com/path/sibling"

resolveHref("https://example.com/", "#section")
// → ""  (fragments discarded by default)

resolveHref("https://example.com/", "https://other.com/page?utm_source=x", {
  stripQueryParams: ["utm_source"],
})
// → "https://other.com/page"
```

Rules:
- `data:` and `javascript:` → empty string (ignored).
- Fragment-only (`#...`) → empty string unless `preserveFragment: true`.
- Protocol-relative (`//host/path`) → prepends protocol from base.
- Relative paths resolved via `new URL(href, base)`.
- Host lowercased; default ports (`:80`, `:443`) stripped.
- Trailing slash removed (except root `/`).

#### `normalizeTitle(title, options?)`

Canonical text key for item matching across sites.

```typescript
import { normalizeTitle } from "@strongmove/crawler-core";

normalizeTitle('  "Hello  World"  ')  // → "hello world"
normalizeTitle("ＨＥＬＬＯ")          // → "hello"  (NFKC normalization)
normalizeTitle("Hello", { preserveCase: true }) // → "Hello"
```

Core behaviour (neutral — no language-specific heuristics):
1. NFKC Unicode normalization.
2. Remove invisible / zero-width characters.
3. Non-breaking spaces → regular spaces.
4. Collapse whitespace.
5. Strip surrounding quotes and brackets.
6. Trim and lowercase.

> **Extend it:** for project-specific stripping (e.g. episode markers), run your own regex on the title *before or after* calling `normalizeTitle`.

#### `computeContentHash(body)`

SHA-256 hex hash of a string — used for change detection.

```typescript
import { computeContentHash } from "@strongmove/crawler-core";
computeContentHash("<html>...</html>"); // → "a3f5..."
```

#### `safeUrl(url)`

Returns the URL if valid `http(s)`, otherwise returns `""`.

```typescript
import { safeUrl } from "@strongmove/crawler-core";
safeUrl("https://ok.com/path"); // → "https://ok.com/path"
safeUrl("ftp://blocked.com");   // → ""
safeUrl("bad string");          // → ""
```

---

### 4.3 Plugin Registry

```typescript
import {
  registerPlugin,
  clearPlugins,
  getPlugins,
  findPlugin,
} from "@strongmove/crawler-core";

registerPlugin(MyPlugin);         // Add a plugin
getPlugins();                     // → SitePlugin[]
findPlugin("https://mysite.com"); // → SitePlugin | undefined
clearPlugins();                   // Remove all (useful in tests)
```

**Routing order:**
1. Best URL match based on matcher specificity (`exact` > `path` > `regex`) and `pageType` priority (`detail` > `listing` > `other`).
2. Catch-all `pageType: "other"` plugin if no more specific match exists.
3. `undefined` → page is skipped with `markFailed`.

---

### 4.4 Crawler Engine

#### `runCrawl(seedUrls, opts?)`

Run a bounded crawl from a list of seed URLs.

```typescript
import { runCrawl } from "@strongmove/crawler-core";

const summary = await runCrawl(["https://mysite.com/"], {
  persistence: myPersistenceAdapter,
  queue: myQueueAdapter,        // Optional; defaults to InMemoryQueue
  globalConcurrency: 4,
  maxDepth: 3,
  perHostDelayMs: 500,
  logger: (e) => console.log(e),
});
```

#### `runWorkerLoop(opts?)`

Long-lived background worker — keeps pulling from the queue until it is empty or a signal fires. Suitable for external queue adapters (Redis, BullMQ).

```typescript
import { runWorkerLoop } from "@strongmove/crawler-core";

const controller = new AbortController();

// Stop after 60 seconds.
setTimeout(() => controller.abort(), 60_000);

await runWorkerLoop({
  persistence: myAdapter,
  queue: myRedisQueue,
  signal: controller.signal,
});
```

---

### 4.5 Fetcher

Used internally by the crawler, but exported for custom use.

```typescript
import { fetchPage } from "@strongmove/crawler-core";

const result = await fetchPage("https://example.com/page", {
  timeoutMs: 5000,
  retryAttempts: 2,
  userAgent: "MyBot/1.0",
  extraHeaders: { "Accept-Language": "en" },
});

// result.html         — raw HTML string
// result.status       — HTTP status code
// result.contentHash  — SHA-256 of body
// result.etag         — value of ETag response header
// result.finalUrl     — URL after redirects
```

The fetcher now includes a built-in browser path for `mode: "browser"` and `mode: "auto"` upgrades. It uses Playwright Chromium internally, so consumers do not need to provide their own browser instance or wire up a custom emulator.

```typescript
const browserResult = await fetchPage("https://example.com/js-page", {
  mode: "browser",
  timeoutMs: 15_000,
});
```

If the browser binary is not installed yet, the first browser fetch will throw an actionable error telling you to run:

```bash
npx playwright install --with-deps chromium
```

---

### 4.6 In-Memory Dev Adapters

#### `InMemoryQueue`

Priority-aware FIFO queue. **Not suitable for production distributed workloads.**

```typescript
import { InMemoryQueue } from "@strongmove/crawler-core";
const queue = new InMemoryQueue();
await queue.enqueue("https://example.com/", { depth: 0, priority: 10 });
const item = await queue.dequeue();  // → QueueItem | null
await queue.ack(item.id);
// queue.size         — items waiting
// queue.inFlightSize — items dequeued but not yet acked
```

#### `NoopPersistenceAdapter`

Silently accepts all operations (claims everything, saves nothing).

```typescript
import { NoopPersistenceAdapter } from "@strongmove/crawler-core";
const adapter = new NoopPersistenceAdapter();
```

---

### 4.7 Event Emitter

The `EventEmitter` class is used internally; you can also instantiate it for custom logging in adapters.

```typescript
import { EventEmitter } from "@strongmove/crawler-core";

const emitter = new EventEmitter((event) => {
  console.log(event.timestamp, event.level, event.event, event.message);
});

emitter.info("my.event", "Something happened", { url: "https://..." });
emitter.error("my.error", "Something broke", { error: "..." });
```

---

### 4.8 Test Harness

```typescript
import { runPluginTest, assertPageParseResult } from "@strongmove/crawler-core/testing";
// (import from the testing module directly)
```

See [Section 10](#10-testing-guide) for full usage.

---

## 5. Adapter Contracts

### 5.1 PersistenceAdapter

Implement this interface to wire the crawler to your database.

```typescript
interface PersistenceAdapter {
  tryClaim(url: string, opts?: {
    recheckWindowMs?: number;  // Skip if done within this window
    inProgressStaleMs?: number; // Take over stale in-progress claim
  }): Promise<boolean>;

  markDone(url: string, meta?: {
    contentHash?: string;
    etag?: string;
    lastItemLocation?: string;
    canonicalId?: string | null;
  }): Promise<void>;

  markFailed(url: string, error?: string): Promise<void>;

  getOrCreateCanonical(
    normalizedTitle: string,
    suggestedType?: string | null,
    category?: string | null
  ): Promise<string>;  // Returns canonical id or ""

  saveItem(item: ParsedItem): Promise<SaveItemResult | void>;

  findPendingByParsedTitle?(parsedTitle: string): Promise<unknown[]>; // optional
}
```

#### `tryClaim` semantics

| DB row state | Behaviour |
|---|---|
| Missing | Insert `status=in_progress`, return `true` |
| `status=done` and `lastCrawledAt` within `recheckWindowMs` | Return `false` (skip) |
| `status=in_progress` but stale (older than `inProgressStaleMs`) | Take over, return `true` |
| Any other state (`failed`, `pending`, stale done) | Update to `in_progress`, return `true` |

#### Minimal Postgres Implementation Sketch

```typescript
import type { PersistenceAdapter, ParsedItem } from "@strongmove/crawler-core";
import { Pool } from "pg";

export class PostgresPersistenceAdapter implements PersistenceAdapter {
  constructor(private readonly pool: Pool) {}

  async tryClaim(url: string, opts = {}): Promise<boolean> {
    const { recheckWindowMs = 30 * 24 * 60 * 60 * 1000 } = opts;
    // Upsert into crawled_pages; return true if we took the claim.
    const { rows } = await this.pool.query(
      `INSERT INTO crawled_pages (url, status, last_crawled_at)
       VALUES ($1, 'in_progress', NOW())
       ON CONFLICT (url) DO UPDATE
         SET status = 'in_progress', last_crawled_at = NOW()
         WHERE crawled_pages.status != 'done'
            OR crawled_pages.last_crawled_at < NOW() - ($2 || ' milliseconds')::INTERVAL
       RETURNING 1 AS claimed`,
      [url, recheckWindowMs]
    );
    return rows.length > 0;
  }

  async markDone(url: string, meta = {}): Promise<void> {
    await this.pool.query(
      `UPDATE crawled_pages SET status='done', content_hash=$2, etag=$3 WHERE url=$1`,
      [url, meta.contentHash, meta.etag]
    );
  }

  async markFailed(url: string, error?: string): Promise<void> {
    await this.pool.query(
      `UPDATE crawled_pages SET status='failed', last_error=$2 WHERE url=$1`,
      [url, error]
    );
  }

  async getOrCreateCanonical(normalizedTitle: string): Promise<string> {
    const { rows } = await this.pool.query(
      `INSERT INTO canonical_items (normalized_title) VALUES ($1)
       ON CONFLICT (normalized_title) DO UPDATE SET normalized_title=EXCLUDED.normalized_title
       RETURNING id`,
      [normalizedTitle]
    );
    return rows[0]?.id ?? "";
  }

  async saveItem(item: ParsedItem): Promise<void> {
    await this.pool.query(
      `INSERT INTO items (title, normalized_title, locations, source_url, meta)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [item.title, item.normalizedTitle, JSON.stringify(item.locations), item.sourceUrl, JSON.stringify(item.meta)]
    );
  }
}
```

---

### 5.2 QueueAdapter

```typescript
interface QueueAdapter {
  enqueue(url: string, opts?: { priority?: number; depth?: number }): Promise<void>;
  dequeue(): Promise<QueueItem | null>;
  ack(itemId: string): Promise<void>;
  requeue(itemId: string, opts?: { delay?: number }): Promise<void>;
}

interface QueueItem {
  id: string;
  url: string;
  priority?: number;
  depth: number;
}
```

For production / distributed crawls, implement this interface backed by **Redis + BullMQ** and run multiple worker processes calling `runWorkerLoop`.

---

## 6. Plugin Author Guide

### Minimal Plugin Template

```typescript
import type { SitePlugin, PageParseResult, ParsedItem } from "@strongmove/crawler-core";
// npm install cheerio  (or any HTML parser you prefer)
import * as cheerio from "cheerio";

export const MySitePlugin: SitePlugin = {
  name: "my-site",
  pageType: "listing",
  matchers: [
    { type: "path", value: "/products" },
    { type: "regex", value: /\/products\/.*$/ },
  ],
  crawlPolicy: {
    recheckWindowMs: 60_000,
    maxDepth: 1,
    followLinks: true,
  },

  // Optional: custom base URL resolution
  resolveBaseUrl(url: string): string {
    return new URL(url).origin;
  },

  parsePage(html: string, url: string, baseUrl: string): PageParseResult {
    const $ = cheerio.load(html);
    const items: ParsedItem[] = [];
    const links: string[] = [];

    // Collect outgoing links.
    $("a[href]").each((_i, el) => {
      links.push($(el).attr("href") ?? "");
    });

    // Collect items (e.g., media files).
    $("article.media-card").each((_i, el) => {
      const title = $(el).find("h2").text().trim();
      const href = $(el).find("a.download").attr("href") ?? "";

      if (title && href) {
        items.push({
          title,
          locations: [href],
          meta: {
            category: $(el).find(".category").text().trim(),
          },
        });
      }
    });

    return { items, links, baseUrl };
  },
};
```

### Plugin Rules

- `parsePage` must **never throw** (the core catches exceptions but marks the page failed).
- Return empty arrays `[]` for `items` and `links` rather than `null`.
- `locations` must be non-empty for a `ParsedItem` to be meaningful.
- Avoid blocking I/O in `parsePage` — keep it synchronous or fast-async.
- Use `meta` for all domain-specific fields; keep `title` and `idHint` generic.

### Declarative Crawl Policy

`SitePlugin` now supports a `crawlPolicy` object for per-site fetch and recheck behavior. This is the declarative hook for logic that is site-specific but still belongs to the crawler core rather than being hidden inside `parsePage`.

```ts
const ListingPlugin: SitePlugin = {
  name: "listing",
  pageType: "listing",
  matchers: [{ type: "path", value: "/listings" }],
  crawlPolicy: {
    recheckWindowMs: 30_000,
    maxDepth: 1,
    skipFetch: false,
    followLinks: true,
  },
  parsePage(html, url, baseUrl) {
    return { items: [], links: [], baseUrl };
  },
};
```

The engine merges plugin policy values with the top-level `runCrawl(...)` options, and the run-level values still win when explicitly supplied. This keeps plugin defaults reusable while letting a caller override them for a specific crawl.

---

## 7. Configuration Defaults

| Option | Default | Description |
|---|---|---|
| `globalConcurrency` | `1` | Parallel page workers |
| `perHostDelayMs` | `500` | Min delay between requests to same host |
| `requestTimeoutMs` | `10 000` | Per-page fetch timeout |
| `retryAttempts` | `2` | Retries on transient network errors |
| `maxDepth` | `3` | Max crawl depth from seeds |
| `maxPagesPerRun` | `1 000` | Max pages per `runCrawl` call |
| `recheckWindowMs` | `2 592 000 000` (30 days) | Skip done URLs within this window |
| `inProgressStaleMs` | `300 000` (5 min) | Stale in-progress claim threshold |
| `userAgent` | `Mozilla/5.0 (compatible; crawler-core/1.0; +https://your-org.example)` | Default User-Agent |
| `skipPersistOnUnchanged` | `false` | Skip saveItem when content hash unchanged |

---

## 8. Publishing to GitHub Packages (Private NPM)

### One-time repo setup

1. Add `.npmrc` at the repo root (already included):

   ```
   @strongmove:registry=https://npm.pkg.github.com
   ```

2. In `package.json` (already set):

   ```json
   {
     "name": "@strongmove/crawler-core",
     "publishConfig": {
       "registry": "https://npm.pkg.github.com"
     }
   }
   ```

### GitHub Actions publish workflow

Create `.github/workflows/publish.yml`:

```yaml
name: Publish to GitHub Packages

on:
  push:
    tags:
      - "v*"

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          registry-url: "https://npm.pkg.github.com"
          scope: "@strongmove"

      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Installing in another project

1. In the consuming project, add `.npmrc`:

   ```
   @strongmove:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
   ```

2. Install:

   ```bash
   npm install @strongmove/crawler-core
   ```

3. Set `GITHUB_TOKEN` (or a Personal Access Token with `read:packages`) in your environment or CI secrets.

---

## 9. Adapting Existing Projects

### Step-by-step integration

1. **Install the package** (see above).

2. **Implement a `SitePlugin`** for each target site:
   - Create a file per site, e.g., `src/plugins/MySitePlugin.ts`.
   - Implement `parsePage` to extract `ParsedItem[]` and `links[]`.
   - See [Section 6](#6-plugin-author-guide) for the template.

3. **Implement a `PersistenceAdapter`**:
   - Map `saveItem(ParsedItem)` to your DB schema.
   - Implement `tryClaim` / `markDone` / `markFailed` on a `crawled_pages` table.
   - Implement `getOrCreateCanonical` to manage a deduplication table.
   - See [Section 5.1](#51-persistenceadapter) for the Postgres sketch.

4. **Optionally implement a `QueueAdapter`** for Redis/BullMQ (for distributed crawling). For single-process runs, `InMemoryQueue` is sufficient.

5. **Create a bootstrap script**:

   ```typescript
   // src/crawl.ts
   import { registerPlugin, runCrawl } from "@strongmove/crawler-core";
   import { MySitePlugin } from "./plugins/MySitePlugin";
   import { MyPostgresAdapter } from "./adapters/MyPostgresAdapter";

   registerPlugin(MySitePlugin);

   const summary = await runCrawl(["https://mysite.com/"], {
     persistence: new MyPostgresAdapter(),
     globalConcurrency: 3,
     maxDepth: 4,
     perHostDelayMs: 800,
     logger: (e) => console.log(JSON.stringify(e)),
   });

   console.log("Done:", summary);
   ```

6. **Wire the logger** to your admin UI via WebSocket, or to `pino`/`winston`.

### What stays in your project

| Concern | Where it lives |
|---|---|
| HTML parsing logic | `SitePlugin.parsePage` |
| DB schema + ORM models | Your `PersistenceAdapter` |
| Domain-specific title cleaning | Before/after `normalizeTitle` in your plugin or adapter |
| Approval flow (pending/approved items) | `saveItem` implementation |
| Redis/BullMQ queue | Your `QueueAdapter` implementation |
| Admin UI | Your project; wire via `logger` callback |

---

## 10. Testing Guide

### Unit-testing plugins with HTML fixtures

```typescript
// src/plugins/MySitePlugin.test.ts
import * as fs from "fs";
import { runPluginTest, assertPageParseResult } from "@strongmove/crawler-core/testing";
// Note: import from the testing sub-path
import { MySitePlugin } from "./MySitePlugin";

const html = fs.readFileSync("fixtures/my-page.html", "utf8");

describe("MySitePlugin", () => {
  it("extracts items from listing page", async () => {
    const result = await runPluginTest(
      MySitePlugin,
      html,
      "https://mysite.com/listing"
    );

    // Assert contract.
    assertPageParseResult(result);

    // Assert domain expectations.
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].title).toBeTruthy();
    expect(result.items[0].locations).toHaveLength(1);
  });
});
```

### Testing adapters with in-memory implementations

Use `InMemoryQueue` and `NoopPersistenceAdapter` in unit tests to isolate crawler logic from I/O.

```typescript
import { runCrawl, registerPlugin, clearPlugins, InMemoryQueue } from "@strongmove/crawler-core";

beforeEach(() => clearPlugins());

it("crawls and saves items", async () => {
  registerPlugin(myPlugin);
  const saved = [];

  await runCrawl(["https://mysite.com/"], {
    persistence: {
      tryClaim: async () => true,
      markDone: async () => {},
      markFailed: async () => {},
      getOrCreateCanonical: async () => "",
      saveItem: async (item) => saved.push(item),
    },
    globalConcurrency: 1,
    perHostDelayMs: 0,
  });

  expect(saved.length).toBeGreaterThan(0);
});
```

### Running tests

```bash
npm ci            # Install dependencies
npm test          # Run all tests
npm run lint      # CI-friendly alias for static validation
npm run typecheck # Type-check without emitting build artifacts
npm run build     # Compile the distributable output
```

---

## 11. Security & Legal

- **Respect `robots.txt`**: This library does not enforce `robots.txt` by default. You **must** enforce it in your `PersistenceAdapter.tryClaim` or a URL filter if required by the site's terms.
- **Rate limiting**: Set `perHostDelayMs` appropriately. The default 500 ms is conservative; increase it for sites that explicitly require slower crawling.
- **Do not scrape private or copyrighted content** without permission.
- **Sanitize plugin output**: Ensure `ParsedItem.locations` contains only trusted URL strings before persisting or serving them.
- **Plugin isolation**: Plugins are plain TypeScript functions — do not load untrusted plugin code dynamically.

---

## 12. Migration Guide

If you have an existing scraper codebase, here are the common mapping points:

| Old name / concept | New name | Notes |
|---|---|---|
| `cleanListingTitle(s)` | `normalizeTitle(s)` | Core provides neutral baseline; add project-specific stripping around it |
| `createOrGetCanonical(...)` | `getOrCreateCanonical(...)` | Method name changed to `getOrCreate` prefix |
| Listing page parser | `SitePlugin.parsePage` returning `{ items: [], links: [...] }` | Return links to detail pages |
| Details page parser | `SitePlugin.parsePage` returning `{ items: [...], links: [] }` | Same interface; return items |
| Combined listing+details | `SitePlugin.parsePage` returning `{ items: [...], links: [...] }` | Fully supported |
| `DetailsPageResult` | `ParsedItem` | Core has no separate details type; use `ParsedItem.meta` for extra fields |
| Custom fetch wrapper | `fetchPage` or `FetchOptions` | Or implement your own fetcher and call `plugin.parsePage` directly |

---

## License

UNLICENSED — private package. Do not publish to the public npm registry.
