import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FOCUS_AREAS,
  allocateDurations,
  areaIdOf,
  areasActiveOn,
  chooseAreas,
  longBreakIndex,
  normalizeFocusAreas,
  planEntries,
} from "../src/focus-areas.js";
import { buildAnalytics } from "../src/analytics.js";
import { formatClock, historyDateKeys } from "../src/format.js";

const areas = DEFAULT_FOCUS_AREAS;
const area = (overrides) => ({ ...areas[0], ...overrides });

test("时间分配的总和等于用户设置的总时长，且每段至少 5 分钟", () => {
  for (const total of [60, 100, 180, 240, 360, 480]) {
    const values = Object.values(allocateDurations(total, areas));
    assert.equal(values.reduce((sum, value) => sum + value, 0), total, `${total} 分钟`);
    assert.ok(values.every((value) => value >= 5), `${total} 分钟出现过短时段`);
  }
});

test("默认方向的时段顺序和旧版一致：科研两段穿插，长休息在阅读之后", () => {
  const entries = planEntries(areas);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["vocabulary", "research#1", "listening", "reading", "research#2", "speaking", "writing"],
  );
  assert.equal(entries[longBreakIndex(entries.length)].id, "reading");
});

test("拆成多段的方向，时间平分到各段", () => {
  const durations = allocateDurations(120, [area({ id: "a", minimum: 60, segments: 2 })]);
  assert.deepEqual(durations, { "a#1": 60, "a#2": 60 });
});

test("旧记录里的 research1 / research2 归到科研方向", () => {
  assert.equal(areaIdOf({ id: "research2" }), "research");
  assert.equal(areaIdOf({ id: "x#2", areaId: "x" }), "x");
  assert.equal(areaIdOf({ id: "writing" }), "writing");
});

test("生效日：只在选中的星期排；不设生效日就每天排；归档的不排", () => {
  const list = [
    area({ id: "gym", days: [1, 3, 5] }),
    area({ id: "daily", days: [] }),
    area({ id: "old", archived: true }),
  ];
  // 2026-11-02 是周一，2026-11-03 是周二。
  assert.deepEqual(areasActiveOn(list, "2026-11-02").map((a) => a.id), ["gym", "daily"]);
  assert.deepEqual(areasActiveOn(list, "2026-11-03").map((a) => a.id), ["daily"]);
});

test("空档不够时，只保留标了“优先保留”的方向", () => {
  const chosen = chooseAreas(areas, {
    totalMinutes: 360,
    freeMinutes: 180,
    breakMinutes: 10,
    longBreakMinutes: 45,
  });
  assert.deepEqual(chosen.areas.map((a) => a.id), ["vocabulary", "research"]);
  // 再少到连这两个都放不下，就从末尾去掉。
  const tighter = chooseAreas(areas, { totalMinutes: 360, freeMinutes: 120, breakMinutes: 10, longBreakMinutes: 45 });
  assert.deepEqual(tighter.areas.map((a) => a.id), ["vocabulary"]);
});

test("空档足够时全部排上", () => {
  const chosen = chooseAreas(areas, {
    totalMinutes: 360,
    freeMinutes: 750,
    breakMinutes: 10,
    longBreakMinutes: 45,
  });
  assert.equal(chosen.areas.length, areas.length);
  assert.equal(chosen.total, 360);
});

test("校验：默认方向合法；新方向的简称和图标自动补齐", () => {
  const result = normalizeFocusAreas([
    ...areas,
    { id: "fa-new", name: "求职准备", minimum: 30, weight: 10, segments: 1, days: [] },
  ]);
  const added = result.at(-1);
  assert.equal(added.shortName, "求职准备");
  assert.equal(added.icon, "求");
  assert.equal(added.color, "#1f5c48");
});

test("校验：拒绝空名称、过短的最低保障、重复 id、全部归档", () => {
  assert.throws(() => normalizeFocusAreas([area({ name: " " })]), /名称/);
  assert.throws(() => normalizeFocusAreas([area({ minimum: 1 })]), /最低保障/);
  assert.throws(() => normalizeFocusAreas([area({}), area({})]), /重复/);
  assert.throws(() => normalizeFocusAreas([area({ archived: true })]), /至少保留/);
});

test("校验：已存在的方向不能直接移除，只能归档", () => {
  assert.throws(() => normalizeFocusAreas([areas[0]], areas), /归档/);
  const archived = normalizeFocusAreas(
    areas.map((a, i) => (i === 1 ? { ...a, archived: true } : a)),
    areas,
  );
  assert.equal(archived[1].archived, true);
});

test("跨午夜时间格式化", () => {
  assert.equal(formatClock(24 * 60 + 15), "00:15");
});

// 旧版 localStorage 迁移过来的记录：时段 id 是写死的任务 id。
const legacyDays = {
  "2026-09-06": {
    plan: [
      { id: "vocabulary", duration: 35 },
      { id: "research1", duration: 60 },
      { id: "listening", duration: 50 },
      { id: "reading", duration: 65 },
      { id: "research2", duration: 60 },
      { id: "speaking", duration: 35 },
      { id: "writing", duration: 55 },
    ],
    tasks: {
      vocabulary: { complete: true },
      research1: { complete: true },
      listening: { complete: true },
      reading: { complete: true },
      research2: { complete: true },
      speaking: { complete: true },
      writing: { complete: false },
    },
  },
  "2026-09-05": {
    plan: [
      { id: "vocabulary", duration: 30 },
      { id: "research1", duration: 45 },
      { id: "listening", duration: 40 },
      { id: "reading", duration: 50 },
      { id: "research2", duration: 45 },
      { id: "speaking", duration: 30 },
      { id: "writing", duration: 45 },
    ],
    tasks: {
      vocabulary: { complete: true },
      research1: { complete: true },
      listening: { complete: true },
      reading: { complete: true },
      research2: { complete: false },
      speaking: { complete: false },
      writing: { complete: false },
    },
  },
};

test("旧记录照常统计：完成率、薄弱方向、连续均衡日", () => {
  const analytics = buildAnalytics(legacyDays, ["2026-09-06", "2026-09-05"], areas);
  assert.equal(analytics.completionRate, 71);
  assert.equal(analytics.weakest.id, "writing");
  assert.equal(analytics.balancedStreak, 0);
  const research = analytics.categoryStats.find((item) => item.id === "research");
  assert.equal(research.completed, 2);
  assert.equal(research.completedMinutes, 60 + 60 + 45);
});

test("归档的方向只在历史里出现过时才进统计", () => {
  const list = areas.map((a) => (a.id === "writing" ? { ...a, archived: true } : a));
  const withHistory = buildAnalytics(legacyDays, ["2026-09-06"], list);
  assert.ok(withHistory.categoryStats.some((item) => item.id === "writing"));
  const withoutHistory = buildAnalytics({}, ["2026-09-06"], list);
  assert.ok(!withoutHistory.categoryStats.some((item) => item.id === "writing"));
});

test("历史日期从今天往前数", () => {
  assert.deepEqual(historyDateKeys("2026-03-01", 3), ["2026-03-01", "2026-02-28", "2026-02-27"]);
});
