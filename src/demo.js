// ?demo=1 演示页用的样例记录（GitHub Pages 上没有本地服务器，只能看这个）。

import { DEFAULT_FOCUS_AREAS, planEntries, longBreakIndex } from "./focus-areas.js";
import { historyDateKeys } from "./format.js";

function demoPlan(durations) {
  const entries = planEntries(DEFAULT_FOCUS_AREAS);
  const longBreakAt = longBreakIndex(entries.length);
  let cursor = 9 * 60;
  return entries.map((entry, index) => {
    const start = cursor;
    const duration = durations[index];
    cursor += duration + (index === longBreakAt ? 45 : 10);
    return { ...entry, start, end: start + duration, duration };
  });
}

const DEMO_DAYS = [
  {
    plan: demoPlan([35, 60, 50, 65, 60, 35, 55]),
    tasks: {
      vocabulary: { complete: true, goal: "复习旧词 120 个 + 错词 20 个", completedAt: "demo" },
      "research#1": { complete: true, goal: "完成图表说明初稿", completedAt: "demo" },
      listening: { complete: true, goal: "Section 3 精听错题句", completedAt: "demo" },
      reading: { complete: true, goal: "限时一篇 + 5 个同义替换", completedAt: "demo" },
      "research#2": { complete: false, goal: "整理实验结果判断" },
      speaking: { complete: false, goal: "录 2 个 Part 2 话题", quickStarts: 1 },
      writing: { complete: false, goal: "Task 2 提纲 + 主体段", quickStarts: 2 },
    },
    reflection: "今天阅读进入状态很快，但写作还是容易拖。明天写作先做 5 分钟提纲。",
  },
  {
    plan: demoPlan([30, 45, 40, 50, 45, 30, 45]),
    tasks: {
      vocabulary: { complete: true },
      "research#1": { complete: true },
      listening: { complete: true },
      reading: { complete: true },
      "research#2": { complete: true },
      speaking: { complete: false },
      writing: { complete: false },
    },
    reflection: "科研完成一轮修改，输出类雅思任务被挤掉。",
  },
  {
    plan: demoPlan([30, 45, 40, 50, 45, 30, 45]),
    tasks: {
      vocabulary: { complete: true },
      "research#1": { complete: true },
      listening: { complete: false },
      reading: { complete: true },
      "research#2": { complete: true },
      speaking: { complete: true },
      writing: { complete: false },
    },
    reflection: "口语完成录音，但听力和写作复盘不足。",
  },
];

export function createDemoDays(todayKey) {
  const keys = historyDateKeys(todayKey, DEMO_DAYS.length);
  return Object.fromEntries(keys.map((key, index) => [key, structuredClone(DEMO_DAYS[index])]));
}
