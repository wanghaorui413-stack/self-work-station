import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 在当前 realm 里加载，deepEqual 才不会因为跨 realm 的原型不同而失败。
const R = vm.runInThisContext(
  `(() => { ${fs.readFileSync(path.join(root, "recruiting.js"), "utf8")}\nreturn Recruiting; })()`,
);
const at = (iso) => Date.parse(iso);
const clock = (ms) => R.toIso(ms).slice(0, 16);

const settings = { startTime: "09:00", dayEnd: "21:30" };

test("线上面试的占用时段 = 前 30 分钟准备 + 面试 + 后 15 分钟缓冲", () => {
  const block = R.blockedTime(
    { id: "a", start: "2026-11-05T14:00:00+08:00", durationMinutes: 60, mode: "online" },
    settings,
  );
  assert.equal(clock(block.start), "2026-11-05T13:30");
  assert.equal(clock(block.end), "2026-11-05T15:15");
});

test("线下面试额外加往返交通，默认 1 小时", () => {
  const block = R.blockedTime(
    { id: "a", start: "2026-11-05T14:00:00+08:00", durationMinutes: 60, mode: "offline" },
    settings,
  );
  assert.equal(clock(block.start), "2026-11-05T12:30");
  assert.equal(clock(block.end), "2026-11-05T16:15");
});

test("截止任务排在窗口内最早的空档，且不排在截止当天", () => {
  const items = [
    {
      id: "t1",
      kind: "deadline",
      status: "scheduled",
      windowStart: "2026-11-03T00:00:00+08:00",
      deadline: "2026-11-04T23:59:00+08:00",
      estimatedMinutes: 60,
    },
  ];
  const { placements } = R.placeDeadlineTasks(items, settings, at("2026-11-01T10:00:00+08:00"));
  assert.equal(clock(placements.t1.start), "2026-11-03T09:00");
});

test("截止任务避开面试占用时段（含间隔）和饭点", () => {
  const items = [
    {
      id: "iv",
      kind: "appointment",
      status: "scheduled",
      start: "2026-11-03T09:30:00+08:00",
      durationMinutes: 60,
      mode: "online",
    },
    {
      id: "t1",
      kind: "deadline",
      status: "scheduled",
      deadline: "2026-11-05T12:00:00+08:00",
      estimatedMinutes: 60,
    },
  ];
  // 面试占用 09:00-10:45，再留 15 分钟间隔 → 11:00 起；11:30 开始是饭点 → 只剩 30 分钟，不够
  // 下一个空档是 13:30。
  const { placements } = R.placeDeadlineTasks(items, settings, at("2026-11-03T07:00:00+08:00"));
  assert.equal(clock(placements.t1.start), "2026-11-03T13:30");
});

test("当天才收到、窗口很短的截止任务，可以退到截止当天", () => {
  const items = [
    {
      id: "ai",
      kind: "deadline",
      status: "scheduled",
      deadline: "2026-11-01T20:00:00+08:00",
      estimatedMinutes: 45,
    },
  ];
  const { placements, unplaceable } = R.placeDeadlineTasks(
    items,
    settings,
    at("2026-11-01T14:10:00+08:00"),
  );
  assert.deepEqual(unplaceable, []);
  assert.equal(clock(placements.ai.start), "2026-11-01T14:30");
});

test("排不下的截止任务被标出来", () => {
  const items = [
    {
      id: "x",
      kind: "deadline",
      status: "scheduled",
      deadline: "2026-11-01T15:00:00+08:00",
      estimatedMinutes: 120,
    },
  ];
  const { unplaceable } = R.placeDeadlineTasks(items, settings, at("2026-11-01T14:00:00+08:00"));
  assert.deepEqual(unplaceable, ["x"]);
});

