import { Command } from "commander";
import { getTokens } from "../auth/token-manager.js";
import { AppleMusicClient } from "../api/client.js";

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

async function removeSong(id: string, opts: { json?: boolean }): Promise<void> {
  validateId(id, "song ID");
  const client = await requireClient();
  await client.delete(`/v1/me/library/songs/${id}`);
  if (opts.json) {
    console.log(JSON.stringify({ ok: true, id }));
  } else {
    console.log(`Removed song ${id} from library`);
  }
}

export function registerSongCommands(program: Command): void {
  const song = program.command("song").description("Manage songs");

  song
    .command("remove <id>")
    .description("Remove a song from your library")
    .option("--json", "Output as JSON")
    .action(removeSong);
}
