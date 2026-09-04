const browserLaunchMock = jest.fn();

jest.mock("playwright", () => ({
  chromium: {
    launch: browserLaunchMock,
  },
}));

import { runCrawl } from "./crawler";
import * as fetcher from "./fetcher";
import { registerPlugin, clearPlugins } from "./pluginRegistry";
import type { SitePlugin, PersistenceAdapter, ParsedItem } from "./types";

// Mock fetch globally for unit tests.
const mockFetch = jest.fn();
global.fetch = mockFetch as typeof fetch;

function makeHtmlResponse(html: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "https://example.com/",
    headers: { get: (_k: string) => null } as unknown as Headers,
    text: async () => html,
  } as unknown as Response;
}

beforeEach(() => {
  clearPlugins();
  mockFetch.mockReset();
  browserLaunchMock.mockReset();
});

describe("runCrawl", () => {
  it("returns zero summary when no seeds", async () => {
    const summary = await runCrawl([]);
    expect(summary.pagesVisited).toBe(0);
    expect(summary.itemsSaved).toBe(0);
  });

  it("supports parseFetchedData as the richer parsing hook", async () => {
    const parseFetchedData = jest.fn(() => ({
      items: [{ title: "Fetched Item", locations: ["https://example.com/file.mp4"] }],
      links: [],
    }));

    const plugin: SitePlugin = {
      name: "fetched-plugin",
      pageType: "detail",
      matchers: [{ type: "regex", value: /^https:\/\/example\.com\/.*$/ }],
      parseFetchedData,
    };
    registerPlugin(plugin);
    mockFetch.mockResolvedValue(makeHtmlResponse("<html>hello</html>"));

    const adapter: PersistenceAdapter = {
      tryClaim: async () => true,
      markDone: async () => {},
      markFailed: async () => {},
      getOrCreateCanonical: async () => "",
      saveItem: async () => {},
    };

    await runCrawl(["https://example.com/"], {
      persistence: adapter,
      globalConcurrency: 1,
      perHostDelayMs: 0,
    });

    expect(parseFetchedData).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/",
        html: "<html>hello</html>",
      })
    );
  });

  it("visits seed URL, parses items, and returns summary", async () => {
    const plugin: SitePlugin = {
      name: "test-plugin",
      pageType: "detail",
      matchers: [{ type: "regex", value: /^https:\/\/example\.com\/.*$/ }],
      parsePage: () => ({
        items: [{ title: "Test Item", locations: ["https://example.com/file.mp4"] }],
        links: [],
      }),
    };
    registerPlugin(plugin);
    mockFetch.mockResolvedValue(makeHtmlResponse("<html>hello</html>"));

    const saved: ParsedItem[] = [];
    const adapter: PersistenceAdapter = {
      tryClaim: async () => true,
      markDone: async () => {},
      markFailed: async () => {},
      getOrCreateCanonical: async () => "",
      saveItem: async (item: ParsedItem) => { saved.push(item); },
    };

    const summary = await runCrawl(["https://example.com/"], {
      persistence: adapter,
      globalConcurrency: 1,
      perHostDelayMs: 0,
    });

    expect(summary.pagesVisited).toBe(1);
    expect(summary.pagesParsed).toBe(1);
    expect(summary.itemsSaved).toBe(1);
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe("Test Item");
  });

  it("follows links discovered during parse", async () => {
    const plugin: SitePlugin = {
      name: "link-plugin",
      pageType: "other",
      matchers: [{ type: "regex", value: /^https:\/\/example\.com\/.*$/ }],
      parsePage: (_html: string, url: string) => {
        if (url === "https://example.com/") {
          return { items: [], links: ["https://example.com/page1"] };
        }
        return { items: [], links: [] };
      },
    };
    registerPlugin(plugin);
    mockFetch.mockResolvedValue(makeHtmlResponse("<html></html>"));

    const summary = await runCrawl(["https://example.com/"], {
      globalConcurrency: 1,
      perHostDelayMs: 0,
      maxDepth: 3,
    });

    expect(summary.pagesVisited).toBe(2);
  });

  it("does not auto-enqueue URLs captured by browserFlow", async () => {
    const plugin: SitePlugin = {
      name: "browser-flow-plugin",
      pageType: "other",
      matchers: [{ type: "regex", value: /^https:\/\/example\.com\/.*$/ }],
      parsePage: () => ({ items: [], links: [] }),
    };
    registerPlugin(plugin);

    const fetchPageSpy = jest.spyOn(fetcher, "fetchPage").mockResolvedValue({
      html: "<html></html>",
      status: 200,
      contentHash: "hash",
      finalUrl: "https://example.com/",
      mode: "browser",
      browserFlow: {
        finalUrl: "https://example.com/next",
        html: "<html></html>",
        status: 200,
        discoveredUrls: ["https://example.com/next"],
        stepsExecuted: 1,
        errors: [],
      },
    });

    const summary = await runCrawl(["https://example.com/"], {
      globalConcurrency: 1,
      perHostDelayMs: 0,
      maxDepth: 1,
    });

    expect(summary.pagesVisited).toBe(1);
    expect(fetchPageSpy).toHaveBeenCalledTimes(1);
    fetchPageSpy.mockRestore();
  });

  it("skips URLs that fail claim", async () => {
    const plugin: SitePlugin = {
      name: "claim-plugin",
      pageType: "other",
      matchers: [{ type: "regex", value: /^https:\/\/example\.com\/.*$/ }],
      parsePage: () => ({ items: [], links: [] }),
    };
    registerPlugin(plugin);
    mockFetch.mockResolvedValue(makeHtmlResponse("<html></html>"));

    const adapter: PersistenceAdapter = {
      tryClaim: async () => false,
      markDone: async () => {},
      markFailed: async () => {},
      getOrCreateCanonical: async () => "",
      saveItem: async () => {},
    };

    const summary = await runCrawl(["https://example.com/"], {
      persistence: adapter,
      globalConcurrency: 1,
      perHostDelayMs: 0,
    });

    expect(summary.pagesParsed).toBe(0);
  });

  it("normalizes item title if normalizedTitle is absent", async () => {
    const plugin: SitePlugin = {
      name: "norm-plugin",
      pageType: "detail",
      matchers: [{ type: "regex", value: /^https:\/\/example\.com\/.*$/ }],
      parsePage: () => ({
        items: [{ title: "  HELLO WORLD  ", locations: ["https://x.com/f"] }],
        links: [],
      }),
    };
    registerPlugin(plugin);
    mockFetch.mockResolvedValue(makeHtmlResponse("<html></html>"));

    const saved: ParsedItem[] = [];
    const adapter: PersistenceAdapter = {
      tryClaim: async () => true,
      markDone: async () => {},
      markFailed: async () => {},
      getOrCreateCanonical: async () => "",
      saveItem: async (item: ParsedItem) => { saved.push(item); },
    };

    await runCrawl(["https://example.com/"], {
      persistence: adapter,
      globalConcurrency: 1,
      perHostDelayMs: 0,
    });

    expect(saved[0].normalizedTitle).toBe("hello world");
  });

  it("respects maxPagesPerRun limit", async () => {
    const plugin: SitePlugin = {
      name: "multi-plugin",
      pageType: "other",
      matchers: [{ type: "regex", value: /^https:\/\/example\.com\/.*$/ }],
      parsePage: (_html: string, _url: string) => ({
        items: [],
        links: [`https://example.com/page${Math.random()}`],
      }),
    };
    registerPlugin(plugin);
    mockFetch.mockResolvedValue(makeHtmlResponse("<html></html>"));

    const summary = await runCrawl(["https://example.com/"], {
      globalConcurrency: 1,
      perHostDelayMs: 0,
      maxPagesPerRun: 3,
    });

    expect(summary.pagesVisited).toBeLessThanOrEqual(3);
  });

  it("applies plugin crawlPolicy for recheck and skipFetch", async () => {
    const parsePage = jest.fn(() => ({ items: [], links: [] }));
    const tryClaim = jest.fn(async () => true);
    const plugin: SitePlugin = {
      name: "policy-plugin",
      pageType: "other",
      matchers: [{ type: "regex", value: /^https:\/\/example\.com\/.*$/ }],
      crawlPolicy: {
        recheckWindowMs: 1_234,
        skipFetch: true,
      },
      parsePage,
    };
    registerPlugin(plugin);

    const adapter: PersistenceAdapter = {
      tryClaim,
      markDone: async () => {},
      markFailed: async () => {},
      getOrCreateCanonical: async () => "",
      saveItem: async () => {},
    };

    const summary = await runCrawl(["https://example.com/"], {
      persistence: adapter,
      globalConcurrency: 1,
      perHostDelayMs: 0,
      recheckWindowMs: 5_000,
    });

    expect(tryClaim).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({ recheckWindowMs: 5_000 })
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(parsePage).not.toHaveBeenCalled();
    expect(summary.pagesParsed).toBe(0);
  });

  it("respects plugin crawlPolicy.followLinks", async () => {
    const plugin: SitePlugin = {
      name: "link-policy-plugin",
      pageType: "other",
      matchers: [{ type: "regex", value: /^https:\/\/example\.com\/.*$/ }],
      crawlPolicy: { followLinks: false },
      parsePage: () => ({
        items: [],
        links: ["https://example.com/next"],
      }),
    };
    registerPlugin(plugin);
    mockFetch.mockResolvedValue(makeHtmlResponse("<html></html>"));

    const summary = await runCrawl(["https://example.com/"], {
      globalConcurrency: 1,
      perHostDelayMs: 0,
      maxDepth: 3,
    });

    expect(summary.pagesVisited).toBe(1);
  });

  it("allows auto fetch mode to upgrade native HTML to browser content", async () => {
    const plugin: SitePlugin = {
      name: "auto-plugin",
      pageType: "detail",
      matchers: [{ type: "regex", value: /^https:\/\/example\.com\/.*$/ }],
      crawlPolicy: {
        fetchMode: "auto",
        requiredSelectors: [".product-card"],
        minSelectorMatches: 1,
        autoFetchDecision: async ({ html }) =>
          html.includes("native-shell") ? "browser" : "native",
      },
      parsePage: (html: string) => ({
        items: html.includes("browser-loaded") ? [{ title: "Browser Item", locations: ["https://example.com/final"] }] : [],
        links: [],
      }),
    };
    registerPlugin(plugin);
    mockFetch.mockResolvedValue(makeHtmlResponse("<html><body><div class='native-shell'></div></body></html>"));

    const page = {
      on: jest.fn(),
      setExtraHTTPHeaders: jest.fn(),
      goto: jest.fn().mockResolvedValue({
        status: () => 200,
        headers: () => ({ etag: '"etag-value"' }),
      }),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      content: jest.fn().mockResolvedValue("<html><body><div class='product-card'>browser-loaded</div></body></html>"),
      url: jest.fn().mockReturnValue("https://example.com/final"),
      close: jest.fn(),
    };
    const browser = {
      newPage: jest.fn().mockResolvedValue(page),
      close: jest.fn(),
    };
    browserLaunchMock.mockResolvedValue(browser);

    const saved: ParsedItem[] = [];
    const adapter: PersistenceAdapter = {
      tryClaim: async () => true,
      markDone: async () => {},
      markFailed: async () => {},
      getOrCreateCanonical: async () => "",
      saveItem: async (item: ParsedItem) => { saved.push(item); },
    };

    const summary = await runCrawl(["https://example.com/"], {
      persistence: adapter,
      globalConcurrency: 1,
      perHostDelayMs: 0,
    });

    expect(summary.pagesParsed).toBe(1);
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe("Browser Item");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(browserLaunchMock).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("applies top-level auto fetch options during runCrawl", async () => {
    const plugin: SitePlugin = {
      name: "top-level-auto-plugin",
      pageType: "detail",
      matchers: [{ type: "regex", value: /^https:\/\/example\.com\/.*$/ }],
      parsePage: (html: string) => ({
        items: html.includes("browser-loaded")
          ? [{ title: "Browser Item", locations: ["https://example.com/final"] }]
          : [],
        links: [],
      }),
    };
    registerPlugin(plugin);
    mockFetch.mockResolvedValue(
      makeHtmlResponse("<html><body><div class='native-shell'></div></body></html>")
    );

    const page = {
      on: jest.fn(),
      setExtraHTTPHeaders: jest.fn(),
      goto: jest.fn().mockResolvedValue({
        status: () => 200,
        headers: () => ({ etag: '"etag-value"' }),
      }),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      content: jest
        .fn()
        .mockResolvedValue(
          "<html><body><div class='product-card'>browser-loaded</div></body></html>"
        ),
      url: jest.fn().mockReturnValue("https://example.com/final"),
      close: jest.fn(),
    };
    const browser = {
      newPage: jest.fn().mockResolvedValue(page),
      close: jest.fn(),
    };
    browserLaunchMock.mockResolvedValue(browser);

    const saved: ParsedItem[] = [];
    const adapter: PersistenceAdapter = {
      tryClaim: async () => true,
      markDone: async () => {},
      markFailed: async () => {},
      getOrCreateCanonical: async () => "",
      saveItem: async (item: ParsedItem) => {
        saved.push(item);
      },
    };

    const summary = await runCrawl(["https://example.com/"], {
      persistence: adapter,
      globalConcurrency: 1,
      perHostDelayMs: 0,
      defaultFetchMode: "auto",
      defaultAutoFetchDecision: async ({ html }) =>
        html.includes("native-shell") ? "browser" : "native",
    });

    expect(summary.pagesParsed).toBe(1);
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe("Browser Item");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(browserLaunchMock).toHaveBeenCalledTimes(1);
  });
});
