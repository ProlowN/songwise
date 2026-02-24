import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerPlaylistCommands } from "../playlist.js";
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
let mockPost: ReturnType<typeof vi.fn>;
let mockDelete: ReturnType<typeof vi.fn>;
let mockGetAll: ReturnType<typeof vi.fn>;

vi.mock("../../api/client.js", () => ({
  AppleMusicClient: vi.fn(function (this: Record<string, unknown>) {
    this.get = mockGet;
    this.post = mockPost;
    this.delete = mockDelete;
    this.getAll = mockGetAll;
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlaylist(
  id: string,
  name: string,
  description?: string,
) {
  return {
    id,
    type: "library-playlists" as const,
    attributes: {
      name,
      description: description ? { standard: description } : undefined,
      canEdit: true,
    },
  };
}

function makeTrack(id: string, name: string, artistName: string) {
  return {
    id,
    type: "library-songs" as const,
    attributes: {
      name,
      artistName,
      albumName: "Test Album",
      durationInMillis: 200000,
      trackNumber: 1,
    },
  };
}

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerPlaylistCommands(program);
  return program;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("playlist commands", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGet = vi.fn();
    mockPost = vi.fn();
    mockDelete = vi.fn();
    mockGetAll = vi.fn();

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
  // playlist list (listPlaylists)
  // -----------------------------------------------------------------------

  describe("playlist list", () => {
    it("displays playlists with id, name, and description", async () => {
      mockGetAll.mockResolvedValue([
        makePlaylist("p.001", "Workout Mix", "Songs for the gym"),
        makePlaylist("p.002", "Chill Vibes", "Relaxing tunes"),
      ]);

      const program = createProgram();
      await program.parseAsync(["node", "songwise", "playlist", "list"]);

      expect(logSpy).toHaveBeenCalledWith("Playlists (2):\n");
      expect(logSpy).toHaveBeenCalledWith(
        "  p.001  Workout Mix \u2014 Songs for the gym",
      );
      expect(logSpy).toHaveBeenCalledWith(
        "  p.002  Chill Vibes \u2014 Relaxing tunes",
      );
    });

    it("displays playlists without description suffix when description is absent", async () => {
      mockGetAll.mockResolvedValue([
        makePlaylist("p.001", "Untitled Playlist"),
      ]);

      const program = createProgram();
      await program.parseAsync(["node", "songwise", "playlist", "list"]);

      expect(logSpy).toHaveBeenCalledWith("  p.001  Untitled Playlist");
    });

    it('prints "No playlists in library." when empty', async () => {
      mockGetAll.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(["node", "songwise", "playlist", "list"]);

      expect(logSpy).toHaveBeenCalledWith("No playlists in library.");
    });

    it("calls getAll with the correct path and params", async () => {
      mockGetAll.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(["node", "songwise", "playlist", "list"]);

      expect(mockGetAll).toHaveBeenCalledWith("/v1/me/library/playlists", {
        limit: "100",
      });
    });

    it("exits with error when not authenticated", async () => {
      (getTokens as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const program = createProgram();

      await expect(
        program.parseAsync(["node", "songwise", "playlist", "list"]),
      ).rejects.toThrow("process.exit(1)");

      expect(errorSpy).toHaveBeenCalledWith(
        "Not authenticated. Run: songwise auth login",
      );
    });
  });

  // -----------------------------------------------------------------------
  // playlist create (createPlaylist)
  // -----------------------------------------------------------------------

  describe("playlist create", () => {
    it("shows created message with id when API returns one", async () => {
      mockPost.mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          data: [makePlaylist("p.new123", "My New Playlist")],
        }),
      });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "playlist",
        "create",
        "My New Playlist",
      ]);

      expect(logSpy).toHaveBeenCalledWith(
        'Created playlist "My New Playlist" (p.new123)',
      );
    });

    it("shows created message without id when API returns no data", async () => {
      mockPost.mockResolvedValue({
        json: vi.fn().mockResolvedValue({}),
      });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "playlist",
        "create",
        "Unnamed",
      ]);

      expect(logSpy).toHaveBeenCalledWith('Created playlist "Unnamed"');
    });

    it("shows created message without id when data array is empty", async () => {
      mockPost.mockResolvedValue({
        json: vi.fn().mockResolvedValue({ data: [] }),
      });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "playlist",
        "create",
        "Empty Response",
      ]);

      expect(logSpy).toHaveBeenCalledWith('Created playlist "Empty Response"');
    });

    it("sends the correct body with empty description by default", async () => {
      mockPost.mockResolvedValue({
        json: vi.fn().mockResolvedValue({}),
      });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "playlist",
        "create",
        "Test Playlist",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/v1/me/library/playlists", {
        attributes: { name: "Test Playlist", description: "" },
        relationships: { tracks: { data: [] } },
      });
    });

    it("passes --description option to the API body", async () => {
      mockPost.mockResolvedValue({
        json: vi.fn().mockResolvedValue({}),
      });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "playlist",
        "create",
        "Workout",
        "--description",
        "My gym playlist",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/v1/me/library/playlists", {
        attributes: { name: "Workout", description: "My gym playlist" },
        relationships: { tracks: { data: [] } },
      });
    });

    it("exits with error when not authenticated", async () => {
      (getTokens as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const program = createProgram();

      await expect(
        program.parseAsync([
          "node",
          "songwise",
          "playlist",
          "create",
          "Test",
        ]),
      ).rejects.toThrow("process.exit(1)");

      expect(errorSpy).toHaveBeenCalledWith(
        "Not authenticated. Run: songwise auth login",
      );
    });
  });

  // -----------------------------------------------------------------------
  // playlist delete (deletePlaylist)
  // -----------------------------------------------------------------------

  describe("playlist delete", () => {
    it("shows deleted message with the playlist id", async () => {
      mockDelete.mockResolvedValue(true);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "playlist",
        "delete",
        "p.abc123",
      ]);

      expect(logSpy).toHaveBeenCalledWith("Deleted playlist p.abc123");
    });

    it("calls delete with the correct path", async () => {
      mockDelete.mockResolvedValue(true);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "playlist",
        "delete",
        "p.xyz789",
      ]);

      expect(mockDelete).toHaveBeenCalledWith(
        "/v1/me/library/playlists/p.xyz789",
      );
    });

    it("exits with error when not authenticated", async () => {
      (getTokens as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const program = createProgram();

      await expect(
        program.parseAsync([
          "node",
          "songwise",
          "playlist",
          "delete",
          "p.abc",
        ]),
      ).rejects.toThrow("process.exit(1)");

      expect(errorSpy).toHaveBeenCalledWith(
        "Not authenticated. Run: songwise auth login",
      );
    });
  });

  // -----------------------------------------------------------------------
  // playlist tracks (listTracks)
  // -----------------------------------------------------------------------

  describe("playlist tracks", () => {
    it("displays numbered tracks with name, artist, and id", async () => {
      mockGetAll.mockResolvedValue([
        makeTrack("i.001", "Bohemian Rhapsody", "Queen"),
        makeTrack("i.002", "Yesterday", "The Beatles"),
        makeTrack("i.003", "Imagine", "John Lennon"),
      ]);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "playlist",
        "tracks",
        "p.abc123",
      ]);

      expect(logSpy).toHaveBeenCalledWith("Tracks (3):\n");
      expect(logSpy).toHaveBeenCalledWith(
        "    1. Bohemian Rhapsody - Queen  (i.001)",
      );
      expect(logSpy).toHaveBeenCalledWith(
        "    2. Yesterday - The Beatles  (i.002)",
      );
      expect(logSpy).toHaveBeenCalledWith(
        "    3. Imagine - John Lennon  (i.003)",
      );
    });

    it('prints "No tracks in this playlist." when empty', async () => {
      mockGetAll.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "playlist",
        "tracks",
        "p.empty",
      ]);

      expect(logSpy).toHaveBeenCalledWith("No tracks in this playlist.");
    });

    it("calls getAll with correct path and params", async () => {
      mockGetAll.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "playlist",
        "tracks",
        "p.test123",
      ]);

      expect(mockGetAll).toHaveBeenCalledWith(
        "/v1/me/library/playlists/p.test123/tracks",
        { limit: "100" },
      );
    });

    it("pads track numbers to 3 characters", async () => {
      const tracks = Array.from({ length: 12 }, (_, i) =>
        makeTrack(`i.${String(i + 1).padStart(3, "0")}`, `Song ${i + 1}`, "Artist"),
      );
      mockGetAll.mockResolvedValue(tracks);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "playlist",
        "tracks",
        "p.big",
      ]);

      // Single digit should be padded: "  1."
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\s+1\. Song 1/),
      );
      // Double digit should also be padded: " 12."
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\s+12\. Song 12/),
      );
    });

    it("exits with error when not authenticated", async () => {
      (getTokens as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const program = createProgram();

      await expect(
        program.parseAsync([
          "node",
          "songwise",
          "playlist",
          "tracks",
          "p.abc",
        ]),
      ).rejects.toThrow("process.exit(1)");

      expect(errorSpy).toHaveBeenCalledWith(
        "Not authenticated. Run: songwise auth login",
      );
    });
  });

  // -----------------------------------------------------------------------
  // playlist add (addTrack)
  // -----------------------------------------------------------------------

  describe("playlist add", () => {
    it("adds a track with default type library-songs", async () => {
      mockPost.mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "playlist",
        "add",
        "p.abc123",
        "i.song456",
      ]);

      expect(mockPost).toHaveBeenCalledWith(
        "/v1/me/library/playlists/p.abc123/tracks",
        { data: [{ type: "library-songs", id: "i.song456" }] },
      );
      expect(logSpy).toHaveBeenCalledWith(
        "Added i.song456 to playlist p.abc123",
      );
    });

    it("adds a track with custom type songs", async () => {
      mockPost.mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "playlist",
        "add",
        "p.abc123",
        "12345",
        "--type",
        "songs",
      ]);

      expect(mockPost).toHaveBeenCalledWith(
        "/v1/me/library/playlists/p.abc123/tracks",
        { data: [{ type: "songs", id: "12345" }] },
      );
      expect(logSpy).toHaveBeenCalledWith(
        "Added 12345 to playlist p.abc123",
      );
    });

    it("exits with error when not authenticated", async () => {
      (getTokens as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const program = createProgram();

      await expect(
        program.parseAsync([
          "node",
          "songwise",
          "playlist",
          "add",
          "p.abc",
          "i.song",
        ]),
      ).rejects.toThrow("process.exit(1)");

      expect(errorSpy).toHaveBeenCalledWith(
        "Not authenticated. Run: songwise auth login",
      );
    });
  });

  // -----------------------------------------------------------------------
  // playlist remove (removeTrack)
  // -----------------------------------------------------------------------

  describe("playlist remove", () => {
    it("removes a track with correct params and default type", async () => {
      mockDelete.mockResolvedValue(true);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "playlist",
        "remove",
        "p.abc123",
        "i.song456",
      ]);

      expect(mockDelete).toHaveBeenCalledWith(
        "/v1/me/library/playlists/p.abc123/tracks",
        {
          "ids[library-songs]": "i.song456",
          mode: "all",
        },
      );
      expect(logSpy).toHaveBeenCalledWith(
        "Removed i.song456 from playlist p.abc123",
      );
    });

    it("removes a track with custom type option", async () => {
      mockDelete.mockResolvedValue(true);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "songwise",
        "playlist",
        "remove",
        "p.abc123",
        "12345",
        "--type",
        "songs",
      ]);

      expect(mockDelete).toHaveBeenCalledWith(
        "/v1/me/library/playlists/p.abc123/tracks",
        {
          "ids[songs]": "12345",
          mode: "all",
        },
      );
      expect(logSpy).toHaveBeenCalledWith(
        "Removed 12345 from playlist p.abc123",
      );
    });

    it("exits with error when not authenticated", async () => {
      (getTokens as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const program = createProgram();

      await expect(
        program.parseAsync([
          "node",
          "songwise",
          "playlist",
          "remove",
          "p.abc",
          "i.song",
        ]),
      ).rejects.toThrow("process.exit(1)");

      expect(errorSpy).toHaveBeenCalledWith(
        "Not authenticated. Run: songwise auth login",
      );
    });
  });
});
