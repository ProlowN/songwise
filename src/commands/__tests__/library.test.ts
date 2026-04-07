import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerLibraryCommands } from "../library.js";
import { getTokens } from "../../auth/token-manager.js";
import { AppleMusicClient } from "../../api/client.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../auth/token-manager.js", () => ({
  getTokens: vi.fn(),
}));

// Shared mock method references — set in beforeEach, used in mock factory
let mockGet: ReturnType<typeof vi.fn>;

vi.mock("../../api/client.js", () => ({
  AppleMusicClient: vi.fn(function (this: Record<string, unknown>) {
    this.get = mockGet;
    this.post = vi.fn();
    this.delete = vi.fn();
    this.getAll = vi.fn();
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSong(
  id: string,
  name: string,
  artistName: string,
  durationInMillis?: number,
) {
  return {
    id,
    type: "library-songs" as const,
    attributes: {
      name,
      artistName,
      albumName: "Test Album",
      durationInMillis: durationInMillis ?? 0,
      trackNumber: 1,
    },
  };
}

function createProgram(): Command {
  const program = new Command();
  program.exitOverride(); // throw instead of calling process.exit on commander errors
  registerLibraryCommands(program);
  return program;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("library commands", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGet = vi.fn();

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
  // library songs (listSongs)
  // -----------------------------------------------------------------------

  describe("library songs", () => {
    it("displays songs with id, name, artist, and formatted duration", async () => {
      mockGet.mockResolvedValue({
        data: [
          makeSong("i.001", "Bohemian Rhapsody", "Queen", 354000),
          makeSong("i.002", "Yesterday", "The Beatles", 125000),
        ],
        next: undefined,
      });

      const program = createProgram();
      await program.parseAsync(["node", "songwise", "library", "songs"]);

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Library songs (2)"));
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("i.001  Bohemian Rhapsody - Queen [5:54]"),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("i.002  Yesterday - The Beatles [2:05]"),
      );
    });

    it('prints "No songs in library." when the library is empty', async () => {
      mockGet.mockResolvedValue({ data: [], next: undefined });

      const program = createProgram();
      await program.parseAsync(["node", "songwise", "library", "songs"]);

      expect(logSpy).toHaveBeenCalledWith("No songs in library.");
    });

    it("respects --limit flag and shows only that many songs", async () => {
      mockGet.mockResolvedValue({
        data: [
          makeSong("i.001", "Song A", "Artist A", 180000),
          makeSong("i.002", "Song B", "Artist B", 200000),
          makeSong("i.003", "Song C", "Artist C", 210000),
        ],
        next: undefined,
      });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "library",
        "songs",
        "--limit",
        "2",
      ]);

      // Should display exactly 2 songs (header + 2 song lines)
      const songLines = logSpy.mock.calls.filter(
        ([msg]: [unknown]) => typeof msg === "string" && msg.startsWith("  i."),
      );
      expect(songLines).toHaveLength(2);
    });

    it("handles pagination across multiple pages", async () => {
      mockGet
        .mockResolvedValueOnce({
          data: [makeSong("i.001", "Song A", "Artist A")],
          next: "/v1/me/library/songs?offset=1",
        })
        .mockResolvedValueOnce({
          data: [makeSong("i.002", "Song B", "Artist B")],
          next: undefined,
        });

      const program = createProgram();
      await program.parseAsync(["node", "songwise", "library", "songs"]);

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Library songs (2)"));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("i.001"));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("i.002"));
    });

    it("passes params only on the first page request", async () => {
      mockGet
        .mockResolvedValueOnce({
          data: [makeSong("i.001", "Song A", "Artist A")],
          next: "/v1/me/library/songs?offset=100",
        })
        .mockResolvedValueOnce({
          data: [],
          next: undefined,
        });

      const program = createProgram();
      await program.parseAsync(["node", "songwise", "library", "songs"]);

      // First call should include params
      expect(mockGet).toHaveBeenNthCalledWith(
        1,
        "/v1/me/library/songs",
        { limit: "100" },
      );
      // Second call should not include params (because url !== initial)
      expect(mockGet).toHaveBeenNthCalledWith(
        2,
        "/v1/me/library/songs?offset=100",
        undefined,
      );
    });

    it("stops pagination when --limit is reached before all pages are fetched", async () => {
      mockGet
        .mockResolvedValueOnce({
          data: [
            makeSong("i.001", "Song A", "Artist A"),
            makeSong("i.002", "Song B", "Artist B"),
          ],
          next: "/v1/me/library/songs?offset=2",
        })
        .mockResolvedValueOnce({
          data: [makeSong("i.003", "Song C", "Artist C")],
          next: "/v1/me/library/songs?offset=3",
        });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "library",
        "songs",
        "--limit",
        "2",
      ]);

      // Should stop after first page since we already have 2 songs >= limit of 2
      expect(mockGet).toHaveBeenCalledTimes(1);
      const songLines = logSpy.mock.calls.filter(
        ([msg]: [unknown]) => typeof msg === "string" && msg.startsWith("  i."),
      );
      expect(songLines).toHaveLength(2);
    });

    it("rejects --limit with NaN value", async () => {
      const program = createProgram();

      await expect(
        program.parseAsync([
          "node",
          "songwise",
          "library",
          "songs",
          "--limit",
          "abc",
        ]),
      ).rejects.toThrow("process.exit(1)");

      expect(errorSpy).toHaveBeenCalledWith(
        "Invalid --limit value. Must be a positive integer.",
      );
    });

    it("rejects --limit with value of 0", async () => {
      const program = createProgram();

      await expect(
        program.parseAsync([
          "node",
          "songwise",
          "library",
          "songs",
          "--limit",
          "0",
        ]),
      ).rejects.toThrow("process.exit(1)");

      expect(errorSpy).toHaveBeenCalledWith(
        "Invalid --limit value. Must be a positive integer.",
      );
    });

    it("rejects --limit with negative value", async () => {
      const program = createProgram();

      await expect(
        program.parseAsync([
          "node",
          "songwise",
          "library",
          "songs",
          "--limit",
          "-5",
        ]),
      ).rejects.toThrow("process.exit(1)");

      expect(errorSpy).toHaveBeenCalledWith(
        "Invalid --limit value. Must be a positive integer.",
      );
    });

    it("exits with error when not authenticated", async () => {
      (getTokens as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const program = createProgram();

      await expect(
        program.parseAsync(["node", "songwise", "library", "songs"]),
      ).rejects.toThrow("process.exit(1)");

      expect(errorSpy).toHaveBeenCalledWith(
        "Not authenticated. Run: songwise auth login --manual",
      );
    });

    it("omits duration bracket when durationInMillis is 0", async () => {
      const song = makeSong("i.001", "No Duration", "Artist", 0);
      mockGet.mockResolvedValue({ data: [song], next: undefined });

      const program = createProgram();
      await program.parseAsync(["node", "songwise", "library", "songs"]);

      // durationInMillis is 0 which is falsy, so no duration bracket
      const songLine = logSpy.mock.calls.find(
        ([msg]: [unknown]) => typeof msg === "string" && msg.includes("i.001"),
      );
      expect(songLine).toBeDefined();
      expect(songLine![0]).not.toContain("[");
    });

    it("formats duration with zero-padded seconds", async () => {
      // 61 seconds = 1:01
      mockGet.mockResolvedValue({
        data: [makeSong("i.001", "Short Song", "Artist", 61000)],
        next: undefined,
      });

      const program = createProgram();
      await program.parseAsync(["node", "songwise", "library", "songs"]);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("[1:01]"),
      );
    });
  });

  // -----------------------------------------------------------------------
  // library search (searchLibrary)
  // -----------------------------------------------------------------------

  describe("library search", () => {
    it("displays results grouped by type", async () => {
      mockGet.mockResolvedValue({
        results: {
          "library-songs": {
            data: [
              makeSong("i.001", "Yesterday", "The Beatles"),
              makeSong("i.002", "Tomorrow", "Some Artist"),
            ],
          },
        },
      });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "library",
        "search",
        "yesterday",
      ]);

      expect(logSpy).toHaveBeenCalledWith("\nlibrary-songs:");
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("i.001  Yesterday - The Beatles"),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("i.002  Tomorrow - Some Artist"),
      );
    });

    it('prints "No results" when results are empty', async () => {
      mockGet.mockResolvedValue({ results: {} });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "library",
        "search",
        "nonexistent",
      ]);

      expect(logSpy).toHaveBeenCalledWith('No results for "nonexistent".');
    });

    it('prints "No results" when results key is absent', async () => {
      mockGet.mockResolvedValue({ results: undefined });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "library",
        "search",
        "missing",
      ]);

      expect(logSpy).toHaveBeenCalledWith('No results for "missing".');
    });

    it("passes default type and limit params to the API", async () => {
      mockGet.mockResolvedValue({ results: {} });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "library",
        "search",
        "test",
      ]);

      expect(mockGet).toHaveBeenCalledWith("/v1/me/library/search", {
        term: "test",
        types: "library-songs",
        limit: "10",
      });
    });

    it("passes custom --type and --limit params to the API", async () => {
      mockGet.mockResolvedValue({ results: {} });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "library",
        "search",
        "test",
        "--type",
        "library-albums",
        "--limit",
        "25",
      ]);

      expect(mockGet).toHaveBeenCalledWith("/v1/me/library/search", {
        term: "test",
        types: "library-albums",
        limit: "25",
      });
    });

    it("handles items with only name and no artistName", async () => {
      mockGet.mockResolvedValue({
        results: {
          "library-albums": {
            data: [
              {
                id: "a.001",
                type: "library-albums",
                attributes: { name: "Greatest Hits" },
              },
            ],
          },
        },
      });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "library",
        "search",
        "greatest",
        "--type",
        "library-albums",
      ]);

      expect(logSpy).toHaveBeenCalledWith("\nlibrary-albums:");
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("a.001  Greatest Hits"),
      );
    });

    it("displays multiple result types", async () => {
      mockGet.mockResolvedValue({
        results: {
          "library-songs": {
            data: [makeSong("i.001", "Song A", "Artist A")],
          },
          "library-albums": {
            data: [
              {
                id: "a.001",
                type: "library-albums",
                attributes: { name: "Album A" },
              },
            ],
          },
        },
      });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "library",
        "search",
        "test",
      ]);

      expect(logSpy).toHaveBeenCalledWith("\nlibrary-songs:");
      expect(logSpy).toHaveBeenCalledWith("\nlibrary-albums:");
    });

    it("exits with error when not authenticated", async () => {
      (getTokens as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const program = createProgram();

      await expect(
        program.parseAsync([
          "node",
          "songwise",
          "library",
          "search",
          "test",
        ]),
      ).rejects.toThrow("process.exit(1)");

      expect(errorSpy).toHaveBeenCalledWith(
        "Not authenticated. Run: songwise auth login --manual",
      );
    });
  });
});
