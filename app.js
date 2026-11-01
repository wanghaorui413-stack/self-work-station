const TASK_TYPES = {
  vocabulary: {
    name: "雅思单词复习",
    shortName: "单词",
    icon: "Aa",
    color: "#6b91a8",
    minimum: 20,
    weight: 0.1,
    description: "复习旧词优先于盲目加新词；最后 5 分钟集中处理错词。",
    placeholder: "今日小目标：例如复习 120 个旧词 + 20 个错词",
  },
  research1: {
    name: "科研深度工作（一）",
    shortName: "科研",
    icon: "研",
    color: "#1f5c48",
    minimum: 30,
    weight: 0.17,
    description: "只定义一个可交付结果，避免把“做科研”当成无限任务。",
    placeholder: "今日小目标：例如完成图 3 初稿 / 修改方法部分两段",
  },
  listening: {
    name: "雅思听力练习",
    shortName: "听力",
    icon: "听",
    color: "#e68a53",
    minimum: 25,
    weight: 0.14,
    description: "做题、核对、精听各占一部分；记录漏听原因，不只记录分数。",
    placeholder: "今日小目标：例如完成 Section 3 并精听错题句",
  },
  reading: {
    name: "雅思阅读练习",
    shortName: "阅读",
    icon: "读",
    color: "#927ca5",
    minimum: 35,
    weight: 0.18,
    description: "限时完成后复盘定位依据；卡住超过 3 分钟先标记再继续。",
    placeholder: "今日小目标：例如限时完成一篇 + 整理 5 个同义替换",
  },
  research2: {
    name: "科研深度工作（二）",
    shortName: "科研",
    icon: "研",
    color: "#1f5c48",
    minimum: 30,
    weight: 0.17,
    description: "承接上午结果，优先完成一个闭环，而不是同时打开更多任务。",
    placeholder: "今日小目标：例如跑完一组实验并写下结果判断",
  },
  speaking: {
    name: "雅思口语练习",
    shortName: "口语",
    icon: "说",
    color: "#c57365",
    minimum: 20,
    weight: 0.1,
    description: "必须开口并录音；追求表达完整，不在脑内反复准备。",
    placeholder: "今日小目标：例如录制 2 个 Part 2 话题并复述一次",
  },
  writing: {
    name: "雅思写作练习",
    shortName: "写作",
    icon: "写",
    color: "#b08b42",
    minimum: 30,
    weight: 0.14,
    description: "完整作文与局部训练交替；时间少时也至少写提纲和一个主体段。",
    placeholder: "今日小目标：例如完成 Task 2 提纲 + 一个主体段",
  },
};

const ORDER = [
  "vocabulary",
  "research1",
  "listening",
  "reading",
  "research2",
  "speaking",
  "writing",
];

const dom = {
  todayLabel: document.querySelector("#todayLabel"),
  progressRing: document.querySelector("#progressRing"),
  progressPercent: document.querySelector("#progressPercent"),
  progressText: document.querySelector("#progressText"),
  focusSummary: document.querySelector("#focusSummary"),
  totalMinutes: document.querySelector("#totalMinutes"),
  startTime: document.querySelector("#startTime"),
  dayEnd: document.querySelector("#dayEnd"),
  breakMinutes: document.querySelector("#breakMinutes"),
  longBreakMinutes: document.querySelector("#longBreakMinutes"),
  regenerateButton: document.querySelector("#regenerateButton"),
  notificationButton: document.querySelector("#notificationButton"),
  resetButton: document.querySelector("#resetButton"),
  scheduleList: document.querySelector("#scheduleList"),
  timerPanel: document.querySelector("#timerPanel"),
  timerTaskName: document.querySelector("#timerTaskName"),
  timerHint: document.querySelector("#timerHint"),
  timerDisplay: document.querySelector("#timerDisplay"),
  pauseButton: document.querySelector("#pauseButton"),
  finishButton: document.querySelector("#finishButton"),
  reflection: document.querySelector("#reflection"),
  saveStatus: document.querySelector("#saveStatus"),
  toast: document.querySelector("#toast"),
  analyticsCompletion: document.querySelector("#analyticsCompletion"),
  analyticsWeakness: document.querySelector("#analyticsWeakness"),
  analyticsStreak: document.querySelector("#analyticsStreak"),
  analyticsTotalTime: document.querySelector("#analyticsTotalTime"),
  analyticsBars: document.querySelector("#analyticsBars"),
  planRationale: document.querySelector("#planRationale"),
  insightList: document.querySelector("#insightList"),
  syncStatus: document.querySelector("#syncStatus"),
  syncButton: document.querySelector("#syncButton"),
  recruitAlerts: document.querySelector("#recruitAlerts"),
  recruitList: document.querySelector("#recruitList"),
};

const HISTORY_DAYS = 7;
const TIME_ZONE = "Asia/Shanghai";
const STORE_PREFIX = "daily-balance:";
const DEFAULT_SETTINGS = {
  totalMinutes: "360",
  startTime: "09:00",
  dayEnd: "21:30",
  breakMinutes: "10",
  longBreakMinutes: "45",
};
// 招聘事项挤满当天时，均衡任务按这个顺序保底（科研 + 单词）。
const CROWD_PRIORITY = ["vocabulary", "research1", "research2"];
const RECRUIT_POLL_MS = 10 * 60 * 1000;
const REMINDER_CHECK_MS = 30 * 1000;
const FIRED_REMINDERS_KEY = "self-work-station:fired-reminders";
const RECRUIT_UPCOMING_DAYS = 14;
const RECRUIT_TYPE_ICONS = {
  appointment: "约",
  deadline: "限",
};

const CATEGORY_DEFINITIONS = {
  vocabulary: {
    name: "单词",
    taskIds: ["vocabulary"],
  },
  listening: {
    name: "听力",
    taskIds: ["listening"],
  },
  reading: {
    name: "阅读",
    taskIds: ["reading"],
  },
  speaking: {
    name: "口语",
    taskIds: ["speaking"],
  },
  writing: {
    name: "写作",
    taskIds: ["writing"],
  },
  research: {
    name: "科研",
    taskIds: ["research1", "research2"],
  },
};

const CATEGORY_ORDER = [
  "vocabulary",
  "listening",
  "reading",
  "speaking",
  "writing",
  "research",
];

const dateKey = formatDateKey(new Date());
const storageKey = `daily-balance:${dateKey}`;
const settingsKey = "daily-balance:settings";
const isDemoMode =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("demo") === "1";
const isScreenshotMode =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("screenshot") === "1";

