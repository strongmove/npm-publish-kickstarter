/**
 * Plugin test harness.
 *
 * Use `runPluginTest` to load an HTML fixture, execute a plugin's parsePage,
 * and assert the shape of the PageParseResult.
 *
 * Example:
 *
 *   import { runPluginTest } from "@strongmove/crawler-core/testing";
 *   import { MyPlugin } from "./MyPlugin";
 *   import * as fs from "fs";
 *
 *   const html = fs.readFileSync("fixtures/my-page.html", "utf8");
 *   const result = await runPluginTest(MyPlugin, html, "https://mysite.com/page");
 *
 *   expect(result.items.length).toBeGreaterThan(0);
 *   expect(result.items[0].title).toBeTruthy();
 */

import type { SitePlugin, PageParseResult } from "./types";

/**
 * Execute a plugin's parsePage against a raw HTML string and return the result.
 *
 * @param plugin   The SitePlugin to test.
 * @param html     Raw HTML string (from a fixture file).
 * @param url      The URL to pass as context.
 * @param baseUrl  Optional base URL; defaults to `url`.
 */
export async function runPluginTest(
  plugin: SitePlugin,
  html: string,
  url: string,
  baseUrl?: string
): Promise<PageParseResult> {
  const resolvedBase = baseUrl ?? (plugin.resolveBaseUrl?.(url) ?? url);
  return plugin.parsePage(html, url, resolvedBase);
}

/**
 * Assert that a PageParseResult conforms to the expected shape.
 * Throws descriptive errors if any contract is violated.
 *
 * Suitable for use inside any test framework (Jest, Vitest, etc.).
 */
export function assertPageParseResult(result: PageParseResult): void {
  if (!result || typeof result !== "object") {
    throw new Error("PageParseResult must be an object");
  }
  if (!Array.isArray(result.items)) {
    throw new Error("PageParseResult.items must be an array");
  }
  if (!Array.isArray(result.links)) {
    throw new Error("PageParseResult.links must be an array");
  }
  for (const item of result.items) {
    if (!Array.isArray(item.locations)) {
      throw new Error(`ParsedItem.locations must be an array (got: ${JSON.stringify(item)})`);
    }
  }
}
