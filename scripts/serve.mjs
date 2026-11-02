import { createServer } from "node:http";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_FOCUS_AREAS, normalizeFocusAreas } from "../src/focus-areas.js";

// 以项目根目录为准，而不是启动时的工作目录，方便开机自启脚本从任意位置拉起。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = process.env.WORKBENCH_DATA_DIR || path.join(root, "data");
const itemsFile = path.join(dataDir, "items.json");
// 设置和投入方向；每日记录按天一个文件。见 docs/adr/0002。
const workbenchFile = path.join(dataDir, "workbench.json");
const daysDir = path.join(dataDir, "days");
const port = Number(process.env.PORT || 8000);

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HISTORY_DAYS = 366;

const DEFAULT_SETTINGS = {
  totalMinutes: "360",
  startTime: "09:00",
  dayEnd: "21:30",
  breakMinutes: "10",
  longBreakMinutes: "45",
};

// 网页只允许改这些字段；邮件里提取出的其余字段由定时任务维护。
const USER_EDITABLE_FIELDS = [
  "status",
  "kind",
  "company",
  "title",
  "start",
  "durationMinutes",
  "mode",
  "travelMinutes",
  "windowStart",
  "deadline",
  "estimatedMinutes",
  "manualSlot",
  "completedAt",
  "userNote",
  "link",
  "location",
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function emptyData() {
  return { version: 1, updatedAt: null, lastSyncedAt: null, processedMessageIds: [], items: [] };
}

export async function readItems(file = itemsFile) {
  try {
    const raw = await readFile(file, "utf8");
    return { ...emptyData(), ...JSON.parse(raw.replace(/^﻿/, "")) };
  } catch (error) {
    if (error.code === "ENOENT") return emptyData();
    throw error;
  }
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

async function readJson(file) {
  try {
    return JSON.parse((await readFile(file, "utf8")).replace(/^﻿/, ""));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// 串行化写入，避免两次点击同时读改写互相覆盖。所有数据文件共用一个队列。
let writeQueue = Promise.resolve();
function serialized(task) {
  const run = writeQueue.then(task);
  writeQueue = run.catch(() => {});
  return run;
}

export function patchItem(id, patch, file = itemsFile) {
  return serialized(async () => {
    const data = await readItems(file);
    const item = data.items.find((entry) => entry.id === id);
    if (!item) return null;
    for (const field of USER_EDITABLE_FIELDS) {
      if (Object.hasOwn(patch, field)) item[field] = patch[field];
    }
    const now = new Date().toISOString();
    item.userUpdatedAt = now;
    item.updatedAt = now;
    data.updatedAt = now;
    await writeJson(file, data);
    return item;
  });
}

// ---------- 设置、投入方向、每日记录 ----------

function defaultWorkbench() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    focusAreas: DEFAULT_FOCUS_AREAS.map((area) => ({ ...area })),
    migratedFromBrowserAt: null,
    updatedAt: null,
  };
}

export async function readWorkbench() {
  const saved = await readJson(workbenchFile);
  if (!saved) return defaultWorkbench();
  const base = defaultWorkbench();
  return {
    ...base,
    ...saved,
    settings: { ...base.settings, ...saved.settings },
    focusAreas: saved.focusAreas?.length ? saved.focusAreas : base.focusAreas,
  };
}

function normalizeSettings(input) {
  const settings = { ...DEFAULT_SETTINGS };
  const time = /^\d{2}:\d{2}$/;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const value = String(input?.[key] ?? DEFAULT_SETTINGS[key]);
    const valid = key === "startTime" || key === "dayEnd" ? time.test(value) : /^\d{1,4}$/.test(value);
    if (!valid) throw new Error(`设置项 ${key} 不合法`);
    settings[key] = value;
  }
  return settings;
}

function updateWorkbench(change) {
  return serialized(async () => {
    const workbench = await readWorkbench();
    change(workbench);
    workbench.updatedAt = new Date().toISOString();
    await writeJson(workbenchFile, workbench);
    return workbench;
  });
}

function dayFile(dateKey) {
  return path.join(daysDir, `${dateKey}.json`);
}

function normalizeDay(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("每日记录必须是对象");
  }
  return {
    plan: Array.isArray(input.plan) ? input.plan : null,
    tasks: input.tasks && typeof input.tasks === "object" ? input.tasks : {},
    reflection: typeof input.reflection === "string" ? input.reflection.slice(0, 5000) : "",
    crowdedOut: Array.isArray(input.crowdedOut) ? input.crowdedOut : [],
    ...(typeof input.busySignature === "string" ? { busySignature: input.busySignature } : {}),
  };
}

