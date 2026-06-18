// Shared helpers for the Spotify Functions. The leading underscore tells
// Netlify NOT to deploy this as its own endpoint — it's imported by the others.
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

// Cache the owner access token across warm invocations of a function instance.
let cached = { token: null, exp: 0 };

export async function getOwnerToken() {
  const now = Date.now();
  if (cached.token && now < cached.exp) return cached.token;

  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  const refresh = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!id || !secret || !refresh) {
    throw new Error("Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / SPOTIFY_REFRESH_TOKEN");
  }

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  cached = { token: data.access_token, exp: now + (data.expires_in - 60) * 1000 };
  return cached.token;
}

// Thin wrapper around the Spotify Web API using the owner token by default.
export async function spotify(path, init = {}) {
  const token = init.token || (await getOwnerToken());
  const { token: _drop, headers, ...rest } = init;
  return fetch(`${API}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(headers || {}),
    },
  });
}

export const playlistId = () => process.env.SPOTIFY_PLAYLIST_ID;

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Map a raw Spotify track object to the shape the frontend uses.
export function mapTrack(t) {
  const images = t.album?.images || [];
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: (t.artists || []).map((a) => a.name).join(", "),
    album: t.album?.name || "",
    albumArt: images[0]?.url || null,
    albumArtSmall: images[images.length - 1]?.url || images[0]?.url || null,
    durationMs: t.duration_ms,
  };
}
