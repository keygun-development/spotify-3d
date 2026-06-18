// One-time helper: mint the OWNER refresh token for the shared playlist.
//
// Usage (from project root):
//   npm run token                         (reads SPOTIFY_CLIENT_ID / _SECRET from .env)
//   SPOTIFY_CLIENT_ID=xxx SPOTIFY_CLIENT_SECRET=yyy node scripts/get-refresh-token.js
//
// In the Spotify dashboard, add this exact redirect URI to your app first:
//   http://127.0.0.1:8899/callback
//
// Log in as the account that OWNS (or can edit) the shared playlist.
// Paste the printed refresh token into SPOTIFY_REFRESH_TOKEN (.env / Netlify).
import http from "node:http";
import { readFileSync } from "node:fs";

// Load .env from the project root (no dependency).
try {
  const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* no .env — fall back to real env vars */
}

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const PORT = 8899;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = "playlist-modify-public playlist-modify-private";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET env vars first.");
  process.exit(1);
}

const authUrl =
  "https://accounts.spotify.com/authorize?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }

  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("No code in callback");
    return;
  }

  try {
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(JSON.stringify(data));

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>Done — refresh token printed in the terminal. You can close this tab.</h2>");

    console.log("\n=== SPOTIFY_REFRESH_TOKEN ===\n");
    console.log(data.refresh_token);
    console.log("\nPaste that into your .env and Netlify env vars.\n");
  } catch (e) {
    res.writeHead(500).end("Token exchange failed: " + e.message);
    console.error(e);
  } finally {
    setTimeout(() => server.close(() => process.exit(0)), 500);
  }
});

server.listen(PORT, () => {
  console.log("\nOpen this URL in your browser and log in as the playlist owner:\n");
  console.log(authUrl + "\n");
});
