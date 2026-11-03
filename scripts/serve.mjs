import { createServer } from "node:http";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_FOCUS_AREAS, normalizeFocusAreas } from "../src/focus-areas.js";
import { normalizeTodos } from "../src/todos.js";
import {
  MODEL,
  ExtractUnavailable,
  createClient,
  extractFromEmail,
  loadApiKey,
  normalizeEmail,
  normalizeExtractedItem,
} from "./extract.mjs";

// 以项目根目录为准，而不是启动时的工作目录，方便开机自启脚本从任意位置拉起。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = process.env.WORKBENCH_DATA_DIR || path.join(root, "data");
const itemsFile = path.join(dataDir, "items.json");
// 设置和投入方向；每日记录按天一个文件。见 docs/adr/0002。
const workbenchFile = path.join(dataDir, "workbench.json");
const todosFile = path.join(dataDir, "todos.json");
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
  "type",
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
  "prepMinutes",
  "bufferMinutes",
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

// 用户自己建的（手动、粘贴解析）可以删；邮件同步来的只能取消，否则定时任务下次又会建回来。
const DELETABLE_SOURCES = ["manual", "paste"];

export function patchItem(id, patch, file = itemsFile) {
  return serialized(async () => {
    const data = await readItems(file);
    const item = data.items.find((entry) => entry.id === id);
    if (!item) return null;
    if (item.source === "manual" && Object.hasOwn(patch, "kind")) {
      // 编辑手动事项时整条重新校验，避免存进不合法的时间；换类型时清掉另一类的字段。
      const fields = validated(() => normalizeManualItem(patch));
      for (const key of ["start", "durationMinutes", "mode", "travelMinutes", "deadline", "windowStart", "estimatedMinutes"]) {
        delete item[key];
      }
      Object.assign(item, fields);
    } else {
      for (const field of USER_EDITABLE_FIELDS) {
        if (Object.hasOwn(patch, field)) item[field] = patch[field];
      }
    }
    const now = new Date().toISOString();
    item.userUpdatedAt = now;
    item.updatedAt = now;
    data.updatedAt = now;
    await writeJson(file, data);
    return item;
  });
}

export function deleteItem(id, file = itemsFile) {
  return serialized(async () => {
    const data = await readItems(file);
    const index = data.items.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    if (!DELETABLE_SOURCES.includes(data.items[index].source)) {
      throw new BadRequest("邮件同步来的事项不能删除，请用“取消”。");
    }
    const [removed] = data.items.splice(index, 1);
    data.updatedAt = new Date().toISOString();
    await writeJson(file, data);
    return removed;
  });
}

// ---------- 手动建的事项 ----------

// 用户自己建的固定日程和截止任务，和邮件来的放在同一个 items.json 里，
// 排程和提醒规则完全一样；用 source: "manual" 区分，定时任务不会改动它们。
export function normalizeManualItem(raw) {
  const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const time = (value, label) => {
    if (!value || !Number.isFinite(Date.parse(value))) throw new Error(`请填写${label}`);
    return String(value);
  };
  const minutes = (value, fallback, label) => {
    const number = Math.round(Number(value ?? fallback));
    if (!(number >= 0 && number <= 24 * 60)) throw new Error(`${label}要在 0-1440 分钟之间`);
    return number;
  };

  const kind = raw?.kind;
  if (kind !== "appointment" && kind !== "deadline") throw new Error("事项类型只能是固定日程或截止任务");
  const title = text(raw.title, 60);
  if (!title) throw new Error("请填写事项名称");
  const item = {
    kind,
    title,
    type: text(raw.type, 20) || (kind === "appointment" ? "日程" : "截止任务"),
    link: text(raw.link, 500) || null,
    location: text(raw.location, 200) || null,
    userNote: text(raw.userNote, 1000) || null,
  };
  if (kind === "appointment") {
    item.start = time(raw.start, "开始时间");
    item.durationMinutes = Math.max(5, minutes(raw.durationMinutes, 60, "时长"));
    item.mode = raw.mode === "offline" ? "offline" : "online";
    item.travelMinutes = raw.travelMinutes == null ? null : minutes(raw.travelMinutes, 60, "往返交通");
    item.prepMinutes = minutes(raw.prepMinutes, 0, "提前准备");
    item.bufferMinutes = minutes(raw.bufferMinutes, 0, "结束后缓冲");
  } else {
    item.deadline = time(raw.deadline, "截止时间");
    item.windowStart = raw.windowStart ? time(raw.windowStart, "最早开始时间") : null;
    item.estimatedMinutes = Math.max(5, minutes(raw.estimatedMinutes, 60, "预计用时"));
  }
  return item;
}

