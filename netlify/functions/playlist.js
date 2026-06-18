import { spotify, playlistId, json, mapTrack } from "./_spotify.js";

// GET /api/playlist -> the shared playlist's tracks (paged through fully).
export default async () => {
  const id = playlistId();
  if (!id) return json({ error: "SPOTIFY_PLAYLIST_ID not set" }, 500);

  const tracks = [];
  const limit = 100;
  let offset = 0;

  // Playlist meta (name + owner) for the header label and follow buttons.
  let meta = {};
  try {
    const m = await spotify(`/playlists/${id}?fields=name,owner(id,display_name),images`);
    if (m.ok) meta = await m.json();
  } catch {
    /* non-fatal */
  }

  try {
    while (true) {
      // NOTE: Spotify migrated playlist items from /tracks to /items (Feb 2026);
      // the old /tracks path now 403s. Each entry's track sits under `item`.
      const res = await spotify(`/playlists/${id}/items?offset=${offset}&limit=${limit}`);
      if (!res.ok) return json({ error: await res.text() }, res.status);
      const data = await res.json();

      for (const entry of data.items || []) {
        const t = entry.item;
        if (t && t.id) tracks.push(mapTrack(t));
      }

      if (!data.next || (data.items || []).length < limit) break;
      offset += limit;
    }
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }

  return json({
    playlistId: id,
    playlistUri: `spotify:playlist:${id}`,
    name: meta.name || "Shared playlist",
    owner: { id: meta.owner?.id || null, name: meta.owner?.display_name || null },
    image: meta.images?.[0]?.url || null,
    count: tracks.length,
    tracks,
  });
};

export const config = { path: "/api/playlist" };