let state = loadState();
let recruitData = { items: [], lastSyncedAt: null };
let recruitSource = "loading"; // loading | server | offline
let recruitSchedule = { placements: {}, unplaceable: [] };
let timerInterval = null;
let activeTimer = null;
let toastTimeout = null;

function formatDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
  }).format(date);
}

function defaultState() {
  return {
    tasks: {},
    reflection: "",
    plan: null,
  };
}

function loadState() {
  if (isDemoMode) {
    return { ...defaultState(), ...createDemoState(0) };
  }

  try {
    return { ...defaultState(), ...JSON.parse(localStorage.getItem(storageKey)) };
  } catch {
    return defaultState();
  }
}

function saveState() {
  if (isDemoMode) return;
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function loadSettings() {
  if (isDemoMode) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(settingsKey)) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function currentSettings() {
  return {
    totalMinutes: dom.totalMinutes.value,
    startTime: dom.startTime.value || DEFAULT_SETTINGS.startTime,
    dayEnd: dom.dayEnd.value || DEFAULT_SETTINGS.dayEnd,
    breakMinutes: dom.breakMinutes.value,
    longBreakMinutes: dom.longBreakMinutes.value,
  };
}

function saveSettings() {
  if (isDemoMode) return;
  localStorage.setItem(settingsKey, JSON.stringify(currentSettings()));
}

function roundToFive(value) {
  return Math.max(5, Math.round(value / 5) * 5);
}

function minimumTotalFor(ids) {
  return ids.reduce((sum, key) => sum + TASK_TYPES[key].minimum, 0);
}

function allocateDurations(totalMinutes, ids = ORDER) {
  const minimumTotal = minimumTotalFor(ids);
  const weightTotal = ids.reduce((sum, key) => sum + TASK_TYPES[key].weight, 0);
  const result = {};

  if (totalMinutes < minimumTotal) {
    const scale = totalMinutes / minimumTotal;
    ids.forEach((key) => {
      result[key] = roundToFive(TASK_TYPES[key].minimum * scale);
    });
  } else {
    const extra = totalMinutes - minimumTotal;
    ids.forEach((key) => {
      result[key] = roundToFive(
        TASK_TYPES[key].minimum + (extra * TASK_TYPES[key].weight) / weightTotal,
      );
    });
  }

  // 取整误差放进最后一个科研块（没有科研就放进最后一项）。
  const sink = ids.includes("research2")
    ? "research2"
    : ids.includes("research1")
      ? "research1"
      : ids[ids.length - 1];
  const allocated = ids.reduce((sum, key) => sum + result[key], 0);
  result[sink] += totalMinutes - allocated;

  if (sink === "research2" && result.research2 < 10 && ids.includes("research1")) {
    const shortfall = 10 - result.research2;
    result.research2 = 10;
    result.research1 = Math.max(10, result.research1 - shortfall);
  }

  return result;
}

function breakOverhead(ids, breakMinutes, longBreakMinutes) {
  if (ids.length <= 1) return 0;
  const longBreak = ids.slice(0, -1).includes("reading") ? longBreakMinutes - breakMinutes : 0;
  return (ids.length - 1) * breakMinutes + longBreak;
}

// 选出今天要排的均衡任务：空档够就全排；不够最低保障时只保科研 + 单词，其余算挤占。
function chooseBalanceTasks(totalMinutes, freeMinutes, breakMinutes, longBreakMinutes) {
  const budget = (ids) =>
    Math.min(totalMinutes, freeMinutes - breakOverhead(ids, breakMinutes, longBreakMinutes));

  if (budget(ORDER) >= minimumTotalFor(ORDER)) {
    return { ids: ORDER, total: budget(ORDER) };
  }
  for (let count = CROWD_PRIORITY.length; count >= 1; count -= 1) {
    const ids = ORDER.filter((id) => CROWD_PRIORITY.slice(0, count).includes(id));
    if (budget(ids) >= minimumTotalFor(ids) || count === 1) {
      return { ids, total: Math.max(0, budget(ids)) };
    }
  }
  return { ids: [], total: 0 };
}

function buildPlan() {
  const settings = currentSettings();
  const totalMinutes = Number(settings.totalMinutes);
  const breakMinutes = Number(settings.breakMinutes);
  const longBreakMinutes = Number(settings.longBreakMinutes);
  const busy = todayBusyMinutes();
  const free = Recruiting.freeMinutes(dateKey, busy, settings);
  const chosen = chooseBalanceTasks(totalMinutes, free, breakMinutes, longBreakMinutes);
  const ids = chosen.total >= 10 ? chosen.ids : [];
  const durations = ids.length ? allocateDurations(chosen.total, ids) : {};

  const { plan, crowdedOut } = Recruiting.layoutBalanceTasks({
    order: ids,
    durations,
    busy,
    dayStart: timeToMinutes(settings.startTime),
    dayEnd: timeToMinutes(settings.dayEnd),
    breakMinutes,
    longBreakAfter: "reading",
    longBreakMinutes,
  });

  state.crowdedOut = [...ORDER.filter((id) => !ids.includes(id)), ...crowdedOut];
  state.busySignature = JSON.stringify(busy);
  return plan;
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatClock(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分` : `${hours} 小时`;
}

function safeParseState(rawValue) {
  if (!rawValue) return null;
  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

function getHistoryDateKeys(days = HISTORY_DAYS) {
  const keys = [];
  const cursor = new Date();
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() - offset);
    keys.push(formatDateKey(date));
  }
  return keys;
}

function loadStateForDate(key) {
  if (isDemoMode) {
    return createDemoStateForDate(key);
  }
  return safeParseState(localStorage.getItem(`${STORE_PREFIX}${key}`));
}

function createDemoStateForDate(key) {
  const dateKeys = getHistoryDateKeys(3);
  const offset = dateKeys.indexOf(key);
  return offset >= 0 ? createDemoState(offset) : null;
}

function createDemoState(offset) {
  const demoPlans = [
    {
      plan: createDemoPlan([35, 60, 50, 65, 60, 35, 55]),
      tasks: {
        vocabulary: {
          complete: true,
          goal: "复习旧词 120 个 + 错词 20 个",
          completedAt: "demo",
        },
        research1: {
          complete: true,
          goal: "完成图表说明初稿",
          completedAt: "demo",
        },
        listening: {
          complete: true,
          goal: "Section 3 精听错题句",
          completedAt: "demo",
        },
        reading: {
          complete: true,
          goal: "限时一篇 + 5 个同义替换",
          completedAt: "demo",
        },
        research2: {
          complete: false,
          goal: "整理实验结果判断",
        },
        speaking: {
          complete: false,
          goal: "录 2 个 Part 2 话题",
          quickStarts: 1,
        },
        writing: {
          complete: false,
          goal: "Task 2 提纲 + 主体段",
          quickStarts: 2,
        },
      },
      reflection:
        "今天阅读进入状态很快，但写作还是容易拖。明天写作先做 5 分钟提纲。",
    },
    {
      plan: createDemoPlan([30, 45, 40, 50, 45, 30, 45]),
      tasks: {
        vocabulary: { complete: true },
        research1: { complete: true },
        listening: { complete: true },
        reading: { complete: true },
        research2: { complete: true },
        speaking: { complete: false },
        writing: { complete: false },
      },
      reflection: "科研完成一轮修改，输出类雅思任务被挤掉。",
    },
    {
      plan: createDemoPlan([30, 45, 40, 50, 45, 30, 45]),
      tasks: {
        vocabulary: { complete: true },
        research1: { complete: true },
        listening: { complete: false },
        reading: { complete: true },
        research2: { complete: true },
        speaking: { complete: true },
        writing: { complete: false },
      },
      reflection: "口语完成录音，但听力和写作复盘不足。",
    },
  ];

  return demoPlans[offset] || null;
}

function createDemoPlan(durations) {
  let cursor = 9 * 60;
  return ORDER.map((id, index) => {
    const start = cursor;
    const duration = durations[index];
    cursor += duration;
    const end = cursor;
    if (index < ORDER.length - 1) {
      cursor += id === "reading" ? 45 : 10;
    }
    return { id, start, end, duration };
  });
}

function hasDayActivity(dayState) {
  if (!dayState) return false;
  return Boolean(
    dayState.plan?.length ||
      Object.keys(dayState.tasks || {}).length ||
      dayState.reflection,
  );
}

function summarizeDay(key, dayState) {
  const plan = Array.isArray(dayState?.plan) ? dayState.plan : [];
  const tasks = dayState?.tasks || {};
  const durationByTask = Object.fromEntries(
    plan.map((item) => [item.id, Number(item.duration) || 0]),
  );
  const plannedTaskIds = plan.length ? plan.map((item) => item.id) : ORDER;
  const completedTaskIds = plannedTaskIds.filter((taskId) => tasks[taskId]?.complete);
  const completedMinutes = completedTaskIds.reduce(
    (sum, taskId) => sum + (durationByTask[taskId] || 0),
    0,
  );
  const totalMinutes = plan.reduce(
    (sum, item) => sum + (Number(item.duration) || 0),
    0,
  );

  const categories = {};
  CATEGORY_ORDER.forEach((categoryId) => {
    const definition = CATEGORY_DEFINITIONS[categoryId];
    const plannedIds = definition.taskIds.filter((taskId) =>
      plannedTaskIds.includes(taskId),
    );
    const completedIds = plannedIds.filter((taskId) => tasks[taskId]?.complete);
    categories[categoryId] = {
      name: definition.name,
      planned: plannedIds.length > 0,
      completed: completedIds.length > 0,
      completedMinutes: completedIds.reduce(
        (sum, taskId) => sum + (durationByTask[taskId] || 0),
        0,
      ),
    };
  });

  return {
    key,
    active: hasDayActivity(dayState),
    completedTaskCount: completedTaskIds.length,
    plannedTaskCount: plannedTaskIds.length,
    completedMinutes,
    totalMinutes,
    // 被挤占（没排进计划）的类别不算失衡。
    balanced:
      CATEGORY_ORDER.some((categoryId) => categories[categoryId].planned) &&
      CATEGORY_ORDER.every(
        (categoryId) => !categories[categoryId].planned || categories[categoryId].completed,
      ),
    categories,
  };
}

function buildAnalytics(dateKeys = getHistoryDateKeys()) {
  const summaries = dateKeys.map((key) => summarizeDay(key, loadStateForDate(key)));
  const activeDays = summaries.filter((day) => day.active);
  const daysForRate = activeDays.length ? activeDays : summaries.slice(0, 1);
  const plannedTasks = daysForRate.reduce(
    (sum, day) => sum + day.plannedTaskCount,
    0,
  );
  const completedTasks = daysForRate.reduce(
    (sum, day) => sum + day.completedTaskCount,
    0,
  );
  const completionRate = plannedTasks
    ? Math.round((completedTasks / plannedTasks) * 100)
    : 0;

  const categoryStats = CATEGORY_ORDER.map((categoryId) => {
    const definition = CATEGORY_DEFINITIONS[categoryId];
    const planned = daysForRate.filter(
      (day) => day.categories[categoryId]?.planned,
    ).length;
    const completed = daysForRate.filter(
      (day) => day.categories[categoryId]?.completed,
    ).length;
    const completedMinutes = daysForRate.reduce(
      (sum, day) => sum + (day.categories[categoryId]?.completedMinutes || 0),
      0,
    );
    return {
      id: categoryId,
      name: definition.name,
      planned,
      completed,
      missed: Math.max(0, planned - completed),
      completionRate: planned ? Math.round((completed / planned) * 100) : 0,
      completedMinutes,
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

  const totalCompletedMinutes = daysForRate.reduce(
    (sum, day) => sum + day.completedMinutes,
    0,
  );

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

function buildInsights({ activeDayCount, completionRate, weakest, categoryStats, balancedStreak }) {
  const insights = [];

  if (activeDayCount < 2) {
    insights.push("先积累 2-3 天记录，系统会更准确地识别你真正容易逃避的模块。");
  }

  if (weakest?.missed >= 2) {
    insights.push(
      `${weakest.name}近 7 天被跳过 ${weakest.missed} 次，今天先用“5 分钟启动”，目标不是表现好，而是打破回避。`,
    );
  }

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
    insights.push("目前没有明显偏科信号。继续保持“每类任务每天至少推进一次”的节奏。");
  }

  return insights;
}

function buildPlanRationale() {
  const plan = state.plan || [];
  const minutesOf = (ids) =>
    plan.filter((item) => ids.includes(item.id)).reduce((sum, item) => sum + item.duration, 0);
  const researchMinutes = minutesOf(["research1", "research2"]);
  const ieltsMinutes = minutesOf(["vocabulary", "listening", "reading", "speaking", "writing"]);
  const busyMinutes = todayBusyMinutes().reduce((sum, block) => sum + block.end - block.start, 0);
  const crowded = (state.crowdedOut || []).map((id) => TASK_TYPES[id].shortName);

  const lines = [];
  if (busyMinutes) {
    lines.push(`招聘事项今天占用 ${formatDuration(busyMinutes)}（含准备和缓冲），均衡任务只排在剩下的空档里。`);
  }
  lines.push(
    `均衡任务共 ${formatDuration(researchMinutes + ieltsMinutes)}：雅思 ${formatDuration(ieltsMinutes)}，科研 ${formatDuration(researchMinutes)}，按“最低保障 + 权重分配”生成。`,
  );
  if (crowded.length) {
    lines.push(`空档不够，${[...new Set(crowded)].join("、")}今天被挤占。这不算跳过，也不计入薄弱模块。`);
  } else {
    lines.push("科研拆成两段，避免单项任务吞掉全天；每类任务今天都至少出现一次。");
  }
  lines.push("如果系统识别到弱项，先用提醒和 5 分钟启动处理回避，不直接牺牲其他模块的最低保障。");
  return lines;
}

function getTaskState(id) {
  if (!state.tasks[id]) {
    state.tasks[id] = {
      complete: false,
      goal: "",
      elapsedSeconds: 0,
    };
  }
  return state.tasks[id];
}

function render() {
  if (!state.plan) {
    state.plan = buildPlan();
    saveState();
  }

  dom.scheduleList.innerHTML = "";

  const timeline = [
    ...state.plan.map((item) => ({ type: "balance", start: item.start, item })),
    ...todayRecruitEntries(),
  ].sort((a, b) => a.start - b.start);

  timeline.forEach((entry) => {
    if (entry.type === "recruit") {
      dom.scheduleList.appendChild(renderRecruitTimelineCard(entry));
      return;
    }
    const item = entry.item;
    const task = TASK_TYPES[item.id];
    const taskState = getTaskState(item.id);
    const card = document.createElement("article");
    card.className = [
      "task-card",
      taskState.complete ? "is-complete" : "",
      activeTimer?.taskId === item.id ? "is-active" : "",
    ]
      .filter(Boolean)
      .join(" ");
    card.style.setProperty("--task-color", task.color);
    card.dataset.taskId = item.id;

    card.innerHTML = `
      <div class="task-time">${formatClock(item.start)}<br />${formatClock(item.end)}</div>
      <div class="task-icon" aria-hidden="true">${task.icon}</div>
      <div class="task-content">
        <div class="task-meta">
          <h3 class="task-title">${task.name}</h3>
          <span class="duration-pill">${formatDuration(item.duration)}</span>
        </div>
        <p class="task-description">${task.description}</p>
        <input
          class="micro-goal"
          type="text"
          value="${escapeHtml(taskState.goal)}"
          placeholder="${task.placeholder}"
          aria-label="${task.name}的今日小目标"
        />
      </div>
      <div class="task-controls">
        <button class="task-button quick" type="button" data-action="quick" ${
          taskState.complete ? "disabled" : ""
        }>先做 5 分钟</button>
        <button class="task-button" type="button" data-action="start" ${
          taskState.complete ? "disabled" : ""
        }>开始计时</button>
        <button class="task-button complete" type="button" data-action="complete">
          ${taskState.complete ? "撤销完成" : "标记完成"}
        </button>
      </div>
    `;

    const goalInput = card.querySelector(".micro-goal");
    goalInput.addEventListener("input", (event) => {
      getTaskState(item.id).goal = event.target.value;
      saveState();
      flashSaveStatus();
    });

    card.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.action;
        if (action === "quick") startTimer(item.id, 5, true);
        if (action === "start") startTimer(item.id, item.duration, false);
        if (action === "complete") toggleComplete(item.id);
      });
    });

    dom.scheduleList.appendChild(card);
  });

  if (!state.plan.length && !timeline.length) {
    dom.scheduleList.innerHTML =
      '<p class="empty-note">今天的空档不够安排均衡任务。先把招聘事项做好，均衡任务明天补上。</p>';
  }

  updateProgress();
  renderAnalytics();
  renderRecruit();
  updateTimerPanel();
}


// ---------- 招聘事项 ----------

function recruitSettings() {
  const settings = currentSettings();
  return { startTime: settings.startTime, dayEnd: settings.dayEnd };
}

function refreshRecruitSchedule() {
  recruitSchedule = Recruiting.placeDeadlineTasks(
    recruitData.items || [],
    recruitSettings(),
    Date.now(),
  );
}

function todayBusyMinutes() {
  return Recruiting.busyMinutesForDay(
    dateKey,
    recruitData.items || [],
    recruitSchedule.placements,
    recruitSettings(),
  );
}

function recruitTypeLabel(item) {
  return item.type || (item.kind === "appointment" ? "面试" : "截止任务");
}

// 招聘事项在今天时间表里的条目：固定日程按实际开始时间，截止任务按排定时段。
function todayRecruitEntries() {
  const entries = [];
  for (const item of recruitData.items || []) {
    if (!Recruiting.BLOCKING_STATUSES.includes(item.status)) continue;
    if (item.kind === "appointment") {
      const block = Recruiting.blockedTime(item, recruitSettings());
      if (block && Recruiting.dateKeyOf(block.eventStart) === dateKey) {
        entries.push({
          type: "recruit",
          item,
          start: Recruiting.minutesOfDay(block.eventStart),
          end: Recruiting.minutesOfDay(block.eventEnd),
          block,
        });
      }
    } else {
      const slot = recruitSchedule.placements[item.id];
      if (slot && Recruiting.dateKeyOf(slot.start) === dateKey) {
        entries.push({
          type: "recruit",
          item,
          start: Recruiting.minutesOfDay(slot.start),
          end: Recruiting.minutesOfDay(slot.end),
          slot,
        });
      }
    }
  }
  return entries;
}

function safeLink(url) {
  return /^https?:\/\//i.test(url || "") ? url : null;
}

function recruitLinkHtml(item) {
  const link = safeLink(item.link);
  const source = safeLink(item.sourceEmails?.[0]?.url);
  return [
    link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">打开链接</a>` : "",
    item.location ? `<span>${escapeHtml(item.location)}</span>` : "",
    source ? `<a href="${escapeHtml(source)}" target="_blank" rel="noopener">原邮件</a>` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderRecruitTimelineCard(entry) {
  const { item } = entry;
  const card = document.createElement("article");
  card.className = "task-card recruit-card";
  card.style.setProperty("--task-color", item.kind === "appointment" ? "#c0503a" : "#3f6fb0");
  const detail =
    item.kind === "appointment"
      ? `占用 ${Recruiting.formatClock(entry.block.start)}-${Recruiting.formatClock(entry.block.end)}（含准备与缓冲）`
      : `截止 ${Recruiting.formatDayLabel(Recruiting.parseTime(item.deadline))}${entry.slot.manual ? " · 手动指定" : " · 自动安排"}`;
  card.innerHTML = `
    <div class="task-time">${formatClock(entry.start)}<br />${formatClock(entry.end)}</div>
    <div class="task-icon" aria-hidden="true">${RECRUIT_TYPE_ICONS[item.kind] || "招"}</div>
    <div class="task-content">
      <div class="task-meta">
        <h3 class="task-title">${escapeHtml(Recruiting.describe(item))}</h3>
        <span class="duration-pill recruit-pill">${escapeHtml(recruitTypeLabel(item))}</span>
        ${statusChip(item)}
      </div>
      <p class="task-description">${escapeHtml(detail)}</p>
      <p class="recruit-links">${recruitLinkHtml(item)}</p>
    </div>
    <div class="task-controls">${recruitActionButtons(item)}</div>
  `;
  bindRecruitActions(card, item);
  return card;
}

function statusChip(item) {
  return `<span class="status-chip status-${item.status}">${Recruiting.STATUS_LABELS[item.status] || item.status}</span>`;
}

function recruitActionButtons(item) {
  const buttons = [];
  if (item.status === "pending_confirmation") {
    buttons.push('<button class="task-button complete" type="button" data-recruit="confirm">已回复确认</button>');
  }
  if (item.status === "changed") {
    buttons.push('<button class="task-button complete" type="button" data-recruit="ack">知道了</button>');
  }
  if (item.kind === "deadline" && Recruiting.BLOCKING_STATUSES.includes(item.status)) {
    buttons.push('<button class="task-button complete" type="button" data-recruit="done">标记完成</button>');
    buttons.push('<button class="task-button" type="button" data-recruit="move">改时间</button>');
  }
  if (item.kind === "appointment" && Recruiting.BLOCKING_STATUSES.includes(item.status)) {
    buttons.push('<button class="task-button" type="button" data-recruit="done">已结束</button>');
  }
  if (Recruiting.isOpen(item)) {
    buttons.push('<button class="task-button quiet" type="button" data-recruit="cancel">取消</button>');
  }
  return buttons.join("");
}

function bindRecruitActions(container, item) {
  container.querySelectorAll("[data-recruit]").forEach((button) => {
    button.addEventListener("click", () => handleRecruitAction(item, button.dataset.recruit, container));
  });
}

function toLocalInput(value) {
  const ms = Recruiting.parseTime(value);
  return ms === null ? "" : Recruiting.toIso(ms).slice(0, 16);
}

function fromLocalInput(value) {
  return value ? `${value}:00+08:00` : null;
}

async function handleRecruitAction(item, action, container) {
  if (action === "confirm" || action === "ack") {
    await patchRecruitItem(item.id, { status: "scheduled" }, "已更新。");
  }
  if (action === "done") {
    await patchRecruitItem(
      item.id,
      { status: "done", completedAt: new Date().toISOString() },
      `${Recruiting.describe(item)} 已完成。`,
    );
  }
  if (action === "cancel") {
    if (!window.confirm(`确定把「${Recruiting.describe(item)}」标为已取消吗？`)) return;
    await patchRecruitItem(item.id, { status: "cancelled" }, "已取消，并从日程中移除。");
  }
  if (action === "move") {
    if (container.querySelector(".move-form")) return;
    const slot = recruitSchedule.placements[item.id];
    const form = document.createElement("form");
    form.className = "move-form";
    form.innerHTML = `
      <label><span>改到</span><input type="datetime-local" required value="${slot ? toLocalInput(slot.start) : ""}" /></label>
      <button class="task-button complete" type="submit">保存</button>
      ${item.manualSlot ? '<button class="task-button" type="button" data-auto>恢复自动安排</button>' : ""}
    `;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const value = form.querySelector("input").value;
      await patchRecruitItem(item.id, { manualSlot: { start: fromLocalInput(value) } }, "已改到指定时间。");
    });
    form.querySelector("[data-auto]")?.addEventListener("click", () =>
      patchRecruitItem(item.id, { manualSlot: null }, "已恢复自动安排。"),
    );
    container.querySelector(".task-content").appendChild(form);
  }
}

// 待核对事项的补全表单：补齐时间后进入日程。
function reviewFormHtml(item) {
  const isAppointment = item.kind !== "deadline";
  return `
    <form class="review-form" data-item="${escapeHtml(item.id)}">
      <label><span>类型</span>
        <select name="kind">
          <option value="appointment" ${isAppointment ? "selected" : ""}>固定日程（面试等）</option>
          <option value="deadline" ${isAppointment ? "" : "selected"}>截止任务（测评、AI 面试等）</option>
        </select>
      </label>
      <label data-for="appointment"><span>开始时间</span>
        <input name="start" type="datetime-local" value="${toLocalInput(item.start)}" /></label>
      <label data-for="appointment"><span>时长（分钟）</span>
        <input name="durationMinutes" type="number" min="15" step="15" value="${Number(item.durationMinutes) || 60}" /></label>
      <label data-for="appointment"><span>形式</span>
        <select name="mode">
          <option value="online" ${item.mode === "offline" ? "" : "selected"}>线上</option>
          <option value="offline" ${item.mode === "offline" ? "selected" : ""}>线下</option>
        </select>
      </label>
      <label data-for="deadline"><span>截止时间</span>
        <input name="deadline" type="datetime-local" value="${toLocalInput(item.deadline)}" /></label>
      <label data-for="deadline"><span>预计用时（分钟）</span>
        <input name="estimatedMinutes" type="number" min="15" step="15" value="${Number(item.estimatedMinutes) || 60}" /></label>
      <button class="task-button complete" type="submit">确认并排进日程</button>
    </form>
  `;
}

function bindReviewForm(form, item) {
  const syncVisibility = () => {
    const kind = form.elements.kind.value;
    form.querySelectorAll("[data-for]").forEach((label) => {
      label.hidden = label.dataset.for !== kind;
    });
  };
  form.elements.kind.addEventListener("change", syncVisibility);
  syncVisibility();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const kind = form.elements.kind.value;
    const patch = { kind, status: "scheduled" };
    if (kind === "appointment") {
      if (!form.elements.start.value) return showToast("请填写开始时间。");
      patch.start = fromLocalInput(form.elements.start.value);
      patch.durationMinutes = Number(form.elements.durationMinutes.value) || 60;
      patch.mode = form.elements.mode.value;
    } else {
      if (!form.elements.deadline.value) return showToast("请填写截止时间。");
      patch.deadline = fromLocalInput(form.elements.deadline.value);
      patch.estimatedMinutes = Number(form.elements.estimatedMinutes.value) || 60;
    }
    await patchRecruitItem(item.id, patch, "已补全，已排进日程。");
  });
}