test("手动指定的时段原样保留，并让其他任务避开", () => {
  const items = [
    {
      id: "m",
      kind: "deadline",
      status: "scheduled",
      deadline: "2026-11-06T23:00:00+08:00",
      estimatedMinutes: 60,
      manualSlot: { start: "2026-11-03T09:00:00+08:00" },
    },
    {
      id: "n",
      kind: "deadline",
      status: "scheduled",
      deadline: "2026-11-06T23:00:00+08:00",
      estimatedMinutes: 60,
      windowStart: "2026-11-03T00:00:00+08:00",
    },
  ];
  const { placements } = R.placeDeadlineTasks(items, settings, at("2026-11-01T10:00:00+08:00"));
  assert.equal(clock(placements.m.start), "2026-11-03T09:00");
  assert.equal(clock(placements.n.start), "2026-11-03T10:15");
});

test("待核对、已完成、已取消的事项不占时间", () => {
  const base = { kind: "appointment", start: "2026-11-03T10:00:00+08:00", durationMinutes: 60 };
  const items = ["needs_review", "done", "cancelled"].map((status, index) => ({
    ...base,
    id: `i${index}`,
    status,
  }));
  assert.equal(R.appointmentBlocks(items, settings).length, 0);
});

test("均衡任务绕开占用时段，放不下的算挤占", () => {
  const { plan, crowdedOut } = R.layoutBalanceTasks({
    order: ["a", "b", "c"],
    durations: { a: 60, b: 60, c: 60 },
    busy: [{ start: 600, end: 720 }],
    dayStart: 540,
    dayEnd: 820,
    breakMinutes: 0,
    longBreakAfter: null,
    longBreakMinutes: 0,
  });
  assert.deepEqual(
    plan.map((item) => [item.id, item.start]),
    [
      ["a", 540],
      ["b", 720],
    ],
  );
  assert.deepEqual(crowdedOut, ["c"]);
});

test("固定日程有前一天 20:00 和提前 1 小时两条提醒", () => {
  const items = [
    {
      id: "iv",
      kind: "appointment",
      status: "scheduled",
      company: "某公司",
      title: "一面",
      start: "2026-11-05T14:00:00+08:00",
      durationMinutes: 60,
    },
  ];
  const reminders = R.computeReminders(items, {}, [], settings);
  const times = reminders.map((reminder) => clock(reminder.at)).sort();
  assert.deepEqual(times, ["2026-11-04T20:00", "2026-11-05T13:00"]);
});

test("提醒只在到点后、过期前弹一次", () => {
  const reminders = [{ key: "k", at: 100, expires: 200 }];
  assert.equal(R.dueReminders(reminders, 50, new Set()).length, 0);
  assert.equal(R.dueReminders(reminders, 150, new Set()).length, 1);
  assert.equal(R.dueReminders(reminders, 150, new Set(["k"])).length, 0);
  assert.equal(R.dueReminders(reminders, 250, new Set()).length, 0);
});

test("截止任务有开始时段提醒和截止前 24 小时提醒", () => {
  const items = [
    {
      id: "t",
      kind: "deadline",
      status: "scheduled",
      deadline: "2026-11-05T23:59:00+08:00",
      estimatedMinutes: 60,
    },
  ];
  const { placements, unplaceable } = R.placeDeadlineTasks(
    items,
    settings,
    at("2026-11-03T08:00:00+08:00"),
  );
  const keys = R.computeReminders(items, placements, unplaceable, settings).map(
    (reminder) => reminder.key.split(":")[1],
  );
  assert.deepEqual(keys.sort(), ["deadline-warning", "slot"]);
});

test("当天被占用的分钟数按天切分", () => {
  const items = [
    {
      id: "iv",
      kind: "appointment",
      status: "scheduled",
      start: "2026-11-05T14:00:00+08:00",
      durationMinutes: 60,
    },
  ];
  const busy = R.busyMinutesForDay("2026-11-05", items, {}, settings);
  assert.deepEqual(busy, [{ start: 13 * 60 + 30, end: 15 * 60 + 15 }]);
  assert.deepEqual(R.busyMinutesForDay("2026-11-06", items, {}, settings), []);
});
