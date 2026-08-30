const GitHubArchive = (() => {
  const OWNER = "BobbiHenson";
  const REPO = "police-tragedy-archive";
  const PAGES = "gh-pages";
  const MAIN = "main";
  const TOKEN_KEY = "pt_gh_token";
  const MAX_BYTES = 40 * 1024 * 1024;

  function getToken() {
    return String(localStorage.getItem(TOKEN_KEY) || "").trim();
  }

  function setToken(token) {
    const value = String(token || "").trim();
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function hasToken() {
    return Boolean(getToken());
  }

  function tokenSetupUrl() {
    return "https://github.com/settings/tokens/new?scopes=public_repo&description=police-tragedy-archive";
  }

  function isNetworkError(err) {
    return /failed to fetch|networkerror|load failed|network request failed/i.test(String(err && err.message || ""));
  }

  async function api(path, options = {}) {
    const token = getToken();
    if (!token) throw new Error("Сначала сохрани GitHub token в админке.");
    const method = String(options.method || "GET").toUpperCase();
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (options.body) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch(`https://api.github.com${path}`, {
        cache: "no-store",
        ...options,
        headers,
      });
    } catch (err) {
      if (isNetworkError(err)) {
        throw new Error("GitHub не ответил. Обнови страницу (Ctrl+F5) и проверь token в админке.");
      }
      throw err;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("GitHub token не подходит. Создай новый с правом public_repo.");
    }
    if (res.status === 404 && method === "GET") return { missing: true, status: 404 };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || `GitHub ${res.status}`);
    }
    return data;
  }

  function utf8ToBase64(text) {
    return btoa(unescape(encodeURIComponent(text)));
  }

  function base64ToUtf8(b64) {
    return decodeURIComponent(escape(atob(String(b64 || "").replace(/\n/g, ""))));
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
      reader.readAsDataURL(file);
    });
  }

  function extOf(file, fallback) {
    const fromName = String(file?.name || "").split(".").pop();
    if (fromName && fromName !== file.name) return "." + fromName.toLowerCase();
    return fallback;
  }

  function mediaName(file, fallbackExt) {
    const hex = Math.random().toString(16).slice(2, 10);
    return `${Date.now()}-${hex}${extOf(file, fallbackExt)}`;
  }

  async function getContent(branch, path) {
    const data = await api(
      `/repos/${OWNER}/${REPO}/contents/${path}?ref=${encodeURIComponent(branch)}&ts=${Date.now()}`
    );
    if (data.missing) return { sha: "", text: "", exists: false };
    return {
      sha: data.sha || "",
      text: data.content ? base64ToUtf8(data.content) : "",
      exists: true,
    };
  }

  async function putContent(branch, path, contentBase64, message) {
    let lastError = new Error("Не удалось сохранить файл на GitHub");
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await getContent(branch, path);
      const body = { message, content: contentBase64, branch };
      if (current.exists && current.sha) body.sha = current.sha;
      try {
        return await api(`/repos/${OWNER}/${REPO}/contents/${path}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      } catch (err) {
        lastError = err;
        const msg = String(err.message || "");
        if (!/does not match|already exists|sha|409|422/i.test(msg) || attempt === 3) throw err;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  async function loadArchive() {
    const file = await getContent(PAGES, "data/officers.json");
    let data = { department: "Police Tragedy Department", officers: [] };
    if (file.exists && file.text) {
      try {
        data = JSON.parse(file.text);
      } catch {
        /* keep empty */
      }
    }
    if (!Array.isArray(data.officers)) data.officers = [];
    return { data, shaPages: file.sha, existsPages: file.exists };
  }

  async function saveArchive(data) {
    data.updatedAt = new Date().toISOString();
    const encoded = utf8ToBase64(JSON.stringify(data, null, 2));
    await putContent(PAGES, "data/officers.json", encoded, "Update archive");
    try {
      await putContent(MAIN, "public/data/officers.json", encoded, "Update archive");
    } catch (err) {
      console.warn("main officers.json", err);
    }
  }

  async function uploadMedia(file, folderExt, onStatus) {
    if (!(file instanceof File) || file.size === 0) return "";
    if (file.size > MAX_BYTES) {
      throw new Error(
        `Файл «${file.name}» больше 40 МБ. Для большого видео вставь YouTube-ссылку.`
      );
    }
    if (onStatus) onStatus(`Загружаю ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} МБ)…`);
    const name = mediaName(file, folderExt);
    const encoded = await fileToBase64(file);
    await putContent(PAGES, `media/${name}`, encoded, `Upload ${name}`);
    try {
      await putContent(MAIN, `public/media/${name}`, encoded, `Upload ${name}`);
    } catch (err) {
      console.warn("main media", err);
    }
    return "media/" + name;
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

  function val(form, key, fallback = "") {
    const value = form.get(key);
    return value == null || value === "" ? fallback : String(value);
  }

  async function saveOfficer(form, editingId, onStatus) {
    const name = val(form, "name").trim();
    if (!name) throw new Error("Укажите имя офицера");

    const photo = form.get("photo");
    const video = form.get("video");
    const demo = form.get("demo");

    const packed = await loadArchive();
    const existing = packed.data.officers.find((o) => o.id === editingId) || null;
    const photoUrl = await uploadMedia(photo, ".jpg", onStatus);
    const videoUrl = await uploadMedia(video, ".mp4", onStatus);
    const demoUrl = await uploadMedia(demo, ".dem", onStatus);

    const officer = {
      id: uniqueId(packed.data, name, existing?.id),
      name,
      rank: val(form, "rank", existing?.rank || "Officer"),
      badge: val(form, "badge", existing?.badge || ""),
      unit: val(form, "unit", existing?.unit || ""),
      callsign: val(form, "callsign", existing?.callsign || ""),
      status: val(form, "status", existing?.status || "archived"),
      photo: photoUrl || existing?.photo || "",
      storyTitle: val(form, "storyTitle", existing?.storyTitle || ""),
      story: val(form, "story", existing?.story || ""),
      player: val(form, "player", existing?.player || ""),
      bodycam: {
        title: val(form, "bodycamTitle", existing?.bodycam?.title || ""),
        date: val(form, "bodycamDate", existing?.bodycam?.date || ""),
        utcOffset: val(form, "utcOffset", existing?.bodycam?.utcOffset || "-0400"),
        serial: val(form, "serial", existing?.bodycam?.serial || ""),
        model: val(form, "camModel", existing?.bodycam?.model || "AXON BODY 3"),
        location: val(form, "bodycamLocation", existing?.bodycam?.location || ""),
        video: videoUrl || existing?.bodycam?.video || "",
        youtube: val(form, "youtube", existing?.bodycam?.youtube || ""),
        demo: demoUrl || existing?.bodycam?.demo || "",
        duration: val(form, "duration", existing?.bodycam?.duration || ""),
      },
    };

    if (onStatus) onStatus("Сохраняю дело в архив…");
    if (existing) {
      packed.data.officers = packed.data.officers.map((o) => (o.id === existing.id ? officer : o));
    } else {
      packed.data.officers.unshift(officer);
    }
    await saveArchive(packed.data, packed.shaPages);
    return officer;
  }

  async function deleteOfficer(id) {
    const packed = await loadArchive();
    packed.data.officers = packed.data.officers.filter((o) => o.id !== id);
    await saveArchive(packed.data, packed.shaPages);
  }

  function officerFromSubmission(archive, post) {
    const name = String(post.name || post.title || "Unknown").trim();
    return {
      id: uniqueId(archive, name),
      name,
      rank: String(post.rank || "Officer"),
      badge: String(post.badge || ""),
      unit: String(post.unit || ""),
      callsign: String(post.callsign || ""),
      status: "archived",
      photo: String(post.photo || ""),
      storyTitle: String(post.title || name),
      story: String(post.story || ""),
      player: String(post.authorNick || ""),
      bodycam: {
        title: String(post.title || name),
        date: String(post.date || ""),
        utcOffset: "-0400",
        serial: "",
        model: "AXON BODY 3",
        location: String(post.location || ""),
        video: "",
        youtube: String(post.youtube || ""),
        demo: "",
        duration: "",
      },
    };
  }

  function parseIssue(issue) {
    if (!issue || issue.pull_request) return null;
    if (!String(issue.title || "").startsWith("[PT]")) return null;
    const match = String(issue.body || "").match(/```json\s*([\s\S]*?)```/);
    let extra = {};
    if (match) {
      try {
        extra = JSON.parse(match[1]);
      } catch {
        extra = {};
      }
    }
    return {
      id: extra.id || `issue-${issue.number}`,
      issueNumber: issue.number,
      status: extra.status || "pending",
      createdAt: extra.createdAt || issue.created_at,
      authorNick: extra.authorNick || issue.user?.login || "",
      title: extra.title || String(issue.title).replace(/^\[PT\]\s*/, ""),
      name: extra.name || extra.title || "",
      rank: extra.rank || "Officer",
      badge: extra.badge || "",
      unit: extra.unit || "",
      callsign: extra.callsign || "",
      location: extra.location || "",
      youtube: extra.youtube || "",
      date: extra.date || "",
      story: extra.story || String(issue.body || "").replace(/```json[\s\S]*?```/, "").trim(),
    };
  }

  async function loadSubmissionsFile() {
    const file = await getContent(PAGES, "data/submissions.json");
    let data = { submissions: [] };
    if (file.exists && file.text) {
      try {
        data = JSON.parse(file.text);
      } catch {
        data = { submissions: [] };
      }
    }
    if (!Array.isArray(data.submissions)) data.submissions = [];
    return { data, shaPages: file.sha };
  }

  async function saveSubmissionsFile(data) {
    data.updatedAt = new Date().toISOString();
    const encoded = utf8ToBase64(JSON.stringify(data, null, 2));
    await putContent(PAGES, "data/submissions.json", encoded, "Update submit board");
    try {
      await putContent(MAIN, "public/data/submissions.json", encoded, "Update submit board");
    } catch (err) {
      console.warn("main submissions.json", err);
    }
  }

  async function listPosts() {
    const map = new Map();
    try {
      const res = await fetch("data/submissions.json", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        for (const post of data.submissions || []) {
          if (post?.id) map.set(post.id, post);
        }
      }
    } catch {
      /* static */
    }
    try {
      const res = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/issues?state=open&per_page=50&sort=created`
      );
      const issues = await res.json();
      if (Array.isArray(issues)) {
        for (const issue of issues) {
          const post = parseIssue(issue);
          if (post && !map.has(post.id)) map.set(post.id, post);
        }
      }
    } catch {
      /* rate limit */
    }
    return [...map.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  function openIssue(post) {
    const title = `[PT] ${post.title}`;
    const compact = { ...post, story: String(post.story || "").slice(0, 3500) };
    const body = `<!--pt-submit-->\n\`\`\`json\n${JSON.stringify(compact, null, 2)}\n\`\`\`\n\n${post.story || ""}`;
    const url = `https://github.com/${OWNER}/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener");
  }

  async function addPost(post) {
    if (!hasToken()) {
      openIssue(post);
      return { ...post, viaIssue: true };
    }
    const packed = await loadSubmissionsFile();
    packed.data.submissions.unshift(post);
    await saveSubmissionsFile(packed.data, packed.shaPages);
    return post;
  }

  async function rejectPost(id) {
    const packed = await loadSubmissionsFile();
    const post = packed.data.submissions.find((s) => s.id === id);
    if (post) {
      post.status = "rejected";
      post.rejectedAt = new Date().toISOString();
      await saveSubmissionsFile(packed.data, packed.shaPages);
      return post;
    }
    throw new Error("Заявка не найдена в файле. Отклони issue вручную, если заявка с GitHub.");
  }

  async function acceptPost(id) {
    const packed = await loadSubmissionsFile();
    let post = packed.data.submissions.find((s) => s.id === id);
    if (!post) {
      const all = await listPosts();
      post = all.find((s) => s.id === id);
      if (post) packed.data.submissions.unshift(post);
    }
    if (!post) throw new Error("Заявка не найдена");
    const archivePack = await loadArchive();
    const officer = officerFromSubmission(archivePack.data, post);
    archivePack.data.officers.unshift(officer);
    await saveArchive(archivePack.data, archivePack.shaPages);
    post.status = "accepted";
    post.acceptedAt = new Date().toISOString();
    post.officerId = officer.id;
    const exists = packed.data.submissions.some((s) => s.id === post.id);
    if (!exists) packed.data.submissions.unshift(post);
    await saveSubmissionsFile(packed.data, packed.shaPages);
    if (post.issueNumber) {
      try {
        await api(`/repos/${OWNER}/${REPO}/issues/${post.issueNumber}`, {
          method: "PATCH",
          body: JSON.stringify({ state: "closed" }),
        });
      } catch {
        /* ignore */
      }
    }
    return officer;
  }

  return {
    getToken,
    setToken,
    hasToken,
    tokenSetupUrl,
    saveOfficer,
    deleteOfficer,
    listPosts,
    addPost,
    acceptPost,
    rejectPost,
  };
})();