function upcomingRecruitItems() {
  const now = Date.now();
  const horizon = now + RECRUIT_UPCOMING_DAYS * 24 * 60 * 60 * 1000;
  const sortTime = (item) => {
    if (item.kind === "appointment") return Recruiting.parseTime(item.start) ?? Infinity;
    return recruitSchedule.placements[item.id]?.start ?? Recruiting.parseTime(item.deadline) ?? Infinity;
  };
  return (recruitData.items || [])
    .filter((item) => Recruiting.BLOCKING_STATUSES.includes(item.status))
    .filter((item) => {
      const end =
        item.kind === "appointment"
          ? (Recruiting.parseTime(item.start) ?? 0) + (Number(item.durationMinutes) || 60) * 60000
          : Recruiting.parseTime(item.deadline) ?? Infinity;
      return end > now && sortTime(item) < horizon;
    })
    .sort((a, b) => sortTime(a) - sortTime(b));
}

function recruitWhenText(item) {
  if (item.kind === "appointment") {
    const start = Recruiting.parseTime(item.start);
    return `${Recruiting.formatDayLabel(start)} · ${Number(item.durationMinutes) || 60} 分钟 · ${item.mode === "offline" ? "线下" : "线上"}`;
  }
  const slot = recruitSchedule.placements[item.id];
  const deadline = Recruiting.parseTime(item.deadline);
  const planned = slot
    ? `安排在 ${Recruiting.formatDayLabel(slot.start)}`
    : "排不进日程，请手动改时间";
  return `${planned} · 截止 ${Recruiting.formatDayLabel(deadline)} · 约 ${Number(item.estimatedMinutes) || 60} 分钟`;
}

