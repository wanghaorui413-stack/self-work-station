import { createServer } from "node:http";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 以项目根目录为准，而不是启动时的工作目录，方便开机自启脚本从任意位置拉起。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.WORKBENCH_DATA_DIR || path.join(root, "data");
const itemsFile = path.join(dataDir, "items.json");
const port = Number(process.env.PORT || 8000);

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

async function writeItems(data, file = itemsFile) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

// 串行化写入，避免两次点击同时读改写互相覆盖。
let writeQueue = Promise.resolve();
export function patchItem(id, patch, file = itemsFile) {
  const run = writeQueue.then(async () => {
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
    await writeItems(data, file);
    return item;
  });
  writeQueue = run.catch(() => {});
  return run;
}

function resolveStaticPath(url) {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const normalized = path.normalize(pathname).replace(/^([/\\])+/, "");
  const filePath = path.join(root, normalized || "index.html");
  const insideRoot = filePath === root || filePath.startsWith(`${root}${path.sep}`);
  // 数据目录不当静态文件暴露，只能走 /api。
  const insideData = filePath.startsWith(`${dataDir}${path.sep}`) || filePath === dataDir;
  return insideRoot && !insideData ? filePath : null;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("请求体过大");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function handleApi(request, response, pathname) {
  if (pathname === "/api/items" && request.method === "GET") {
    sendJson(response, 200, await readItems());
    return;
  }

  const match = pathname.match(/^\/api\/items\/([^/]+)$/);
  if (match && request.method === "PATCH") {
    // 只接受本机页面发起的修改。
    const origin = request.headers.origin;
    if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      sendJson(response, 403, { error: "forbidden origin" });
      return;
    }
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
    const { pathname } = new URL(request.url || "/", "http://localhost");
    try {
      if (pathname.startsWith("/api/")) {
        await handleApi(request, response, pathname);
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
        sendJson(response, 500, { error: error.message });
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
    console.log(`招聘事项数据：${itemsFile}`);
  });
}
