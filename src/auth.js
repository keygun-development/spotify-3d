// Listener login via Authorization Code + PKCE — runs entirely in the browser,
// no client secret. The resulting token drives the Web Playback SDK. These
// users count against Spotify's dev-mode allowlist (max 5 accounts).
const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = `${location.origin}/callback`;
const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
  "user-read-playback-state",
  "user-follow-modify", // follow Keagan
  "playlist-modify-public", // follow the shared playlist
].join(" ");

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const LS_KEY = "sp3d_auth";
const VERIFIER_KEY = "sp3d_verifier";

function randomString(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => ("0" + b.toString(16)).slice(-2)).join("");
}

async function sha256base64url(input) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY));
  } catch {
    return null;
  }
}

function save(obj) {
  localStorage.setItem(LS_KEY, JSON.stringify(obj));
}

export function isLoggedIn() {
  const a = load();
  return !!(a && a.refresh_token);
}

export function logout() {
  localStorage.removeItem(LS_KEY);
}

export async function login() {
  if (!CLIENT_ID) {
    alert("VITE_SPOTIFY_CLIENT_ID is not set — cannot start Spotify login.");
    return;
  }
  const verifier = randomString(64);
  const challenge = await sha256base64url(verifier);
  sessionStorage.setItem(VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  location.href = `${AUTH_URL}?${params}`;
}

// Call once on load. If we returned from Spotify with ?code=, exchange it.
export async function handleCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (!code) return false;

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) {
    history.replaceState({}, "", "/");
    return false;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });

  sessionStorage.removeItem(VERIFIER_KEY);
  if (!res.ok) {
    history.replaceState({}, "", "/");
    return false;
  }

  const token = await res.json();
  save({ ...token, expires_at: Date.now() + token.expires_in * 1000 });
  history.replaceState({}, "", "/");
  return true;
}

// Returns a valid access token, refreshing if needed. Null if not logged in.
export async function getToken() {
  let a = load();
  if (!a) return null;
  if (Date.now() < a.expires_at - 60000) return a.access_token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: a.refresh_token,
    }),
  });
  if (!res.ok) {
    logout();
    return null;
  }

  const token = await res.json();
  a = {
    ...a,
    ...token,
    refresh_token: token.refresh_token || a.refresh_token,
    expires_at: Date.now() + token.expires_in * 1000,
  };
  save(a);
  return a.access_token;
}
