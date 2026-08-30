const STATUS_LABEL = {
  archived: "Archived",
  active: "Active",
  resigned: "Resigned",
  unknown: "Unknown",
};

const app = document.getElementById("app");
let archive = { officers: [] };
let clockTimer = null;
let me = null;
const ME_KEY = "pt_me";
const LOCAL_USERS_KEY = "pt_users";

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function parseWall(value) {
  const match = String(value || "").match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return {
    y: Number(match[1]),
    mo: Number(match[2]),
    d: Number(match[3]),
    h: Number(match[4]),
    mi: Number(match[5]),
    s: Number(match[6] || 0),
  };
}

function addWallSeconds(parts, extra) {
  const date = new Date(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s + extra);
  return {
    y: date.getFullYear(),
    mo: date.getMonth() + 1,
    d: date.getDate(),
    h: date.getHours(),
    mi: date.getMinutes(),
    s: date.getSeconds(),
  };
}

function formatAxonStamp(parts, offset) {
  const off = offset && /^[+-]\d{4}$/.test(offset) ? offset : "-0400";
  return `${parts.y}-${pad(parts.mo)}-${pad(parts.d)} ${pad(parts.h)}:${pad(parts.mi)}:${pad(parts.s)} ${off}`;
}

function axonSerial(officer) {
  if (officer.bodycam?.serial) return officer.bodycam.serial.toUpperCase();
  const digits = String(officer.badge || "1873").replace(/\D/g, "").padStart(5, "0").slice(-5);
  return `X60A${digits}`;
}

function axonModel(officer) {
  return officer.bodycam?.model || "AXON BODY 3";
}

function formatShortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${String(date.getFullYear()).slice(2)}`;
}

function formatLongDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function snippet(text, n = 220) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= n) return clean;
  return clean.slice(0, n).replace(/\s+\S*$/, "") + "...";
}

function releaseTitle(officer) {
  return officer.bodycam?.title || officer.storyTitle || `${officer.rank || ""} ${officer.name}`.trim();
}

function thumbHtml(officer, className = "thumb") {
  const inner = officer.photo
    ? `<img src="${escapeHtml(assetUrl(officer.photo))}" alt="">`
    : `<div class="thumb-fallback">${escapeHtml(initials(officer.name))}</div>`;
  return `<span class="${className}">${inner}</span>`;
}

function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "officer" && parts[1]) return renderOfficer(decodeURIComponent(parts[1]));
  if (parts[0] === "submit") return renderSubmit();
  if (parts[0] === "register") return renderRegister();
  if (parts[0] === "login") return renderLogin();
  return renderHome(currentQuery());
}

function currentQuery() {
  const fromGlobal = document.getElementById("global-q")?.value || "";
  return fromGlobal.trim();
}

function assetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path) || String(path).startsWith("data:")) return path;
  return String(path).replace(/^\//, "");
}

async function loadArchive() {
  const urls = ["api/officers", "data/officers.json"];
  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (data && Array.isArray(data.officers)) {
        archive = data;
        return;
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Archive unavailable");
}

function matchesQuery(officer, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return [
    officer.name,
    officer.rank,
    officer.badge,
    officer.unit,
    officer.callsign,
    officer.player,
    officer.storyTitle,
    officer.bodycam?.title,
    officer.bodycam?.location,
    officer.story,
  ]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

function sealSvg() {
  return `
    <svg class="seal" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="98" fill="#0c2b4a"/>
      <circle cx="100" cy="100" r="90" fill="none" stroke="#c9a44a" stroke-width="4"/>
      <circle cx="100" cy="100" r="74" fill="none" stroke="#c9a44a" stroke-width="1.5"/>
      <path d="M100 38 L107 68 H138 L112 86 L122 116 L100 99 L78 116 L88 86 L62 68 H93 Z" fill="#c9a44a"/>
      <text x="100" y="140" text-anchor="middle" fill="#e9eef5" font-size="12" font-family="Arial" font-weight="700" letter-spacing="2">POLICE</text>
      <text x="100" y="156" text-anchor="middle" fill="#e9eef5" font-size="12" font-family="Arial" font-weight="700" letter-spacing="1">TRAGEDY</text>
    </svg>`;
}

function shareRow() {
  return `
    <div class="share-row" aria-hidden="true">
      <span class="s-fb">f</span>
      <span class="s-x">x</span>
      <span class="s-in">in</span>
      <span class="s-pin">p</span>
      <span class="s-em">@</span>
    </div>`;
}

function renderHome(query = "") {
  const list = (archive.officers || []).filter((o) => matchesQuery(o, query));

  app.innerHTML = `
    <section class="wrap">
      <div class="page-title">
        <span>Police Tragedy Body-Worn Camera Video Releases</span>
        ${shareRow()}
      </div>
      <div class="seal-wrap">${sealSvg()}</div>
      <div class="local-search">
        <input id="search" type="search" placeholder="Search" value="${escapeHtml(query)}" autocomplete="off">
      </div>
      <h2 class="section-title"><span id="count">${list.length}</span> Featured Videos</h2>
      <div id="roster">${list.map(releaseHtml).join("") || `<div class="empty">No videos found.</div>`}</div>
    </section>
  `;

  wireSearch();
}

function releaseHtml(officer) {
  const cam = officer.bodycam || {};
  const date = formatShortDate(cam.date);
  return `
    <article class="release">
      <a href="#/officer/${encodeURIComponent(officer.id)}">${thumbHtml(officer)}</a>
      <div class="release-body">
        <h3><a href="#/officer/${encodeURIComponent(officer.id)}">${escapeHtml(releaseTitle(officer))}</a></h3>
        <div class="release-meta">
          ${date ? escapeHtml(date) + " | " : ""}${escapeHtml(officer.rank || "")} ${escapeHtml(officer.name)} | ${escapeHtml(officer.unit || "PTD")}
        </div>
        <p class="release-snip">${escapeHtml(snippet(officer.story))}</p>
      </div>
    </article>
  `;
}

function wireSearch() {
  const input = document.getElementById("search");
  const global = document.getElementById("global-q");
  const apply = (value) => {
    if (global && global !== document.activeElement) global.value = value;
    const filtered = (archive.officers || []).filter((o) => matchesQuery(o, value.trim()));
    const count = document.getElementById("count");
    const roster = document.getElementById("roster");
    if (count) count.textContent = filtered.length;
    if (roster) {
      roster.innerHTML = filtered.map(releaseHtml).join("") || `<div class="empty">No videos found.</div>`;
    }
  };
  input?.addEventListener("input", () => apply(input.value));
}

function hudHtml(officer) {
  const cam = officer.bodycam || {};
  const wall = parseWall(cam.date) || parseWall(new Date().toISOString());
  const stamp = formatAxonStamp(wall, cam.utcOffset);
  return `
    <div class="player-hud">
      <div class="hud-brand">
        <svg class="hud-lens" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="15" fill="#1e5aa8"/>
          <circle cx="16" cy="16" r="8" fill="#0b2a4a"/>
          <circle cx="16" cy="16" r="4.2" fill="#7eb6ff"/>
          <circle cx="13.5" cy="13.5" r="1.4" fill="#d9ecff"/>
        </svg>
        <span class="hud-word">police<em>tragedy</em></span>
      </div>
      <div class="hud-right">
        <div class="hud-stamp">
          <div id="cam-clock">${escapeHtml(stamp)}</div>
          <div>${escapeHtml(axonModel(officer))} ${escapeHtml(axonSerial(officer))}</div>
        </div>
        <svg class="axon-mark" viewBox="0 0 40 40" aria-hidden="true">
          <path fill="#f5c400" d="M6 34 L20 6 L34 34 L27.2 34 L20 18.5 L12.8 34 Z"/>
          <path fill="#f5c400" d="M14.2 34 L20 22.4 L25.8 34 Z" opacity=".35"/>
        </svg>
      </div>
    </div>`;
}

function ensureFisheyeFilter() {
  const feImage = document.getElementById("fisheye-map");
  if (!feImage || feImage.getAttribute("href")) return;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - cx) / cx;
      const ny = (y - cy) / cy;
      const r2 = nx * nx + ny * ny;
      const amount = 0.7 * r2;
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, 128 + nx * amount * 127));
      img.data[i + 1] = Math.max(0, Math.min(255, 128 + ny * amount * 127));
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL("image/png");
  feImage.setAttribute("href", url);
  feImage.setAttributeNS("http://www.w3.org/1999/xlink", "href", url);
}

function startAxonClock(cam, video) {
  const clock = document.getElementById("cam-clock");
  const base = parseWall(cam.date);
  if (!clock || !base) return;
  if (clockTimer) clearInterval(clockTimer);
  const paint = (extra) => {
    clock.textContent = formatAxonStamp(addWallSeconds(base, extra), cam.utcOffset);
  };
  paint(0);
  clockTimer = setInterval(() => {
    if (video && Number.isFinite(video.currentTime)) {
      paint(Math.floor(video.currentTime));
    }
  }, 200);
}
function youtubeId(url) {
  if (!url) return "";
  const match = String(url).match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : "";
}

function renderOfficer(id) {
  const officer = (archive.officers || []).find((o) => o.id === id);
  if (!officer) {
    app.innerHTML = `<section class="wrap"><p class="empty">Release not found.</p></section>`;
    return;
  }

  const cam = officer.bodycam || {};
  const yt = youtubeId(cam.youtube);
  let media = `<div class="nosignal"><div><strong>No Signal</strong>Body-worn camera offline</div></div>`;
  if (cam.video) {
    media = `<video id="bodycam-video" playsinline src="${escapeHtml(assetUrl(cam.video))}"></video>`;
  } else if (yt) {
    media = `<iframe src="https://www.youtube.com/embed/${yt}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  }

  const others = (archive.officers || []).filter((o) => o.id !== officer.id).slice(0, 4);
  const hasLocalVideo = Boolean(cam.video);

  app.innerHTML = `
    <section class="wrap">
      <div class="crumb"><a href="#/">Archive</a> / Video</div>
      <div class="article-head">
        <h1 class="article-title">${escapeHtml(releaseTitle(officer))}</h1>
        ${shareRow()}
      </div>
      <div class="article-grid">
        <div>
          <div class="player">
            <div class="player-stage">${media}</div>
            <div class="player-vignette"></div>
            ${hudHtml(officer)}
            ${hasLocalVideo ? `
            <button class="player-play" type="button" id="bodycam-play" aria-label="Play">▶</button>
            <div class="player-bar" id="bodycam-bar">
              <button type="button" id="bodycam-toggle" aria-label="Pause">❚❚</button>
              <input type="range" id="bodycam-seek" min="0" max="1000" value="0">
              <span class="player-time" id="bodycam-time">0:00</span>
            </div>` : ""}
          </div>
          <div class="article-meta">${escapeHtml((cam.location || "UNKNOWN LOCATION").toUpperCase())}${cam.date ? " | " + escapeHtml(formatShortDate(cam.date)) : ""}</div>
          <div class="article-credit">Body-worn camera · ${escapeHtml(officer.rank || "")} ${escapeHtml(officer.name)} · Badge #${escapeHtml(officer.badge || "—")}</div>
          <div class="article-org">${escapeHtml(officer.unit || "Police Tragedy Department")}${officer.callsign ? " · " + escapeHtml(officer.callsign) : ""}</div>
          <div class="article-story">${escapeHtml(officer.story || "История ещё не приложена к релизу.")}</div>
          ${cam.demo ? `<a class="demo-link" href="${escapeHtml(assetUrl(cam.demo))}" download>Download demo (.dem)</a>` : ""}
        </div>
        <aside class="side">
          <h4>Officer</h4>
          <div class="facts">
            <div><dt>Rank</dt><dd>${escapeHtml(officer.rank || "—")}</dd></div>
            <div><dt>Badge</dt><dd>#${escapeHtml(officer.badge || "—")}</dd></div>
            <div><dt>Unit</dt><dd>${escapeHtml(officer.unit || "—")}</dd></div>
            <div><dt>Callsign</dt><dd>${escapeHtml(officer.callsign || "—")}</dd></div>
            <div><dt>Status</dt><dd>${escapeHtml(STATUS_LABEL[officer.status] || officer.status || "—")}</dd></div>
            ${officer.player ? `<div><dt>Player</dt><dd>${escapeHtml(officer.player)}</dd></div>` : ""}
          </div>
          <h4 style="margin-top:22px">Tags</h4>
          <div class="tags">
            <span>${escapeHtml(officer.rank || "Officer")}</span>
            <span>${escapeHtml(officer.unit || "PTD")}</span>
            <span>bodycam</span>
            <span>policetragedy</span>
          </div>
          <h4>More Like This</h4>
          ${others.map((o) => `
            <a class="side-card" href="#/officer/${encodeURIComponent(o.id)}">
              <span class="mini">${o.photo ? `<img src="${escapeHtml(assetUrl(o.photo))}" alt="">` : `<div>${escapeHtml(initials(o.name))}</div>`}</span>
              <span>${escapeHtml(releaseTitle(o))}</span>
            </a>
          `).join("")}
        </aside>
      </div>
    </section>
  `;

  ensureFisheyeFilter();
  const video = document.getElementById("bodycam-video");
  startAxonClock(cam, video);
  bindBodycamPlayer(video);
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

