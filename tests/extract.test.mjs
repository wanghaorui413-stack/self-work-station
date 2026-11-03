import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-extract-"));
process.env.WORKBENCH_DATA_DIR = dir;
delete process.env.ANTHROPIC_API_KEY;
const { validateExtraction, normalizeExtractedItem, extractFromEmail } = await import("../scripts/extract.mjs");
const { createWorkbenchServer } = await import("../scripts/serve.mjs");

const email = {
  subject: "【某某科技】数据分析岗一面邀请",
  from: "hr@example.com",
  receivedAt: "2026-11-01T09:00:00+08:00",
  body: "您好，诚邀您参加一面，时间：11月5日 14:00，腾讯会议 https://meeting.tencent.com/abc ，请回复确认。\n另请于 11月3日 23:59 前完成在线测评。",
};

const appointment = {
  kind: "appointment",
  type: "一面",
  company: "某某科技",
  title: "数据分析岗一面",
  start: "2026-11-05T14:00:00+08:00",
  duration_minutes: null,
  mode: "online",
  window_start: null,
  deadline: null,
  estimated_minutes: null,
  link: "https://meeting.tencent.com/abc",
  location: null,
  needs_confirmation: true,
  time_certainty: "exact",
  evidence: "时间：11月5日 14:00",
  reason: "邮件写明了面试时间",
};

const assessment = {
  ...appointment,
  kind: "deadline",
  type: "在线测评",
  title: "在线测评",
  start: null,
  deadline: "2026-11-03T23:59:00+08:00",
  link: null,
  needs_confirmation: false,
  evidence: "11月3日 23:59 前完成在线测评",
};

test("一封邮件拆出多个事项，按类型补默认值和状态", () => {
  const { isRecruiting, items } = validateExtraction({ is_recruiting: true, items: [appointment, assessment] }, email);
  assert.equal(isRecruiting, true);
  assert.equal(items.length, 2);
  assert.equal(items[0].status, "pending_confirmation");
  assert.equal(items[0].durationMinutes, 60);
  assert.equal(items[0].link, "https://meeting.tencent.com/abc");
  assert.equal(items[1].status, "scheduled");
  assert.equal(items[1].estimatedMinutes, 60);
});

test("时间缺失或含糊的标成待核对", () => {
  const { items } = validateExtraction(
    {
      is_recruiting: true,
      items: [
        { ...appointment, start: null, time_certainty: "missing", evidence: "" },
        { ...appointment, time_certainty: "vague" },
      ],
    },
    email,
  );
  assert.deepEqual(
    items.map((item) => item.status),
    ["needs_review", "needs_review"],
  );
  assert.match(items[0].reviewNote, /开始时间/);
  assert.match(items[1].reviewNote, /含糊/);
});

test("引用的原文不在邮件里、或时间早于收信时间，都不直接进日程", () => {
  const { items } = validateExtraction(
    {
      is_recruiting: true,
      items: [
        { ...appointment, evidence: "时间：11月6日 10:00" },
        { ...appointment, start: "2025-11-05T14:00:00+08:00" },
      ],
    },
    email,
  );
  assert.match(items[0].reviewNote, /原文/);
  assert.match(items[1].reviewNote, /早于收信时间/);
});

test("邮件里没出现过的链接会被丢掉；没写时区的时间按北京时间", () => {
  const { items } = validateExtraction(
    { is_recruiting: true, items: [{ ...appointment, link: "https://phish.example/x", start: "2026-11-05T14:00" }] },
    email,
  );
  assert.equal(items[0].link, null);
  assert.equal(items[0].start, "2026-11-05T14:00:00+08:00");
});

test("不是招聘邮件时不返回事项", () => {
  assert.deepEqual(validateExtraction({ is_recruiting: false, items: [appointment] }, email).items, []);
});

test("保存前再核一遍：没有时间的不能是已排定", () => {
  const item = normalizeExtractedItem({ kind: "deadline", title: "测评", status: "scheduled", deadline: "下周" });
  assert.equal(item.status, "needs_review");
  assert.ok(item.reviewNote);
  assert.throws(() => normalizeExtractedItem({ kind: "other", title: "x" }));
});

function fakeClient(output, extra = {}) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return {
            model: params.model,
            stop_reason: "end_turn",
            content: [{ type: "text", text: JSON.stringify(output) }],
            usage: { input_tokens: 100, output_tokens: 50 },
            ...extra,
          };
        },
      },
    },
  };
}

test("调用模型时用 JSON Schema 约束输出", async () => {
  const client = fakeClient({ is_recruiting: true, items: [appointment] });
  const result = await extractFromEmail(email, client);
  assert.equal(result.items.length, 1);
  const params = client.calls[0];
  assert.equal(params.output_config.format.type, "json_schema");
  assert.match(params.messages[0].content, /收信时间：2026-11-01T09:00:00\+08:00/);
});

test("模型拒绝时给出明确的错误", async () => {
  const client = fakeClient({}, { stop_reason: "refusal", content: [] });
  await assert.rejects(() => extractFromEmail(email, client), /拒绝/);
});

// ---------- 接口 ----------

const fake = fakeClient({ is_recruiting: true, items: [appointment, assessment] });
const server = createWorkbenchServer({ extractClient: fake });
const bare = createWorkbenchServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
await new Promise((resolve) => bare.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const bareBase = `http://127.0.0.1:${bare.address().port}`;
after(() => {
  server.close();
  bare.close();
});

const post = (root, url, body) =>
  fetch(`${root}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:8000" },
    body: JSON.stringify(body),
  });

test("没配置密钥时接口返回 503，其他功能不受影响", async () => {
  const status = await (await fetch(`${bareBase}/api/extract/status`)).json();
  assert.equal(status.configured, false);
  const response = await post(bareBase, "/api/extract", email);
  assert.equal(response.status, 503);
  assert.equal((await fetch(`${bareBase}/api/items`)).status, 200);
});

test("解析接口只返回候选，不写数据；确认后才保存", async () => {
  const response = await post(base, "/api/extract", email);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.items.length, 2);
  const before = (await (await fetch(`${base}/api/items`)).json()).items;
  assert.equal(before.length, 0);

  const saved = await post(base, "/api/items/extracted", { items: result.items, email, model: result.model });
  assert.equal(saved.status, 201);
  const items = (await (await fetch(`${base}/api/items`)).json()).items;
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.source === "paste" && item.id.startsWith("p-")));
  assert.equal(items[0].sourceEmails[0].subject, email.subject);
});

test("正文为空时返回 400", async () => {
  const response = await post(base, "/api/extract", { subject: "x", body: "  " });
  assert.equal(response.status, 400);
});
