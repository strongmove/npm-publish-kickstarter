/**
 * Example logging persistence adapter.
 *
 * This adapter logs all operations to the console instead of writing to a
 * database. Use it as a reference when building a real PersistenceAdapter
 * (e.g., backed by Postgres, SQLite, or a remote API).
 *
 * Key method to customize for your project:
 * - `saveItem`: map ParsedItem fields to your DB schema.
 * - `getOrCreateCanonical`: link items to a canonical entity table.
 * - `tryClaim` / `markDone` / `markFailed`: update a `crawled_pages` table.
 */

import type { PersistenceAdapter, ParsedItem, SaveItemResult } from "../types";

export class LoggingPersistenceAdapter implements PersistenceAdapter {
  async tryClaim(
    url: string,
    opts?: { recheckWindowMs?: number; inProgressStaleMs?: number }
  ): Promise<boolean> {
    console.log("[tryClaim]", url, opts ?? {});
    // Always claim every URL in this example.
    return true;
  }

  async markDone(
    url: string,
    meta?: {
      contentHash?: string;
      etag?: string;
      lastItemLocation?: string;
      canonicalId?: string | null;
    }
  ): Promise<void> {
    console.log("[markDone]", url, meta ?? {});
  }

  async markFailed(url: string, error?: string): Promise<void> {
    console.log("[markFailed]", url, error ?? "");
  }

  async getOrCreateCanonical(
    normalizedTitle: string,
    suggestedType?: string | null,
    category?: string | null
  ): Promise<string> {
    console.log("[getOrCreateCanonical]", { normalizedTitle, suggestedType, category });
    // Return a fake canonical id based on the title.
    return `canonical:${normalizedTitle.replace(/\s+/g, "-")}`;
  }

  async saveItem(item: ParsedItem): Promise<SaveItemResult | void> {
    console.log("[saveItem]", JSON.stringify(item, null, 2));
    // Return a fake result.
    return { id: `item:${item.idHint ?? item.title ?? "unknown"}`, created: true };
  }

  async findPendingByParsedTitle(parsedTitle: string): Promise<unknown[]> {
    console.log("[findPendingByParsedTitle]", parsedTitle);
    return [];
  }
}
