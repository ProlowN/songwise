import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("../token-scraper.js", () => ({
  scrapeDevToken: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { scrapeDevToken } from "../token-scraper.js";
import {
  saveTokens,
  clearTokens,
  getTokens,
  getTokenStatus,
} from "../token-manager.js";

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedScrapeDevToken = vi.mocked(scrapeDevToken);

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "ES256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

function futureExp(): number {
  return Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
}

function pastExp(): number {
  return Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
}

/**
 * Configures the mock so that `keychainGet` returns the desired values
 * for specific accounts. Intercepts `find-generic-password` calls and
 * returns the mapped value; all other calls (delete, add) return "".
 */
function setupKeychainGet(
  mapping: Record<string, string | null>,
): void {
  mockedExecFileSync.mockImplementation(((
    cmd: string,
    args?: readonly string[],
    _opts?: unknown,
  ) => {
    if (cmd === "security" && args && args[0] === "find-generic-password") {
      const accountIdx = args.indexOf("-a");
      const account = accountIdx !== -1 ? args[accountIdx + 1] : undefined;
      if (account && account in mapping) {
        const value = mapping[account];
        if (value === null) {
          const err = new Error("not found") as Error & { status: number };
          err.status = 44;
          throw err;
        }
        return value + "\n"; // execFileSync returns with trailing newline
      }
    }
    // For all other calls (delete-generic-password, add-generic-password), succeed
    return "";
  }) as Mock);
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
});

// ── saveTokens ─────────────────────────────────────────────────────────────────

describe("saveTokens", () => {
  it("calls execFileSync to delete then add for both accounts", () => {
    mockedExecFileSync.mockReturnValue("");

    saveTokens("dev-tok-123", "user-tok-456");

    // keychainSet is called once per token; each does delete + add = 2 calls.
    // Two tokens = 4 calls total.
    expect(mockedExecFileSync).toHaveBeenCalledTimes(4);

    // Developer token: delete
    expect(mockedExecFileSync).toHaveBeenNthCalledWith(
      1,
      "security",
      ["delete-generic-password", "-s", "songwise", "-a", "developer-token"],
      { stdio: "ignore" },
    );

    // Developer token: add
    expect(mockedExecFileSync).toHaveBeenNthCalledWith(
      2,
      "security",
      [
        "add-generic-password",
        "-s", "songwise",
        "-a", "developer-token",
        "-w", "dev-tok-123",
      ],
    );

    // User token: delete
    expect(mockedExecFileSync).toHaveBeenNthCalledWith(
      3,
      "security",
      ["delete-generic-password", "-s", "songwise", "-a", "music-user-token"],
      { stdio: "ignore" },
    );

    // User token: add
    expect(mockedExecFileSync).toHaveBeenNthCalledWith(
      4,
      "security",
      [
        "add-generic-password",
        "-s", "songwise",
        "-a", "music-user-token",
        "-w", "user-tok-456",
      ],
    );
  });

  it("handles delete failure gracefully (key did not exist)", () => {
    let callIndex = 0;
    mockedExecFileSync.mockImplementation(() => {
      callIndex++;
      // First and third calls are delete — make them throw
      if (callIndex === 1 || callIndex === 3) {
        throw new Error("The specified item could not be found in the keychain.");
      }
      return "";
    });

    // Should not throw despite delete failures
    expect(() => saveTokens("dev-tok", "user-tok")).not.toThrow();
  });

  it("throws with actionable error when add-generic-password fails", () => {
    mockedExecFileSync.mockImplementation(((
      _cmd: string,
      args?: readonly string[],
    ) => {
      if (args && args[0] === "add-generic-password" && args.includes("developer-token")) {
        throw new Error("Keychain locked");
      }
      return "";
    }) as Mock);

    const thrown = expect(() => saveTokens("dev-tok", "user-tok"));
    thrown.toThrow(/Failed to save to macOS Keychain \(developer-token\): Keychain locked/);
  });

  it("includes unlock hint in the error when add fails", () => {
    mockedExecFileSync.mockImplementation(((
      _cmd: string,
      args?: readonly string[],
    ) => {
      if (args && args[0] === "add-generic-password" && args.includes("developer-token")) {
        throw new Error("Keychain locked");
      }
      return "";
    }) as Mock);

    expect(() => saveTokens("dev-tok", "user-tok")).toThrow(
      /Make sure your keychain is unlocked/,
    );
  });

  it("throws with actionable error when add fails for music-user-token", () => {
    mockedExecFileSync.mockImplementation(((
      _cmd: string,
      args?: readonly string[],
    ) => {
      if (args && args[0] === "add-generic-password" && args.includes("music-user-token")) {
        throw new Error("Permission denied");
      }
      return "";
    }) as Mock);

    expect(() => saveTokens("dev-tok", "user-tok")).toThrow(
      /Failed to save to macOS Keychain \(music-user-token\): Permission denied/,
    );
  });

  it("wraps non-Error throwables in the error message", () => {
    mockedExecFileSync.mockImplementation(((
      _cmd: string,
      args?: readonly string[],
    ) => {
      if (args && args[0] === "add-generic-password" && args.includes("developer-token")) {
        throw "string error"; // eslint-disable-line no-throw-literal
      }
      return "";
    }) as Mock);

    expect(() => saveTokens("dev-tok", "user-tok")).toThrow(
      /Failed to save to macOS Keychain \(developer-token\): string error/,
    );
  });
});

// ── clearTokens ────────────────────────────────────────────────────────────────

describe("clearTokens", () => {
  it("calls delete-generic-password for both accounts", () => {
    mockedExecFileSync.mockReturnValue("");

    clearTokens();

    expect(mockedExecFileSync).toHaveBeenCalledTimes(2);

    expect(mockedExecFileSync).toHaveBeenNthCalledWith(
      1,
      "security",
      ["delete-generic-password", "-s", "songwise", "-a", "developer-token"],
      { stdio: "ignore" },
    );

    expect(mockedExecFileSync).toHaveBeenNthCalledWith(
      2,
      "security",
      ["delete-generic-password", "-s", "songwise", "-a", "music-user-token"],
      { stdio: "ignore" },
    );
  });

  it("handles delete failure gracefully for both accounts", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("Item not found");
    });

    expect(() => clearTokens()).not.toThrow();
  });
});

