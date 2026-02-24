# songwise

macOS CLI for managing Apple Music libraries. Requires Node.js 18+ and an Apple Music subscription.

This README is for AI agents and LLMs. It documents how to create a skill that wraps this CLI.

## Install

```bash
npm install -g songwise
```

## Auth setup

Before any command works, the user must authenticate. There are two methods:

### Method 1: Browser callback (default)

```bash
songwise auth login
```

This opens `music.apple.com`, starts a local callback server on port 9274, and displays a JavaScript snippet to paste in the browser console. The snippet sends your tokens back to the local server.

**Known issue:** The snippet is a long one-liner that browsers (especially Chrome) may truncate or split when pasting, causing `SyntaxError: Unexpected identifier`. If this happens, use Method 2 instead.

### Method 2: Manual token paste (recommended)

```bash
songwise auth login --manual
```

This scrapes the developer token automatically and prompts you to paste only the Music User Token. To get it:

1. Go to [music.apple.com](https://music.apple.com) and sign in
2. Open the browser console (`Cmd+Option+J` in Chrome, `Cmd+Option+C` in Safari)
3. Run: `MusicKit.getInstance().musicUserToken`
4. Copy the output and paste it into the terminal prompt

### For LLM agents with browser access

If you have browser automation (e.g., Playwright, Chrome DevTools), you can extract both tokens directly from the Apple Music web player and save them without user interaction:

1. Navigate to `https://music.apple.com` (user must be signed in)
2. Execute in the page context:
   ```js
   var m = MusicKit.getInstance();
   JSON.stringify({ dt: m.developerToken, ut: m.musicUserToken })
   ```
3. Save the tokens using `songwise auth login --manual` or by calling the token manager directly

### Check auth status

```bash
songwise auth status
```

## Commands

All commands output plain text to stdout. Exit code 0 = success, 1 = error.

### Auth

| Command | Description |
|---|---|
| `songwise auth login` | Interactive browser-based auth flow |
| `songwise auth login --manual` | Paste tokens manually |
| `songwise auth status` | Check token health |
| `songwise auth logout` | Clear stored tokens |

### Library

| Command | Description |
|---|---|
| `songwise library songs` | List all library songs |
| `songwise library songs --limit 50` | List first 50 songs |
| `songwise library search "query"` | Search library (default: songs) |
| `songwise library search "query" --type library-playlists` | Search playlists |
| `songwise library search "query" --limit 20` | Limit results |

Output format for songs:
```
  i.abcdef123456  Song Name - Artist Name [3:42]
```

### Playlists

| Command | Description |
|---|---|
| `songwise playlist list` | List all playlists |
| `songwise playlist create "Name"` | Create empty playlist |
| `songwise playlist create "Name" -d "Description"` | Create with description |
| `songwise playlist delete <playlist-id>` | Delete a playlist |
| `songwise playlist tracks <playlist-id>` | List tracks in playlist |
| `songwise playlist add <playlist-id> <song-id>` | Add song to playlist |
| `songwise playlist add <playlist-id> <song-id> -t songs` | Add catalog song |
| `songwise playlist remove <playlist-id> <song-id>` | Remove song from playlist |

Output format for playlists:
```
  p.abcdef123456  Playlist Name — description text
```

Output format for tracks:
```
    1. Song Name - Artist Name  (i.abcdef123456)
```

### Songs

| Command | Description |
|---|---|
| `songwise song remove <song-id>` | Remove song from library |

## Creating an LLM skill for songwise

An LLM skill is a prompt template that teaches an agent how to use songwise. Below is a complete skill definition.

### Skill definition

```yaml
name: songwise
description: Manage the user's Apple Music library via the songwise CLI
triggers:
  - apple music
  - playlist
  - library songs
  - music library
prerequisites:
  - songwise must be installed (npm install -g songwise)
  - user must have run `songwise auth login` at least once
  - macOS only
```

### Skill prompt

```
You have access to the `songwise` CLI for managing Apple Music libraries.

AUTHENTICATION:
- Before running any command, check auth with: songwise auth status
- If not authenticated, tell the user to run: songwise auth login --manual
- The default `songwise auth login` (browser callback) has a known issue where the console snippet gets truncated on paste, causing SyntaxError. Prefer --manual.
- If you have browser automation tools, you can extract tokens directly from music.apple.com by running `MusicKit.getInstance().developerToken` and `MusicKit.getInstance().musicUserToken` in the page context, then pass them to `songwise auth login --manual`

READING DATA:
- List songs: songwise library songs --limit <n>
- Search: songwise library search "<query>"
- List playlists: songwise playlist list
- List tracks: songwise playlist tracks <playlist-id>

WRITING DATA (destructive — confirm with user first):
- Create playlist: songwise playlist create "<name>"
- Delete playlist: songwise playlist delete <playlist-id>
- Add to playlist: songwise playlist add <playlist-id> <song-id>
- Remove from playlist: songwise playlist remove <playlist-id> <song-id>
- Remove from library: songwise song remove <song-id>

ID FORMATS:
- Library song IDs start with "i." (e.g., i.abcdef123456)
- Playlist IDs start with "p." (e.g., p.abcdef123456)
- Catalog song IDs are numeric (e.g., 203709340)

WORKFLOW PATTERNS:
- To find a song ID: songwise library search "<song name>"
- To find a playlist ID: songwise playlist list
- To add a song to a playlist: first search for the song, then use the ID with playlist add
- To move songs between playlists: get track IDs from source, add to target, remove from source

LIMITATIONS:
- No playlist rename (unverified API endpoint)
- No track reordering (no API endpoint exists)
- Reorder workaround: create new playlist, add tracks in desired order, delete old playlist
- Music user tokens are believed to last several months (Apple does not document exact expiry) — if commands fail with auth errors, re-run songwise auth login

ERROR HANDLING:
- All errors print to stderr with actionable messages
- Exit code 0 = success, 1 = failure
- Common errors: "Not authenticated" → run auth login, "Rate limited" → wait and retry
```

### MCP server integration (optional)

To expose songwise as an MCP tool server, wrap each command as a tool:

```json
{
  "tools": [
    {
      "name": "songwise_library_search",
      "description": "Search the user's Apple Music library",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Search query" },
          "type": { "type": "string", "enum": ["library-songs", "library-playlists", "library-albums", "library-artists"], "default": "library-songs" },
          "limit": { "type": "number", "default": 10 }
        },
        "required": ["query"]
      }
    },
    {
      "name": "songwise_playlist_list",
      "description": "List all playlists in the user's Apple Music library",
      "inputSchema": { "type": "object", "properties": {} }
    },
    {
      "name": "songwise_playlist_tracks",
      "description": "List tracks in a specific playlist",
      "inputSchema": {
        "type": "object",
        "properties": {
          "playlist_id": { "type": "string", "description": "Playlist ID (starts with p.)" }
        },
        "required": ["playlist_id"]
      }
    },
    {
      "name": "songwise_playlist_create",
      "description": "Create a new playlist",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "description": { "type": "string" }
        },
        "required": ["name"]
      }
    },
    {
      "name": "songwise_playlist_add",
      "description": "Add a track to a playlist",
      "inputSchema": {
        "type": "object",
        "properties": {
          "playlist_id": { "type": "string" },
          "song_id": { "type": "string" },
          "type": { "type": "string", "enum": ["library-songs", "songs"], "default": "library-songs" }
        },
        "required": ["playlist_id", "song_id"]
      }
    },
    {
      "name": "songwise_playlist_remove",
      "description": "Remove a track from a playlist",
      "inputSchema": {
        "type": "object",
        "properties": {
          "playlist_id": { "type": "string" },
          "song_id": { "type": "string" }
        },
        "required": ["playlist_id", "song_id"]
      }
    },
    {
      "name": "songwise_playlist_delete",
      "description": "Delete an entire playlist",
      "inputSchema": {
        "type": "object",
        "properties": {
          "playlist_id": { "type": "string" }
        },
        "required": ["playlist_id"]
      }
    },
    {
      "name": "songwise_song_remove",
      "description": "Remove a song from the user's library",
      "inputSchema": {
        "type": "object",
        "properties": {
          "song_id": { "type": "string" }
        },
        "required": ["song_id"]
      }
    }
  ]
}
```

Each tool implementation simply shells out to the corresponding `songwise` command and returns stdout/stderr.

## API details (for contributors)

All requests go to `https://amp-api.music.apple.com` with four headers:

```
Authorization: Bearer {developer_token}
Music-User-Token: {user_token}
Origin: https://music.apple.com
Content-Type: application/json
```

The developer token is auto-scraped from Apple's web player. The music user token comes from the browser auth flow and is believed to last several months (Apple does not document exact expiry).

This uses undocumented Apple endpoints. It may break if Apple changes their web client.
