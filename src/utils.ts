/**
 * Utility functions exported by crawler-core.
 */

import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// resolveHref
// ---------------------------------------------------------------------------

export interface ResolveHrefOptions {
  /** When true, preserve fragment (#) anchors instead of discarding them. */
  preserveFragment?: boolean;
  /** Query-string parameter names to strip (for deduplication). */
  stripQueryParams?: string[];
}

/**
 * Resolve a possibly-relative href against a base URL, producing a canonical
 * absolute URL string suitable for queueing and deduplication.
 *
 * Rules:
 * - Absolute http(s):// links → returned as-is (after normalization).
 * - Protocol-relative //href → prepend protocol from base.
 * - Fragment-only (#...) → ignored (returns empty string) unless preserveFragment is true.
 * - data: / javascript: → ignored (returns empty string).
 * - Relative links → resolved via `new URL(href, base)`.
 * - Scheme and host normalized to lowercase; default ports removed.
 * - Trailing slash removed unless the path is root "/".
 *
 * Returns empty string for hrefs that should be discarded.
 */
export function resolveHref(
  base: string,
  href: string,
  options: ResolveHrefOptions = {}
): string {
  const { preserveFragment = false, stripQueryParams = [] } = options;

  if (!href || typeof href !== "string") return "";

  const trimmed = href.trim();

  // Discard data: and javascript: URIs.
  if (/^(data:|javascript:)/i.test(trimmed)) return "";

  // Discard fragment-only links by default.
  if (trimmed.startsWith("#")) {
    return preserveFragment ? canonicalize(base, trimmed, stripQueryParams) : "";
  }

  return canonicalize(base, trimmed, stripQueryParams);
}

function canonicalize(
  base: string,
  href: string,
  stripQueryParams: string[]
): string {
  let parsed: URL;

  try {
    // Protocol-relative
    if (href.startsWith("//")) {
      const baseProto = new URL(base).protocol;
      parsed = new URL(`${baseProto}${href}`);
    } else {
      parsed = new URL(href, base);
    }
  } catch {
    return "";
  }

  // Only allow http(s).
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";

  // Normalize host to lowercase (protocol is already lowercase from URL).
  parsed.hostname = parsed.hostname.toLowerCase();

  // Remove default ports.
  if (
    (parsed.protocol === "http:" && parsed.port === "80") ||
    (parsed.protocol === "https:" && parsed.port === "443")
  ) {
    parsed.port = "";
  }

  // Strip requested query params.
  for (const key of stripQueryParams) {
    parsed.searchParams.delete(key);
  }

  let result = parsed.toString();

  // Remove trailing slash (unless path is root "/").
  if (parsed.pathname !== "/" && result.endsWith("/")) {
    result = result.slice(0, -1);
  }

  return result;
}

// ---------------------------------------------------------------------------
// normalizeTitle
// ---------------------------------------------------------------------------

export interface NormalizeTitleOptions {
  /** When true, skip lower-casing. Default: false (lower-case is applied). */
  preserveCase?: boolean;
}

/**
 * Produce a comparable canonical text key for an item title.
 *
 * Core behaviour (neutral — no language-specific heuristics):
 * 1. NFKC Unicode normalization.
 * 2. Remove invisible / zero-width characters.
 * 3. Replace non-breaking spaces with regular spaces.
 * 4. Collapse internal whitespace to a single space.
 * 5. Strip simple surrounding quotes and brackets ( " ' 「」『』【】[] ).
 * 6. Trim whitespace.
 * 7. Lower-case (unless preserveCase is true).
 *
 * Domain-specific cleaning (e.g., removing episode markers) must be done in
 * project-level code *before* or *after* calling this function.
 */
export function normalizeTitle(
  title: string,
  options: NormalizeTitleOptions = {}
): string {
  if (!title || typeof title !== "string") return "";

  const { preserveCase = false } = options;

  let s = title;

  // 1. NFKC normalization.
  s = s.normalize("NFKC");

  // 2. Remove invisible / zero-width characters.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001F\u007F\u00AD\u200B-\u200D\uFEFF\u2028\u2029]/g, "");

  // 3. Non-breaking space → regular space.
  s = s.replace(/\u00A0/g, " ");

  // 4. Collapse whitespace.
  s = s.replace(/\s+/g, " ");

  // 5. Strip surrounding quotes / brackets (one level).
  s = s.replace(/^[\s"'「『【[\]]+|[\s"'」』】[\]]+$/g, "");

  // 6. Trim.
  s = s.trim();

  // 7. Lower-case.
  if (!preserveCase) {
    s = s.toLowerCase();
  }

  return s;
}

// ---------------------------------------------------------------------------
// computeContentHash (re-export from fetcher for public API)
// ---------------------------------------------------------------------------

/**
 * Compute a SHA-256 hex hash of the given body string.
 * Useful for change-detection between crawl runs.
 */
export function computeContentHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// safeUrl
// ---------------------------------------------------------------------------

/**
 * Return the URL string if it is a valid http(s) URL, otherwise return empty string.
 */
export function safeUrl(url: string): string {
  if (!url || typeof url !== "string") return "";
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}
