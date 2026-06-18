import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import "./style.css";

import { handleCallback, isLoggedIn, login, logout, getToken } from "./auth.js";
import { getPlaylist } from "./playlist.js";
import { initAddPanel } from "./add.js";
import {
  initPlayer,
  setPlaylistUri,
  playAt,
  togglePlay,
  next,
  prev,
  seek,
  setVolume,
  setShuffle,
  setRepeat,
  getModes,
  hasStarted,
  activate,
  onChange as onPlayerChange,
  onError as onPlayerError,
  getProgress,
  currentTrackId,
} from "./player.js";

/* ------------------------------------------------------------------ *
 *  LAYOUT — tracks are placed along the flight path
 * ------------------------------------------------------------------ */
const TRACK_START = 12; // camera start z
const FIRST_Z = -36; // z of the first track card
const SPACING = 28; // z gap between tracks

let TRACK_END = -200; // recomputed from track count
let TRACK_LEN = TRACK_START - TRACK_END;
let SCROLL_VH = 300;

const zForIndex = (i) => FIRST_Z - i * SPACING;
const xForIndex = (i) => (i % 2 === 0 ? -1 : 1) * (11 + (i % 3) * 2.5);
const yForIndex = (i) => Math.sin(i * 0.9) * 2.2;

/* ------------------------------------------------------------------ *
 *  SCROLL — a tall spacer turns native page scroll into 0..1 progress
 * ------------------------------------------------------------------ */
const scroller = document.getElementById("scroller");
let scrollProgress = 0;
let smooth = 0;
let prevSmooth = 0;
let warp = 0;
let transitioning = false; // true while warping to another site
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Seamless site jump: kick the stars into hyperspace, fade through the same
 * loading veil, then hard-navigate. Sister sites (portfolio-3d) share this
 * template, so the hand-off reads as one continuous flight, not a page change. */
function warpTo(url) {
  if (transitioning) return;
  transitioning = true;
  const v = document.createElement("div");
  v.className = "veil";
  v.style.opacity = "0";
  v.innerHTML = "<span>entering universe…</span>";
  document.body.appendChild(v);
  requestAnimationFrame(() => (v.style.opacity = "1"));
  setTimeout(() => (window.location.href = url), 700);
}

function readScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  scrollProgress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
}
window.addEventListener("scroll", readScroll, { passive: true });

function recomputeTrack() {
  const n = anchors.length;
  TRACK_END = n > 0 ? zForIndex(n - 1) - 30 : -200;
  TRACK_LEN = TRACK_START - TRACK_END;
  SCROLL_VH = Math.max(260, TRACK_LEN * 2.4);
  scroller.style.height = SCROLL_VH + "vh";
  readScroll();
}

/* ------------------------------------------------------------------ *
 *  THREE.JS SETUP
 * ------------------------------------------------------------------ */
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});

const isMobile = window.matchMedia("(max-width: 767px)").matches;
const pixelRatio = () =>
  isMobile ? Math.min(window.devicePixelRatio, 1.25) : Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(pixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0x07090c);
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.012);
scene.background = FOG_COLOR;

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, 0, TRACK_START);

const composer = new EffectComposer(renderer);
composer.setPixelRatio(pixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  isMobile ? 0.55 : 0.8,
  0.7,
  0.2
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

scene.add(new THREE.AmbientLight(0x3a4a40, 1.1));
const keyLight = new THREE.PointLight(0x1ed760, 200, 170);
keyLight.position.set(20, 14, 0);
scene.add(keyLight);
const rimLight = new THREE.PointLight(0x4fd6a0, 150, 160);
rimLight.position.set(-22, -10, -60);
scene.add(rimLight);
const travelLight = new THREE.PointLight(0x1db954, 120, 90);
scene.add(travelLight);

/* ---------- starfield ---------- */
function makeStars(count, spread, depth) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * spread;
    pos[i * 3 + 1] = (Math.random() - 0.5) * spread * 0.7;
    pos[i * 3 + 2] = TRACK_START - Math.random() * depth;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x9fffcb,
    size: 0.3,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  return new THREE.Points(geo, mat);
}
let stars, starsFar;
let gates = [];

