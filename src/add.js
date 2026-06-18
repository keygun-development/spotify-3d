// Add-track panel: search Spotify and add results to the shared playlist.
// No login required — the backend writes with the owner token.

async function searchTracks(q) {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error("search failed");
  return (await res.json()).tracks || [];
}

async function addTrack(uri) {
  const res = await fetch("/api/add-track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uri }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || "add failed");
  }
  return res.json();
}

export function initAddPanel({ onAdded, toast }) {
  const panel = document.getElementById("addPanel");
  const openBtn = document.getElementById("addBtn");
  const closeBtn = document.getElementById("addClose");
  const input = document.getElementById("searchInput");
  const results = document.getElementById("searchResults");

  const open = () => {
    panel.hidden = false;
    setTimeout(() => input.focus(), 50);
  };
  const close = () => {
    panel.hidden = true;
  };

  openBtn.addEventListener("click", () => (panel.hidden ? open() : close()));
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) close();
  });

  let timer = null;
  let lastQuery = "";

  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (!q) {
      results.innerHTML = "";
      return;
    }
    timer = setTimeout(async () => {
      lastQuery = q;
      try {
        const tracks = await searchTracks(q);
        if (q !== lastQuery) return; // a newer query already fired
        render(tracks);
      } catch {
        results.innerHTML = `<p class="addpanel__empty">Search failed. Try again.</p>`;
      }
    }, 300);
  });

  function render(tracks) {
    if (!tracks.length) {
      results.innerHTML = `<p class="addpanel__empty">No results.</p>`;
      return;
    }
    results.innerHTML = "";
    for (const t of tracks) {
      const row = document.createElement("div");
      row.className = "result";
      row.innerHTML = `
        <img src="${t.albumArtSmall || "/album-cover.svg"}" alt="" onerror="this.onerror=null;this.src='/album-cover.svg'" />
        <div class="result__meta">
          <div class="result__title">${escapeHtml(t.name)}</div>
          <div class="result__artist">${escapeHtml(t.artists)}</div>
        </div>
        <button class="result__add">Add</button>`;
      const btn = row.querySelector(".result__add");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "…";
        try {
          const r = await addTrack(t.uri);
          btn.textContent = r.duplicate ? "Already in" : "Added ✓";
          toast?.(r.duplicate ? `"${t.name}" is already in the playlist` : `Added "${t.name}"`);
          if (!r.duplicate) onAdded?.(t);
        } catch (e) {
          btn.disabled = false;
          btn.textContent = "Add";
          toast?.("Could not add track");
        }
      });
      results.appendChild(row);
    }
  }
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
