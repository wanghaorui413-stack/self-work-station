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

const send = (url, method, body, origin = "http://127.0.0.1:8000") =>
  fetch(`${base}${url}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });

test("没有设置文件时返回默认设置和默认投入方向，尚未迁移", async () => {
  const data = await (await fetch(`${base}/api/workbench`)).json();
  assert.equal(data.settings.totalMinutes, "360");
  assert.ok(data.focusAreas.some((area) => area.id === "research"));
  assert.equal(data.migratedFromBrowserAt, null);
});

test("浏览器里没有旧记录时不标记为已迁移，以后换个网址打开还能再搬", async () => {
  const result = await (await send("/api/migrate", "POST", { days: {}, settings: null })).json();
  assert.equal(result.migrated, 0);
  const workbench = await (await fetch(`${base}/api/workbench`)).json();
  assert.equal(workbench.migratedFromBrowserAt, null);
});

test("首次迁移搬入浏览器旧记录；之后再迁移不会覆盖", async () => {
  const first = await (
    await send("/api/migrate", "POST", {
      days: { "2026-10-30": { plan: [{ id: "reading", duration: 30 }], tasks: {}, reflection: "旧" } },
      settings: { totalMinutes: "240", startTime: "08:30", dayEnd: "22:00", breakMinutes: "5", longBreakMinutes: "30" },
    })
  ).json();
  assert.equal(first.migrated, 1);

  const second = await (
    await send("/api/migrate", "POST", { days: { "2026-10-30": { reflection: "覆盖" } } })
  ).json();
  assert.equal(second.skipped, true);

  const { days } = await (await fetch(`${base}/api/days?from=2026-10-29&to=2026-10-31`)).json();
  assert.deepEqual(Object.keys(days), ["2026-10-30"]);
  assert.equal(days["2026-10-30"].reflection, "旧");
  const workbench = await (await fetch(`${base}/api/workbench`)).json();
  assert.equal(workbench.settings.totalMinutes, "240");
  assert.ok(workbench.migratedFromBrowserAt);
});

test("每日记录按天读写", async () => {
  const response = await send("/api/days/2026-11-02", "PUT", {
    plan: [{ id: "research#1", areaId: "research", duration: 60 }],
    tasks: { "research#1": { complete: true } },
    reflection: "今天不错",
  });
  assert.equal(response.status, 200);
  const saved = JSON.parse(await fs.readFile(path.join(dir, "days", "2026-11-02.json"), "utf8"));
  assert.equal(saved.tasks["research#1"].complete, true);
});

test("保存投入方向：合法的保存成功，不合法的返回 400 和原因", async () => {
  const { focusAreas } = await (await fetch(`${base}/api/workbench`)).json();
  const renamed = focusAreas.map((area) =>
    area.id === "reading" ? { ...area, name: "精读论文", shortName: "精读" } : area,
  );
  const ok = await send("/api/workbench/focus-areas", "PUT", { focusAreas: renamed });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).focusAreas.find((area) => area.id === "reading").name, "精读论文");

  const removed = await send("/api/workbench/focus-areas", "PUT", { focusAreas: renamed.slice(1) });
  assert.equal(removed.status, 400);
  assert.match((await removed.json()).error, /归档/);
});

test("拒绝其他网站修改设置和每日记录", async () => {
  const response = await send("/api/days/2026-11-02", "PUT", { reflection: "x" }, "https://evil.example");
  assert.equal(response.status, 403);
});

test("非法日期范围返回 400", async () => {
  const response = await fetch(`${base}/api/days?from=bad&to=2026-11-01`);
  assert.equal(response.status, 400);
});