function bindBodycamPlayer(video) {
  if (!video) return;
  const playBtn = document.getElementById("bodycam-play");
  const toggleBtn = document.getElementById("bodycam-toggle");
  const seek = document.getElementById("bodycam-seek");
  const time = document.getElementById("bodycam-time");
  const bar = document.getElementById("bodycam-bar");
  const player = video.closest(".player");
  let seeking = false;

  const toggle = () => {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };

  const sync = () => {
    const paused = video.paused || video.ended;
    playBtn?.classList.toggle("is-hidden", !paused);
    if (toggleBtn) toggleBtn.textContent = paused ? "▶" : "❚❚";
    if (toggleBtn) toggleBtn.setAttribute("aria-label", paused ? "Play" : "Pause");
    if (time) {
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      time.textContent = `${formatClock(video.currentTime)} / ${formatClock(dur)}`;
    }
    if (seek && !seeking && Number.isFinite(video.duration) && video.duration > 0) {
      seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
    }
  };

  playBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggle();
  });
  toggleBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggle();
  });
  bar?.addEventListener("click", (event) => event.stopPropagation());
  player?.addEventListener("click", () => toggle());

  seek?.addEventListener("input", () => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    seeking = true;
    video.currentTime = (Number(seek.value) / 1000) * video.duration;
  });
  seek?.addEventListener("change", () => {
    seeking = false;
  });

  video.addEventListener("play", sync);
  video.addEventListener("pause", sync);
  video.addEventListener("ended", sync);
  video.addEventListener("timeupdate", sync);
  video.addEventListener("loadedmetadata", sync);
  sync();
}

