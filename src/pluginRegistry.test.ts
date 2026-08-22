import {
  registerPlugin,
  clearPlugins,
  findPlugin,
  getPlugins,
} from "./pluginRegistry";
import type { PageType, SitePlugin } from "./types";

const makePlugin = (
  name: string,
  pageType: PageType,
  matchers?: Array<{ type: "exact" | "path" | "regex"; value: string | RegExp }>
): SitePlugin => ({
  name,
  pageType,
  matchers,
  parsePage: async () => ({ items: [], links: [] }),
});

beforeEach(() => {
  clearPlugins();
});

describe("pluginRegistry", () => {
  it("registerPlugin adds a plugin", () => {
    const p = makePlugin("test", "other", [{ type: "exact", value: "https://example.com/" }]);
    registerPlugin(p);
    expect(getPlugins()).toHaveLength(1);
  });

  it("throws if plugin has no parsePage", () => {
    expect(() => registerPlugin({ name: "bad", pageType: "other" } as unknown as SitePlugin)).toThrow();
  });

  it("findPlugin returns matching URL-based plugin", () => {
    registerPlugin(
      makePlugin("listing", "listing", [{ type: "exact", value: "https://example.com/index.php?mid=drama" }])
    );
    registerPlugin(
      makePlugin("detail", "detail", [{ type: "exact", value: "https://example.com/index.php?mid=drama&document_srl=669964" }])
    );

    expect(findPlugin("https://example.com/index.php?mid=drama")?.name).toBe("listing");
    expect(findPlugin("https://example.com/index.php?mid=drama&document_srl=669964")?.name).toBe("detail");
  });

  it("findPlugin falls back to a catch-all other plugin", () => {
    registerPlugin(makePlugin("catch-all", "other"));
    const found = findPlugin("https://unknown-site.com/page");
    expect(found?.name).toBe("catch-all");
  });

  it("findPlugin normalizes path matchers case-insensitively", () => {
    registerPlugin(
      makePlugin("detail", "detail", [{ type: "path", value: "/Articles/View" }])
    );

    expect(findPlugin("https://example.com/articles/view")?.name).toBe("detail");
  });

  it("findPlugin returns undefined when nothing matches", () => {
    registerPlugin(
      makePlugin("specific", "detail", [{ type: "path", value: "/articles/view" }])
    );
    const found = findPlugin("https://no-match.com/page");
    expect(found).toBeUndefined();
  });

  it("clearPlugins removes all plugins", () => {
    registerPlugin(makePlugin("a", "other", [{ type: "exact", value: "https://example.com/" }]));
    clearPlugins();
    expect(getPlugins()).toHaveLength(0);
  });
});
