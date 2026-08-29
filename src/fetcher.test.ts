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
      on: jest.fn(),
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

  it("captures HLS manifests and media URLs from browser responses", async () => {
    const setExtraHTTPHeaders = jest.fn();
    let responseHandler: ((response: any) => void | Promise<void>) | undefined;
    const goto = jest.fn().mockImplementation(async () => {
      if (responseHandler) {
        await responseHandler({
          url: () => "https://example.com/master.m3u8",
          status: () => 200,
          headers: () => ({ "content-type": "application/vnd.apple.mpegurl" }),
          text: jest.fn().mockResolvedValue("#EXTM3U\n#EXT-X-STREAM-INF\nhttps://example.com/segment.m3u8"),
        });
        await responseHandler({
          url: () => "https://example.com/segment.ts",
          status: () => 200,
          headers: () => ({ "content-type": "video/mp2t" }),
          text: jest.fn().mockResolvedValue("segment-data"),
        });
      }
      return {
        status: () => 200,
        headers: () => ({ etag: '"manifest-etag"' }),
      };
    });
    const content = jest.fn().mockResolvedValue("<html><body>video</body></html>");
    const close = jest.fn();
    const page = {
      on: jest.fn((event, handler) => {
        if (event === "response") {
          responseHandler = handler;
        }
      }),
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
    });

    expect(result.manifest).toMatchObject({
      url: "https://example.com/master.m3u8",
      kind: "m3u8",
      body: expect.stringContaining("#EXTM3U"),
    });
    expect(result.mediaUrls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://example.com/segment.ts",
          kind: "segment",
        }),
      ])
    );
    expect(result.networkLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://example.com/master.m3u8",
          kind: "manifest",
        }),
      ])
    );
  });
});
