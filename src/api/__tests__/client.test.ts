import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AppleMusicClient } from "../client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEV_TOKEN = "test-developer-token";
const USER_TOKEN = "test-music-user-token";

const expectedHeaders: Record<string, string> = {
  Authorization: `Bearer ${DEV_TOKEN}`,
  "Music-User-Token": USER_TOKEN,
  Origin: "https://music.apple.com",
  "Content-Type": "application/json",
};

/**
 * Build a minimal Response-like object that satisfies the parts of the
 * Response interface used by AppleMusicClient.
 */
function mockResponse(
  status: number,
  body: unknown = {},
  {
    ok,
    statusText = "OK",
    headers: extraHeaders = {},
  }: {
    ok?: boolean;
    statusText?: string;
    headers?: Record<string, string>;
  } = {},
): Response {
  const isOk = ok ?? (status >= 200 && status < 300);
  const hdrs = new Headers(extraHeaders);
  return {
    ok: isOk,
    status,
    statusText,
    headers: hdrs,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === "string" ? body : JSON.stringify(body)),
    // The rest are required by the Response type but unused by our code
    clone: vi.fn(),
    body: null,
    bodyUsed: false,
    arrayBuffer: vi.fn(),
    blob: vi.fn(),
    formData: vi.fn(),
    redirected: false,
    type: "basic" as ResponseType,
    url: "",
    bytes: vi.fn(),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("AppleMusicClient", () => {
  let client: AppleMusicClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    client = new AppleMusicClient(DEV_TOKEN, USER_TOKEN);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Headers / Auth
  // -----------------------------------------------------------------------

  describe("headers and authentication", () => {
    it("sends correct Authorization and Music-User-Token headers", async () => {
      fetchMock.mockResolvedValue(mockResponse(200, { result: true }));

      await client.get("/v1/me/library/songs");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.headers).toEqual(expectedHeaders);
    });

    it("prepends BASE_URL for relative paths", async () => {
      fetchMock.mockResolvedValue(mockResponse(200, { result: true }));

      await client.get("/v1/me/library/songs");

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe("https://amp-api.music.apple.com/v1/me/library/songs");
    });

    it("uses absolute URL as-is when path starts with http", async () => {
      fetchMock.mockResolvedValue(mockResponse(200, { data: [], next: "" }));

      await client.getAll("https://amp-api.music.apple.com/v1/me/library/songs?offset=25");

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe("https://amp-api.music.apple.com/v1/me/library/songs?offset=25");
    });
  });

  // -----------------------------------------------------------------------
  // GET
  // -----------------------------------------------------------------------

  describe("get()", () => {
    it("returns parsed JSON on success", async () => {
      const payload = { id: "1", type: "songs", attributes: { name: "Test Song" } };
      fetchMock.mockResolvedValue(mockResponse(200, payload));

      const result = await client.get("/v1/me/library/songs/1");

      expect(result).toEqual(payload);
    });

    it("appends query params when provided", async () => {
      fetchMock.mockResolvedValue(mockResponse(200, { data: [] }));

      await client.get("/v1/me/library/songs", { limit: "25", offset: "50" });

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain("limit=25");
      expect(url).toContain("offset=50");
      expect(url).toMatch(/\?.*&/); // has ? and &
    });

    it("does not append query string when params are omitted", async () => {
      fetchMock.mockResolvedValue(mockResponse(200, {}));

      await client.get("/v1/me/library/songs");

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe("https://amp-api.music.apple.com/v1/me/library/songs");
    });

    it("uses GET method", async () => {
      fetchMock.mockResolvedValue(mockResponse(200, {}));

      await client.get("/v1/me/library/songs");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("GET");
    });

    it("throws on non-ok status with body excerpt", async () => {
      const errorBody = "Unauthorized: invalid developer token provided for this request";
      fetchMock.mockResolvedValue(
        mockResponse(401, errorBody, { ok: false, statusText: "Unauthorized" }),
      );

      await expect(client.get("/v1/me/library/songs")).rejects.toThrow(
        /GET \/v1\/me\/library\/songs failed: 401 Unauthorized/,
      );
      await expect(client.get("/v1/me/library/songs")).rejects.toThrow(
        /Unauthorized: invalid developer token/,
      );
    });

    it("throws on non-ok status without body when text() fails", async () => {
      const res = mockResponse(500, "", { ok: false, statusText: "Internal Server Error" });
      (res.text as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("read error"));
      fetchMock.mockResolvedValue(res);

      await expect(client.get("/v1/path")).rejects.toThrow(
        "GET /v1/path failed: 500 Internal Server Error",
      );
    });

    it("throws descriptive error when response is not valid JSON", async () => {
      const res = mockResponse(200, null);
      (res.json as ReturnType<typeof vi.fn>).mockRejectedValue(new SyntaxError("Unexpected token"));
      fetchMock.mockResolvedValue(res);

      await expect(client.get("/v1/me/library/songs")).rejects.toThrow(
        /non-JSON response.*status 200.*Apple Music may be experiencing issues/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // POST
  // -----------------------------------------------------------------------

  describe("post()", () => {
    it("sends POST request with JSON body", async () => {
      fetchMock.mockResolvedValue(mockResponse(200, {}));
      const body = { name: "My Playlist" };

      await client.post("/v1/me/library/playlists", body);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify(body));
    });

    it("succeeds with 200 status", async () => {
      fetchMock.mockResolvedValue(mockResponse(200));

      const res = await client.post("/v1/me/library/playlists");

      expect(res.status).toBe(200);
    });

    it("succeeds with 201 status", async () => {
      fetchMock.mockResolvedValue(mockResponse(201, {}, { ok: false, statusText: "Created" }));

      const res = await client.post("/v1/me/library/playlists");

      expect(res.status).toBe(201);
    });

    it("succeeds with 202 status", async () => {
      fetchMock.mockResolvedValue(mockResponse(202, {}, { ok: false, statusText: "Accepted" }));

      const res = await client.post("/v1/me/library/playlists");

      expect(res.status).toBe(202);
    });

    it("throws on 400 status with response body excerpt", async () => {
      fetchMock.mockResolvedValue(
        mockResponse(400, { error: "Invalid request" }, { ok: false, statusText: "Bad Request" }),
      );

      await expect(client.post("/v1/me/library/playlists")).rejects.toThrow(
        /POST \/v1\/me\/library\/playlists failed: 400 Bad Request/,
      );
    });

    it("throws on 500 status with response body excerpt", async () => {
      fetchMock.mockResolvedValue(
        mockResponse(500, "Server error details", { ok: false, statusText: "Internal Server Error" }),
      );

      await expect(client.post("/v1/path")).rejects.toThrow(
        /POST \/v1\/path failed: 500 Internal Server Error/,
      );
    });

    it("sends POST without body when body is omitted", async () => {
      fetchMock.mockResolvedValue(mockResponse(200));

      await client.post("/v1/me/library/playlists");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.body).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // DELETE
  // -----------------------------------------------------------------------

  describe("delete()", () => {
    it("sends DELETE request", async () => {
      fetchMock.mockResolvedValue(mockResponse(204, null, { statusText: "No Content" }));

      await client.delete("/v1/me/library/playlists/p.abc123");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("DELETE");
    });

    it("returns true on 204 status", async () => {
      fetchMock.mockResolvedValue(mockResponse(204, null, { statusText: "No Content" }));

      const result = await client.delete("/v1/me/library/playlists/p.abc123");

      expect(result).toBe(true);
    });

    it("returns true on 200 status", async () => {
      fetchMock.mockResolvedValue(mockResponse(200));

      const result = await client.delete("/v1/me/library/playlists/p.abc123");

      expect(result).toBe(true);
    });

    it("appends query params when provided", async () => {
      fetchMock.mockResolvedValue(mockResponse(204, null, { statusText: "No Content" }));

      await client.delete("/v1/me/library/songs", { ids: "i.1,i.2,i.3" });

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain("ids=");
    });

    it("throws on 404 status with response body excerpt", async () => {
      fetchMock.mockResolvedValue(
        mockResponse(404, { error: "Resource not found" }, { ok: false, statusText: "Not Found" }),
      );

      await expect(
        client.delete("/v1/me/library/playlists/p.nonexistent"),
      ).rejects.toThrow(
        /DELETE \/v1\/me\/library\/playlists\/p.nonexistent failed: 404 Not Found/,
      );
    });

    it("throws on 500 status with response body excerpt", async () => {
      fetchMock.mockResolvedValue(
        mockResponse(500, "Server error details", { ok: false, statusText: "Internal Server Error" }),
      );

      await expect(client.delete("/v1/path")).rejects.toThrow(
        /DELETE \/v1\/path failed: 500 Internal Server Error/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Rate Limiting (429)
  // -----------------------------------------------------------------------

  describe("rate limiting (429)", () => {
    it("retries once after 429 and succeeds", async () => {
      vi.useFakeTimers();

      const rateLimitedRes = mockResponse(429, {}, {
        ok: false,
        statusText: "Too Many Requests",
        headers: { "Retry-After": "2" },
      });
      const okRes = mockResponse(200, { id: "1" });

      fetchMock.mockResolvedValueOnce(rateLimitedRes).mockResolvedValueOnce(okRes);

      const promise = client.get<{ id: string }>("/v1/me/library/songs");

      // Advance past the 2-second retry delay
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ id: "1" });
    });

    it("throws after two consecutive 429 responses", async () => {
      vi.useFakeTimers();

      const rateLimitedRes1 = mockResponse(429, {}, {
        ok: false,
        statusText: "Too Many Requests",
        headers: { "Retry-After": "1" },
      });
      const rateLimitedRes2 = mockResponse(429, {}, {
        ok: false,
        statusText: "Too Many Requests",
        headers: { "Retry-After": "1" },
      });

      fetchMock.mockResolvedValueOnce(rateLimitedRes1).mockResolvedValueOnce(rateLimitedRes2);

      const promise = client.get("/v1/me/library/songs");

      // Attach a no-op catch immediately to prevent Node's unhandled rejection warning.
      // We still assert on the original promise below.
      promise.catch(() => {});

      await vi.advanceTimersByTimeAsync(1000);

      await expect(promise).rejects.toThrow(
        "Rate limited by Apple Music API even after retry. Try again later.",
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("respects Retry-After header value", async () => {
      vi.useFakeTimers();

      const rateLimitedRes = mockResponse(429, {}, {
        ok: false,
        statusText: "Too Many Requests",
        headers: { "Retry-After": "5" },
      });
      const okRes = mockResponse(200, { success: true });

      fetchMock.mockResolvedValueOnce(rateLimitedRes).mockResolvedValueOnce(okRes);

      const promise = client.get("/v1/me/library/songs");

      // At 4 seconds, the retry hasn't fired yet
      await vi.advanceTimersByTimeAsync(4000);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // At 5 seconds the retry fires
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await promise;
    });

    it("defaults to 2s when Retry-After header is missing", async () => {
      vi.useFakeTimers();

      const rateLimitedRes = mockResponse(429, {}, {
        ok: false,
        statusText: "Too Many Requests",
      });
      const okRes = mockResponse(200, { ok: true });

      fetchMock.mockResolvedValueOnce(rateLimitedRes).mockResolvedValueOnce(okRes);

      const promise = client.get("/v1/me/library/songs");

      // Should wait default 2 seconds
      await vi.advanceTimersByTimeAsync(1999);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await promise;
    });

    it("clamps Retry-After to minimum of 1 second", async () => {
      vi.useFakeTimers();

      const rateLimitedRes = mockResponse(429, {}, {
        ok: false,
        statusText: "Too Many Requests",
        headers: { "Retry-After": "0" },
      });
      const okRes = mockResponse(200, { ok: true });

      fetchMock.mockResolvedValueOnce(rateLimitedRes).mockResolvedValueOnce(okRes);

      const promise = client.get("/v1/me/library/songs");

      // Clamped to 1s minimum
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await promise;
    });

    it("clamps Retry-After to maximum of 30 seconds", async () => {
      vi.useFakeTimers();

      const rateLimitedRes = mockResponse(429, {}, {
        ok: false,
        statusText: "Too Many Requests",
        headers: { "Retry-After": "120" },
      });
      const okRes = mockResponse(200, { ok: true });

      fetchMock.mockResolvedValueOnce(rateLimitedRes).mockResolvedValueOnce(okRes);

      const promise = client.get("/v1/me/library/songs");

      // Clamped to 30s max
      await vi.advanceTimersByTimeAsync(29999);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await promise;
    });

    it("logs rate limit warning to console.error", async () => {
      vi.useFakeTimers();
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const rateLimitedRes = mockResponse(429, {}, {
        ok: false,
        statusText: "Too Many Requests",
        headers: { "Retry-After": "3" },
      });
      const okRes = mockResponse(200, { ok: true });

      fetchMock.mockResolvedValueOnce(rateLimitedRes).mockResolvedValueOnce(okRes);

      const promise = client.get("/v1/me/library/songs");
      await vi.advanceTimersByTimeAsync(3000);
      await promise;

      expect(errorSpy).toHaveBeenCalledWith(
        "Rate limited by Apple Music API. Retrying in 3s...",
      );

      errorSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // getAll (pagination)
  // -----------------------------------------------------------------------

  describe("getAll()", () => {
    it("returns data from a single page (no next)", async () => {
      const songs = [
        { id: "1", type: "songs" },
        { id: "2", type: "songs" },
      ];
      fetchMock.mockResolvedValue(mockResponse(200, { data: songs }));

      const result = await client.getAll("/v1/me/library/songs", { limit: "100" });

      expect(result).toEqual(songs);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("follows next URLs across multiple pages", async () => {
      const page1 = {
        data: [{ id: "1" }, { id: "2" }],
        next: "https://amp-api.music.apple.com/v1/me/library/songs?offset=2",
      };
      const page2 = {
        data: [{ id: "3" }, { id: "4" }],
        next: "https://amp-api.music.apple.com/v1/me/library/songs?offset=4",
      };
      const page3 = {
        data: [{ id: "5" }],
        // no next -> end of pagination
      };

      fetchMock
        .mockResolvedValueOnce(mockResponse(200, page1))
        .mockResolvedValueOnce(mockResponse(200, page2))
        .mockResolvedValueOnce(mockResponse(200, page3));

      const result = await client.getAll("/v1/me/library/songs");

      expect(result).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }, { id: "5" }]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("handles absolute next URLs without double-prefixing BASE_URL", async () => {
      const page1 = {
        data: [{ id: "1" }],
        next: "https://amp-api.music.apple.com/v1/me/library/songs?offset=1",
      };
      const page2 = {
        data: [{ id: "2" }],
      };

      fetchMock
        .mockResolvedValueOnce(mockResponse(200, page1))
        .mockResolvedValueOnce(mockResponse(200, page2));

      await client.getAll("/v1/me/library/songs");

      // The second fetch call should use the absolute URL as-is
      const [secondUrl] = fetchMock.mock.calls[1] as [string];
      expect(secondUrl).toBe("https://amp-api.music.apple.com/v1/me/library/songs?offset=1");
      // Must NOT be double-prefixed like https://amp-api.music.apple.comhttps://...
      expect(secondUrl).not.toMatch(/^https:\/\/amp-api\.music\.apple\.comhttps/);
    });

    it("passes query params on the first request", async () => {
      fetchMock.mockResolvedValue(mockResponse(200, { data: [] }));

      await client.getAll("/v1/me/library/songs", { limit: "100", include: "catalog" });

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain("limit=100");
      expect(url).toContain("include=catalog");
    });

    it("throws on non-ok response during pagination", async () => {
      fetchMock.mockResolvedValue(
        mockResponse(500, {}, { ok: false, statusText: "Internal Server Error" }),
      );

      await expect(client.getAll("/v1/me/library/songs")).rejects.toThrow(
        /GET .* failed: 500 Internal Server Error/,
      );
    });

    it("throws on non-JSON response", async () => {
      const res = mockResponse(200, null);
      (res.json as ReturnType<typeof vi.fn>).mockRejectedValue(
        new SyntaxError("Unexpected token"),
      );
      fetchMock.mockResolvedValue(res);

      await expect(client.getAll("/v1/me/library/songs")).rejects.toThrow(
        /non-JSON response.*Apple Music may be experiencing issues/,
      );
    });

    it("throws when response is missing data array", async () => {
      fetchMock.mockResolvedValue(
        mockResponse(200, { results: [] }), // has "results" instead of "data"
      );

      await expect(client.getAll("/v1/me/library/songs")).rejects.toThrow(
        /missing "data" array/,
      );
    });

    it("throws when data is not an array", async () => {
      fetchMock.mockResolvedValue(
        mockResponse(200, { data: "not-an-array" }),
      );

      await expect(client.getAll("/v1/me/library/songs")).rejects.toThrow(
        /missing "data" array/,
      );
    });

    it("throws after exceeding MAX_PAGES (500)", async () => {
      // Create a response that always has a next URL, causing infinite pagination
      const infinitePage = {
        data: [{ id: "x" }],
        next: "https://amp-api.music.apple.com/v1/me/library/songs?offset=999",
      };
      fetchMock.mockResolvedValue(mockResponse(200, infinitePage));

      await expect(client.getAll("/v1/me/library/songs")).rejects.toThrow(
        "Pagination exceeded 500 pages. Aborting to prevent infinite loop.",
      );

      // Pages 1-500 each make a fetch call; page 501 increments the counter
      // and throws BEFORE fetching, so total fetch calls = 500
      expect(fetchMock).toHaveBeenCalledTimes(500);
    });

    it("returns empty array when first page has empty data", async () => {
      fetchMock.mockResolvedValue(mockResponse(200, { data: [] }));

      const result = await client.getAll("/v1/me/library/songs");

      expect(result).toEqual([]);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("stops pagination when next is an empty string", async () => {
      const page1 = {
        data: [{ id: "1" }],
        next: "",
      };
      fetchMock.mockResolvedValue(mockResponse(200, page1));

      const result = await client.getAll("/v1/me/library/songs");

      expect(result).toEqual([{ id: "1" }]);
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });
});
