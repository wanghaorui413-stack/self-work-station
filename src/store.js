// 和本地服务器之间的读写。所有用户数据都在本机 data/ 目录（见 docs/adr/0002）。

const SAVE_DELAY_MS = 400;
const LEGACY_DAY_KEY = /^daily-balance:(\d{4}-\d{2}-\d{2})$/;
const LEGACY_SETTINGS_KEY = "daily-balance:settings";

async function request(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

export function loadWorkbench() {
  return request("/api/workbench");
}

export async function loadDays(from, to) {
  const { days } = await request(`/api/days?from=${from}&to=${to}`);
  return days;
}

export function saveSettings(settings) {
  return request("/api/workbench/settings", { method: "PUT", body: JSON.stringify(settings) });
}

export function saveFocusAreas(focusAreas) {
  return request("/api/workbench/focus-areas", {
    method: "PUT",
    body: JSON.stringify({ focusAreas }),
  });
}

// 每日记录写得很频繁（输入小目标、计时），合并成一次请求再发。
const pendingDays = new Map();
let saveTimer = null;
let onSaveError = () => {};

export function setSaveErrorHandler(handler) {
  onSaveError = handler;
}

function flushDays({ keepalive = false } = {}) {
  clearTimeout(saveTimer);
  saveTimer = null;
  const entries = [...pendingDays];
  pendingDays.clear();
  return Promise.all(
    entries.map(([dateKey, record]) =>
      fetch(`/api/days/${dateKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
        keepalive,
      })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
        })
        .catch((error) => onSaveError(error)),
    ),
  );
}

export function saveDay(dateKey, record) {
  pendingDays.set(dateKey, JSON.parse(JSON.stringify(record)));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushDays, SAVE_DELAY_MS);
}

if (typeof window !== "undefined") {
  // 关窗口时把还没发出的记录发掉。
  window.addEventListener("pagehide", () => flushDays({ keepalive: true }));
}

// V3 及以前的记录存在浏览器 localStorage 里。第一次连上服务器时整体搬过去；
// 服务器记下“已迁移”，之后不再搬。localStorage 里的旧数据原样保留，当作备份。
export async function migrateFromBrowser() {
  const days = {};
  let settings = null;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      const match = key?.match(LEGACY_DAY_KEY);
      if (match) days[match[1]] = JSON.parse(localStorage.getItem(key));
    }
    settings = JSON.parse(localStorage.getItem(LEGACY_SETTINGS_KEY));
  } catch {
    // 读不到浏览器旧数据（隐私模式等）就当没有。
  }
  return request("/api/migrate", {
    method: "POST",
    body: JSON.stringify({ days, settings }),
  });
}
