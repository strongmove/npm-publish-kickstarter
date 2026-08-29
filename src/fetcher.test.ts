const launchMock = jest.fn();

jest.mock("playwright", () => ({
  chromium: {
    launch: launchMock,
  },
}));

import { fetchPage } from "./fetcher";

describe("fetchPage", () => {
  beforeEach(() => {
    launchMock.mockReset();
  });

  it("uses Playwright Chromium when browser mode is selected", async () => {
    const setExtraHTTPHeaders = jest.fn();
    const goto = jest.fn().mockResolvedValue({
      status: () => 200,
      headers: () => ({ etag: '"abc123"' }),
    });
    const content = jest.fn().mockResolvedValue("<html><body>rendered</body></html>");
    const close = jest.fn();
    const page = {
      setExtraHTTPHeaders,
      goto,
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      content,
      url: jest.fn().mockReturnValue("https://example.com/final"),
      close,
    };

    launchMock.mockResolvedValue({
      newPage: jest.fn().mockResolvedValue(page),
    });

    const result = await fetchPage("https://example.com/", {
      mode: "browser",
      timeoutMs: 5_000,
      userAgent: "ua-test",
      headers: { "X-Test": "present" },
      extraHeaders: { Accept: "text/html" },
    });

    expect(launchMock).toHaveBeenCalledWith({ headless: true });
    expect(setExtraHTTPHeaders).toHaveBeenCalledWith({
      Accept: "text/html",
      "X-Test": "present",
    });
    expect(goto).toHaveBeenCalledWith("https://example.com/", {
      waitUntil: "domcontentloaded",
      timeout: 5_000,
    });
    expect(result.mode).toBe("browser");
    expect(result.status).toBe(200);
    expect(result.etag).toBe('"abc123"');
    expect(result.finalUrl).toBe("https://example.com/final");
    expect(result.html).toBe("<html><body>rendered</body></html>");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
