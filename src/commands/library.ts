import { Command } from "commander";
import { getTokens } from "../auth/token-manager.js";
import { AppleMusicClient } from "../api/client.js";
import type { LibrarySong } from "../api/types.js";

async function requireClient(): Promise<AppleMusicClient> {
  const tokens = await getTokens();
  if (!tokens) {
    console.error("Not authenticated. Run: songwise auth login");
    process.exit(1);
  }
  return new AppleMusicClient(tokens.developerToken, tokens.musicUserToken);
}

function formatDuration(ms: number): string {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

async function listSongs(opts: { limit?: string; json?: boolean }): Promise<void> {
  const client = await requireClient();
  const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;
  if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
    console.error("Invalid --limit value. Must be a positive integer.");
    process.exit(1);
  }

  const MAX_PAGES = 500;
  const params: Record<string, string> = { limit: "100" };
  const songs: LibrarySong[] = [];
  let url = "/v1/me/library/songs";
  let pages = 0;

  const initial = "/v1/me/library/songs";
  while (url) {
    if (++pages > MAX_PAGES) {
      console.error(`Warning: Stopped after ${MAX_PAGES} pages to prevent infinite loop.`);
      break;
    }
    const res = await client.get<{ data: LibrarySong[]; next?: string }>(
      url,
      url === initial ? params : undefined,
    );
    songs.push(...res.data);
    if (limit && songs.length >= limit) break;
    url = res.next ?? "";
  }

  const display = limit ? songs.slice(0, limit) : songs;

  if (opts.json) {
    console.log(JSON.stringify({
      total: display.length,
      songs: display.map((song) => ({
        id: song.id,
        name: song.attributes.name,
        artistName: song.attributes.artistName,
        albumName: song.attributes.albumName,
        durationInMillis: song.attributes.durationInMillis,
        trackNumber: song.attributes.trackNumber,
      })),
    }));
    return;
  }

  if (display.length === 0) {
    console.log("No songs in library.");
    return;
  }

  console.log(`Library songs (${display.length}${!limit && songs.length > display.length ? "+" : ""}):\n`);
  for (const song of display) {
    const attr = song.attributes;
    const duration = attr.durationInMillis
      ? ` [${formatDuration(attr.durationInMillis)}]`
      : "";
    console.log(`  ${song.id}  ${attr.name} - ${attr.artistName}${duration}`);
  }
}

async function searchLibrary(
  query: string,
  opts: { type?: string; limit?: string; json?: boolean },
): Promise<void> {
  const client = await requireClient();
  const types = opts.type || "library-songs";
  const limit = opts.limit || "10";

  const res = await client.get<{
    results: Record<string, { data: LibrarySong[] }>;
  }>("/v1/me/library/search", {
    term: query,
    types,
    limit,
  });

  const results = res.results;
  if (!results || Object.keys(results).length === 0) {
    if (opts.json) {
      console.log(JSON.stringify({ query, results: {} }));
    } else {
      console.log(`No results for "${query}".`);
    }
    return;
  }

  if (opts.json) {
    const jsonResults: Record<string, Array<{ id: string; name: string; artistName?: string }>> = {};
    for (const [type, group] of Object.entries(results)) {
      jsonResults[type] = group.data.map((item) => {
        const attr = item.attributes;
        const entry: { id: string; name: string; artistName?: string } = {
          id: item.id,
          name: (attr as { name: string }).name,
        };
        if ("artistName" in attr) {
          entry.artistName = attr.artistName as string;
        }
        return entry;
      });
    }
    console.log(JSON.stringify({ query, results: jsonResults }));
    return;
  }

  for (const [type, group] of Object.entries(results)) {
    console.log(`\n${type}:`);
    for (const item of group.data) {
      const attr = item.attributes;
      if (attr && "name" in attr && "artistName" in attr) {
        console.log(`  ${item.id}  ${attr.name} - ${attr.artistName}`);
      } else if (attr && "name" in attr) {
        console.log(`  ${item.id}  ${(attr as { name: string }).name}`);
      }
    }
  }
}

export function registerLibraryCommands(program: Command): void {
  const library = program
    .command("library")
    .description("Browse your music library");

  library
    .command("songs")
    .description("List songs in your library")
    .option("-l, --limit <n>", "Maximum number of songs to show")
    .option("--json", "Output as JSON")
    .action(listSongs);

  library
    .command("search <query>")
    .description("Search your library")
    .option(
      "-t, --type <type>",
      "Resource type to search",
      "library-songs",
    )
    .option("-l, --limit <n>", "Maximum results", "10")
    .option("--json", "Output as JSON")
    .action(searchLibrary);
}