function buildEnvironment() {
  const depth = TRACK_LEN + 120;
  stars = makeStars(2600, 220, depth);
  scene.add(stars);
  starsFar = makeStars(1400, 380, depth);
  starsFar.material.size = 0.18;
  starsFar.material.opacity = 0.45;
  scene.add(starsFar);

  const gateColors = [0x1db954, 0x1ed760, 0x4fd6a0, 0x2bc4ff];
  const gateCount = Math.max(4, Math.ceil(TRACK_LEN / 30));
  for (let i = 0; i < gateCount; i++) {
    const r = 16 + Math.random() * 6;
    const geo = new THREE.TorusGeometry(r, 0.16, 12, 90);
    const color = gateColors[i % gateColors.length];
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.5,
      metalness: 0.6,
      roughness: 0.3,
    });
    const gate = new THREE.Mesh(geo, mat);
    gate.position.set(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 6,
      TRACK_START - 20 - i * 30
    );
    gate.rotation.z = Math.random() * Math.PI;
    gate.userData.spin = (Math.random() - 0.5) * 0.3;
    gate.userData.pulse = Math.random() * Math.PI * 2;
    scene.add(gate);
    gates.push(gate);
  }
}

/* ------------------------------------------------------------------ *
 *  TRACK CARDS — one DOM node per track, placed in 3D each frame
 * ------------------------------------------------------------------ */
const cardsLayer = document.getElementById("cards");
const anchors = []; // { el, playBtn, track, world }

function escapeHtml(s = "") {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function makeCard(track, i) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `
    <div class="card__inner">
      <div class="card__art">
        <span class="card__index">${i + 1}</span>
        <img src="${track.albumArt || "/album-cover.svg"}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/album-cover.svg'" />
        <button class="card__play" aria-label="Play">▶</button>
      </div>
      <div class="card__title">${escapeHtml(track.name)}</div>
      <div class="card__artist">${escapeHtml(track.artists)}</div>
    </div>`;
  const playBtn = el.querySelector(".card__play");
  playBtn.addEventListener("click", (e) => {
    e.preventDefault();
    activate(); // unlock audio inside the gesture, before any async work
    onPlayCard(i);
  });
  cardsLayer.appendChild(el);
  return { el, playBtn, track, world: new THREE.Vector3(xForIndex(i), yForIndex(i), zForIndex(i)) };
}

function appendTrack(track) {
  anchors.push(makeCard(track, anchors.length));
  recomputeTrack();
}

/* ------------------------------------------------------------------ *
 *  PROJECTION — port of portfolio-3d's place()
 * ------------------------------------------------------------------ */
const ndc = new THREE.Vector3();

function place(el, world, opts = {}) {
  ndc.copy(world).project(camera);
  const behind = ndc.z > 1;
  const halfW = window.innerWidth / 2;
  const halfH = window.innerHeight / 2;
  const sx = ndc.x * halfW + halfW;
  const sy = -ndc.y * halfH + halfH;

  const ahead = camera.position.z - world.z;
  let op = 0;
  const far = opts.far ?? 100;
  const near = opts.near ?? 16;
  if (!behind) {
    if (ahead > 8 && ahead < far) {
      if (ahead <= near) op = 1;
      else op = 1 - (ahead - near) / (far - near);
    } else if (ahead <= 8 && ahead > -6) {
      op = Math.max(0, (ahead + 6) / 14);
    }
  }
  op = Math.max(0, Math.min(1, op));

  const scale = THREE.MathUtils.clamp(1.15 - ahead / 160, 0.55, 1.18) * (opts.scale ?? 1);
  el.style.transform = `translate(-50%, -50%) translate(${sx}px, ${sy}px) scale(${scale.toFixed(3)})`;
  el.style.opacity = op.toFixed(3);
  el.style.pointerEvents = op > 0.55 ? "auto" : "none";
}

/* ------------------------------------------------------------------ *
 *  UI: HUD, player bar, toast
 * ------------------------------------------------------------------ */
const introEl = document.getElementById("intro");
const introSub = introEl.querySelector(".intro__sub");
const progressBar = document.getElementById("progressBar");
const loginBtn = document.getElementById("loginBtn");
const playlistNameEl = document.getElementById("playlistName");
const followArtistBtn = document.getElementById("followArtistBtn");
const followPlaylistBtn = document.getElementById("followPlaylistBtn");

let ownerId = null;
let playlistId = null;

