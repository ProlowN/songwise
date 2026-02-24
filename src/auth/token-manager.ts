import { execFileSync } from "node:child_process";
import { scrapeDevToken } from "./token-scraper.js";

const SERVICE = "songwise";
const DEV_TOKEN_ACCOUNT = "developer-token";
const USER_TOKEN_ACCOUNT = "music-user-token";

function keychainSet(account: string, value: string): void {
  try {
    execFileSync("security", [
      "delete-generic-password",
      "-s", SERVICE,
      "-a", account,
    ], { stdio: "ignore" });
  } catch {
    // Key didn't exist — fine
  }
  try {
    execFileSync("security", [
      "add-generic-password",
      "-s", SERVICE,
      "-a", account,
      "-w", value,
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to save to macOS Keychain (${account}): ${msg}\n` +
        "Make sure your keychain is unlocked.",
    );
  }
}

function keychainGet(account: string): string | null {
  try {
    return execFileSync("security", [
      "find-generic-password",
      "-s", SERVICE,
      "-a", account,
      "-w",
    ], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (err: unknown) {
    // Exit code 44 = item not found in keychain (expected)
    if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 44) {
      return null;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to read from macOS Keychain (${account}): ${msg}\n` +
        "Make sure your keychain is unlocked and the 'security' command is available.",
    );
  }
}

function keychainDelete(account: string): void {
  try {
    execFileSync("security", [
      "delete-generic-password",
      "-s", SERVICE,
      "-a", account,
    ], { stdio: "ignore" });
  } catch {
    // Key didn't exist — fine
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Invalid JWT");
  return JSON.parse(Buffer.from(payload, "base64url").toString());
}

function isTokenExpired(token: string): boolean {
  try {
    const payload = decodeJwtPayload(token);
    const exp = payload.exp as number | undefined;
    if (typeof exp !== "number") return true;
    return Date.now() / 1000 > exp;
  } catch {
    return true;
  }
}

export function saveTokens(
  developerToken: string,
  musicUserToken: string,
): void {
  keychainSet(DEV_TOKEN_ACCOUNT, developerToken);
  keychainSet(USER_TOKEN_ACCOUNT, musicUserToken);
}

export function clearTokens(): void {
  keychainDelete(DEV_TOKEN_ACCOUNT);
  keychainDelete(USER_TOKEN_ACCOUNT);
}

export interface StoredTokens {
  developerToken: string;
  musicUserToken: string;
}

export async function getTokens(): Promise<StoredTokens | null> {
  const musicUserToken = keychainGet(USER_TOKEN_ACCOUNT);
  if (!musicUserToken) return null;

  let developerToken = keychainGet(DEV_TOKEN_ACCOUNT);

  if (!developerToken || isTokenExpired(developerToken)) {
    try {
      developerToken = await scrapeDevToken();
      keychainSet(DEV_TOKEN_ACCOUNT, developerToken);
    } catch (err) {
      if (!developerToken) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Developer token is missing and could not be refreshed: ${msg}\n` +
            "Run: songwise auth login",
        );
      }
      console.error(
        `Warning: Developer token expired and could not be refreshed. Using expired token as fallback.`,
      );
    }
  }

  return { developerToken, musicUserToken };
}

export function getTokenStatus(): {
  hasDeveloperToken: boolean;
  hasUserToken: boolean;
  devTokenExpired: boolean;
  devTokenExpiry: Date | null;
} {
  const devToken = keychainGet(DEV_TOKEN_ACCOUNT);
  const userToken = keychainGet(USER_TOKEN_ACCOUNT);

  let devTokenExpired = false;
  let devTokenExpiry: Date | null = null;

  if (devToken) {
    try {
      const payload = decodeJwtPayload(devToken);
      const exp = payload.exp as number;
      if (typeof exp === "number") {
        devTokenExpiry = new Date(exp * 1000);
        devTokenExpired = Date.now() / 1000 > exp;
      } else {
        devTokenExpired = true;
      }
    } catch {
      devTokenExpired = true;
    }
  }

  return {
    hasDeveloperToken: !!devToken,
    hasUserToken: !!userToken,
    devTokenExpired,
    devTokenExpiry,
  };
}