function renderRecruit() {
  const items = recruitData.items || [];
  const lastSynced = Recruiting.parseTime(recruitData.lastSyncedAt);
  if (recruitSource === "offline") {
    dom.syncStatus.textContent = "未连接本地服务器：请用开机自启的工作台打开（http://127.0.0.1:8000）。";
  } else if (recruitSource === "loading") {
    dom.syncStatus.textContent = "正在读取…";
  } else {
    dom.syncStatus.textContent = lastSynced
      ? `上次从邮件同步：${Recruiting.formatDayLabel(lastSynced)}`
      : "还没有从邮件同步过";
  }

  const alerts = items.filter((item) => item.status === "needs_review");
  const stuck = recruitSchedule.unplaceable
    .map((id) => items.find((item) => item.id === id))
    .filter(Boolean);
  dom.recruitAlerts.innerHTML = "";
  alerts.forEach((item) => {
    const card = document.createElement("article");
    card.className = "recruit-alert";
    card.innerHTML = `
      <div class="recruit-alert-head">
        ${statusChip(item)}
        <strong>${escapeHtml(Recruiting.describe(item))}</strong>
        <button class="text-button" type="button" data-recruit="cancel">不是招聘事项，忽略</button>
      </div>
      <p>${escapeHtml(item.reviewNote || "邮件里的时间信息不完整，请补全。")}</p>
      <p class="recruit-links">${recruitLinkHtml(item)}</p>
      ${reviewFormHtml(item)}
    `;
    bindReviewForm(card.querySelector(".review-form"), item);
    bindRecruitActions(card.querySelector(".recruit-alert-head"), item);
    dom.recruitAlerts.appendChild(card);
  });
  stuck.forEach((item) => {
    const card = document.createElement("article");
    card.className = "recruit-alert is-warning";
    card.innerHTML = `<p><strong>${escapeHtml(Recruiting.describe(item))}</strong>：截止前找不到足够长的空档，请在下方用“改时间”手动指定。</p>`;
    dom.recruitAlerts.appendChild(card);
  });

  const upcoming = upcomingRecruitItems();
  dom.recruitList.innerHTML = upcoming.length
    ? ""
    : `<p class="empty-note">${
        recruitSource === "server" ? "未来两周没有待办的招聘事项。" : "暂无数据。"
      }</p>`;
  upcoming.forEach((item) => {
    const row = document.createElement("article");
    row.className = `recruit-row kind-${item.kind}`;
    row.innerHTML = `
      <div class="recruit-row-main task-content">
        <div class="task-meta">
          <span class="duration-pill recruit-pill">${escapeHtml(recruitTypeLabel(item))}</span>
          <h3 class="task-title">${escapeHtml(Recruiting.describe(item))}</h3>
          ${statusChip(item)}
        </div>
        <p class="task-description">${escapeHtml(recruitWhenText(item))}</p>
        ${item.changeNote && item.status === "changed" ? `<p class="task-description">变更：${escapeHtml(item.changeNote)}</p>` : ""}
        <p class="recruit-links">${recruitLinkHtml(item)}</p>
      </div>
      <div class="task-controls">${recruitActionButtons(item)}</div>
    `;
    bindRecruitActions(row, item);
    dom.recruitList.appendChild(row);
  });
}