const bar = document.getElementById("bar");
const barArt = document.getElementById("barArt");
const barTitle = document.getElementById("barTitle");
const barArtist = document.getElementById("barArtist");
const playPauseBtn = document.getElementById("playPauseBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const shuffleBtn = document.getElementById("shuffleBtn");
const repeatBtn = document.getElementById("repeatBtn");
const seekEl = document.getElementById("seek");
const curTimeEl = document.getElementById("curTime");
const remTimeEl = document.getElementById("remTime");
const volEl = document.getElementById("vol");

let seeking = false;
let lastBarTrackId = null;

const toastEl = document.getElementById("toast");
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
}

function fmt(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function refreshLoginBtn() {
  if (isLoggedIn()) {
    loginBtn.textContent = "Spotify ✓";
    loginBtn.classList.add("is-on");
  } else {
    loginBtn.textContent = "Login to listen";
    loginBtn.classList.remove("is-on");
  }
}

// Follow Keagan / the playlist on Spotify. Logged in -> real API follow;
// otherwise open the Spotify page so anyone can follow manually.
async function followUser() {
  if (!ownerId) return;
  if (!isLoggedIn()) {
    window.open(`https://open.spotify.com/user/${ownerId}`, "_blank", "noopener");
    return;
  }
  const token = await getToken();
  const r = await fetch(`https://api.spotify.com/v1/me/following?type=user&ids=${ownerId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
  });
  toast(r.ok ? "Following on Spotify ♥" : "Couldn't follow — log in again to grant access");
}

async function followPlaylist() {
  if (!playlistId) return;
  if (!isLoggedIn()) {
    window.open(`https://open.spotify.com/playlist/${playlistId}`, "_blank", "noopener");
    return;
  }
  const token = await getToken();
  const r = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/followers`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ public: true }),
  });
  toast(r.ok ? "Following the playlist ♥" : "Couldn't follow — log in again to grant access");
}

async function onPlayCard(i) {
  if (!isLoggedIn()) {
    toast("Log in with Spotify Premium to listen");
    login();
    return;
  }
  bar.hidden = false;
  const a = anchors[i];
  if (currentTrackId() && a.track.id === currentTrackId()) {
    togglePlay();
    return;
  }
  await playAt(i);
}

function wirePlayerBar() {
  barArt.onerror = () => {
    barArt.onerror = null;
    barArt.src = "/album-cover.svg";
  };
  playPauseBtn.addEventListener("click", () => {
    activate(); // unlock audio inside the gesture, before any async work
    if (!isLoggedIn()) {
      toast("Log in with Spotify Premium to listen");
      login();
      return;
    }
    // Until the shared playlist has been started on our device, a plain
    // togglePlay() would resume whatever was last on the user's account (their
    // last Spotify playlist). Start *this* playlist instead.
    if (!hasStarted()) {
      bar.hidden = false;
      playAt(0);
      return;
    }
    togglePlay();
  });
  nextBtn.addEventListener("click", next);
  prevBtn.addEventListener("click", prev);

  shuffleBtn.addEventListener("click", () => {
    if (!isLoggedIn()) return toast("Log in to control playback");
    setShuffle(!getModes().shuffle);
  });
  repeatBtn.addEventListener("click", () => {
    if (!isLoggedIn()) return toast("Log in to control playback");
    setRepeat((getModes().repeatMode + 1) % 3);
  });

  seekEl.addEventListener("input", () => {
    seeking = true;
  });
  seekEl.addEventListener("change", () => {
    const { duration } = getProgress();
    seek((seekEl.value / 1000) * duration);
    seeking = false;
  });

  volEl.addEventListener("input", () => setVolume(volEl.value / 100));

  onPlayerChange(() => {
    /* state pushed; the tick loop reads getProgress() for smooth updates */
  });
  onPlayerError((ev, message) => {
    if (ev === "account_error") toast("Spotify Premium is required to play in-browser.");
    else if (ev === "authentication_error") {
      toast("Spotify session expired — log in again.");
      logout();
      refreshLoginBtn();
    } else if (message) toast(message);
  });
}

function updatePlayerBar() {
  if (bar.hidden) return;
  const p = getProgress();
  if (!p.hasTrack) return;

  if (p.track && p.track.id !== lastBarTrackId) {
    lastBarTrackId = p.track.id;
    barArt.src = p.track.albumArt || "/album-cover.svg";
    barTitle.textContent = p.track.name || "—";
    barArtist.textContent = p.track.artists || "";
  }

  playPauseBtn.textContent = p.paused ? "▶" : "⏸";
  if (!seeking && p.duration > 0) {
    seekEl.value = Math.round((p.position / p.duration) * 1000);
  }
  curTimeEl.textContent = fmt(p.position);
  remTimeEl.textContent = "-" + fmt(Math.max(0, p.duration - p.position));
}

function updateCardStates() {
  const id = currentTrackId();
  const playing = !getProgress().paused;
  for (const a of anchors) {
    const isCur = id && a.track.id === id;
    a.el.classList.toggle("playing", !!isCur);
    a.playBtn.textContent = isCur && playing ? "⏸" : "▶";
  }
}

function reflectModes() {
  const { shuffle, repeatMode } = getModes();
  shuffleBtn.classList.toggle("is-on", shuffle);
  repeatBtn.classList.toggle("is-on", repeatMode !== 0);
  repeatBtn.textContent = repeatMode === 2 ? "🔂" : "🔁";
}

/* ------------------------------------------------------------------ *
 *  FIND IN PLAYLIST — Cmd/Ctrl+F flies the camera to matching tracks
 * ------------------------------------------------------------------ */
const findBar = document.getElementById("findBar");
const findInput = document.getElementById("findInput");
const findCount = document.getElementById("findCount");

let findMatches = [];
let findPos = -1;

// Scroll so the camera comes to rest just in front of a given track card.
function scrollToIndex(i) {
  const targetCamZ = zForIndex(i) + 22;
  let s = (TRACK_START - targetCamZ) / TRACK_LEN;
  s = Math.max(0, Math.min(1, s));
  const max = document.documentElement.scrollHeight - window.innerHeight;
  window.scrollTo({ top: s * max, behavior: "smooth" });
}

function clearFindMarks() {
  for (const a of anchors) a.el.classList.remove("match", "match-active");
}

function runFind(q) {
  findMatches = [];
  const query = q.trim().toLowerCase();
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const hit = query && (a.track.name + " " + a.track.artists).toLowerCase().includes(query);
    a.el.classList.toggle("match", !!hit);
    a.el.classList.remove("match-active");
    if (hit) findMatches.push(i);
  }
  findPos = findMatches.length ? 0 : -1;
  updateFindCount();
  if (findPos >= 0) gotoMatch();
}

function gotoMatch() {
  for (const a of anchors) a.el.classList.remove("match-active");
  const idx = findMatches[findPos];
  anchors[idx].el.classList.add("match-active");
  scrollToIndex(idx);
}

function stepMatch(dir) {
  if (!findMatches.length) return;
  findPos = (findPos + dir + findMatches.length) % findMatches.length;
  gotoMatch();
  updateFindCount();
}

function updateFindCount() {
  findCount.textContent = findMatches.length
    ? `${findPos + 1}/${findMatches.length}`
    : findInput.value.trim()
      ? "0/0"
      : "";
}

function openFind() {
  findBar.hidden = false;
  findInput.focus();
  findInput.select();
  if (findInput.value.trim()) runFind(findInput.value);
}

function closeFind() {
  findBar.hidden = true;
  clearFindMarks();
  findMatches = [];
  findPos = -1;
}

function initFind() {
  findInput.addEventListener("input", () => runFind(findInput.value));
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      stepMatch(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeFind();
    }
  });
  document.getElementById("findNext").addEventListener("click", () => stepMatch(1));
  document.getElementById("findPrev").addEventListener("click", () => stepMatch(-1));
  document.getElementById("findClose").addEventListener("click", closeFind);

  // Cmd+F (mac) / Ctrl+F (win) opens our finder instead of the browser's.
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openFind();
    }
  });
}

/* ------------------------------------------------------------------ *
 *  RESIZE + ANIMATION LOOP
 * ------------------------------------------------------------------ */
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(pixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.setPixelRatio(pixelRatio());
  bloomPass.setSize(window.innerWidth, window.innerHeight);
  readScroll();
}
window.addEventListener("resize", onResize);

const clock = new THREE.Clock();

function tick() {
  const t = clock.getElapsedTime();

  smooth += (scrollProgress - smooth) * 0.08;
  const dSmooth = smooth - prevSmooth;
  prevSmooth = smooth;
  const speed = Math.abs(dSmooth) * 60;
  const warpTarget =
    transitioning && !reduceMotion
      ? 1
      : reduceMotion
        ? 0
        : THREE.MathUtils.clamp((speed - 0.35) * 1.4, 0, 1);
  warp += (warpTarget - warp) * 0.1;

  const z = TRACK_START - smooth * TRACK_LEN;
  camera.position.z = z;
  camera.position.x = Math.sin(smooth * Math.PI * 3) * 4 + Math.sin(t * 0.3) * 0.6;
  camera.position.y = Math.cos(smooth * Math.PI * 2.2) * 2.4 + Math.sin(t * 0.4) * 0.4;
  camera.lookAt(
    Math.sin((smooth + 0.04) * Math.PI * 3) * 4,
    Math.cos((smooth + 0.04) * Math.PI * 2.2) * 2.4,
    z - 24
  );
  travelLight.position.set(camera.position.x, camera.position.y, z - 6);

  for (const g of gates) {
    g.rotation.z += g.userData.spin * 0.01;
    g.material.emissiveIntensity = 1.5 + Math.sin(t * 1.5 + g.userData.pulse) * 0.7;
  }

  if (stars) {
    stars.rotation.z = t * 0.005;
    starsFar.rotation.z = -t * 0.003;
    stars.scale.z = 1 + warp * 3.5;
    starsFar.scale.z = 1 + warp * 2;
    stars.material.size = 0.3 * (1 + warp * 0.35);
  }

  for (const a of anchors) place(a.el, a.world, { near: 18, far: 105 });

  // intro fades out over the first slice of scroll
  const introFade = Math.max(0, 1 - smooth * 6);
  introEl.style.opacity = introFade.toFixed(3);
  introEl.style.transform = `translateY(${(-smooth * 120).toFixed(1)}px) scale(${(1 - smooth * 0.3).toFixed(3)})`;
  introEl.style.pointerEvents = "none";

  progressBar.style.width = (smooth * 100).toFixed(1) + "%";

  updatePlayerBar();
  updateCardStates();
  reflectModes();

  composer.render();
  requestAnimationFrame(tick);
}

/* ------------------------------------------------------------------ *
 *  BOOT
 * ------------------------------------------------------------------ */
const veil = document.createElement("div");
veil.className = "veil";
veil.innerHTML = "<span>tuning in…</span>";
document.body.appendChild(veil);

async function boot() {
  // Returning from Spotify OAuth?
  if (new URLSearchParams(location.search).has("code") || location.pathname === "/callback") {
    await handleCallback();
  }
  refreshLoginBtn();

  // Load the shared playlist (works without login).
  let playlistUri = null;
  let tracks = [];
  try {
    const data = await getPlaylist();
    tracks = data.tracks || [];
    playlistUri = data.playlistUri;
    playlistId = data.playlistId || null;
    ownerId = data.owner?.id || null;
    if (data.name) {
      playlistNameEl.textContent = "♫ " + data.name;
      document.title = data.name + " — fly the playlist";
    }
  } catch (e) {
    introSub.textContent = "Couldn't load the playlist — check the backend config.";
    toast(String(e.message || e));
  }

  tracks.forEach((tr, i) => anchors.push(makeCard(tr, i)));
  recomputeTrack();
  buildEnvironment();

  if (anchors.length === 0) {
    introSub.textContent = "Playlist is empty — hit “Add track” to drop the first song.";
  }

  // HUD + panels
  loginBtn.addEventListener("click", () => {
    if (isLoggedIn()) {
      logout();
      location.reload();
    } else {
      login();
    }
  });

  followArtistBtn.addEventListener("click", followUser);
  followPlaylistBtn.addEventListener("click", followPlaylist);

  document
    .getElementById("portfolioBtn")
    .addEventListener("click", () => warpTo("https://keaganmulder.nl"));

  initAddPanel({ toast, onAdded: (track) => appendTrack(track) });
  wirePlayerBar();
  initFind();

  // If already logged in, set up the player so listening is instant.
  if (playlistUri) setPlaylistUri(playlistUri);
  if (isLoggedIn()) {
    bar.hidden = false;
    initPlayer().catch(() => {});
  }

  tick();
  requestAnimationFrame(() => setTimeout(() => veil.classList.add("hide"), 350));
}

boot();