function* dateRange(from, to) {
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let count = 0; cursor <= end && count < MAX_HISTORY_DAYS; count += 1) {
    yield cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

export async function readDays(from, to) {
  const days = {};
  for (const key of dateRange(from, to)) {
    const record = await readJson(dayFile(key));
    if (record) days[key] = record;
  }
  return days;
}

function writeDay(dateKey, record) {
  return serialized(() => writeJson(dayFile(dateKey), normalizeDay(record)));
}

// 一次性把浏览器 localStorage 里的旧记录搬进 data/。已有的文件不覆盖，搬过一次就不再搬。
// localStorage 按网址隔离（127.0.0.1 和 localhost 各一份），所以只有真的带来了记录才算迁移完成，
// 免得先从一个空的网址打开，把有数据的那份永远挡在外面。
export function migrateFromBrowser({ days = {}, settings } = {}) {
  return serialized(async () => {
    const workbench = await readWorkbench();
    if (workbench.migratedFromBrowserAt) return { migrated: 0, skipped: true };
    if (!Object.keys(days).length) return { migrated: 0, skipped: false };
    let migrated = 0;
    for (const [key, record] of Object.entries(days)) {
      if (!DATE_KEY_PATTERN.test(key)) continue;
      if (await readJson(dayFile(key))) continue;
      await writeJson(dayFile(key), normalizeDay(record));
      migrated += 1;
    }
    if (settings) {
      try {
        workbench.settings = normalizeSettings({ ...workbench.settings, ...settings });
      } catch {
        // 旧设置不合法就用默认值，不影响记录迁移。
      }
    }
    workbench.migratedFromBrowserAt = new Date().toISOString();
    workbench.updatedAt = workbench.migratedFromBrowserAt;
    await writeJson(workbenchFile, workbench);
    return { migrated, skipped: false };
  });
}

function resolveStaticPath(url) {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const normalized = path.normalize(pathname).replace(/^([/\\])+/, "");
  const filePath = path.join(root, normalized || "index.html");
  const insideRoot = filePath === root || filePath.startsWith(`${root}${path.sep}`);
  // 数据目录不当静态文件暴露，只能走 /api。项目下的 data/ 也拦住，即使数据目录被改到别处。
  const insideData = [dataDir, path.join(root, "data")].some(
    (dir) => filePath === dir || filePath.startsWith(`${dir}${path.sep}`),
  );
  return insideRoot && !insideData ? filePath : null;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

class BadRequest extends Error {}

// 把校验函数抛出的错误标成 400。
function validated(check) {
  try {
    return check();
  } catch (error) {
    throw new BadRequest(error.message);
  }
}

async function readBody(request, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new BadRequest("请求体过大");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new BadRequest("请求体不是合法的 JSON");
  }
}

// 只接受本机页面发起的修改。
function isAllowedOrigin(request) {
  const origin = request.headers.origin;
  return !origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

async function handleApi(request, response, pathname, searchParams) {
  if (request.method !== "GET" && !isAllowedOrigin(request)) {
    sendJson(response, 403, { error: "forbidden origin" });
    return;
  }

  if (pathname === "/api/items" && request.method === "GET") {
    sendJson(response, 200, await readItems());
    return;
  }

  if (pathname === "/api/workbench" && request.method === "GET") {
    sendJson(response, 200, await readWorkbench());
    return;
  }

  if (pathname === "/api/workbench/settings" && request.method === "PUT") {
    const body = await readBody(request);
    const settings = validated(() => normalizeSettings(body));
    const workbench = await updateWorkbench((data) => {
      data.settings = settings;
    });
    sendJson(response, 200, workbench);
    return;
  }

  if (pathname === "/api/workbench/focus-areas" && request.method === "PUT") {
    const body = await readBody(request);
    const workbench = await updateWorkbench((data) => {
      data.focusAreas = validated(() => normalizeFocusAreas(body.focusAreas, data.focusAreas));
    });
    sendJson(response, 200, workbench);
    return;
  }

  if (pathname === "/api/migrate" && request.method === "POST") {
    sendJson(response, 200, await migrateFromBrowser(await readBody(request, 4 * 1024 * 1024)));
    return;
  }

  if (pathname === "/api/days" && request.method === "GET") {
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!DATE_KEY_PATTERN.test(from || "") || !DATE_KEY_PATTERN.test(to || "")) {
      throw new BadRequest("from 和 to 必须是 YYYY-MM-DD");
    }
    sendJson(response, 200, { days: await readDays(from, to) });
    return;
  }

  const dayMatch = pathname.match(/^\/api\/days\/(\d{4}-\d{2}-\d{2})$/);
  if (dayMatch && request.method === "PUT") {
    const body = await readBody(request);
    await writeDay(dayMatch[1], validated(() => normalizeDay(body)));
    sendJson(response, 200, { ok: true });
    return;
  }

  const match = pathname.match(/^\/api\/items\/([^/]+)$/);
  if (match && request.method === "PATCH") {
    const item = await patchItem(decodeURIComponent(match[1]), await readBody(request));
    if (!item) {
      sendJson(response, 404, { error: "item not found" });
      return;
    }
    sendJson(response, 200, item);
    return;
  }

  sendJson(response, 404, { error: "not found" });
}

export function createWorkbenchServer() {
  return createServer(async (request, response) => {
    const { pathname, searchParams } = new URL(request.url || "/", "http://localhost");
    try {
      if (pathname.startsWith("/api/")) {
        await handleApi(request, response, pathname, searchParams);
        return;
      }

      const filePath = resolveStaticPath(request.url || "/");
      if (!filePath) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      const content = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      response.end(content);
    } catch (error) {
      if (pathname.startsWith("/api/")) {
        // 校验失败（包括投入方向不合法）返回 400，页面会把原因显示给用户。
        sendJson(response, error instanceof BadRequest ? 400 : 500, { error: error.message });
      } else {
        response.writeHead(404);
        response.end("Not found");
      }
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  createWorkbenchServer().listen(port, "127.0.0.1", () => {
    console.log(`Self Work Station running at http://localhost:${port}`);
    console.log(`数据目录：${dataDir}`);
  });
}