async function patchRecruitItem(id, patch, message) {
  try {
    const response = await fetch(`/api/items/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await loadRecruitData();
    showToast(message);
  } catch (error) {
    showToast(`保存失败：${error.message}。请确认本地服务器在运行。`);
  }
}

async function loadRecruitData() {
  if (isDemoMode) {
    recruitData = createDemoRecruitData();
    recruitSource = "server";
  } else {
    try {
      const response = await fetch("/api/items", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      recruitData = await response.json();
      recruitSource = "server";
    } catch {
      recruitSource = "offline";
    }
  }
  applyRecruitChanges();
}

// 招聘事项变化后：重新排截止任务；今天的占用时段变了就重排均衡任务（完成记录保留）。
function applyRecruitChanges() {
  refreshRecruitSchedule();
  if (recruitSource !== "server") {
    // 读不到数据时不动今天的计划，免得把已经避让好的时间表冲掉。
    render();
    return;
  }
  const signature = JSON.stringify(todayBusyMinutes());
  if (state.plan && state.busySignature !== undefined && state.busySignature !== signature) {
    state.plan = buildPlan();
    saveState();
    showToast("招聘事项有变化，今日均衡任务已重新避让。");
  } else if (state.plan && state.busySignature === undefined) {
    state.busySignature = signature;
    if (signature !== "[]") {
      state.plan = buildPlan();
    }
    saveState();
  }
  render();
  checkReminders();
}

function loadFiredReminders() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FIRED_REMINDERS_KEY)) || []);
  } catch {
    return new Set();
  }
}

function saveFiredReminders(keys) {
  try {
    localStorage.setItem(FIRED_REMINDERS_KEY, JSON.stringify([...keys].slice(-500)));
  } catch {
    // 存不下时最多重复提醒一次，不影响主流程。
  }
}

function checkReminders() {
  if (recruitSource !== "server" || isDemoMode) return;
  const fired = loadFiredReminders();
  const reminders = Recruiting.computeReminders(
    recruitData.items || [],
    recruitSchedule.placements,
    recruitSchedule.unplaceable,
    recruitSettings(),
  );
  const due = Recruiting.dueReminders(reminders, Date.now(), fired);
  if (!due.length) return;
  due.forEach((reminder) => {
    notify(reminder.title, reminder.body, { tag: reminder.key, requireInteraction: true });
    fired.add(reminder.key);
  });
  saveFiredReminders(fired);
  showToast(due.length === 1 ? `${due[0].title}：${due[0].body}` : `有 ${due.length} 条招聘事项提醒，请查看。`);
  playChime();
}

function createDemoRecruitData() {
  const day = (offset, time) =>
    `${Recruiting.addDays(dateKey, offset)}T${time}:00+08:00`;
  return {
    lastSyncedAt: day(0, "08:30"),
    items: [
      {
        id: "demo-1",
        kind: "appointment",
        type: "一面",
        status: "scheduled",
        company: "示例科技",
        title: "算法岗一面",
        start: day(0, "15:00"),
        durationMinutes: 60,
        mode: "online",
        link: "https://meeting.example.com",
      },
      {
        id: "demo-2",
        kind: "deadline",
        type: "在线测评",
        status: "scheduled",
        company: "示例集团",
        title: "性格与能力测评",
        windowStart: day(0, "00:00"),
        deadline: day(3, "23:59"),
        estimatedMinutes: 60,
      },
      {
        id: "demo-3",
        kind: "appointment",
        type: "二面",
        status: "pending_confirmation",
        company: "示例银行",
        title: "管培生二面",
        start: day(2, "10:00"),
        durationMinutes: 45,
        mode: "offline",
        location: "上海市浦东新区",
      },
      {
        id: "demo-4",
        kind: "deadline",
        type: "AI 面试",
        status: "needs_review",
        company: "示例咨询",
        title: "AI 视频面试",
        reviewNote: "邮件只写了“收到邮件后 72 小时内完成”，没有给出发送时间，请确认截止时间。",
      },
    ],
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toggleComplete(taskId, forceValue) {
  const taskState = getTaskState(taskId);
  taskState.complete =
    typeof forceValue === "boolean" ? forceValue : !taskState.complete;
  taskState.completedAt = taskState.complete ? new Date().toISOString() : null;

  if (activeTimer?.taskId === taskId && taskState.complete) {
    stopTimer();
  }

  saveState();
  render();
  showToast(
    taskState.complete
      ? `${TASK_TYPES[taskId].shortName}已完成。现在切换到下一项。`
      : `已恢复${TASK_TYPES[taskId].shortName}任务。`,
  );
}

function startTimer(taskId, minutes, isQuickStart) {
  stopTimer(false);
  if (isQuickStart) {
    const taskState = getTaskState(taskId);
    taskState.quickStarts = (taskState.quickStarts || 0) + 1;
    saveState();
  }

  activeTimer = {
    taskId,
    initialSeconds: minutes * 60,
    remainingSeconds: minutes * 60,
    isQuickStart,
    isPaused: false,
    startedAt: Date.now(),
  };

  timerInterval = window.setInterval(tickTimer, 1000);
  render();
  dom.timerPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  showToast(
    isQuickStart
      ? `只做 5 分钟，先越过启动阻力。`
      : `${TASK_TYPES[taskId].shortName}计时开始。`,
  );
}

function tickTimer() {
  if (!activeTimer || activeTimer.isPaused) return;

  activeTimer.remainingSeconds -= 1;
  getTaskState(activeTimer.taskId).elapsedSeconds += 1;

  if (activeTimer.remainingSeconds <= 0) {
    const completedTimer = { ...activeTimer };
    stopTimer(false);

    if (completedTimer.isQuickStart) {
      notify(
        "5 分钟已完成",
        `${TASK_TYPES[completedTimer.taskId].name}已经启动。可以继续完整任务，也可以按计划切换。`,
      );
      showToast("5 分钟启动完成。最难的部分已经过去，现在决定继续或切换。");
    } else {
      const completedState = getTaskState(completedTimer.taskId);
      completedState.complete = true;
      completedState.completedAt = new Date().toISOString();
      saveState();
      notify(
        "该切换任务了",
        `${TASK_TYPES[completedTimer.taskId].name}计时结束，休息后开始下一项。`,
      );
      showToast("本项时间已到并标记完成。休息一下，然后切换任务。");
    }
    render();
    playChime();
    return;
  }

  updateTimerPanel();
  if (activeTimer.remainingSeconds % 15 === 0) saveState();
}

function stopTimer(resetPanel = true) {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  activeTimer = null;
  if (resetPanel) updateTimerPanel();
}

function togglePause() {
  if (!activeTimer) return;
  activeTimer.isPaused = !activeTimer.isPaused;
  updateTimerPanel();
}

function finishActiveTask() {
  if (!activeTimer) return;
  const taskId = activeTimer.taskId;
  stopTimer(false);
  toggleComplete(taskId, true);
}

function updateTimerPanel() {
  if (!activeTimer) {
    dom.timerTaskName.textContent = "选择一个任务开始";
    dom.timerHint.textContent =
      "计时结束后会提醒你切换，不让单项任务吞掉整天。";
    dom.timerDisplay.textContent = "00:00";
    dom.pauseButton.disabled = true;
    dom.finishButton.disabled = true;
    dom.pauseButton.textContent = "暂停";
    return;
  }

  const task = TASK_TYPES[activeTimer.taskId];
  dom.timerTaskName.textContent = task.name;
  dom.timerHint.textContent = activeTimer.isQuickStart
    ? "先完成 5 分钟。此时不评价表现，只负责开始。"
    : "本区块结束后请按计划切换；未完成的内容留到下一次科研或复盘区块。";
  dom.timerDisplay.textContent = formatTimer(activeTimer.remainingSeconds);
  dom.pauseButton.disabled = false;
  dom.finishButton.disabled = false;
  dom.pauseButton.textContent = activeTimer.isPaused ? "继续" : "暂停";
}

function formatTimer(seconds) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const remainder = Math.max(0, seconds) % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function updateProgress() {
  const plannedIds = state.plan.map((item) => item.id);
  const completed = plannedIds.filter((key) => getTaskState(key).complete).length;
  const percent = plannedIds.length ? Math.round((completed / plannedIds.length) * 100) : 0;
  const completedMinutes = state.plan
    .filter((item) => getTaskState(item.id).complete)
    .reduce((sum, item) => sum + item.duration, 0);
  const totalMinutes = state.plan.reduce((sum, item) => sum + item.duration, 0);

  dom.progressPercent.textContent = `${percent}%`;
  dom.progressText.textContent = `${completed} / ${plannedIds.length} 项`;
  dom.focusSummary.textContent = `已完成 ${formatDuration(completedMinutes)}，计划 ${formatDuration(totalMinutes)}`;
  dom.progressRing.style.background = `conic-gradient(var(--green) ${
    percent * 3.6
  }deg, #dedbd1 0deg)`;
}

function renderAnalytics() {
  const analytics = buildAnalytics();
  const weakLabel =
    analytics.weakest && analytics.weakest.missed > 0
      ? `${analytics.weakest.name}｜漏 ${analytics.weakest.missed} 次`
      : "暂无明显偏科";

  dom.analyticsCompletion.textContent = `${analytics.completionRate}%`;
  dom.analyticsWeakness.textContent = weakLabel;
  dom.analyticsStreak.textContent = `${analytics.balancedStreak} 天`;
  dom.analyticsTotalTime.textContent = formatDuration(
    analytics.totalCompletedMinutes,
  );

  dom.analyticsBars.innerHTML = analytics.categoryStats
    .map((item) => {
      const width = Math.max(4, item.completionRate);
      return `
        <div class="bar-row">
          <div class="bar-meta">
            <span>${item.name}</span>
            <strong>${item.completionRate}%</strong>
          </div>
          <div class="bar-track" aria-label="${item.name}完成率 ${item.completionRate}%">
            <span style="width: ${width}%"></span>
          </div>
          <p>${item.completed}/${item.planned || 1} 天完成 · ${formatDuration(item.completedMinutes)}</p>
        </div>
      `;
    })
    .join("");

  dom.planRationale.innerHTML = buildPlanRationale()
    .map((message) => `<li>${escapeHtml(message)}</li>`)
    .join("");

  dom.insightList.innerHTML = analytics.insights
    .map((message) => `<li>${escapeHtml(message)}</li>`)
    .join("");
}

function regeneratePlan() {
  saveSettings();
  state.plan = buildPlan();
  stopTimer();
  saveState();
  render();
  showToast("已按新的时间边界重新分配。原有完成记录和小目标已保留。");
}

function resetToday() {
  const confirmed = window.confirm(
    "确定清空今天的完成状态、小目标和复盘内容吗？时间设置会保留。",
  );
  if (!confirmed) return;

  stopTimer();
  state = defaultState();
  state.plan = buildPlan();
  dom.reflection.value = "";
  saveState();
  render();
  showToast("今日记录已重置。");
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    showToast("当前浏览器不支持系统通知，页面内提醒仍可正常使用。");
    return;
  }

  if (Notification.permission === "granted") {
    showToast("到时提醒已经开启。工作台开着（可以最小化）就会弹出 Windows 通知。");
    return;
  }

  const permission = await Notification.requestPermission();
  updateNotificationButton();
  showToast(
    permission === "granted"
      ? "到时提醒已开启。请保持页面打开。"
      : "未开启系统通知，仍会使用页面提示和提示音。",
  );
}

function updateNotificationButton() {
  if (!("Notification" in window)) {
    dom.notificationButton.textContent = "浏览器不支持通知";
    dom.notificationButton.disabled = true;
    return;
  }
  dom.notificationButton.textContent =
    Notification.permission === "granted" ? "到时提醒已开启" : "开启到时提醒";
}

function notify(title, body, options = {}) {
  if ("Notification" in window && Notification.permission === "granted") {
    const notification = new Notification(title, { body, ...options });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}

function playChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.frequency.setValueAtTime(660, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      880,
      context.currentTime + 0.22,
    );
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.48);
  } catch {
    // 页面提示仍然有效，音频不可用时无需中断流程。
  }
}

