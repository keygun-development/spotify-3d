// Custom Spotify player built on the Web Playback SDK. Streams full tracks in
// the listener's own browser (their own Premium account). We expose plain
// control functions + a state snapshot so the UI in main.js can render a fully
// custom bottom bar. Requires Spotify Premium.
import { getToken } from "./auth.js";

let player = null;
let deviceId = null;
let ready = false;
let playlistUri = null;

// Local playback clock, resynced on every player_state_changed.
let curTrack = null;
let paused = true;
let duration = 0;
let basePosition = 0;
let baseStamp = 0;

let shuffle = false;
let repeatMode = 0; // 0 = off, 1 = repeat all, 2 = repeat one
let desiredShuffle = false;
let desiredRepeat = 0;
let started = false; // becomes true once playback has been started on our device

let changeCb = () => {};
let errorCb = () => {};

export function setPlaylistUri(uri) {
  playlistUri = uri;
}
export function onChange(cb) {
  changeCb = cb;
}
export function onError(cb) {
  errorCb = cb;
}
export function isReady() {
  return ready;
}
export function currentTrackId() {
  return curTrack?.id || null;
}
export function getModes() {
  return { shuffle, repeatMode };
}

// Live position derived from the local clock (smooth between SDK updates).
export function getProgress() {
  if (!curTrack) return { position: 0, duration: 0, paused: true, hasTrack: false };
  const pos = paused
    ? basePosition
    : Math.min(duration, basePosition + (performance.now() - baseStamp));
  return { position: pos, duration, paused, hasTrack: true, track: curTrack };
}

let sdkPromise = null;
function loadSDK() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve) => {
    if (window.Spotify) return resolve();
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const s = document.createElement("script");
    s.src = "https://sdk.scdn.co/spotify-player.js";
    s.async = true;
    document.head.appendChild(s);
  });
  return sdkPromise;
}

// Initialise the SDK once the listener is logged in. Safe to call multiple times.
export async function initPlayer() {
  if (player) return ready;
  const token = await getToken();
  if (!token) return false;

  await loadSDK();

  player = new Spotify.Player({
    name: "Spotify 3D",
    getOAuthToken: async (cb) => cb((await getToken()) || ""),
    volume: 0.7,
  });

  player.addListener("ready", ({ device_id }) => {
    deviceId = device_id;
    ready = true;
  });
  player.addListener("not_ready", () => {
    ready = false;
  });

  player.addListener("player_state_changed", (state) => {
    if (!state) return;
    curTrack = mapSdkTrack(state.track_window?.current_track);
    paused = state.paused;
    duration = state.duration;
    basePosition = state.position;
    baseStamp = performance.now();
    shuffle = !!state.shuffle;
    repeatMode = state.repeat_mode ?? 0;
    desiredShuffle = shuffle;
    desiredRepeat = repeatMode;
    changeCb(getProgress());
  });

  ["initialization_error", "authentication_error", "account_error", "playback_error"].forEach(
    (ev) => player.addListener(ev, ({ message }) => errorCb(ev, message))
  );

  return player.connect();
}

function mapSdkTrack(t) {
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    artists: (t.artists || []).map((a) => a.name).join(", "),
    albumArt: t.album?.images?.[0]?.url || null,
  };
}

// Start the shared playlist on the listener's device at a given track index.
export async function playAt(index) {
  if (!playlistUri) return;
  if (!player) await initPlayer();
  // Wait briefly for the device to register on first play.
  for (let i = 0; i < 20 && !deviceId; i++) await new Promise((r) => setTimeout(r, 150));
  if (!deviceId) {
    errorCb("no_device", "Player not ready yet — try again in a moment.");
    return;
  }
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // 1) Make this web device the active Connect device. Without this, a freshly
  //    connected SDK device often rejects play with "Restriction violated".
  await fetch("https://api.spotify.com/v1/me/player", {
    method: "PUT",
    headers,
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 350));

  // 2) Start the shared playlist at the chosen track.
  const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ context_uri: playlistUri, offset: { position: index } }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || "";
    if (/restriction/i.test(msg)) {
      errorCb("playback_error", "Playback blocked — close Spotify on your other devices and try again.");
    } else {
      errorCb("playback_error", msg || "Could not start playback");
    }
    return;
  }

  // Apply any shuffle/repeat the user picked before playback was active.
  started = true;
  applyModes();
}

const REPEAT_NAMES = ["off", "context", "track"];

async function applyModes() {
  if (!deviceId || !started) return; // applied automatically after first play
  const token = await getToken();
  const h = { Authorization: `Bearer ${token}` };
  await fetch(
    `https://api.spotify.com/v1/me/player/shuffle?state=${desiredShuffle}&device_id=${deviceId}`,
    { method: "PUT", headers: h }
  ).catch(() => {});
  await fetch(
    `https://api.spotify.com/v1/me/player/repeat?state=${REPEAT_NAMES[desiredRepeat]}&device_id=${deviceId}`,
    { method: "PUT", headers: h }
  ).catch(() => {});
}

export async function setShuffle(state) {
  desiredShuffle = !!state;
  shuffle = desiredShuffle; // optimistic; corrected by player_state_changed
  await applyModes();
}

export async function setRepeat(mode) {
  desiredRepeat = ((mode % 3) + 3) % 3;
  repeatMode = desiredRepeat; // optimistic
  await applyModes();
}

export function togglePlay() {
  player?.togglePlay();
}
export function next() {
  player?.nextTrack();
}
export function prev() {
  player?.previousTrack();
}
export function seek(ms) {
  player?.seek(ms);
}
export function setVolume(v) {
  player?.setVolume(v);
}
