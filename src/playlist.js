// Read the shared playlist from our backend function. Works for everyone,
// no login — the function uses the owner token server-side.
export async function getPlaylist() {
  const res = await fetch("/api/playlist");
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `playlist fetch failed (${res.status})`);
  }
  return res.json(); // { playlistId, playlistUri, count, tracks: [...] }
}
