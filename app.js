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
};

const HISTORY_DAYS = 7;
const TIME_ZONE = "Asia/Shanghai";
const STORE_PREFIX = "daily-balance:";

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

let state = loadState();
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
  try {
    return { ...defaultState(), ...JSON.parse(localStorage.getItem(storageKey)) };
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function loadSettings() {
  try {
    return {
      totalMinutes: "360",
      startTime: "09:00",
      breakMinutes: "10",
      longBreakMinutes: "45",
      ...JSON.parse(localStorage.getItem(settingsKey)),
    };
  } catch {
    return {
      totalMinutes: "360",
      startTime: "09:00",
      breakMinutes: "10",
      longBreakMinutes: "45",
    };
  }
}

function saveSettings() {
  const settings = {
    totalMinutes: dom.totalMinutes.value,
    startTime: dom.startTime.value,
    breakMinutes: dom.breakMinutes.value,
    longBreakMinutes: dom.longBreakMinutes.value,
  };
  localStorage.setItem(settingsKey, JSON.stringify(settings));
}

function roundToFive(value) {
  return Math.max(5, Math.round(value / 5) * 5);
}

function allocateDurations(totalMinutes) {
  const minimumTotal = ORDER.reduce(
    (sum, key) => sum + TASK_TYPES[key].minimum,
    0,
  );
  const result = {};

  if (totalMinutes < minimumTotal) {
    const scale = totalMinutes / minimumTotal;
    ORDER.forEach((key) => {
      result[key] = roundToFive(TASK_TYPES[key].minimum * scale);
    });
  } else {
    const extra = totalMinutes - minimumTotal;
    ORDER.forEach((key) => {
      result[key] = roundToFive(
        TASK_TYPES[key].minimum + extra * TASK_TYPES[key].weight,
      );
    });
  }

  const allocated = ORDER.reduce((sum, key) => sum + result[key], 0);
  result.research2 += totalMinutes - allocated;

  if (result.research2 < 10) {
    const shortfall = 10 - result.research2;
    result.research2 = 10;
    result.research1 = Math.max(10, result.research1 - shortfall);
  }

  return result;
}

function buildPlan() {
  const totalMinutes = Number(dom.totalMinutes.value);
  const breakMinutes = Number(dom.breakMinutes.value);
  const longBreakMinutes = Number(dom.longBreakMinutes.value);
  const durations = allocateDurations(totalMinutes);
  let cursor = timeToMinutes(dom.startTime.value);

  return ORDER.map((key, index) => {
    const start = cursor;
    const duration = durations[key];
    cursor += duration;
    const end = cursor;
    if (index < ORDER.length - 1) {
      cursor += key === "reading" ? longBreakMinutes : breakMinutes;
    }

    return {
      id: key,
      start,
      end,
      duration,
    };
  });
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
  return safeParseState(localStorage.getItem(`${STORE_PREFIX}${key}`));
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
    balanced: CATEGORY_ORDER.every((categoryId) => categories[categoryId].completed),
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
  const totalMinutes = Number(dom.totalMinutes.value);
  const durations = allocateDurations(totalMinutes);
  const researchMinutes = durations.research1 + durations.research2;
  const ieltsMinutes =
    durations.vocabulary +
    durations.listening +
    durations.reading +
    durations.speaking +
    durations.writing;

  return [
    `今日先锁定 ${formatDuration(totalMinutes)} 专注总量，再按“最低保障 + 权重分配”生成计划。`,
    `科研被拆成 ${formatDuration(durations.research1)} 和 ${formatDuration(durations.research2)} 两段，避免单项任务吞掉全天。`,
    `雅思合计 ${formatDuration(ieltsMinutes)}，覆盖输入、输出和词汇；科研合计 ${formatDuration(researchMinutes)}。`,
    "如果系统识别到弱项，先用提醒和 5 分钟启动处理回避，不直接牺牲其他模块的最低保障。",
  ];
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

  state.plan.forEach((item) => {
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

  updateProgress();
  renderAnalytics();
  updateTimerPanel();
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
  const completed = ORDER.filter((key) => getTaskState(key).complete).length;
  const percent = Math.round((completed / ORDER.length) * 100);
  const completedMinutes = state.plan
    .filter((item) => getTaskState(item.id).complete)
    .reduce((sum, item) => sum + item.duration, 0);
  const totalMinutes = state.plan.reduce((sum, item) => sum + item.duration, 0);

  dom.progressPercent.textContent = `${percent}%`;
  dom.progressText.textContent = `${completed} / ${ORDER.length} 项`;
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
    showToast("到时提醒已经开启。请保持页面打开。");
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

function notify(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body });
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
  const settings = loadSettings();
  dom.totalMinutes.value = settings.totalMinutes;
  dom.startTime.value = settings.startTime;
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
}

initialize();
