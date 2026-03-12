import { Command } from "commander";
import { getTokens } from "../auth/token-manager.js";
import { AppleMusicClient } from "../api/client.js";
import type { LibraryPlaylist, LibrarySong } from "../api/types.js";

const SAFE_ID = /^[a-zA-Z0-9._-]+$/;

function validateId(id: string, label: string): void {
  if (!SAFE_ID.test(id)) {
    console.error(`Invalid ${label}: "${id}". IDs must contain only letters, numbers, dots, hyphens, and underscores.`);
    process.exit(1);
  }
}

async function requireClient(): Promise<AppleMusicClient> {
  const tokens = await getTokens();
  if (!tokens) {
    console.error("Not authenticated. Run: songwise auth login");
    process.exit(1);
  }
  return new AppleMusicClient(tokens.developerToken, tokens.musicUserToken);
}

async function listPlaylists(opts: { json?: boolean }): Promise<void> {
  const client = await requireClient();
  const playlists = await client.getAll<LibraryPlaylist>(
    "/v1/me/library/playlists",
    { limit: "100" },
  );

  if (opts.json) {
    console.log(JSON.stringify({
      total: playlists.length,
      playlists: playlists.map((pl) => ({
        id: pl.id,
        name: pl.attributes.name,
        description: pl.attributes.description?.standard ?? null,
      })),
    }));
    return;
  }

  if (playlists.length === 0) {
    console.log("No playlists in library.");
    return;
  }

  console.log(`Playlists (${playlists.length}):\n`);
  for (const pl of playlists) {
    const desc = pl.attributes.description?.standard;
    const suffix = desc ? ` — ${desc}` : "";
    console.log(`  ${pl.id}  ${pl.attributes.name}${suffix}`);
  }
}

async function createPlaylist(
  name: string,
  opts: { description?: string; json?: boolean },
): Promise<void> {
  const client = await requireClient();
  const body = {
    attributes: {
      name,
      description: opts.description || "",
    },
    relationships: {
      tracks: { data: [] },
    },
  };

  const res = await client.post("/v1/me/library/playlists", body);
  let pl: LibraryPlaylist | undefined;
  try {
    const json = (await res.json()) as { data?: LibraryPlaylist[] };
    pl = json.data?.[0];
  } catch {
    // POST succeeded but response body was not parseable — not a failure
  }

  if (opts.json) {
    console.log(JSON.stringify({
      ok: true,
      id: pl?.id ?? null,
      name,
    }));
    return;
  }

  if (pl) {
    console.log(`Created playlist "${name}" (${pl.id})`);
  } else {
    console.log(`Created playlist "${name}"`);
  }
}

async function deletePlaylist(id: string, opts: { json?: boolean }): Promise<void> {
  validateId(id, "playlist ID");
  const client = await requireClient();
  await client.delete(`/v1/me/library/playlists/${id}`);
  if (opts.json) {
    console.log(JSON.stringify({ ok: true, id }));
  } else {
    console.log(`Deleted playlist ${id}`);
  }
}

async function listTracks(id: string, opts: { json?: boolean }): Promise<void> {
  validateId(id, "playlist ID");
  const client = await requireClient();
  const tracks = await client.getAll<LibrarySong>(
    `/v1/me/library/playlists/${id}/tracks`,
    { limit: "100" },
  );

  if (opts.json) {
    console.log(JSON.stringify({
      playlistId: id,
      total: tracks.length,
      tracks: tracks.map((t, i) => ({
        position: i + 1,
        id: t.id,
        name: t.attributes.name,
        artistName: t.attributes.artistName,
        albumName: t.attributes.albumName,
        durationInMillis: t.attributes.durationInMillis,
      })),
    }));
    return;
  }

  if (tracks.length === 0) {
    console.log("No tracks in this playlist.");
    return;
  }

  console.log(`Tracks (${tracks.length}):\n`);
  for (let i = 0; i < tracks.length; i++) {
    const attr = tracks[i].attributes;
    console.log(
      `  ${(i + 1).toString().padStart(3, " ")}. ${attr.name} - ${attr.artistName}  (${tracks[i].id})`,
    );
  }
}

async function addTrack(
  playlistId: string,
  songId: string,
  opts: { type?: string; json?: boolean },
): Promise<void> {
  validateId(playlistId, "playlist ID");
  validateId(songId, "song ID");
  const client = await requireClient();
  const trackType = opts.type || "library-songs";

  await client.post(`/v1/me/library/playlists/${playlistId}/tracks`, {
    data: [{ type: trackType, id: songId }],
  });

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, playlistId, songId }));
  } else {
    console.log(`Added ${songId} to playlist ${playlistId}`);
  }
}

async function removeTrack(
  playlistId: string,
  songId: string,
  opts: { type?: string; json?: boolean },
): Promise<void> {
  validateId(playlistId, "playlist ID");
  validateId(songId, "song ID");
  const client = await requireClient();
  const trackType = opts.type || "library-songs";
  await client.delete(`/v1/me/library/playlists/${playlistId}/tracks`, {
    [`ids[${trackType}]`]: songId,
    mode: "all",
  });

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, playlistId, songId }));
  } else {
    console.log(`Removed ${songId} from playlist ${playlistId}`);
  }
}

export function registerPlaylistCommands(program: Command): void {
  const playlist = program
    .command("playlist")
    .description("Manage playlists");

  playlist
    .command("list")
    .description("List all playlists")
    .option("--json", "Output as JSON")
    .action(listPlaylists);

  playlist
    .command("create <name>")
    .description("Create a new playlist")
    .option("-d, --description <text>", "Playlist description")
    .option("--json", "Output as JSON")
    .action(createPlaylist);

  playlist
    .command("delete <id>")
    .description("Delete a playlist")
    .option("--json", "Output as JSON")
    .action(deletePlaylist);

  playlist
    .command("tracks <id>")
    .description("List tracks in a playlist")
    .option("--json", "Output as JSON")
    .action(listTracks);

  playlist
    .command("add <playlist-id> <song-id>")
    .description("Add a track to a playlist")
    .option(
      "-t, --type <type>",
      "Track type (library-songs or songs)",
      "library-songs",
    )
    .option("--json", "Output as JSON")
    .action(addTrack);

  playlist
    .command("remove <playlist-id> <song-id>")
    .description("Remove a track from a playlist")
    .option(
      "-t, --type <type>",
      "Track type (library-songs or songs)",
      "library-songs",
    )
    .option("--json", "Output as JSON")
    .action(removeTrack);
}
