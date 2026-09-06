import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(directory, "index.html"), "utf8");
const source = fs.readFileSync(path.join(directory, "app.js"), "utf8");

for (const asset of ["styles.css", "app.js"]) {
  if (!fs.existsSync(path.join(directory, asset))) {
    throw new Error(`缺少静态资源：${asset}`);
  }
}

const queriedIds = [
  ...source.matchAll(/document\.querySelector\("#([^"]+)"\)/g),
].map((match) => match[1]);

for (const id of queriedIds) {
  if (!html.includes(`id="${id}"`)) {
    throw new Error(`app.js 引用了不存在的页面元素：#${id}`);
  }
}

const testSource = source.replace(/\ninitialize\(\);\s*$/, "");
const context = {
  console,
  document: {
    querySelector() {
      return {};
    },
  },
  localStorage: {
    store: {},
    getItem(key) {
      return this.store[key] || null;
    },
    setItem(key, value) {
      this.store[key] = value;
    },
  },
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
};

vm.createContext(context);
vm.runInContext(
  `${testSource}
  localStorage.store["daily-balance:2026-09-06"] = JSON.stringify({
    plan: [
      { id: "vocabulary", duration: 35 },
      { id: "research1", duration: 60 },
      { id: "listening", duration: 50 },
      { id: "reading", duration: 65 },
      { id: "research2", duration: 60 },
      { id: "speaking", duration: 35 },
      { id: "writing", duration: 55 }
    ],
    tasks: {
      vocabulary: { complete: true },
      research1: { complete: true },
      listening: { complete: true },
      reading: { complete: true },
      research2: { complete: true },
      speaking: { complete: true },
      writing: { complete: false }
    }
  });
  localStorage.store["daily-balance:2026-09-05"] = JSON.stringify({
    plan: [
      { id: "vocabulary", duration: 30 },
      { id: "research1", duration: 45 },
      { id: "listening", duration: 40 },
      { id: "reading", duration: 50 },
      { id: "research2", duration: 45 },
      { id: "speaking", duration: 30 },
      { id: "writing", duration: 45 }
    ],
    tasks: {
      vocabulary: { complete: true },
      research1: { complete: true },
      listening: { complete: true },
      reading: { complete: true },
      research2: { complete: false },
      speaking: { complete: false },
      writing: { complete: false }
    }
  });
  globalThis.__plannerTests = {
    allocations: [180, 240, 360, 480].map((total) => ({
      total,
      values: allocateDurations(total),
    })),
    midnight: formatClock(24 * 60 + 15),
    analytics: buildAnalytics(["2026-09-06", "2026-09-05"]),
  };`,
  context,
);

for (const result of context.__plannerTests.allocations) {
  const values = Object.values(result.values);
  const allocated = values.reduce((sum, value) => sum + value, 0);
  if (allocated !== result.total) {
    throw new Error(
      `${result.total} 分钟计划分配错误：实际分配 ${allocated} 分钟`,
    );
  }
  if (values.some((value) => value < 5)) {
    throw new Error(`${result.total} 分钟计划出现过短任务`);
  }
}

if (context.__plannerTests.midnight !== "00:15") {
  throw new Error("跨午夜时间格式化错误");
}

const analytics = context.__plannerTests.analytics;
if (analytics.completionRate !== 71) {
  throw new Error(`7 日完成率统计错误：${analytics.completionRate}%`);
}
if (analytics.weakest.id !== "writing") {
  throw new Error(`薄弱模块识别错误：${analytics.weakest.id}`);
}
if (analytics.balancedStreak !== 0) {
  throw new Error(`连续均衡日统计错误：${analytics.balancedStreak}`);
}

console.log("Smoke test passed.");
console.table(context.__plannerTests.allocations);
