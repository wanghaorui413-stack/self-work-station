import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-"));
process.env.WORKBENCH_DATA_DIR = dir;
const { createWorkbenchServer } = await import("../scripts/serve.mjs");

const server = createWorkbenchServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const file = path.join(dir, "items.json");

test("没有数据文件时返回空列表", async () => {
  const data = await (await fetch(`${base}/api/items`)).json();
  assert.deepEqual(data.items, []);
});

test("PATCH 只改白名单字段，保留定时任务写的其他字段", async () => {
  await fs.writeFile(
    file,
    JSON.stringify({
      items: [{ id: "a", status: "scheduled", sourceEmails: [{ messageId: "m1" }] }],
    }),
  );
  const response = await fetch(`${base}/api/items/a`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:8000" },
    body: JSON.stringify({ status: "done", completedAt: "x", sourceEmails: [] }),
  });
  assert.equal(response.status, 200);
  const saved = JSON.parse(await fs.readFile(file, "utf8")).items[0];
  assert.equal(saved.status, "done");
  assert.equal(saved.completedAt, "x");
  assert.deepEqual(saved.sourceEmails, [{ messageId: "m1" }]);
  assert.ok(saved.userUpdatedAt);
});

test("拒绝其他网站发来的修改", async () => {
  const response = await fetch(`${base}/api/items/a`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: JSON.stringify({ status: "cancelled" }),
  });
  assert.equal(response.status, 403);
});

test("数据目录不作为静态文件暴露", async () => {
  const response = await fetch(`${base}/data/items.json`);
  assert.notEqual(response.status, 200);
});
