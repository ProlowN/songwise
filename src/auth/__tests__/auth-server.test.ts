import { describe, it, expect, afterEach } from "vitest";
import { startAuthServer, getAuthSnippet } from "../auth-server.js";

const BASE_URL = "http://127.0.0.1:9274";

/**
 * Wait for the server to be ready by polling the port.
 * The auth server listens on 127.0.0.1:9274 and we need to give it
 * a moment to bind before sending requests.
 */
async function waitForServer(
  url = BASE_URL,
  retries = 20,
  delay = 50,
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await fetch(url, { method: "OPTIONS" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Server did not start in time");
}

describe("auth-server", () => {
  let closeFn: (() => void) | undefined;

  afterEach(() => {
    try {
      closeFn?.();
    } catch {
      // server already closed — ignore
    }
    closeFn = undefined;
  });

  // ---------- getAuthSnippet ----------

  describe("getAuthSnippet", () => {
    it("returns a string containing localhost:9274", () => {
      const snippet = getAuthSnippet("test-nonce");
      expect(snippet).toContain("localhost:9274");
    });

    it("returns a string containing a fetch call to /callback", () => {
      const snippet = getAuthSnippet("test-nonce");
      expect(snippet).toContain("fetch(");
      expect(snippet).toContain("/callback");
    });

    it("references MusicKit.getInstance() for developer and user tokens", () => {
      const snippet = getAuthSnippet("test-nonce");
      expect(snippet).toContain("MusicKit.getInstance().developerToken");
      expect(snippet).toContain("MusicKit.getInstance().musicUserToken");
    });

    it("uses POST method with JSON content type", () => {
      const snippet = getAuthSnippet("test-nonce");
      expect(snippet).toContain("method:'POST'");
      expect(snippet).toContain("'Content-Type':'application/json'");
    });

    it("includes the nonce in the snippet", () => {
      const snippet = getAuthSnippet("abc123");
      expect(snippet).toContain("nonce:'abc123'");
    });
  });

  // ---------- CORS (OPTIONS preflight) ----------

  describe("CORS preflight (OPTIONS)", () => {
    it("returns 204 with correct CORS headers", async () => {
      const { close } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const res = await fetch(`${BASE_URL}/callback`, { method: "OPTIONS" });

      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(
        "https://music.apple.com",
      );
      expect(res.headers.get("access-control-allow-methods")).toBe(
        "POST, OPTIONS",
      );
      expect(res.headers.get("access-control-allow-headers")).toBe(
        "Content-Type",
      );
    });

    it("returns 204 for OPTIONS on any path", async () => {
      const { close } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const res = await fetch(`${BASE_URL}/anything`, { method: "OPTIONS" });
      expect(res.status).toBe(204);
    });
  });

  // ---------- Valid POST /callback ----------

  describe("POST /callback with valid tokens and nonce", () => {
    it("returns 200 and resolves the promise with tokens", async () => {
      const { promise, close, nonce } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const res = await fetch(`${BASE_URL}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dt: "dev-token-abc", ut: "user-token-xyz", nonce }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true });

      const tokens = await promise;
      expect(tokens).toEqual({
        developerToken: "dev-token-abc",
        musicUserToken: "user-token-xyz",
      });
    });

    it("closes the server after successful token receipt", async () => {
      const { promise, close, nonce } = startAuthServer();
      closeFn = close;
      await waitForServer();

      await fetch(`${BASE_URL}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dt: "d", ut: "u", nonce }),
      });

      await promise;

      // Server should be closed now; a new request should fail
      await expect(
        fetch(`${BASE_URL}/callback`, { method: "OPTIONS" }),
      ).rejects.toThrow();
    });
  });

  // ---------- Nonce validation ----------

  describe("POST /callback nonce validation", () => {
    it("returns 403 when nonce is missing", async () => {
      const { close } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const res = await fetch(`${BASE_URL}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dt: "dev-token", ut: "user-token" }),
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toEqual({ error: "Invalid nonce" });
    });

    it("returns 403 when nonce is wrong", async () => {
      const { close } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const res = await fetch(`${BASE_URL}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dt: "dev-token", ut: "user-token", nonce: "wrong-nonce" }),
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toEqual({ error: "Invalid nonce" });
    });

    it("returns a unique nonce each time startAuthServer is called", async () => {
      const server1 = startAuthServer();
      server1.close();
      // Small delay to release the port
      await new Promise((r) => setTimeout(r, 100));
      const server2 = startAuthServer();
      server2.close();

      expect(server1.nonce).not.toBe(server2.nonce);
      expect(server1.nonce).toHaveLength(32); // 16 bytes = 32 hex chars
    });
  });

  // ---------- Missing tokens ----------

  describe("POST /callback with missing tokens", () => {
    it("returns 400 when dt is missing", async () => {
      const { close, nonce } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const res = await fetch(`${BASE_URL}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ut: "user-token", nonce }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: "Missing dt or ut" });
    });

    it("returns 400 when ut is missing", async () => {
      const { close, nonce } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const res = await fetch(`${BASE_URL}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dt: "dev-token", nonce }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: "Missing dt or ut" });
    });

    it("returns 400 when both dt and ut are missing", async () => {
      const { close, nonce } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const res = await fetch(`${BASE_URL}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nonce }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: "Missing dt or ut" });
    });

    it("returns 400 when dt is empty string", async () => {
      const { close, nonce } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const res = await fetch(`${BASE_URL}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dt: "", ut: "user-token", nonce }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: "Missing dt or ut" });
    });
  });

  // ---------- Invalid JSON ----------

  describe("POST /callback with invalid JSON", () => {
    it("returns 400 with 'Invalid JSON' error", async () => {
      const { close } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const res = await fetch(`${BASE_URL}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-valid-json{{{",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: "Invalid JSON" });
    });
  });

  // ---------- Body size limit ----------

  describe("POST /callback body size limit", () => {
    it("returns 413 when body exceeds 64KB", async () => {
      const { close } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const oversizedBody = "x".repeat(64 * 1024 + 1);

      const res = await fetch(`${BASE_URL}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: oversizedBody,
      });

      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json).toEqual({ error: "Request body too large" });
    });
  });

  // ---------- 404 for unknown routes ----------

  describe("unknown routes return 404", () => {
    it("returns 404 for GET /", async () => {
      const { close } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const res = await fetch(`${BASE_URL}/`);
      expect(res.status).toBe(404);
    });

    it("returns 404 for POST /other", async () => {
      const { close } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const res = await fetch(`${BASE_URL}/other`, { method: "POST" });
      expect(res.status).toBe(404);
    });

    it("returns 404 for GET /callback", async () => {
      const { close } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const res = await fetch(`${BASE_URL}/callback`);
      expect(res.status).toBe(404);
    });
  });

  // ---------- CORS headers on all responses ----------

  describe("CORS headers present on all response types", () => {
    it("includes CORS headers on 200 responses", async () => {
      const { promise, close, nonce } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const res = await fetch(`${BASE_URL}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dt: "d", ut: "u", nonce }),
      });

      expect(res.headers.get("access-control-allow-origin")).toBe(
        "https://music.apple.com",
      );
      await promise;
    });

    it("includes CORS headers on 400 responses", async () => {
      const { close } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const res = await fetch(`${BASE_URL}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      expect(res.headers.get("access-control-allow-origin")).toBe(
        "https://music.apple.com",
      );
    });

    it("includes CORS headers on 404 responses", async () => {
      const { close } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const res = await fetch(`${BASE_URL}/unknown`);

      expect(res.status).toBe(404);
      expect(res.headers.get("access-control-allow-origin")).toBe(
        "https://music.apple.com",
      );
    });

    it("includes CORS headers on 413 responses", async () => {
      const { close } = startAuthServer();
      closeFn = close;
      await waitForServer();

      const oversizedBody = "x".repeat(64 * 1024 + 1);
      const res = await fetch(`${BASE_URL}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: oversizedBody,
      });

      expect(res.status).toBe(413);
      expect(res.headers.get("access-control-allow-origin")).toBe(
        "https://music.apple.com",
      );
    });
  });
});
