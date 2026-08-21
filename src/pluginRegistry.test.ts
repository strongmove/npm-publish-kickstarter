import {
  registerPlugin,
  clearPlugins,
  findPlugin,
  getPlugins,
} from "./pluginRegistry";
import type { SitePlugin } from "./types";

const makePlugin = (name: string, hostnames?: string[]): SitePlugin => ({
  name,
  hostnames,
  parsePage: async () => ({ items: [], links: [] }),
});

beforeEach(() => {
  clearPlugins();
});

describe("pluginRegistry", () => {
  it("registerPlugin adds a plugin", () => {
    const p = makePlugin("test");
    registerPlugin(p);
    expect(getPlugins()).toHaveLength(1);
  });

  it("throws if plugin has no parsePage", () => {
    expect(() => registerPlugin({ name: "bad" } as unknown as SitePlugin)).toThrow();
  });

  it("findPlugin returns matching hostname plugin", () => {
    registerPlugin(makePlugin("other", ["other.com"]));
    registerPlugin(makePlugin("example", ["example.com"]));
    const found = findPlugin("https://example.com/page");
    expect(found?.name).toBe("example");
  });

  it("findPlugin falls back to catch-all plugin", () => {
    registerPlugin(makePlugin("catch-all"));
    const found = findPlugin("https://unknown-site.com/page");
    expect(found?.name).toBe("catch-all");
  });

  it("findPlugin returns undefined when nothing matches", () => {
    registerPlugin(makePlugin("specific", ["specific.com"]));
    const found = findPlugin("https://no-match.com/page");
    expect(found).toBeUndefined();
  });

  it("clearPlugins removes all plugins", () => {
    registerPlugin(makePlugin("a"));
    clearPlugins();
    expect(getPlugins()).toHaveLength(0);
  });
});
