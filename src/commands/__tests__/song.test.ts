import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerSongCommands } from "../song.js";
import { getTokens } from "../../auth/token-manager.js";
import { AppleMusicClient } from "../../api/client.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../auth/token-manager.js", () => ({
  getTokens: vi.fn(),
}));

// Shared mock method reference — set in beforeEach, used in mock factory
let mockDelete: ReturnType<typeof vi.fn>;

vi.mock("../../api/client.js", () => ({
  AppleMusicClient: vi.fn(function (this: Record<string, unknown>) {
    this.get = vi.fn();
    this.post = vi.fn();
    this.delete = mockDelete;
    this.getAll = vi.fn();
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerSongCommands(program);
  return program;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("song commands", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockDelete = vi.fn();

    // Clear the constructor mock so each test gets a fresh call count
    (AppleMusicClient as unknown as ReturnType<typeof vi.fn>).mockClear();

    (getTokens as ReturnType<typeof vi.fn>).mockResolvedValue({
      developerToken: "dev-token",
      musicUserToken: "user-token",
    });

    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit(${code})`);
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // song remove (removeSong)
  // -----------------------------------------------------------------------

  describe("song remove", () => {
    it("calls delete with the correct API path", async () => {
      mockDelete.mockResolvedValue(true);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "song",
        "remove",
        "i.abc123",
      ]);

      expect(mockDelete).toHaveBeenCalledWith(
        "/v1/me/library/songs/i.abc123",
      );
    });

    it("shows success message after removal", async () => {
      mockDelete.mockResolvedValue(true);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "song",
        "remove",
        "i.xyz789",
      ]);

      expect(logSpy).toHaveBeenCalledWith(
        "Removed song i.xyz789 from library",
      );
    });

    it("constructs AppleMusicClient with the correct tokens", async () => {
      mockDelete.mockResolvedValue(true);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "song",
        "remove",
        "i.test",
      ]);

      expect(AppleMusicClient).toHaveBeenCalledWith("dev-token", "user-token");
    });

    it("exits with error when not authenticated", async () => {
      (getTokens as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const program = createProgram();

      await expect(
        program.parseAsync([
          "node",
          "songwise",
          "song",
          "remove",
          "i.abc123",
        ]),
      ).rejects.toThrow("process.exit(1)");

      expect(errorSpy).toHaveBeenCalledWith(
        "Not authenticated. Run: songwise auth login --manual",
      );
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("does not call delete when authentication fails", async () => {
      (getTokens as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const program = createProgram();

      await expect(
        program.parseAsync([
          "node",
          "songwise",
          "song",
          "remove",
          "i.abc123",
        ]),
      ).rejects.toThrow("process.exit(1)");

      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("propagates API errors from the delete call", async () => {
      mockDelete.mockRejectedValue(
        new Error("DELETE /v1/me/library/songs/i.bad failed: 404 Not Found"),
      );

      const program = createProgram();

      await expect(
        program.parseAsync([
          "node",
          "songwise",
          "song",
          "remove",
          "i.bad",
        ]),
      ).rejects.toThrow("DELETE /v1/me/library/songs/i.bad failed: 404 Not Found");
    });
  });
});
