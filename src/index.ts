import { program } from "commander";
import { registerAuthCommands } from "./commands/auth.js";
import { registerLibraryCommands } from "./commands/library.js";
import { registerPlaylistCommands } from "./commands/playlist.js";
import { registerSongCommands } from "./commands/song.js";

process.on("uncaughtException", (err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});

program
  .name("songwise")
  .description("CLI tool for managing Apple Music libraries")
  .version("0.1.0");

registerAuthCommands(program);
registerLibraryCommands(program);
registerPlaylistCommands(program);
registerSongCommands(program);

program.parse();
