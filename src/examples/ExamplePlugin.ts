/**
 * Example SitePlugin for a simple static HTML site.
 *
 * This shows the minimum you need to implement to provide a plugin:
 * - `name` and `hostnames` to identify the plugin.
 * - `parsePage` to extract items and outgoing links from raw HTML.
 *
 * In real usage, swap the manual parsing with a library like cheerio:
 *   import * as cheerio from "cheerio";
 *   const $ = cheerio.load(html);
 *
 * This file has no external dependencies so it can run without extra installs.
 */

import type { SitePlugin, PageParseResult, ParsedItem } from "../types";

/**
 * A minimal example plugin that:
 * - Extracts every <a href> link.
 * - Treats every <article> element with a <h2> as a ParsedItem.
 */
export const ExamplePlugin: SitePlugin = {
  name: "example-plugin",
  hostnames: ["example.com"],

  parsePage(html: string, url: string, baseUrl: string): PageParseResult {
    const items: ParsedItem[] = [];
    const links: string[] = [];

    // --- Naïve regex-based parsing (illustrative only) ---
    // Replace this with cheerio or a proper parser in production.

    // Extract <a href="..."> links.
    const linkRegex = /href="([^"]+)"/g;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRegex.exec(html)) !== null) {
      links.push(linkMatch[1]);
    }

    // Extract <article> blocks that contain a <h2> title and an <a> location.
    const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
    let articleMatch: RegExpExecArray | null;
    while ((articleMatch = articleRegex.exec(html)) !== null) {
      const body = articleMatch[1];
      const titleMatch = /<h2[^>]*>([^<]+)<\/h2>/i.exec(body);
      const hrefMatch = /href="([^"]+)"/i.exec(body);

      if (titleMatch && hrefMatch) {
        items.push({
          title: titleMatch[1].trim(),
          locations: [hrefMatch[1]],
          sourceUrl: url,
        });
      }
    }

    return { items, links, baseUrl };
  },
};