// ── getTokens ──────────────────────────────────────────────────────────────────

describe("getTokens", () => {
  it("returns null when no user token is stored", async () => {
    setupKeychainGet({
      "music-user-token": null,
      "developer-token": null,
    });

    const result = await getTokens();
    expect(result).toBeNull();
  });

  it("returns null when user token is missing regardless of dev token", async () => {
    const validDev = makeJwt({ exp: futureExp() });
    setupKeychainGet({
      "music-user-token": null,
      "developer-token": validDev,
    });

    const result = await getTokens();
    expect(result).toBeNull();
  });

  it("returns stored tokens when both are present and dev token is not expired", async () => {
    const validDev = makeJwt({ exp: futureExp() });
    const userToken = "user-token-value";
    setupKeychainGet({
      "music-user-token": userToken,
      "developer-token": validDev,
    });

    const result = await getTokens();
    expect(result).toEqual({
      developerToken: validDev,
      musicUserToken: userToken,
    });
    // scrapeDevToken should NOT be called since dev token is still valid
    expect(mockedScrapeDevToken).not.toHaveBeenCalled();
  });

  it("auto-refreshes expired developer token via scrapeDevToken", async () => {
    const expiredDev = makeJwt({ exp: pastExp() });
    const freshDev = makeJwt({ exp: futureExp(), fresh: true });
    const userToken = "user-token-value";

    setupKeychainGet({
      "music-user-token": userToken,
      "developer-token": expiredDev,
    });
    mockedScrapeDevToken.mockResolvedValue(freshDev);

    const result = await getTokens();

    expect(mockedScrapeDevToken).toHaveBeenCalledOnce();
    expect(result).toEqual({
      developerToken: freshDev,
      musicUserToken: userToken,
    });

    // Verify the new token was saved to keychain (keychainSet calls delete + add)
    const addCalls = mockedExecFileSync.mock.calls.filter(
      (call) =>
        call[0] === "security" &&
        Array.isArray(call[1]) &&
        call[1][0] === "add-generic-password" &&
        call[1].includes("developer-token"),
    );
    expect(addCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("auto-refreshes when developer token is missing but user token exists", async () => {
    const freshDev = makeJwt({ exp: futureExp() });
    const userToken = "user-token-value";

    setupKeychainGet({
      "music-user-token": userToken,
      "developer-token": null,
    });
    mockedScrapeDevToken.mockResolvedValue(freshDev);

    const result = await getTokens();

    expect(mockedScrapeDevToken).toHaveBeenCalledOnce();
    expect(result).toEqual({
      developerToken: freshDev,
      musicUserToken: userToken,
    });
  });

  it("throws when dev token is missing AND scrape fails", async () => {
    const userToken = "user-token-value";
    setupKeychainGet({
      "music-user-token": userToken,
      "developer-token": null,
    });
    mockedScrapeDevToken.mockRejectedValue(new Error("Network error"));

    await expect(getTokens()).rejects.toThrow(
      /Developer token is missing and could not be refreshed: Network error/,
    );
  });

  it("includes login hint when dev token is missing and scrape fails", async () => {
    const userToken = "user-token-value";
    setupKeychainGet({
      "music-user-token": userToken,
      "developer-token": null,
    });
    mockedScrapeDevToken.mockRejectedValue(new Error("Network error"));

    await expect(getTokens()).rejects.toThrow(/Run: songwise auth login/);
  });

  it("falls back to expired token with console warning when scrape fails but expired token exists", async () => {
    const expiredDev = makeJwt({ exp: pastExp() });
    const userToken = "user-token-value";
    setupKeychainGet({
      "music-user-token": userToken,
      "developer-token": expiredDev,
    });
    mockedScrapeDevToken.mockRejectedValue(new Error("Scrape failed"));

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await getTokens();

    expect(result).toEqual({
      developerToken: expiredDev,
      musicUserToken: userToken,
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Warning: Developer token expired and could not be refreshed. Using expired token as fallback.",
    );

    consoleErrorSpy.mockRestore();
  });

  it("treats JWT without exp claim as expired and triggers refresh", async () => {
    const noExpJwt = makeJwt({ sub: "test" }); // no exp
    const freshDev = makeJwt({ exp: futureExp() });
    const userToken = "user-token-value";

    setupKeychainGet({
      "music-user-token": userToken,
      "developer-token": noExpJwt,
    });
    mockedScrapeDevToken.mockResolvedValue(freshDev);

    const result = await getTokens();

    expect(mockedScrapeDevToken).toHaveBeenCalledOnce();
    expect(result).toEqual({
      developerToken: freshDev,
      musicUserToken: userToken,
    });
  });

  it("treats malformed JWT as expired and triggers refresh", async () => {
    const freshDev = makeJwt({ exp: futureExp() });
    const userToken = "user-token-value";

    setupKeychainGet({
      "music-user-token": userToken,
      "developer-token": "not-a-jwt",
    });
    mockedScrapeDevToken.mockResolvedValue(freshDev);

    const result = await getTokens();

    expect(mockedScrapeDevToken).toHaveBeenCalledOnce();
    expect(result).toEqual({
      developerToken: freshDev,
      musicUserToken: userToken,
    });
  });

  it("wraps non-Error scrape throwables in the error message when dev token is missing", async () => {
    const userToken = "user-token-value";
    setupKeychainGet({
      "music-user-token": userToken,
      "developer-token": null,
    });
    mockedScrapeDevToken.mockRejectedValue("string rejection");

    await expect(getTokens()).rejects.toThrow(
      /Developer token is missing and could not be refreshed: string rejection/,
    );
  });
});

// ── getTokenStatus ─────────────────────────────────────────────────────────────

describe("getTokenStatus", () => {
  it("returns correct status when no tokens are stored", () => {
    setupKeychainGet({
      "developer-token": null,
      "music-user-token": null,
    });

    const status = getTokenStatus();

    expect(status).toEqual({
      hasDeveloperToken: false,
      hasUserToken: false,
      devTokenExpired: false,
      devTokenExpiry: null,
    });
  });

  it("returns correct status for valid tokens with expiry", () => {
    const exp = futureExp();
    const validDev = makeJwt({ exp });
    setupKeychainGet({
      "developer-token": validDev,
      "music-user-token": "user-tok",
    });

    const status = getTokenStatus();

    expect(status.hasDeveloperToken).toBe(true);
    expect(status.hasUserToken).toBe(true);
    expect(status.devTokenExpired).toBe(false);
    expect(status.devTokenExpiry).toEqual(new Date(exp * 1000));
  });

  it("returns devTokenExpired=true for an expired developer token", () => {
    const exp = pastExp();
    const expiredDev = makeJwt({ exp });
    setupKeychainGet({
      "developer-token": expiredDev,
      "music-user-token": "user-tok",
    });

    const status = getTokenStatus();

    expect(status.hasDeveloperToken).toBe(true);
    expect(status.hasUserToken).toBe(true);
    expect(status.devTokenExpired).toBe(true);
    expect(status.devTokenExpiry).toEqual(new Date(exp * 1000));
  });

  it("handles malformed JWT gracefully (devTokenExpired=true)", () => {
    setupKeychainGet({
      "developer-token": "not-a-valid-jwt",
      "music-user-token": "user-tok",
    });

    const status = getTokenStatus();

    expect(status.hasDeveloperToken).toBe(true);
    expect(status.hasUserToken).toBe(true);
    expect(status.devTokenExpired).toBe(true);
    expect(status.devTokenExpiry).toBeNull();
  });

  it("handles JWT without exp claim (devTokenExpired=true, devTokenExpiry=null)", () => {
    const noExpJwt = makeJwt({ sub: "test" });
    setupKeychainGet({
      "developer-token": noExpJwt,
      "music-user-token": "user-tok",
    });

    const status = getTokenStatus();

    // exp is undefined, so typeof exp !== "number" → devTokenExpired = true
    expect(status.hasDeveloperToken).toBe(true);
    expect(status.devTokenExpired).toBe(true);
    expect(status.devTokenExpiry).toBeNull();
  });

  it("returns hasUserToken=false when only dev token exists", () => {
    const validDev = makeJwt({ exp: futureExp() });
    setupKeychainGet({
      "developer-token": validDev,
      "music-user-token": null,
    });

    const status = getTokenStatus();

    expect(status.hasDeveloperToken).toBe(true);
    expect(status.hasUserToken).toBe(false);
  });

  it("returns hasDeveloperToken=false when only user token exists", () => {
    setupKeychainGet({
      "developer-token": null,
      "music-user-token": "user-tok",
    });

    const status = getTokenStatus();

    expect(status.hasDeveloperToken).toBe(false);
    expect(status.hasUserToken).toBe(true);
    expect(status.devTokenExpired).toBe(false);
    expect(status.devTokenExpiry).toBeNull();
  });
});

// ── keychainGet error handling (tested indirectly via getTokenStatus) ──────────

describe("keychainGet error handling", () => {
  it("returns null for exit code 44 (item not found)", () => {
    const err = new Error("not found") as Error & { status: number };
    err.status = 44;
    mockedExecFileSync.mockImplementation(() => {
      throw err;
    });

    // getTokenStatus calls keychainGet -- exit code 44 should return null (no token)
    const status = getTokenStatus();
    expect(status.hasDeveloperToken).toBe(false);
    expect(status.hasUserToken).toBe(false);
  });

  it("throws with actionable error for non-44 exit codes", () => {
    const err = new Error("Keychain is locked") as Error & { status: number };
    err.status = 1;
    mockedExecFileSync.mockImplementation(() => {
      throw err;
    });

    expect(() => getTokenStatus()).toThrow(
      /Failed to read from macOS Keychain/,
    );
  });

  it("includes unlock hint for non-44 exit codes", () => {
    const err = new Error("Keychain is locked") as Error & { status: number };
    err.status = 1;
    mockedExecFileSync.mockImplementation(() => {
      throw err;
    });

    expect(() => getTokenStatus()).toThrow(
      /Make sure your keychain is unlocked/,
    );
  });

  it("throws with actionable error for errors without status property", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("Unexpected failure");
    });

    expect(() => getTokenStatus()).toThrow(
      /Failed to read from macOS Keychain.*Unexpected failure/,
    );
  });

  it("wraps non-Error throwables in the error message", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw 42; // eslint-disable-line no-throw-literal
    });

    expect(() => getTokenStatus()).toThrow(
      /Failed to read from macOS Keychain.*42/,
    );
  });
});
