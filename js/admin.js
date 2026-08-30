const root = document.getElementById("admin");
let officers = [];
let editingId = null;
const ADMIN_NICK = "bobbihenson";

function isSiteAdmin(user) {
  return String(user?.nick || "").toLowerCase() === ADMIN_NICK;
}

function readMe() {
  try {
    const saved = JSON.parse(localStorage.getItem("pt_me") || "null");
    return saved?.nick ? saved : null;
  } catch {
    return null;
  }
}

async function currentMe() {
  try {
    const res = await fetch("api/me", { cache: "no-store", signal: AbortSignal.timeout(2500) });
    const type = res.headers.get("content-type") || "";
    if (res.ok && type.includes("application/json")) {
      const data = await res.json();
      if (data.user) return data.user;
    }
  } catch {
    /* static hosting */
  }
  return readMe();
}

document.getElementById("logout").addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    await fetch("api/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
  try {
    await fetch("api/admin/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
  localStorage.removeItem("pt_me");
  location.href = "index.html";
});

function renderDenied() {
  root.innerHTML = `
    <h1>Нет доступа</h1>
    <div class="login-box">
      <p>Админка только для BobbiHenson.</p>
      <p style="margin-top:14px"><a class="btn btn-green" href="index.html">На главную</a></p>
    </div>
  `;
}

async function bootDesk() {
  officers = [];
  const urls = ["api/officers", "data/officers.json"];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.includes("json")) continue;
      const data = await res.json();
      if (data && Array.isArray(data.officers)) {
        officers = data.officers;
        break;
      }
    } catch {
      /* next */
    }
  }
  try {
    renderDesk();
  } catch (err) {
    root.innerHTML = `<h1>Админка</h1><div class="flash">${escapeHtml(err.message || "Ошибка")}</div>`;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toLocalInput(value) {
  if (!value) return "";
  const match = String(value).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || "00"}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function currentOfficer() {
  return officers.find((o) => o.id === editingId) || {};
}

function isStaticHost() {
  return /github\.io$/i.test(location.hostname);
}

function errorFromResponse(status, text) {
  const raw = String(text || "");
  if (status === 405 || /405 Not Allowed/i.test(raw)) {
    return "На GitHub загрузить нельзя. Запусти start.bat и открой http://localhost:3000/admin.html";
  }
  if (status === 401) return "Войди как BobbiHenson на локальном сервере.";
  try {
    const data = JSON.parse(raw);
    if (data.error) return data.error;
  } catch {
    /* html */
  }
  const plain = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return plain.slice(0, 220) || `Ошибка ${status}`;
}

function renderDesk(message = "", isError = false) {
  const o = currentOfficer();
  const cam = o.bodycam || {};
  const staticHost = isStaticHost();
  root.innerHTML = `
    <h1>${editingId ? "Править дело" : "Новое дело"}</h1>
    ${staticHost ? `<div class="flash">GitHub не принимает файлы. Запусти <strong>start.bat</strong> и открой <a href="http://localhost:3000/admin.html">http://localhost:3000/admin.html</a> — там «Выложить в архив» отправит дело на сайт.</div>` : ""}
    ${message ? `<div class="flash ${isError ? "" : "okmsg"}">${escapeHtml(message)}</div>` : ""}
    <form class="form-box" id="officer-form">
      <div class="row-2">
        <label>Имя офицера
          <input type="text" name="name" required value="${escapeHtml(o.name || "")}" placeholder="Михаил Волков">
        </label>
        <label>Звание
          <select name="rank">
            ${["Officer", "Sgt.", "Lt.", "Cpt.", "Cmdr.", "Chief"].map((rank) =>
              `<option ${rank === (o.rank || "Officer") ? "selected" : ""}>${rank}</option>`
            ).join("")}
          </select>
        </label>
      </div>
      <div class="row-3">
        <label>Жетон
          <input type="text" name="badge" value="${escapeHtml(o.badge || "")}" placeholder="147">
        </label>
        <label>Подразделение
          <input type="text" name="unit" value="${escapeHtml(o.unit || "")}" placeholder="Патруль">
        </label>
        <label>Позывной
          <input type="text" name="callsign" value="${escapeHtml(o.callsign || "")}" placeholder="1-Adam-12">
        </label>
      </div>
      <div class="row-2">
        <label>Статус
          <select name="status">
            ${[
              ["archived", "Архив"],
              ["active", "На смене"],
              ["resigned", "Снят"],
              ["unknown", "Неизвестно"],
            ].map(([value, label]) =>
              `<option value="${value}" ${value === (o.status || "archived") ? "selected" : ""}>${label}</option>`
            ).join("")}
          </select>
        </label>
        <label>Ник игрока (необязательно)
          <input type="text" name="player" value="${escapeHtml(o.player || "")}">
        </label>
      </div>
      <label>Фото на жетон
        <input type="file" name="photo" accept="image/*">
      </label>
      <label>Заголовок истории
        <input type="text" name="storyTitle" value="${escapeHtml(o.storyTitle || "")}" placeholder="Последняя смена">
      </label>
      <label>История персонажа
        <textarea name="story" placeholder="Кем он был и что с ним случилось...">${escapeHtml(o.story || "")}</textarea>
      </label>
      <div class="row-2">
        <label>Название записи бодикамеры
          <input type="text" name="bodycamTitle" value="${escapeHtml(cam.title || "")}">
        </label>
        <label>Дата и время на бодикамере
          <input type="datetime-local" name="bodycamDate" step="1" value="${escapeHtml(toLocalInput(cam.date))}">
        </label>
      </div>
      <div class="row-3">
        <label>Часовой пояс (AXON)
          <select name="utcOffset">
            ${["-0800","-0700","-0600","-0500","-0400","+0000","+0300","+0400"].map((off) =>
              `<option value="${off}" ${off === (cam.utcOffset || "-0400") ? "selected" : ""}>${off}</option>`
            ).join("")}
          </select>
        </label>
        <label>Серийник AXON
          <input type="text" name="serial" value="${escapeHtml(cam.serial || "")}" placeholder="X60A01873">
        </label>
        <label>Длительность
          <input type="text" name="duration" value="${escapeHtml(cam.duration || "")}" placeholder="04:12">
        </label>
      </div>
      <div class="row-2">
        <label>Место
          <input type="text" name="bodycamLocation" value="${escapeHtml(cam.location || "")}">
        </label>
        <label>Модель камеры
          <input type="text" name="camModel" value="${escapeHtml(cam.model || "AXON BODY 3")}" placeholder="AXON BODY 3">
        </label>
      </div>
      <label>Видео бодикамеры (mp4, webm, mov)
        ${cam.video ? `<div class="byline" style="margin-bottom:6px">Сейчас: ${escapeHtml(cam.video)} — выбери новый файл, чтобы заменить</div>` : ""}
        <input type="file" name="video" accept=".mp4,.m4v,.webm,.mov,.mkv,video/mp4,video/webm,video/quicktime">
      </label>
      <label>Или ссылка на YouTube
        <input type="text" name="youtube" value="${escapeHtml(cam.youtube || "")}" placeholder="https://youtu.be/...">
      </label>
      <label>Файл демки (.dem)
        ${cam.demo ? `<div class="byline" style="margin-bottom:6px">Сейчас: ${escapeHtml(cam.demo)}</div>` : ""}
        <input type="file" name="demo" accept=".dem,application/octet-stream">
      </label>
      <p id="save-status" class="byline" style="min-height:18px"></p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="submit" ${staticHost ? "disabled" : ""}>${editingId ? "Сохранить изменения" : "Выложить в архив"}</button>
        ${editingId ? `<button type="button" id="cancel-edit">Новое дело</button>` : ""}
      </div>
    </form>

    <h1 style="margin-top:36px;font-size:40px">Уже в архиве</h1>
    <div class="admin-list">
      ${officers.map((item) => `
        <div class="admin-row">
          <div>${escapeHtml(item.rank)} ${escapeHtml(item.name)} · #${escapeHtml(item.badge || "—")}</div>
          <button type="button" data-edit="${escapeHtml(item.id)}">Править</button>
          <button type="button" class="danger" data-del="${escapeHtml(item.id)}">Удалить</button>
        </div>
      `).join("") || `<div class="empty">Пока пусто</div>`}
    </div>
  `;

  document.getElementById("officer-form").addEventListener("submit", saveOfficer);
  document.getElementById("cancel-edit")?.addEventListener("click", () => {
    editingId = null;
    renderDesk();
  });
  root.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingId = btn.getAttribute("data-edit");
      renderDesk();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
  root.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => deleteOfficer(btn.getAttribute("data-del")));
  });
}

async function saveOfficer(event) {
  event.preventDefault();
  if (isStaticHost()) {
    renderDesk("На GitHub загрузить нельзя. Запусти start.bat и открой http://localhost:3000/admin.html", true);
    return;
  }
  const formEl = event.target;
  const form = new FormData(formEl);
  for (const key of ["photo", "video", "demo"]) {
    const file = form.get(key);
    if (!(file instanceof File) || file.size === 0) form.delete(key);
  }

  const video = form.get("video");
  const status = document.getElementById("save-status");
  const submit = formEl.querySelector("[type=submit]");
  if (submit) submit.disabled = true;
  if (status) {
    status.className = "byline";
    if (video instanceof File) {
      status.textContent = `Загружаю ${video.name} (${(video.size / 1024 / 1024).toFixed(1)} МБ)…`;
    } else {
      status.textContent = "Сохраняю дело и выкладываю на GitHub…";
    }
  }

  const url = editingId ? `api/admin/officers/${editingId}` : "api/admin/officers";
  const method = editingId ? "PUT" : "POST";

  try {
    const data = await uploadForm(url, method, form, (percent) => {
      if (status && video instanceof File) {
        status.textContent = `Загрузка видео: ${percent}%`;
      }
    });
    editingId = null;
    await bootDesk();
    let msg = data && data.name ? `Готово: ${data.name} сохранён.` : "Дело сохранено в архив.";
    if (data && data.published) msg += " Выложено на GitHub.";
    else if (data && data.publishError) msg += " На сайт не ушло: " + data.publishError;
    renderDesk(msg);
  } catch (err) {
    if (submit) submit.disabled = false;
    if (status) {
      status.className = "flash";
      status.textContent = err.message || "Не удалось загрузить видео";
    } else {
      renderDesk(err.message || "Не сохранилось", true);
    }
  }
}

function uploadForm(url, method, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.timeout = 0;
    xhr.responseType = "text";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === "function") {
        onProgress(Math.max(1, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        data = { error: xhr.responseText || "Сервер вернул не JSON" };
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(errorFromResponse(xhr.status, xhr.responseText)));
    };
    xhr.onerror = () => reject(new Error("Сеть оборвалась во время загрузки. Попробуй ещё раз."));
    xhr.ontimeout = () => reject(new Error("Слишком долгая загрузка. Попробуй файл поменьше или ещё раз."));
    xhr.send(form);
  });
}

async function deleteOfficer(id) {
  if (!confirm("Снять это дело с сайта?")) return;
  const res = await fetch(`api/admin/officers/${id}`, { method: "DELETE" });
  if (!res.ok) return renderDesk("Не удалось удалить", true);
  if (editingId === id) editingId = null;
  await bootDesk();
  renderDesk("Дело удалено.");
}

function startAdmin() {
  try {
    if (isSiteAdmin(readMe())) {
      bootDesk().catch(() => renderDesk());
      return;
    }
    currentMe()
      .then((user) => {
        if (isSiteAdmin(user) || isSiteAdmin(readMe())) return bootDesk();
        renderDenied();
      })
      .catch(() => {
        if (isSiteAdmin(readMe())) return bootDesk();
        renderDenied();
      });
  } catch (err) {
    root.innerHTML = `<h1>Админка</h1><div class="flash">${escapeHtml(err.message || "Ошибка")}</div>`;
  }
}

startAdmin();
