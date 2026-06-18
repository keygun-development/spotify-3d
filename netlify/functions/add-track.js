import { spotify, playlistId, json } from "./_spotify.js";

const TRACK_URI = /^spotify:track:[A-Za-z0-9]+$/;

// POST /api/add-track { uri } -> add a track to the shared playlist (owner token).
// Open to everyone — no listener login required to contribute.
export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const id = playlistId();
  if (!id) return json({ error: "SPOTIFY_PLAYLIST_ID not set" }, 500);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const uri = body?.uri;
  if (!uri || !TRACK_URI.test(uri)) return json({ error: "invalid track uri" }, 400);

  try {
    // Avoid duplicates: pull current uris, skip if already present.
    // (Spotify migrated /tracks -> /items in Feb 2026; track is under `item`.)
    const existing = await spotify(`/playlists/${id}/items?fields=items(item(uri))&limit=100`);
    if (existing.ok) {
      const data = await existing.json();
      const has = (data.items || []).some((i) => i.item?.uri === uri);
      if (has) return json({ ok: true, duplicate: true });
    }

    const res = await spotify(`/playlists/${id}/items`, {
      method: "POST",
      body: JSON.stringify({ uris: [uri] }),
    });
    if (!res.ok) return json({ error: await res.text() }, res.status);
    const data = await res.json();
    return json({ ok: true, snapshot_id: data.snapshot_id });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
};

export const config = { path: "/api/add-track" };
