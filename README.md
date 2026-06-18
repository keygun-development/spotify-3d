# Spotify 3D — shared playlist flyby

Fly a camera through a **shared Spotify playlist** in 3D (scroll = flight, like
`portfolio-3d`). Each track is a floating card (album art, title, artist, play).
Anyone can **add** tracks; logged-in Premium listeners get a **custom player**
with a bottom control bar.

- **Frontend:** Vite + three.js (static, deploys to Netlify)
- **Backend:** Netlify Functions (Node) — thin Spotify proxy
- **No database** — the track list is read straight from the real Spotify playlist

## How it works

| Feature | Who | How |
|---------|-----|-----|
| Fly through tracks | everyone, no login | `GET /api/playlist` (owner token, server-side) |
| Add a track | everyone, no login | `POST /api/add-track` writes via the **owner** token |
| Listen in-browser | logged-in **Premium** users (max 5) | Web Playback SDK, **listener's own** token (PKCE, client-side) |

Two separate Spotify auth flows:
- **Owner** (server-side, secret): a refresh token in env lets the functions read
  the playlist, search, and add tracks. Minted once with `npm run token`.
- **Listener** (client-side PKCE, no secret): each listener logs in with their own
  Premium account to stream. Counts against Spotify's 5-user dev-mode allowlist.

## Spotify constraints (read this)

- **Listening is Premium-only and capped at 5 allowlisted accounts** — Spotify
  dev-mode limit (tightened 2026). Add the listener accounts manually in the
  dashboard. Adding tracks + the 3D flyby work for everyone with no login.
- `preview_url` is dead for new apps, so there's no non-Premium custom player.
- One Spotify account = one active stream, so each listener streams on their own
  token (you can't funnel everyone through one account).

## Setup

### 1. Spotify dashboard (https://developer.spotify.com/dashboard)
1. Create an app. Note the **Client ID** and **Client Secret**.
2. Add Redirect URIs:
   - `http://127.0.0.1:8899/callback` (for `npm run token`, one-time)
   - `http://127.0.0.1:8888/callback` (local `netlify dev`)
   - `https://spotify.keaganmulder.nl/callback` (production)
3. Under **User Management**, add the ≤5 Spotify accounts allowed to *listen*.
4. Create (or pick) the playlist you want to share; copy its ID from its URL
   (`open.spotify.com/playlist/<ID>`). The owner refresh token's account must be
   able to edit it.

### 2. Env vars — copy `.env.example` to `.env` and fill in
```
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_PLAYLIST_ID=...
SPOTIFY_REFRESH_TOKEN=...        # from step 3
VITE_SPOTIFY_CLIENT_ID=...       # same as SPOTIFY_CLIENT_ID
```

### 3. Mint the owner refresh token (once)
```
SPOTIFY_CLIENT_ID=xxx SPOTIFY_CLIENT_SECRET=yyy npm run token
```
Open the printed URL, log in as the playlist owner, copy the refresh token into
`SPOTIFY_REFRESH_TOKEN`.

## Run locally
```
npm install
npm i -g netlify-cli      # if you don't have it
npm run dev               # netlify dev: Vite + Functions on http://127.0.0.1:8888
```
> Use `http://127.0.0.1:8888` (not `localhost`) so the redirect URI matches.

`npm run vite` runs the frontend alone, but `/api/*` won't work without functions.

## Deploy (Netlify)
1. Connect the repo; build settings come from `netlify.toml` (`npm run build` → `dist`).
2. Set all env vars (including `VITE_SPOTIFY_CLIENT_ID`) in **Site settings → Environment**.
3. Point `spotify.keaganmulder.nl` at the site and confirm the production redirect URI.

## Project layout
```
index.html               canvas + cards + player bar + add panel
src/main.js              3D scene, scroll flight, card projection, UI wiring
src/auth.js              listener PKCE login
src/player.js            Web Playback SDK + custom controls
src/playlist.js          fetch shared playlist
src/add.js               search + add panel
netlify/functions/       _spotify.js (shared), playlist.js, search.js, add-track.js
scripts/get-refresh-token.js   one-time owner token helper
```
