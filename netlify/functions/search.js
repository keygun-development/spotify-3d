import { spotify, json, mapTrack } from "./_spotify.js";

// GET /api/search?q=... -> track results to add to the playlist.
export default async (req) => {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return json({ tracks: [] });

  try {
    // Dev-mode apps cap search `limit` at 5 (a larger value -> "Invalid limit").
    const res = await spotify(`/search?type=track&limit=5&q=${encodeURIComponent(q)}`);
    if (!res.ok) return json({ error: await res.text() }, res.status);
    const data = await res.json();
    const tracks = (data.tracks?.items || []).map(mapTrack);
    return json({ tracks });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
};

export const config = { path: "/api/search" };
