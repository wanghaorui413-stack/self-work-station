import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 8000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const normalized = path.normalize(pathname).replace(/^([/\\])+/, "");
  const filePath = path.join(root, normalized || "index.html");
  if (!filePath.startsWith(root)) {
    return null;
  }
  return filePath;
}

const server = createServer(async (request, response) => {
  const filePath = resolveRequestPath(request.url || "/");
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    const ext = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Daily Balance Planner running at http://localhost:${port}`);
});
