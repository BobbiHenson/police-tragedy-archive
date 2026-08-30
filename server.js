const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const MEDIA = path.join(PUBLIC, "media");
const DATA_FILE = path.join(PUBLIC, "data", "officers.json");
const USERS_FILE = path.join(PUBLIC, "data", "users.json");
const SECRET_FILE = path.join(ROOT, "data", "secret.txt");
const CONFIG_FILE = path.join(ROOT, "config.json");

const DEFAULT_CONFIG = { port: 3000, adminPassword: "tragedy" };

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

const config = { ...DEFAULT_CONFIG, ...readJson(CONFIG_FILE, {}) };
fs.mkdirSync(MEDIA, { recursive: true });
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });

function getSecret() {
  if (fs.existsSync(SECRET_FILE)) {
    return fs.readFileSync(SECRET_FILE, "utf8").trim();
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(SECRET_FILE, secret, "utf8");
  return secret;
}

const SECRET = getSecret();

function signToken() {
  const day = Math.floor(Date.now() / 86400000);
  return crypto.createHmac("sha256", SECRET).update("pt-admin-" + day).digest("hex");
}

function isAdmin(req) {
  const user = currentUser(req);
  return Boolean(user && String(user.nick).toLowerCase() === "bobbihenson");
}

function loadUsers() {
  const data = readJson(USERS_FILE, { users: [] });
  if (!Array.isArray(data.users)) data.users = [];
  return data;
}

function saveUsers(data) {
  writeJson(USERS_FILE, data);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 32, "sha256");
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function checkPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.pbkdf2Sync(String(password), salt, 100000, expected.length, "sha256");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function publicUser(user) {
  return { id: user.id, nick: user.nick, email: user.email };
}

function signUserToken(userId) {
  return crypto.createHmac("sha256", SECRET).update("pt-user-" + userId).digest("hex");
}

function currentUser(req) {
  const cookie = parseCookies(req.headers.cookie || "");
  const id = cookie.pt_uid;
  const token = cookie.pt_user;
  if (!id || !token || token !== signUserToken(id)) return null;
  return loadUsers().users.find((u) => u.id === id) || null;
}

function setUserCookies(res, userId) {
  const maxAge = 60 * 60 * 24 * 30;
  const token = signUserToken(userId);
  res.append("Set-Cookie", `pt_uid=${encodeURIComponent(userId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
  res.append("Set-Cookie", `pt_user=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}

function clearUserCookies(res) {
  res.append("Set-Cookie", "pt_uid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.append("Set-Cookie", "pt_user=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validNick(nick) {
  return nick.length >= 2 && nick.length <= 24 && /^[\p{L}\p{N}_.-]+$/u.test(nick);
}

function parseCookies(header) {
  const out = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function loadArchive() {
  const data = readJson(DATA_FILE, { department: "Police Tragedy Department", officers: [] });
  if (!Array.isArray(data.officers)) data.officers = [];
  return data;
}

function saveArchive(data) {
  data.updatedAt = new Date().toISOString();
  writeJson(DATA_FILE, data);
}

function gitEnv() {
  const extra = "C:\\Program Files\\Git\\bin;C:\\Program Files\\GitHub CLI;";
  return { ...process.env, PATH: extra + (process.env.PATH || process.env.Path || "") };
}

function runGit(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: ROOT, env: gitEnv(), windowsHide: true });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(out.trim() || `git ${args.join(" ")} → ${code}`));
    });
  });
}

async function publishArchive() {
  await runGit(["add", "public/data", "public/media"]);
  const porcelain = await runGit(["status", "--porcelain", "--", "public/data", "public/media"]);
  if (porcelain) {
    await runGit(["commit", "-m", "Publish archive release"]);
    await runGit(["push", "origin", "main"]);
  }
  try {
    await runGit(["branch", "-D", "gh-pages"]);
  } catch {
    /* branch may not exist locally */
  }
  await runGit(["subtree", "split", "--prefix=public", "-b", "gh-pages"]);
  await runGit(["push", "origin", "gh-pages", "--force"]);
}

async function saveAndPublish(res, archive, officer) {
  saveArchive(archive);
  const payload = { ...publicOfficer(officer), published: false, publishError: "" };
  try {
    await publishArchive();
    payload.published = true;
  } catch (err) {
    console.error("GitHub publish:", err);
    payload.publishError = err.message || "Не удалось отправить на GitHub";
  }
  res.json(payload);
}

function slugify(name) {
  const map = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return String(name || "")
    .toLowerCase()
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "officer";
}

function uniqueId(archive, name, currentId) {
  const base = slugify(name);
  if (currentId && archive.officers.some((o) => o.id === currentId)) return currentId;
  let id = base;
  let n = 2;
  while (archive.officers.some((o) => o.id === id)) {
    id = `${base}-${n++}`;
  }
  return id;
}

