import { Command } from "commander";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { startAuthServer, getAuthSnippet } from "../auth/auth-server.js";
import { scrapeDevToken } from "../auth/token-scraper.js";
import {
  saveTokens,
  clearTokens,
  getTokens,
  getTokenStatus,
} from "../auth/token-manager.js";
import { AppleMusicClient } from "../api/client.js";

async function validateTokens(
  developerToken: string,
  musicUserToken: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    const client = new AppleMusicClient(developerToken, musicUserToken);
    await client.get("/v1/me/library/songs", { limit: "1" });
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function loginAuto(): Promise<void> {
  console.log("Authenticating with Apple Music...\n");

  // Scrape developer token in background
  let scrapedDevToken: string | null = null;
  const scrapePromise = scrapeDevToken()
    .then((t) => {
      scrapedDevToken = t;
    })
    .catch((err) => {
      console.error(
        `\nWarning: Could not scrape developer token (${err instanceof Error ? err.message : String(err)}). Using browser-provided token.`,
      );
    });

  // Start local auth server
  let authPromise: Promise<{ developerToken: string; musicUserToken: string }>;
  let close: () => void;
  let nonce: string;
  try {
    const server = startAuthServer();
    authPromise = server.promise;
    close = server.close;
    nonce = server.nonce;
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  // Open Apple Music in browser
  try {
    execFileSync("open", ["https://music.apple.com"]);
  } catch {
    console.log("Could not open browser. Open https://music.apple.com manually.");
  }

  console.log("  1. music.apple.com is opening in your browser");
  console.log("  2. Make sure you are signed in");
  console.log("  3. Open the browser console (Cmd+Option+J in Chrome, Cmd+Option+C in Safari)");
  console.log("  4. Paste this line and press Enter:\n");
  console.log(`  ${getAuthSnippet(nonce)}\n`);
  console.log("Waiting for tokens...");

  try {
    const tokens = await authPromise;
    await scrapePromise;

    // Prefer scraped dev token (more reliable), fall back to browser's
    const developerToken = scrapedDevToken || tokens.developerToken;
    const musicUserToken = tokens.musicUserToken;

    process.stdout.write("Validating tokens... ");
    const result = await validateTokens(developerToken, musicUserToken);

    if (!result.valid) {
      console.log("FAILED");
      console.error(`\nToken validation failed: ${result.error}`);
      console.error("Check your internet connection and ensure you have an active Apple Music subscription.");
      process.exit(1);
    }

    console.log("OK");
    saveTokens(developerToken, musicUserToken);
    console.log("\nAuthenticated successfully. Tokens stored in Keychain.");
  } catch (err) {
    close();
    console.error(`\n${(err as Error).message}`);
    process.exit(1);
  }
}

async function loginManual(): Promise<void> {
  console.log("Manual authentication\n");

  process.stdout.write("Fetching developer token... ");
  let developerToken: string;
  try {
    developerToken = await scrapeDevToken();
    console.log("OK");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log("FAILED");
    console.log(
      `\nCould not scrape developer token automatically: ${msg}`,
    );
    console.log("Go to music.apple.com, open console, and run:");
    console.log("  MusicKit.getInstance().developerToken");
    developerToken = (await promptInput("\nPaste developer token: ")).trim();
    if (!developerToken) {
      console.error("No token provided.");
      process.exit(1);
    }
  }

  console.log("\nTo get your Music User Token:");
  console.log("  1. Go to music.apple.com and sign in");
  console.log("  2. Open browser console (Cmd+Option+J)");
  console.log("  3. Run: MusicKit.getInstance().musicUserToken\n");

  const musicUserToken = await promptInput("Paste Music User Token: ");

  if (!musicUserToken.trim()) {
    console.error("No token provided.");
    process.exit(1);
  }

  process.stdout.write("Validating tokens... ");
  const result = await validateTokens(developerToken, musicUserToken.trim());

  if (!result.valid) {
    console.log("FAILED");
    console.error(`\nToken validation failed: ${result.error}`);
    console.error("Check your internet connection, tokens, and Apple Music subscription.");
    process.exit(1);
  }

  console.log("OK");
  saveTokens(developerToken, musicUserToken.trim());
  console.log("\nAuthenticated successfully. Tokens stored in Keychain.");
}

function promptInput(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.on("close", () => {
      reject(new Error("Input cancelled (stdin closed)."));
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function status(): Promise<void> {
  const tokenStatus = getTokenStatus();

  if (!tokenStatus.hasUserToken) {
    console.log("Status: Not authenticated");
    console.log("\nRun: songwise auth login");
    return;
  }

  console.log("Status: Authenticated\n");
  console.log(
    `Developer token: ${tokenStatus.hasDeveloperToken ? "present" : "missing"}`,
  );
  if (tokenStatus.devTokenExpiry) {
    const label = tokenStatus.devTokenExpired ? "EXPIRED" : "valid";
    console.log(
      `  Expires: ${tokenStatus.devTokenExpiry.toISOString()} (${label})`,
    );
  }
  console.log(`Music User Token: present`);

  // Live validation
  process.stdout.write("\nValidating with Apple Music... ");
  const tokens = await getTokens();
  if (tokens) {
    const result = await validateTokens(
      tokens.developerToken,
      tokens.musicUserToken,
    );
    console.log(result.valid ? "OK" : `FAILED (${result.error}) — run: songwise auth login`);
  } else {
    console.log("FAILED — could not load tokens");
  }
}

function logout(): void {
  clearTokens();
  console.log("Tokens cleared from Keychain.");
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Manage authentication");

  auth
    .command("login")
    .description("Authenticate with Apple Music")
    .option("--manual", "Manually paste tokens instead of using browser callback")
    .action(async (opts) => {
      if (opts.manual) {
        await loginManual();
      } else {
        await loginAuto();
      }
    });

  auth
    .command("status")
    .description("Check authentication status")
    .action(status);

  auth
    .command("logout")
    .description("Clear stored tokens")
    .action(logout);
}
