import { runCrawl } from "./crawler";
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
});

describe("runCrawl", () => {
  it("returns zero summary when no seeds", async () => {
    const summary = await runCrawl([]);
    expect(summary.pagesVisited).toBe(0);
    expect(summary.itemsSaved).toBe(0);
  });

  it("visits seed URL, parses items, and returns summary", async () => {
    const plugin: SitePlugin = {
      name: "test-plugin",
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

  it("skips URLs that fail claim", async () => {
    const plugin: SitePlugin = {
      name: "claim-plugin",
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
});