export function createManualItem(fields, file = itemsFile) {
  return serialized(async () => {
    const data = await readItems(file);
    const now = new Date().toISOString();
    const item = {
      id: `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      source: "manual",
      status: "scheduled",
      ...fields,
      createdAt: now,
      updatedAt: now,
      userUpdatedAt: now,
    };
    data.items.push(item);
    data.updatedAt = now;
    await writeJson(file, data);
    return item;
  });
}

// 粘贴邮件、经大模型解析并由用户确认的招聘事项。用 source: "paste" 标记，
// 和邮件同步来的一样算招聘事项，但定时任务不会改动它们（见 docs/recruiting-data.md）。
export function createExtractedItems(items, email, model, file = itemsFile) {
  return serialized(async () => {
    const data = await readItems(file);
    const now = new Date().toISOString();
    const created = items.map((fields) => ({
      id: `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      source: "paste",
      ...fields,
      extractedBy: model || null,
      sourceEmails: [{ subject: email?.subject || "", receivedAt: email?.receivedAt || now }],
      createdAt: now,
      updatedAt: now,
      userUpdatedAt: now,
    }));
    data.items.push(...created);
    data.updatedAt = now;
    await writeJson(file, data);
    return created;
  });
}

// ---------- 待办 ----------

export async function readTodos() {
  return { version: 1, todos: [], updatedAt: null, ...(await readJson(todosFile)) };
}

function writeTodos(todos) {
  return serialized(async () => {
    const data = { version: 1, todos, updatedAt: new Date().toISOString() };
    await writeJson(todosFile, data);
    return data;
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
    pins: normalizePins(input.pins),
    ...(typeof input.busySignature === "string" ? { busySignature: input.busySignature } : {}),
  };
}

// 当天手动指定的投入方向时段：{ 时段 id: { start, end } }，单位是当天的分钟数。
function normalizePins(input) {
  const pins = {};
  if (!input || typeof input !== "object") return pins;
  for (const [id, pin] of Object.entries(input).slice(0, 40)) {
    const start = Math.round(Number(pin?.start));
    const end = Math.round(Number(pin?.end));
    if (id.length <= 60 && start >= 0 && end > start && end <= 24 * 60) pins[id] = { start, end };
  }
  return pins;
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

async function handleApi(request, response, pathname, searchParams, options) {
  if (request.method !== "GET" && !isAllowedOrigin(request)) {
    sendJson(response, 403, { error: "forbidden origin" });
    return;
  }

  if (pathname === "/api/items" && request.method === "GET") {
    sendJson(response, 200, await readItems());
    return;
  }

  if (pathname === "/api/items" && request.method === "POST") {
    const body = await readBody(request);
    sendJson(response, 201, await createManualItem(validated(() => normalizeManualItem(body))));
    return;
  }

  if (pathname === "/api/extract/status" && request.method === "GET") {
    sendJson(response, 200, { configured: Boolean(await loadApiKey(dataDir)), model: MODEL });
    return;
  }

  if (pathname === "/api/extract" && request.method === "POST") {
    const raw = await readBody(request, 256 * 1024);
    const email = validated(() => normalizeEmail(raw));
    const client = options.extractClient || (await defaultExtractClient());
    if (!client) {
      sendJson(response, 503, { error: "还没有配置 Anthropic API 密钥，见 README“邮件解析”一节。", configured: false });
      return;
    }
    try {
      sendJson(response, 200, await extractFromEmail(email, client));
    } catch (error) {
      if (!(error instanceof ExtractUnavailable)) throw error;
      sendJson(response, 502, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/items/extracted" && request.method === "POST") {
    const body = await readBody(request, 256 * 1024);
    const items = validated(() => {
      if (!Array.isArray(body.items) || !body.items.length) throw new Error("没有要保存的事项");
      return body.items.slice(0, 10).map(normalizeExtractedItem);
    });
    sendJson(response, 201, { items: await createExtractedItems(items, body.email, body.model) });
    return;
  }

  if (pathname === "/api/todos" && request.method === "GET") {
    sendJson(response, 200, await readTodos());
    return;
  }

  if (pathname === "/api/todos" && request.method === "PUT") {
    const body = await readBody(request, 1024 * 1024);
    sendJson(response, 200, await writeTodos(validated(() => normalizeTodos(body.todos))));
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
  if (match && request.method === "DELETE") {
    const removed = await deleteItem(decodeURIComponent(match[1]));
    sendJson(response, removed ? 200 : 404, removed ? { ok: true } : { error: "item not found" });
    return;
  }
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

async function defaultExtractClient() {
  const apiKey = await loadApiKey(dataDir);
  return apiKey ? createClient(apiKey) : null;
}

// options.extractClient：测试时传入假的模型客户端，不走真实 API。
export function createWorkbenchServer(options = {}) {
  return createServer(async (request, response) => {
    const { pathname, searchParams } = new URL(request.url || "/", "http://localhost");
    try {
      if (pathname.startsWith("/api/")) {
        await handleApi(request, response, pathname, searchParams, options);
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
