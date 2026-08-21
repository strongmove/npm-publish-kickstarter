import type { PersistenceAdapter, ParsedItem, SaveItemResult } from "../types";

/**
 * No-op persistence adapter for development and testing.
 *
 * - tryClaim always returns true (claim every URL).
 * - markDone / markFailed are silent no-ops.
 * - getOrCreateCanonical always returns an empty string.
 * - saveItem is a no-op and returns void.
 */
export class NoopPersistenceAdapter implements PersistenceAdapter {
  async tryClaim(_url: string): Promise<boolean> {
    return true;
  }

  async markDone(_url: string): Promise<void> {
    // no-op
  }

  async markFailed(_url: string, _error?: string): Promise<void> {
    // no-op
  }

  async getOrCreateCanonical(
    _normalizedTitle: string,
    _suggestedType?: string | null,
    _category?: string | null
  ): Promise<string> {
    return "";
  }

  async saveItem(_item: ParsedItem): Promise<SaveItemResult | void> {
    // no-op
  }

  async findPendingByParsedTitle(_parsedTitle: string): Promise<unknown[]> {
    return [];
  }
}