function publicOfficer(officer) {
  return {
    id: officer.id,
    name: officer.name,
    rank: officer.rank,
    badge: officer.badge,
    unit: officer.unit,
    callsign: officer.callsign,
    status: officer.status,
    photo: officer.photo || "",
    storyTitle: officer.storyTitle || "",
    story: officer.story || "",
    player: officer.player || "",
    bodycam: {
      title: officer.bodycam?.title || "",
      date: officer.bodycam?.date || "",
      utcOffset: officer.bodycam?.utcOffset || "-0400",
      serial: officer.bodycam?.serial || "",
      model: officer.bodycam?.model || "AXON BODY 3",
      location: officer.bodycam?.location || "",
      video: officer.bodycam?.video || "",
      youtube: officer.bodycam?.youtube || "",
      demo: officer.bodycam?.demo || "",
      duration: officer.bodycam?.duration || "",
    },
  };
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(401).json({ error: "Админка только для BobbiHenson" });
  }
  next();
}

const ALLOWED_EXT = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif",
  ".mp4", ".m4v", ".webm", ".mov", ".mkv", ".avi", ".mpeg", ".mpg",
  ".dem",
]);

function extFromFile(file) {
  let ext = path.extname(file.originalname || "").toLowerCase();
  if (ext === ".jpeg") ext = ".jpg";
  if (ext) return ext;
  const mime = String(file.mimetype || "").toLowerCase();
  if (mime.includes("mp4") || mime === "video/mpeg") return ".mp4";
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("quicktime")) return ".mov";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.startsWith("image/")) return ".jpg";
  return "";
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(MEDIA, { recursive: true });
    cb(null, MEDIA);
  },
  filename: (_req, file, cb) => {
    const ext = extFromFile(file) || ".mp4";
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`);
  },
});

const upload = multer({
  storage,
  defParamCharset: "utf8",
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname && !(file.mimetype || "").startsWith("video/") && !(file.mimetype || "").startsWith("image/")) {
      return cb(null, false);
    }
    const ext = extFromFile(file);
    const mime = String(file.mimetype || "").toLowerCase();
    const ok =
      ALLOWED_EXT.has(ext) ||
      mime.startsWith("video/") ||
      mime.startsWith("image/") ||
      mime === "application/octet-stream";
    if (!ok) {
      return cb(new Error("Этот тип файла не принимается. Нужен mp4, webm, mov или картинка."));
    }
    cb(null, true);
  },
});

const uploadFields = upload.fields([
  { name: "photo", maxCount: 1 },
  { name: "video", maxCount: 1 },
  { name: "demo", maxCount: 1 },
]);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use("/media", express.static(MEDIA, {
  acceptRanges: true,
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".mp4" || ext === ".m4v") res.setHeader("Content-Type", "video/mp4");
    if (ext === ".webm") res.setHeader("Content-Type", "video/webm");
    if (ext === ".mov") res.setHeader("Content-Type", "video/quicktime");
    if (ext === ".mkv") res.setHeader("Content-Type", "video/x-matroska");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=31536000");
  },
}));

app.get("/api/officers", (_req, res) => {
  const archive = loadArchive();
  res.json({
    department: archive.department,
    updatedAt: archive.updatedAt,
    officers: archive.officers.map(publicOfficer),
  });
});

app.get("/api/officers/:id", (req, res) => {
  const archive = loadArchive();
  const officer = archive.officers.find((o) => o.id === req.params.id);
  if (!officer) return res.status(404).json({ error: "Офицер не найден" });
  res.json(publicOfficer(officer));
});

app.get("/api/me", (req, res) => {
  const user = currentUser(req);
  res.json({ user: user ? publicUser(user) : null });
});

app.post("/api/register", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const nick = String(req.body?.nick || "").trim();
  const password = String(req.body?.password || "");
  const password2 = String(req.body?.password2 || "");

  if (!email || !nick || !password || !password2) {
    return res.status(400).json({ error: "Заполни все поля" });
  }
  if (!validEmail(email)) {
    return res.status(400).json({ error: "Некорректная почта" });
  }
  if (!validNick(nick)) {
    return res.status(400).json({ error: "Ник: 2–24 символа, буквы, цифры, _ . -" });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: "Пароль слишком короткий" });
  }
  if (password !== password2) {
    return res.status(400).json({ error: "Пароли не совпадают" });
  }

  const data = loadUsers();
  if (data.users.some((u) => String(u.nick).toLowerCase() === nick.toLowerCase())) {
    return res.status(409).json({ error: "такой ник существует" });
  }
  if (data.users.some((u) => String(u.email).toLowerCase() === email)) {
    return res.status(409).json({ error: "эта почта уже зарегистрирована" });
  }

  const user = {
    id: crypto.randomBytes(8).toString("hex"),
    email,
    nick,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  data.users.push(user);
  saveUsers(data);
  setUserCookies(res, user.id);
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/login", (req, res) => {
  const login = String(req.body?.login || req.body?.nick || req.body?.email || "").trim();
  const password = String(req.body?.password || "");
  const data = loadUsers();
  const user = data.users.find(
    (u) =>
      String(u.nick).toLowerCase() === login.toLowerCase() ||
      String(u.email).toLowerCase() === login.toLowerCase()
  );
  if (!user || !checkPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Неверный ник или пароль" });
  }
  setUserCookies(res, user.id);
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/logout", (_req, res) => {
  clearUserCookies(res);
  res.json({ ok: true });
});

app.get("/api/admin/session", (req, res) => {
  res.json({ ok: isAdmin(req) });
});

app.post("/api/admin/login", (_req, res) => {
  if (!isAdmin(_req)) {
    return res.status(401).json({ error: "Админка только для BobbiHenson" });
  }
  res.json({ ok: true });
});

app.post("/api/admin/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "pt_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.post(
  "/api/admin/officers",
  requireAdmin,
  uploadFields,
  async (req, res) => {
    try {
      const archive = loadArchive();
      const officer = buildOfficer(req, archive, null);
      archive.officers.unshift(officer);
      await saveAndPublish(res, archive, officer);
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message || "Не удалось сохранить" });
    }
  }
);

app.put(
  "/api/admin/officers/:id",
  requireAdmin,
  uploadFields,
  async (req, res) => {
    try {
      const archive = loadArchive();
      const index = archive.officers.findIndex((o) => o.id === req.params.id);
      if (index === -1) return res.status(404).json({ error: "Офицер не найден" });
      const officer = buildOfficer(req, archive, archive.officers[index]);
      archive.officers[index] = officer;
      await saveAndPublish(res, archive, officer);
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message || "Не удалось сохранить" });
    }
  }
);

app.delete("/api/admin/officers/:id", requireAdmin, (req, res) => {
  const archive = loadArchive();
  const before = archive.officers.length;
  archive.officers = archive.officers.filter((o) => o.id !== req.params.id);
  if (archive.officers.length === before) {
    return res.status(404).json({ error: "Офицер не найден" });
  }
  saveArchive(archive);
  res.json({ ok: true });
});

function mediaUrl(file) {
  return file ? "media/" + file.filename : "";
}

function field(req, key, fallback = "") {
  const value = req.body?.[key];
  return value == null ? fallback : String(value);
}

function buildOfficer(req, archive, existing) {
  const name = field(req, "name", existing?.name);
  if (!name.trim()) throw new Error("Укажите имя офицера");

  const files = req.files || {};
  const photoFile = files.photo?.[0];
  const videoFile = files.video?.[0];
  const demoFile = files.demo?.[0];
  if (videoFile) {
    console.log("Video uploaded:", videoFile.originalname, videoFile.mimetype, videoFile.size, videoFile.filename);
  }

  return {
    id: uniqueId(archive, name, existing?.id),
    name: name.trim(),
    rank: field(req, "rank", existing?.rank || "Officer"),
    badge: field(req, "badge", existing?.badge || ""),
    unit: field(req, "unit", existing?.unit || ""),
    callsign: field(req, "callsign", existing?.callsign || ""),
    status: field(req, "status", existing?.status || "archived"),
    photo: mediaUrl(photoFile) || existing?.photo || "",
    storyTitle: field(req, "storyTitle", existing?.storyTitle || ""),
    story: field(req, "story", existing?.story || ""),
    player: field(req, "player", existing?.player || ""),
    bodycam: {
      title: field(req, "bodycamTitle", existing?.bodycam?.title || ""),
      date: field(req, "bodycamDate", existing?.bodycam?.date || ""),
      utcOffset: field(req, "utcOffset", existing?.bodycam?.utcOffset || "-0400"),
      serial: field(req, "serial", existing?.bodycam?.serial || ""),
      model: field(req, "camModel", existing?.bodycam?.model || "AXON BODY 3"),
      location: field(req, "bodycamLocation", existing?.bodycam?.location || ""),
      video: mediaUrl(videoFile) || existing?.bodycam?.video || "",
      youtube: field(req, "youtube", existing?.bodycam?.youtube || ""),
      demo: mediaUrl(demoFile) || existing?.bodycam?.demo || "",
      duration: field(req, "duration", existing?.bodycam?.duration || ""),
    },
  };
}

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(PUBLIC, "admin.html"));
});

app.use(express.static(PUBLIC));

app.use((err, _req, res, _next) => {
  console.error("Upload error:", err);
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "Файл слишком большой. Максимум 4 ГБ." });
  }
  if (err.code === "LIMIT_UNEXPECTED_FILE") {
    return res.status(400).json({ error: "Не удалось принять файл. Выбери mp4 в поле «Видео бодикамеры»." });
  }
  res.status(400).json({ error: err.message || "Ошибка загрузки" });
});

const PORT = Number(process.env.PORT || config.port || 3000);

function openBrowser(url) {
  if (process.env.NO_BROWSER) return;
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Police Tragedy → ${url}`);
  console.log(`Админка → ${url}/admin`);
  openBrowser(url);
});

server.timeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;
server.keepAliveTimeout = 0;
