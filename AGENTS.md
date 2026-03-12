# songwise — Agent Guide

**Purpose:** Minimal CLI for AI agents to manage Apple Music playlists (add/remove songs, create/delete playlists). macOS only.

**Scope (hard limits — do not exceed):**
- Read library: songs, playlists, search
- Write: create/delete playlists, add/remove tracks, remove songs from library
- **No** playlist rename, **No** track reordering
- Auth via manual token paste (browser automation optional)

---

## Quick Start

```bash
npm install -g songwise
songwise auth login --manual   # Required before any command
songwise playlist list
songwise playlist create "My Playlist"
songwise playlist add p.abc123 i.xyz456
songwise playlist remove p.abc123 i.xyz456
```

---

## Authentication

All commands require auth. Check first:

```bash
songwise auth status
```

If not authenticated:
```bash
songwise auth login --manual
```

Follow prompts to get your Music User Token from music.apple.com console.

---

## Core Commands (agent-friendly)

| Command | Purpose |
|---------|---------|
| `songwise playlist list` | List all playlists |
| `songwise playlist create "Name"` | Create empty playlist |
| `songwise playlist create "Name" -d "Description"` | Create with description |
| `songwise playlist delete <playlist-id>` | Delete playlist |
| `songwise playlist tracks <playlist-id>` | List tracks in playlist |
| `songwise playlist add <playlist-id> <song-id>` | Add track |
| `songwise playlist remove <playlist-id> <song-id>` | Remove track |
| `songwise library songs --limit 50` | List songs |
| `songwise library search "query"` | Search library |
| `songwise song remove <song-id>` | Remove song from library |

---

## Structured Output (--json)

All read commands support `--json` for stable agent parsing:

```bash
songwise playlist list --json
# { "total": 2, "playlists": [{ "id": "p.xxx", "name": "Workout", ... }] }

songwise library songs --json
# { "songs": [{ "id": "i.xxx", "name": "Song", "artist": "Artist", ... }], "total": 50 }

songwise playlist tracks <id> --json
# { "playlistId": "p.xxx", "tracks": [{ "id": "i.xxx", "name": "...", "artist": "..." }] }
```

---

## ID Formats

- Library songs: `i.abcdef123456` (starts with `i.`)
- Playlists: `p.abcdef123456` (starts with `p.`)
- Catalog songs: numeric only (e.g., `203709340`)

---

## Workflow Patterns

**Find song ID:**
```bash
songwise library search "Bohemian Rhapsody"
# Output includes i.xxx ID
```

**Find playlist ID:**
```bash
songwise playlist list
# Output includes p.xxx ID
```

**Add song to playlist:**
1. Search for song → get `i.xxx`
2. List playlists → get `p.xxx`
3. `songwise playlist add p.xxx i.xxx`

**Move songs between playlists:**
1. Get track IDs from source playlist
2. Add to target playlist
3. Remove from source

---

## Error Handling

- Exit code 0 = success, 1 = error
- Error messages include actionable next steps
- Common errors:
  - "Not authenticated" → run `songwise auth login --manual`
  - 429 rate limit → wait and retry

---

## What NOT to add

This project stays minimal. Do NOT add:
- Playlist rename (API doesn't support it)
- Track reordering (no API endpoint)
- User-facing polish (colors, animations, prompts)
- Extra metadata fetching
- Feature creep beyond the defined scope

If in doubt, ask before implementing.