function showToast(message) {
  clearTimeout(toastTimeout);
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  toastTimeout = window.setTimeout(() => {
    dom.toast.classList.remove("show");
  }, 3200);
}

function flashSaveStatus() {
  dom.saveStatus.textContent = "已保存";
  window.clearTimeout(flashSaveStatus.timeout);
  flashSaveStatus.timeout = window.setTimeout(() => {
    dom.saveStatus.textContent = "内容自动保存在本机浏览器中";
  }, 1400);
}

function initialize() {
  if (isDemoMode) {
    document.body.classList.add("demo-mode");
  }
  if (isScreenshotMode) {
    document.body.classList.add("screenshot-mode");
  }

  const settings = loadSettings();
  dom.totalMinutes.value = settings.totalMinutes;
  dom.startTime.value = settings.startTime;
  dom.dayEnd.value = settings.dayEnd;
  dom.breakMinutes.value = settings.breakMinutes;
  dom.longBreakMinutes.value = settings.longBreakMinutes;

  const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  dom.todayLabel.textContent = dateFormatter.format(new Date());
  dom.reflection.value = state.reflection || "";

  dom.regenerateButton.addEventListener("click", regeneratePlan);
  dom.syncButton.addEventListener("click", async () => {
    await loadRecruitData();
    showToast(recruitSource === "server" ? "已刷新招聘事项。" : "未连接本地服务器。");
  });
  dom.notificationButton.addEventListener("click", requestNotifications);
  dom.resetButton.addEventListener("click", resetToday);
  dom.pauseButton.addEventListener("click", togglePause);
  dom.finishButton.addEventListener("click", finishActiveTask);
  dom.reflection.addEventListener("input", (event) => {
    state.reflection = event.target.value;
    saveState();
    flashSaveStatus();
  });

  updateNotificationButton();
  render();
  loadRecruitData();
  window.setInterval(loadRecruitData, RECRUIT_POLL_MS);
  window.setInterval(checkReminders, REMINDER_CHECK_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadRecruitData();
  });
}

initialize();
