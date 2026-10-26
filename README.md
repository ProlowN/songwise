# songwise

Minimal CLI for managing Apple Music playlists. Built for AI agents — clean output, no bloat.

## Requirements

- macOS
- Node.js 18+
- Apple Music subscription

## Install

The package is not published on npm. Install from the repository:

```bash
git clone https://github.com/ProlowN/songwise.git
cd songwise
npm install
npm run build
npm link
```

To upgrade later, pull and rebuild:

```bash
git pull
npm run build
```

## Auth Setup

```bash
songwise auth login --manual
```

This fetches the developer token automatically, then prompts you to paste your Music User Token:

1. Go to [music.apple.com](https://music.apple.com) and sign in
2. Open browser console (`Cmd+Option+J`)
3. Run: `MusicKit.getInstance().musicUserToken`
4. Copy the output and paste into the terminal

Check auth:
```bash
songwise auth status
```

## Commands

### Auth

| Command | Description |
|---------|-------------|
| `songwise auth login --manual` | Authenticate (recommended) |
| `songwise auth status` | Check auth status |
| `songwise auth logout` | Clear tokens |

### Library

| Command | Description |
|---------|-------------|
| `songwise library songs` | List library songs |
| `songwise library search "query"` | Search library |

### Playlists

| Command | Description |
|---------|-------------|
| `songwise playlist list` | List playlists |
| `songwise playlist create "Name"` | Create playlist |
| `songwise playlist delete <id>` | Delete playlist |
| `songwise playlist tracks <id>` | List tracks |
| `songwise playlist add <playlist-id> <song-id>` | Add track |
| `songwise playlist remove <playlist-id> <song-id>` | Remove track |

### Songs

| Command | Description |
|---------|-------------|
| `songwise song remove <song-id>` | Remove from library |

## Structured Output

All commands support `--json` for scriptable output:

```bash
songwise playlist list --json
songwise library songs --json
songwise playlist tracks p.abc --json
```

## For AI Agents

See [AGENTS.md](./AGENTS.md) for detailed agent workflows, ID formats, and patterns.

## Limitations

- No playlist rename
- No track reordering
- macOS only

## License

MIT