function renderSubmit() {
  app.innerHTML = `
    <section class="wrap submit-page">
      <h1>How to submit a release</h1>
      <div class="feature-box">
        <p>Типы не заливают файлы сами. Пришлите администрации историю персонажа и демку — релиз появится в архиве бодикамер, как карточка офицера на этой странице.</p>
        <ol>
          <li>Имя, звание, жетон и позывной офицера.</li>
          <li>Историю персонажа — кем он был и что произошло.</li>
          <li>Демку раунда и запись бодикамеры (видеофайл или YouTube).</li>
          <li>Скриншот персонажа для превью релиза.</li>
        </ol>
        <p style="margin-top:14px"><a class="btn btn-green" href="#/">Back to archive</a></p>
      </div>
    </section>
  `;
}

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(String(hex).length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function hashPassword(password, saltHex) {
  const salt = saltHex ? hexToBuf(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  return `${bufToHex(salt)}:${bufToHex(bits)}`;
}

async function passwordMatches(password, stored) {
  const [saltHex, hashHex] = String(stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  const next = await hashPassword(password, saltHex);
  return next === `${saltHex}:${hashHex}`;
}

function publicUser(user) {
  return { id: user.id, nick: user.nick, email: user.email };
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validNick(nick) {
  return nick.length >= 2 && nick.length <= 24 && /^[\p{L}\p{N}_.-]+$/u.test(nick);
}

function readLocalUsers() {
  try {
    const data = JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || "{\"users\":[]}");
    return Array.isArray(data.users) ? data : { users: [] };
  } catch {
    return { users: [] };
  }
}

function writeLocalUsers(data) {
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify({ users: data.users || [] }));
}

async function loadPublishedUsers() {
  try {
    const res = await fetch("data/users.json", { cache: "no-store" });
    if (!res.ok) return { users: [] };
    const data = await res.json();
    return Array.isArray(data.users) ? data : { users: [] };
  } catch {
    return { users: [] };
  }
}

async function loadUserDb() {
  const published = await loadPublishedUsers();
  const local = readLocalUsers();
  const map = new Map();
  for (const user of [...published.users, ...local.users]) {
    if (user?.nick) map.set(String(user.nick).toLowerCase(), user);
  }
  return { users: [...map.values()] };
}

function setMe(user) {
  me = user ? publicUser(user) : null;
  if (me) localStorage.setItem(ME_KEY, JSON.stringify(me));
  else localStorage.removeItem(ME_KEY);
  paintAuth();
}

function paintAuth() {
  document.querySelectorAll("[data-auth]").forEach((el) => {
    el.hidden = (el.dataset.auth === "user") !== Boolean(me);
  });
  document.querySelectorAll("[data-auth='user']:not([data-logout])").forEach((el) => {
    if (el.tagName === "SPAN") el.textContent = me ? me.nick : "";
  });
}

async function loadMe() {
  try {
    const res = await fetch("api/me");
    const type = res.headers.get("content-type") || "";
    if (res.ok && type.includes("application/json")) {
      const data = await res.json();
      if (data.user) {
        setMe(data.user);
        return;
      }
    }
  } catch {
    /* static hosting */
  }
  try {
    const saved = JSON.parse(localStorage.getItem(ME_KEY) || "null");
    me = saved?.nick ? saved : null;
  } catch {
    me = null;
  }
  paintAuth();
}

function showFormError(id, message) {
  const errorEl = document.getElementById(id);
  if (!errorEl) return;
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

async function parseJsonResponse(res) {
  const type = res.headers.get("content-type") || "";
  if (!type.includes("application/json")) return null;
  return res.json().catch(() => null);
}

async function registerAccount(payload) {
  try {
    const res = await fetch("api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await parseJsonResponse(res);
    if (data) {
      if (!res.ok) throw new Error(data.error || "Не удалось зарегистрироваться");
      return data.user;
    }
  } catch (err) {
    if (err instanceof Error && err.message && !/failed to fetch|networkerror|load failed/i.test(err.message)) {
      throw err;
    }
  }

  const email = payload.email.trim().toLowerCase();
  const nick = payload.nick.trim();
  if (!validEmail(email)) throw new Error("Некорректная почта");
  if (!validNick(nick)) throw new Error("Ник: 2–24 символа, буквы, цифры, _ . -");
  if (payload.password.length < 4) throw new Error("Пароль слишком короткий");
  if (payload.password !== payload.password2) throw new Error("Пароли не совпадают");

  const db = await loadUserDb();
  if (db.users.some((u) => String(u.nick).toLowerCase() === nick.toLowerCase())) {
    throw new Error("такой ник существует");
  }
  if (db.users.some((u) => String(u.email).toLowerCase() === email)) {
    throw new Error("эта почта уже зарегистрирована");
  }

  const user = {
    id: bufToHex(crypto.getRandomValues(new Uint8Array(8))),
    email,
    nick,
    passwordHash: await hashPassword(payload.password),
    createdAt: new Date().toISOString(),
  };
  const local = readLocalUsers();
  local.users = local.users.filter((u) => String(u.nick).toLowerCase() !== nick.toLowerCase());
  local.users.push(user);
  writeLocalUsers(local);
  return publicUser(user);
}

async function loginAccount(login, password) {
  try {
    const res = await fetch("api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login, password }),
    });
    const data = await parseJsonResponse(res);
    if (data) {
      if (!res.ok) throw new Error(data.error || "Неверный ник или пароль");
      return data.user;
    }
  } catch (err) {
    if (err instanceof Error && err.message && !/failed to fetch|networkerror|load failed/i.test(err.message)) {
      throw err;
    }
  }

  const db = await loadUserDb();
  const key = String(login || "").trim().toLowerCase();
  const user = db.users.find(
    (u) => String(u.nick).toLowerCase() === key || String(u.email).toLowerCase() === key
  );
  if (!user || !(await passwordMatches(password, user.passwordHash))) {
    throw new Error("Неверный ник или пароль");
  }
  return publicUser(user);
}

function renderRegister() {
  if (me) {
    app.innerHTML = `
      <section class="wrap submit-page">
        <h1>Registration</h1>
        <div class="login-box auth-form">
          <p class="okmsg">Вы уже вошли как <strong>${escapeHtml(me.nick)}</strong>.</p>
          <p style="margin-top:14px"><a class="btn btn-green" href="#/">Back to archive</a></p>
        </div>
      </section>
    `;
    return;
  }

  app.innerHTML = `
    <section class="wrap submit-page">
      <h1>Registration</h1>
      <form class="login-box auth-form" id="register-form">
        <div class="flash" id="reg-error" hidden></div>
        <label>Email
          <input type="email" name="email" required autocomplete="email">
        </label>
        <label>Nickname
          <input type="text" name="nick" required autocomplete="username" maxlength="24">
        </label>
        <label>Password
          <input type="password" name="password" required autocomplete="new-password">
        </label>
        <label>Password again
          <input type="password" name="password2" required autocomplete="new-password">
        </label>
        <button type="submit">Register</button>
        <p class="byline" style="margin-top:14px"><a href="#/login">Log in</a></p>
      </form>
    </section>
  `;

  document.getElementById("register-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const payload = {
      email: String(form.get("email") || "").trim(),
      nick: String(form.get("nick") || "").trim(),
      password: String(form.get("password") || ""),
      password2: String(form.get("password2") || ""),
    };
    const submit = event.target.querySelector("[type=submit]");
    if (submit) submit.disabled = true;
    showFormError("reg-error", "");
    try {
      const user = await registerAccount(payload);
      setMe(user);
      app.innerHTML = `
        <section class="wrap submit-page">
          <h1>Registration</h1>
          <div class="login-box auth-form">
            <p class="okmsg">Аккаунт создан. Ник: <strong>${escapeHtml(user.nick)}</strong></p>
            <p style="margin-top:14px"><a class="btn btn-green" href="#/">Back to archive</a></p>
          </div>
        </section>
      `;
    } catch (err) {
      showFormError("reg-error", err.message || "Не удалось зарегистрироваться");
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

function renderLogin() {
  if (me) {
    location.hash = "#/";
    return;
  }
  app.innerHTML = `
    <section class="wrap submit-page">
      <h1>Log in</h1>
      <form class="login-box auth-form" id="login-form">
        <div class="flash" id="login-error" hidden></div>
        <label>Nickname or email
          <input type="text" name="login" required autocomplete="username">
        </label>
        <label>Password
          <input type="password" name="password" required autocomplete="current-password">
        </label>
        <button type="submit">Log in</button>
        <p class="byline" style="margin-top:14px"><a href="#/register">Registration</a></p>
      </form>
    </section>
  `;
  document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const submit = event.target.querySelector("[type=submit]");
    if (submit) submit.disabled = true;
    showFormError("login-error", "");
    try {
      const user = await loginAccount(String(form.get("login") || ""), String(form.get("password") || ""));
      setMe(user);
      location.hash = "#/";
    } catch (err) {
      showFormError("login-error", err.message || "Неверный ник или пароль");
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

document.getElementById("global-search")?.addEventListener("submit", (event) => {
  event.preventDefault();
  location.hash = "#/";
  renderHome(document.getElementById("global-q").value);
});

window.addEventListener("hashchange", route);

document.addEventListener("click", async (event) => {
  const link = event.target.closest("[data-logout]");
  if (!link) return;
  event.preventDefault();
  try {
    await fetch("api/logout", { method: "POST" });
  } catch {
    /* static hosting */
  }
  setMe(null);
  if (location.hash === "#/" || location.hash === "") route();
  else location.hash = "#/";
});

Promise.all([loadArchive(), loadMe()])
  .then(route)
  .catch(() => {
    paintAuth();
    app.innerHTML = `<section class="wrap empty">Archive unavailable. Run start.bat</section>`;
  });
