// 近 7 天反馈：完成率、薄弱模块、连续均衡日。纯函数，输入是每日记录和投入方向。

import { areaIdOf } from "./focus-areas.js";

function hasDayActivity(dayState) {
  if (!dayState) return false;
  return Boolean(
    dayState.plan?.length || Object.keys(dayState.tasks || {}).length || dayState.reflection,
  );
}

// 统计时出现的方向：当前在用的，加上这几天记录里出现过、后来被归档的。
export function areasInHistory(areas, records) {
  const used = new Set();
  Object.values(records).forEach((record) =>
    (record?.plan || []).forEach((entry) => used.add(areaIdOf(entry))),
  );
  return areas.filter((area) => !area.archived || used.has(area.id));
}

export function summarizeDay(key, dayState, areas) {
  const plan = Array.isArray(dayState?.plan) ? dayState.plan : [];
  const tasks = dayState?.tasks || {};
  const isDone = (entry) => Boolean(tasks[entry.id]?.complete);
  const completed = plan.filter(isDone);
  const minutesOf = (entries) =>
    entries.reduce((sum, entry) => sum + (Number(entry.duration) || 0), 0);

  const categories = {};
  areas.forEach((area) => {
    const planned = plan.filter((entry) => areaIdOf(entry) === area.id);
    const done = planned.filter(isDone);
    categories[area.id] = {
      name: area.shortName || area.name,
      planned: planned.length > 0,
      completed: done.length > 0,
      completedMinutes: minutesOf(done),
    };
  });
  const categoryList = Object.values(categories);

  return {
    key,
    active: hasDayActivity(dayState),
    completedTaskCount: completed.length,
    plannedTaskCount: plan.length,
    completedMinutes: minutesOf(completed),
    totalMinutes: minutesOf(plan),
    // 被挤占（没排进计划）的方向不算失衡。
    balanced:
      categoryList.some((item) => item.planned) &&
      categoryList.every((item) => !item.planned || item.completed),
    categories,
  };
}

// records: { "YYYY-MM-DD": 每日记录 }；dateKeys 从今天往前排。
export function buildAnalytics(records, dateKeys, allAreas) {
  const areas = areasInHistory(allAreas, records);
  const summaries = dateKeys.map((key) => summarizeDay(key, records[key], areas));
  const activeDays = summaries.filter((day) => day.active);
  const daysForRate = activeDays.length ? activeDays : summaries.slice(0, 1);
  const plannedTasks = daysForRate.reduce((sum, day) => sum + day.plannedTaskCount, 0);
  const completedTasks = daysForRate.reduce((sum, day) => sum + day.completedTaskCount, 0);
  const completionRate = plannedTasks ? Math.round((completedTasks / plannedTasks) * 100) : 0;

  const categoryStats = areas.map((area) => {
    const planned = daysForRate.filter((day) => day.categories[area.id]?.planned).length;
    const completed = daysForRate.filter((day) => day.categories[area.id]?.completed).length;
    return {
      id: area.id,
      name: area.shortName || area.name,
      planned,
      completed,
      missed: Math.max(0, planned - completed),
      completionRate: planned ? Math.round((completed / planned) * 100) : 0,
      completedMinutes: daysForRate.reduce(
        (sum, day) => sum + (day.categories[area.id]?.completedMinutes || 0),
        0,
      ),
    };
  });

  const weakest = [...categoryStats]
    .filter((item) => item.planned > 0)
    .sort((a, b) => b.missed - a.missed || a.completionRate - b.completionRate)[0];

  let balancedStreak = 0;
  for (const day of summaries) {
    if (!day.active || !day.balanced) break;
    balancedStreak += 1;
  }

  const totalCompletedMinutes = daysForRate.reduce((sum, day) => sum + day.completedMinutes, 0);

  return {
    summaries,
    activeDayCount: activeDays.length,
    completionRate,
    totalCompletedMinutes,
    balancedStreak,
    weakest,
    categoryStats,
    insights: buildInsights({
      activeDayCount: activeDays.length,
      completionRate,
      weakest,
      categoryStats,
      balancedStreak,
    }),
  };
}

export function buildInsights({ activeDayCount, completionRate, weakest, categoryStats, balancedStreak }) {
  const insights = [];

  if (activeDayCount < 2) {
    insights.push("先积累 2-3 天记录，系统会更准确地识别你真正容易逃避的方向。");
  }

  if (weakest?.missed >= 2) {
    insights.push(
      `${weakest.name}近 7 天被跳过 ${weakest.missed} 次，今天先用“5 分钟启动”，目标不是表现好，而是打破回避。`,
    );
  }

  // 雅思的两个输出类方向还在用时，给一条针对性的建议。
  const writing = categoryStats.find((item) => item.id === "writing");
  const speaking = categoryStats.find((item) => item.id === "speaking");
  if ((writing?.missed || 0) + (speaking?.missed || 0) >= 2) {
    insights.push("输出类任务被跳过较多时，不要等整块时间：写一个主体段或录一段 2 分钟回答也算推进。");
  }

  if (completionRate < 50 && activeDayCount >= 2) {
    insights.push("近 7 天完成率偏低，可以先把总时长调到 3-4 小时，稳住每日覆盖率再加量。");
  }

  if (balancedStreak >= 2) {
    insights.push(`你已经连续 ${balancedStreak} 天保持均衡推进，可以把其中一个弱项的目标稍微加深。`);
  }

  if (!insights.length) {
    insights.push("目前没有明显偏科信号。继续保持“每个方向每天至少推进一次”的节奏。");
  }

  return insights;
}
