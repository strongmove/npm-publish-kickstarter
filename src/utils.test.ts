import { resolveHref, normalizeTitle, computeContentHash, safeUrl } from "./utils";

describe("resolveHref", () => {
  const base = "https://example.com/path/page";

  it("returns absolute https links as-is", () => {
    expect(resolveHref(base, "https://other.com/foo")).toBe("https://other.com/foo");
  });

  it("resolves protocol-relative links using base protocol", () => {
    expect(resolveHref(base, "//other.com/bar")).toBe("https://other.com/bar");
  });

  it("resolves relative links against the base URL", () => {
    expect(resolveHref(base, "sibling")).toBe("https://example.com/path/sibling");
  });

  it("resolves root-relative links", () => {
    expect(resolveHref(base, "/absolute")).toBe("https://example.com/absolute");
  });

  it("discards fragment-only links by default", () => {
    expect(resolveHref(base, "#section")).toBe("");
  });

  it("preserves fragment links when preserveFragment is true", () => {
    const result = resolveHref(base, "#section", { preserveFragment: true });
    expect(result).toContain("example.com");
  });

  it("discards data: URIs", () => {
    expect(resolveHref(base, "data:text/html,hello")).toBe("");
  });

  it("discards javascript: URIs", () => {
    expect(resolveHref(base, "javascript:void(0)")).toBe("");
  });

  it("strips specified query params", () => {
    const url = resolveHref(base, "https://example.com/page?utm_source=foo&keep=1", {
      stripQueryParams: ["utm_source"],
    });
    expect(url).not.toContain("utm_source");
    expect(url).toContain("keep=1");
  });

  it("normalizes hostname to lowercase", () => {
    expect(resolveHref(base, "https://EXAMPLE.COM/path")).toBe("https://example.com/path");
  });

  it("removes default port 443 from https URLs", () => {
    expect(resolveHref(base, "https://example.com:443/path")).toBe("https://example.com/path");
  });

  it("removes default port 80 from http URLs", () => {
    expect(resolveHref("http://example.com/", "http://example.com:80/foo")).toBe(
      "http://example.com/foo"
    );
  });

  it("removes trailing slash (except root)", () => {
    expect(resolveHref(base, "https://example.com/path/")).toBe("https://example.com/path");
    expect(resolveHref(base, "https://example.com/")).toBe("https://example.com/");
  });

  it("returns empty string for empty href", () => {
    expect(resolveHref(base, "")).toBe("");
  });
});

describe("normalizeTitle", () => {
  it("lowercases by default", () => {
    expect(normalizeTitle("Hello World")).toBe("hello world");
  });

  it("preserves case when preserveCase is true", () => {
    expect(normalizeTitle("Hello World", { preserveCase: true })).toBe("Hello World");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeTitle("foo   bar")).toBe("foo bar");
  });

  it("applies NFKC normalization", () => {
    // Full-width character → ASCII equivalent after NFKC.
    expect(normalizeTitle("\uFF21\uFF22\uFF23")).toBe("abc");
  });

  it("strips surrounding quotes", () => {
    expect(normalizeTitle('"Hello"')).toBe("hello");
  });

  it("strips surrounding brackets", () => {
    expect(normalizeTitle("[Hello]")).toBe("hello");
  });

  it("removes zero-width spaces", () => {
    expect(normalizeTitle("hel\u200Blo")).toBe("hello");
  });

  it("converts non-breaking spaces to regular spaces", () => {
    expect(normalizeTitle("foo\u00A0bar")).toBe("foo bar");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeTitle("")).toBe("");
  });
});

describe("computeContentHash", () => {
  it("returns a 64-char hex string", () => {
    const h = computeContentHash("hello");
    expect(h).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(h)).toBe(true);
  });

  it("produces same hash for same input", () => {
    expect(computeContentHash("test")).toBe(computeContentHash("test"));
  });

  it("produces different hash for different input", () => {
    expect(computeContentHash("a")).not.toBe(computeContentHash("b"));
  });
});

describe("safeUrl", () => {
  it("returns valid https URL unchanged", () => {
    expect(safeUrl("https://example.com/path")).toBe("https://example.com/path");
  });

  it("returns empty string for invalid URL", () => {
    expect(safeUrl("not-a-url")).toBe("");
  });

  it("returns empty string for non-http scheme", () => {
    expect(safeUrl("ftp://example.com")).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(safeUrl("")).toBe("");
  });
});
