# Songwise

macOS-only CLI tool for managing Apple Music libraries via the undocumented amp-api.

## Tech Stack

- **Language:** TypeScript (ESM)
- **CLI framework:** Commander.js
- **Build:** tsup
- **Dev runner:** tsx
- **HTTP:** Node.js built-in fetch
- **Keychain:** macOS `security` CLI (no npm dependency)
- **Min Node version:** 18

## Architecture

Single-tier API — all requests go through `amp-api.music.apple.com` with these headers:
```
Authorization: Bearer {developer_token}
Music-User-Token: {user_token}
Origin: https://music.apple.com
Content-Type: application/json
```

Developer token is scraped automatically from the Apple Music web player.
Music User Token is obtained via browser-based auth flow (user pastes a one-liner in browser console).

## Project Structure

```
src/
├── index.ts              # CLI entry point, registers all commands
├── commands/
│   ├── auth.ts           # auth login, status, logout
│   ├── library.ts        # library songs, search
│   ├── playlist.ts       # playlist list/create/delete/tracks/add/remove
│   └── song.ts           # song remove
├── auth/
│   ├── token-manager.ts  # macOS Keychain read/write via `security` CLI
│   ├── token-scraper.ts  # Scrape developer token from music.apple.com
│   └── auth-server.ts    # Local HTTP server for browser token callback
└── api/
    ├── client.ts         # AppleMusicClient — GET/POST/DELETE with auth headers
    └── types.ts          # API response types
```

## Key Design Decisions

- **macOS only** — uses `security` CLI for Keychain, `open` for browser
- **No cookies needed** — confirmed: three headers are sufficient
- **Origin header required** — hardcoded to `https://music.apple.com`
- **No PUT/PATCH** — reorder not available, rename unverified
- **Rate limiting** — retry once on 429
- **Developer token auto-refresh** — transparent JWT expiry check + re-scrape

## Conventions

- No over-engineering — keep commands simple and direct
- Error messages must include actionable next steps (e.g., "Run: songwise auth login")
- Pagination handled transparently — commands fetch all pages
- No colors/emojis unless user opts in
