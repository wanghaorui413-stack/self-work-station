// 工作台入口：“今天”的时间表、计时、7 日反馈和设置。
// 词汇见 GLOSSARY.md；数据存在本机 data/（docs/adr/0002）。

import {
  DEFAULT_FOCUS_AREAS,
  allocateDurations,
  areaIdOf,
  areasActiveOn,
  chooseAreas,
  longBreakIndex,
  pinsForDay,
  planEntries,
} from "./focus-areas.js";
import { buildAnalytics } from "./analytics.js";
import {
  escapeHtml,
  formatDateKey,
  formatDuration,
  formatTimer,
  historyDateKeys,
  formatClock,
  timeToMinutes,
} from "./format.js";
import * as store from "./store.js";
import { createDemoDays } from "./demo.js";
import { notify, playChime, showToast } from "./ui.js";
import {
  configureRecruit,
  checkReminders,
  freeMinutesToday,
  layoutFocusEntries,
  loadRecruitData,
  deleteRecruitItem,
  pendingRecruitCount,
  recruit,
  recruitTimelineSummary,
  renderRecruit,
  renderRecruitTimelineCard,
  todayBusyMinutes,
  todayRecruitEntries,
} from "./recruit.js";
import { renderFocusEditor } from "./focus-settings-view.js";
import { positionNowLine, renderTimeline } from "./timeline.js";
import {
  configureTodos,
  getTodos,
  loadTodosData,
  removeTodo,
  renderTodayTodos,
  renderTodosView,
} from "./todos-view.js";
import { todosForToday } from "./todos.js";
import { configureCalendar, renderCalendar } from "./calendar-view.js";
import { configureItemDialog, openEditDialog, openItemDialog } from "./item-dialog.js";
import { configureExtract, renderExtractPanel } from "./extract-view.js";

const dom = {
  todayLabel: document.querySelector("#todayLabel"),
  connectionBanner: document.querySelector("#connectionBanner"),
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
  analyticsCompletion: document.querySelector("#analyticsCompletion"),
  analyticsWeakness: document.querySelector("#analyticsWeakness"),
  analyticsStreak: document.querySelector("#analyticsStreak"),
  analyticsTotalTime: document.querySelector("#analyticsTotalTime"),
  analyticsBars: document.querySelector("#analyticsBars"),
  planRationale: document.querySelector("#planRationale"),
  insightList: document.querySelector("#insightList"),
  focusEditor: document.querySelector("#focusEditor"),
  recruitBadge: document.querySelector("#recruitBadge"),
  todoBadge: document.querySelector("#todoBadge"),
  todayTodos: document.querySelector("#todayTodos"),
  todosView: document.querySelector("#todosView"),
  calendarView: document.querySelector("#calendarView"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  autostartRow: document.querySelector("#autostartRow"),
  autostartToggle: document.querySelector("#autostartToggle"),
  dataRow: document.querySelector("#dataRow"),
  dataPath: document.querySelector("#dataPath"),
  openDataButton: document.querySelector("#openDataButton"),
};

const VIEWS = ["today", "calendar", "todos", "focus", "recruit", "review", "settings"];

const HISTORY_DAYS = 7;
const RECRUIT_POLL_MS = 10 * 60 * 1000;
const REMINDER_CHECK_MS = 30 * 1000;
const SAVED_HINT = "内容自动保存在本机 data 文件夹";
const DEFAULT_SETTINGS = {
  totalMinutes: "360",
  startTime: "09:00",
  dayEnd: "21:30",
  breakMinutes: "10",
  longBreakMinutes: "45",
};

const params = new URLSearchParams(window.location.search);
const isDemoMode = params.get("demo") === "1";
const isScreenshotMode = params.get("screenshot") === "1";
const dateKey = formatDateKey(new Date());

// connection: server（正常使用）| offline（服务器没开，改动不保存）| demo
let connection = isDemoMode ? "demo" : "server";
let workbench = { settings: { ...DEFAULT_SETTINGS }, focusAreas: DEFAULT_FOCUS_AREAS };
let days = {};
let state = defaultState();
let timerInterval = null;
let activeTimer = null;
// 时间轴上展开的时段。
const openKeys = new Set();
let defaultOpenApplied = false;

function defaultState() {
  return { tasks: {}, reflection: "", plan: null };
}

function saveState() {
  days[dateKey] = state;
  if (connection === "server") store.saveDay(dateKey, state);
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

async function saveSettings() {
  workbench.settings = currentSettings();
  if (connection !== "server") return;
  try {
    await store.saveSettings(workbench.settings);
  } catch (error) {
    showToast(`设置保存失败：${error.message}`);
  }
}

// ---------- 投入方向 → 今天的时段 ----------

function areaOf(entry) {
  const id = areaIdOf(entry);
  return (
    workbench.focusAreas.find((area) => area.id === id) || {
      id,
      name: id,
      shortName: id,
      icon: "·",
      color: "#68716c",
      description: "",
      placeholder: "",
    }
  );
}

// 旧记录（research1 / research2）没有 segment 字段，从 id 末尾的数字推出来。
function segmentOf(entry) {
  return entry.segment || Number(/(\d)$/.exec(entry.id)?.[1]) || 1;
}

function entryTitle(entry) {
  const area = areaOf(entry);
  const segments = state.plan?.filter((item) => areaIdOf(item) === area.id).length || 1;
  return segments > 1 ? `${area.name}（${segmentOf(entry)}）` : area.name;
}

function buildPlan() {
  const settings = currentSettings();
  const breakMinutes = Number(settings.breakMinutes);
  const longBreakMinutes = Number(settings.longBreakMinutes);
  const areas = areasActiveOn(workbench.focusAreas, dateKey);
  const busy = todayBusyMinutes();
  // 钉住的时段（方向的固定时段、今天手动改过的）先占位，其余时段绕开它们自动排。
  const pins = pinsForDay(areas, state.pins);
  const pinnedBlocks = Object.values(pins);
  const pinnedMinutes = pinnedBlocks.reduce((sum, pin) => sum + pin.end - pin.start, 0);
  const busyWithPins = [...busy, ...pinnedBlocks].sort((a, b) => a.start - b.start);
  const chosen = chooseAreas(areas, {
    totalMinutes: Number(settings.totalMinutes),
    freeMinutes: freeMinutesToday(busyWithPins, settings) + pinnedMinutes,
    breakMinutes,
    longBreakMinutes,
  });
  const chosenAreas = chosen.total >= 10 ? chosen.areas : [];
  // 钉住的方向即使空档不够也保留（用户自己定的时间），但只保留钉住的那几段。
  const pinnedAreaIds = new Set(Object.keys(pins).map((id) => id.split("#")[0]));
  const picked = areas.filter((area) => chosenAreas.includes(area) || pinnedAreaIds.has(area.id));
  const entries = planEntries(picked).filter(
    (entry) => chosenAreas.some((area) => area.id === entry.areaId) || pins[entry.id],
  );
  const meta = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
  const durations = picked.length ? allocateDurations(Math.max(chosen.total, pinnedMinutes), picked) : {};
  const free = entries.filter((entry) => !pins[entry.id]);

  const layout = layoutFocusEntries({
    order: free.map((entry) => entry.id),
    durations,
    busy: busyWithPins,
    dayStart: timeToMinutes(settings.startTime),
    dayEnd: timeToMinutes(settings.dayEnd),
    breakMinutes,
    longBreakAfter: free[longBreakIndex(free.length)]?.id ?? null,
    longBreakMinutes,
  });
  const pinnedPlan = entries
    .filter((entry) => pins[entry.id])
    .map((entry) => ({ id: entry.id, ...pins[entry.id], duration: pins[entry.id].end - pins[entry.id].start, pinned: true }));
  const plan = [...layout.plan, ...pinnedPlan].sort((a, b) => a.start - b.start);
  const { crowdedOut } = layout;

  state.crowdedOut = [
    ...new Set([
      ...areas.filter((area) => !picked.includes(area)).map((area) => area.id),
      ...crowdedOut.map((id) => meta[id].areaId),
    ]),
  ];
  state.busySignature = JSON.stringify(busy);
  return plan.map((item) => ({ ...item, areaId: meta[item.id].areaId, segment: meta[item.id].segment }));
}

function buildPlanRationale() {
  const plan = state.plan || [];
  const minutesByArea = new Map();
  plan.forEach((item) => {
    const area = areaOf(item);
    minutesByArea.set(area, (minutesByArea.get(area) || 0) + item.duration);
  });
  const total = plan.reduce((sum, item) => sum + item.duration, 0);
  const busyMinutes = todayBusyMinutes().reduce((sum, block) => sum + block.end - block.start, 0);
  const crowded = (state.crowdedOut || []).map(
    (id) => workbench.focusAreas.find((area) => area.id === id)?.shortName || id,
  );
  const split = [...minutesByArea]
    .sort((a, b) => b[1] - a[1])
    .map(([area, minutes]) => `${area.shortName} ${formatDuration(minutes)}`)
    .join("，");

  const lines = [];
  if (busyMinutes) {
    lines.push(`招聘事项今天占用 ${formatDuration(busyMinutes)}（含准备和缓冲），投入方向只排在剩下的空档里。`);
  }
  if (total) {
    lines.push(`投入方向共 ${formatDuration(total)}：${split}。按“最低保障 + 权重分配”生成。`);
  }
  if (crowded.length) {
    lines.push(`空档不够，${crowded.join("、")}今天被挤占。这不算跳过，也不计入薄弱模块。`);
  } else if (plan.some((item) => segmentOf(item) > 1)) {
    lines.push("拆成多段的方向穿插在其他方向之间，避免单项任务吞掉全天。");
  }
  lines.push("如果系统识别到弱项，先用提醒和 5 分钟启动处理回避，不直接牺牲其他方向的最低保障。");
  return lines;
}

function getTaskState(id) {
  if (!state.tasks[id]) {
    state.tasks[id] = { complete: false, goal: "", elapsedSeconds: 0 };
  }
  return state.tasks[id];
}

// ---------- 渲染 ----------

function nowMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = (type) => Number(parts.find((part) => part.type === type).value);
  return value("hour") * 60 + value("minute");
}

function timelineEntries() {
  const focus = state.plan.map((item) => {
    const area = areaOf(item);
    const taskState = getTaskState(item.id);
    return {
      key: item.id,
      kind: "focus",
      start: item.start,
      end: item.end,
      color: area.color,
      title: entryTitle(item),
      meta: [formatDuration(item.duration), item.pinned ? "固定时间" : "", taskState.goal ? escapeHtml(taskState.goal) : ""]
        .filter(Boolean)
        .join(" · "),
      complete: taskState.complete,
      active: activeTimer?.taskId === item.id,
      checkable: true,
      detail: () => focusDetail(item),
    };
  });
  const recruiting = todayRecruitEntries().map((entry) => ({
    key: `recruit:${entry.item.id}`,
    kind: "recruit",
    start: entry.start,
    end: entry.end,
    ...recruitTimelineSummary(entry),
    detail: () => renderRecruitTimelineCard(entry),
  }));
  return [...focus, ...recruiting].sort((a, b) => a.start - b.start);
}

// 默认展开“现在正在进行”的那一段，其余收起。
function ensureDefaultOpen(entries) {
  if (openKeys.size || defaultOpenApplied) return;
  defaultOpenApplied = true;
  const now = nowMinutes();
  const current = entries.find((entry) => now >= entry.start && now < entry.end && !entry.complete);
  if (current) openKeys.add(current.key);
}

function render() {
  if (!state.plan) {
    state.plan = buildPlan();
    saveState();
  }

  const entries = timelineEntries();
  ensureDefaultOpen(entries);
  if (entries.length) {
    renderTimeline(dom.scheduleList, entries, {
      openKeys,
      onToggleOpen: (key) => {
        if (openKeys.has(key)) openKeys.delete(key);
        else openKeys.add(key);
        render();
      },
      onToggleComplete: (key) => toggleComplete(key),
    });
    positionNowLine(dom.scheduleList, nowMinutes());
  } else {
    dom.scheduleList.innerHTML =
      '<p class="empty-note">今天的空档不够安排投入方向。先把招聘事项做好，其他方向明天补上。</p>';
  }

  updateProgress();
  renderAnalytics();
  renderRecruit();
  updateRecruitBadge();
  updateTimerPanel();
  renderTodoViews();
  renderCalendar(dom.calendarView);
}

function renderTodoViews() {
  renderTodayTodos(dom.todayTodos);
  renderTodosView(dom.todosView);
  const count = todosForToday(getTodos(), dateKey).length;
  dom.todoBadge.hidden = !count;
  dom.todoBadge.textContent = count;
}

// 新建日程或截止任务后：重新读事项（会触发今天的计划避让）；从待办转来的，删掉原待办。
async function onItemCreated(item, preset) {
  if (preset?.fromTodoId) await removeTodo(preset.fromTodoId);
  await loadRecruitData();
}

function scheduleTodo(todo) {
  const due = todo.due ? (todo.due.length > 10 ? todo.due : `${todo.due}T23:00`) : "";
  openItemDialog({
    kind: "deadline",
    title: todo.title,
    deadline: due,
    note: todo.note,
    fromTodoId: todo.id,
  });
}

function configureViews() {
  configureTodos({
    todayKey: dateKey,
    canSave: connection === "server",
    onChange: () => {
      renderTodoViews();
      renderCalendar(dom.calendarView);
    },
    onSchedule: scheduleTodo,
  });
  configureItemDialog({ canSave: connection === "server", onCreated: onItemCreated, onUpdated: loadRecruitData });
  configureCalendar({
    todayKey: dateKey,
    getItems: () => recruit.data.items || [],
    getPlacements: () => recruit.schedule.placements,
    getTodos,
    getDays: () => days,
    getAreas: () => workbench.focusAreas,
    getSettings: currentSettings,
    renderItemDetail: renderRecruitTimelineCard,
    onSlot: (start, end) => openItemDialog({ kind: "appointment", start, end }),
    onEditItem: openEditDialog,
    onDeleteItem: deleteRecruitItem,
    onNewItem: (kind) => openItemDialog({ kind }),
  });
}

function focusDetail(item) {
  const area = areaOf(item);
  const title = entryTitle(item);
  const taskState = getTaskState(item.id);
  const detail = document.createElement("div");
  detail.className = "focus-detail";
  detail.innerHTML = `
    ${area.description ? `<p class="task-description">${escapeHtml(area.description)}</p>` : ""}
    <input
      class="micro-goal"
      type="text"
      value="${escapeHtml(taskState.goal)}"
      placeholder="${escapeHtml(area.placeholder)}"
      aria-label="${escapeHtml(title)}的今日小目标"
    />
    <div class="task-controls">
      <button class="task-button quick" type="button" data-action="quick" ${
        taskState.complete ? "disabled" : ""
      }>先做 5 分钟</button>
      <button class="task-button" type="button" data-action="start" ${
        taskState.complete ? "disabled" : ""
      }>开始计时 ${formatDuration(item.duration)}</button>
    </div>
  `;

  detail.querySelector(".task-controls").insertAdjacentHTML(
    "beforeend",
    '<button class="task-button" type="button" data-action="time">改时间</button>',
  );
  detail.querySelector('[data-action="time"]').addEventListener("click", () => {
    if (!detail.querySelector(".pin-form")) detail.appendChild(pinForm(item));
  });

  const goalInput = detail.querySelector(".micro-goal");
  goalInput.addEventListener("input", (event) => {
    getTaskState(item.id).goal = event.target.value;
    saveState();
    flashSaveStatus();
  });
  // 收起后标题旁会显示小目标，失焦时刷新一下。
  goalInput.addEventListener("change", () => render());

  detail.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "quick") startTimer(item.id, 5, true);
      if (action === "start") startTimer(item.id, item.duration, false);
    });
  });
  return detail;
}

// 改投入方向时段的时间：只影响今天，其余时段绕开它重新排。
function pinForm(item) {
  const form = document.createElement("form");
  form.className = "move-form pin-form";
  const fromArea = item.pinned && !state.pins?.[item.id];
  form.innerHTML = `
    <label><span>开始</span><input name="start" type="time" required value="${formatClock(item.start)}" /></label>
    <label><span>结束</span><input name="end" type="time" required value="${formatClock(item.end)}" /></label>
    <button class="task-button complete" type="submit">保存</button>
    ${state.pins?.[item.id] ? '<button class="task-button" type="button" data-auto>恢复自动安排</button>' : ""}
    <p class="small-text">${
      fromArea ? "这是方向设置里的固定时段，这里改的只对今天有效。" : "只改今天；其他时段会绕开它重新排。"
    }</p>
  `;
  const apply = (pins, message) => {
    state.pins = pins;
    state.plan = buildPlan();
    saveState();
    render();
    showToast(message);
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const start = timeToMinutes(form.elements.start.value);
    const end = timeToMinutes(form.elements.end.value);
    if (!(end > start)) {
      showToast("结束时间要晚于开始时间。");
      return;
    }
    apply({ ...state.pins, [item.id]: { start, end } }, "已改到指定时间，其余时段已重新安排。");
  });
  form.querySelector("[data-auto]")?.addEventListener("click", () => {
    const { [item.id]: _removed, ...rest } = state.pins;
    apply(rest, "已恢复自动安排。");
  });
  return form;
}

function updateRecruitBadge() {
  const count = pendingRecruitCount();
  dom.recruitBadge.hidden = !count;
  dom.recruitBadge.textContent = count;
}

function updateProgress() {
  const completed = state.plan.filter((item) => getTaskState(item.id).complete);
  const percent = state.plan.length ? Math.round((completed.length / state.plan.length) * 100) : 0;
  const completedMinutes = completed.reduce((sum, item) => sum + item.duration, 0);
  const totalMinutes = state.plan.reduce((sum, item) => sum + item.duration, 0);

  dom.progressPercent.textContent = `${percent}%`;
  dom.progressText.textContent = `${completed.length} / ${state.plan.length} 项`;
  dom.focusSummary.textContent = `已完成 ${formatDuration(completedMinutes)}，计划 ${formatDuration(totalMinutes)}`;
  dom.progressRing.style.background = `conic-gradient(var(--green) ${
    percent * 3.6
  }deg, #dedbd1 0deg)`;
}

function renderAnalytics() {
  const analytics = buildAnalytics(
    days,
    historyDateKeys(dateKey, HISTORY_DAYS),
    workbench.focusAreas,
  );
  const weakLabel =
    analytics.weakest && analytics.weakest.missed > 0
      ? `${analytics.weakest.name}｜漏 ${analytics.weakest.missed} 次`
      : "暂无明显偏科";

  dom.analyticsCompletion.textContent = `${analytics.completionRate}%`;
  dom.analyticsWeakness.textContent = weakLabel;
  dom.analyticsStreak.textContent = `${analytics.balancedStreak} 天`;
  dom.analyticsTotalTime.textContent = formatDuration(analytics.totalCompletedMinutes);

  dom.analyticsBars.innerHTML = analytics.categoryStats
    .map((item) => {
      const width = Math.max(4, item.completionRate);
      return `
        <div class="bar-row">
          <div class="bar-meta">
            <span>${escapeHtml(item.name)}</span>
            <strong>${item.completionRate}%</strong>
          </div>
          <div class="bar-track" aria-label="${escapeHtml(item.name)}完成率 ${item.completionRate}%">
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

function renderFocusSettings() {
  renderFocusEditor(dom.focusEditor, workbench.focusAreas, {
    canSave: connection === "server",
    readOnlyNote: connection === "demo" ? "演示模式，改动不会保存。" : "未连接本地服务器，不能保存。",
    onSave: saveFocusAreas,
  });
}

async function saveFocusAreas(focusAreas) {
  const saved = await store.saveFocusAreas(focusAreas);
  workbench.focusAreas = saved.focusAreas;
  regeneratePlan("投入方向已保存，今日计划已按新方向重新分配。完成记录和小目标都保留。");
  renderFocusSettings();
}

// ---------- 招聘事项变化 ----------

// 今天的占用时段变了就重排投入方向（完成记录保留）。
function onRecruitChange() {
  if (recruit.source !== "server") {
    // 读不到数据时不动今天的计划，免得把已经避让好的时间表冲掉。
    render();
    return;
  }
  const signature = JSON.stringify(todayBusyMinutes());
  if (state.plan && state.busySignature !== undefined && state.busySignature !== signature) {
    state.plan = buildPlan();
    saveState();
    showToast("招聘事项有变化，今日投入方向已重新避让。");
  } else if (state.plan && state.busySignature === undefined) {
    state.busySignature = signature;
    if (signature !== "[]") state.plan = buildPlan();
    saveState();
  }
  render();
}

// ---------- 完成与计时 ----------

function toggleComplete(taskId, forceValue) {
  const taskState = getTaskState(taskId);
  taskState.complete = typeof forceValue === "boolean" ? forceValue : !taskState.complete;
  taskState.completedAt = taskState.complete ? new Date().toISOString() : null;

  if (activeTimer?.taskId === taskId && taskState.complete) stopTimer();

  saveState();
  render();
  const name = areaOf({ id: taskId }).shortName;
  showToast(taskState.complete ? `${name}已完成。现在切换到下一项。` : `已恢复${name}。`);
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
    isQuickStart ? "只做 5 分钟，先越过启动阻力。" : `${areaOf({ id: taskId }).shortName}计时开始。`,
  );
}

function timerEntry() {
  return state.plan.find((item) => item.id === activeTimer?.taskId) || { id: activeTimer?.taskId };
}

function tickTimer() {
  if (!activeTimer || activeTimer.isPaused) return;

  activeTimer.remainingSeconds -= 1;
  getTaskState(activeTimer.taskId).elapsedSeconds += 1;

  if (activeTimer.remainingSeconds <= 0) {
    const completedTimer = { ...activeTimer };
    const title = entryTitle(timerEntry());
    stopTimer(false);

    if (completedTimer.isQuickStart) {
      notify("5 分钟已完成", `${title}已经启动。可以继续完整任务，也可以按计划切换。`);
      showToast("5 分钟启动完成。最难的部分已经过去，现在决定继续或切换。");
    } else {
      const completedState = getTaskState(completedTimer.taskId);
      completedState.complete = true;
      completedState.completedAt = new Date().toISOString();
      saveState();
      notify("该切换任务了", `${title}计时结束，休息后开始下一项。`);
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
    dom.timerHint.textContent = "计时结束后会提醒你切换，不让单项任务吞掉整天。";
    dom.timerDisplay.textContent = "00:00";
    dom.pauseButton.disabled = true;
    dom.finishButton.disabled = true;
    dom.pauseButton.textContent = "暂停";
    return;
  }

  dom.timerTaskName.textContent = entryTitle(timerEntry());
  dom.timerHint.textContent = activeTimer.isQuickStart
    ? "先完成 5 分钟。此时不评价表现，只负责开始。"
    : "本区块结束后请按计划切换；没做完的内容留到这个方向的下一段或明天。";
  dom.timerDisplay.textContent = formatTimer(activeTimer.remainingSeconds);
  dom.pauseButton.disabled = false;
  dom.finishButton.disabled = false;
  dom.pauseButton.textContent = activeTimer.isPaused ? "继续" : "暂停";
}

// ---------- 设置与操作 ----------

async function regeneratePlan(message = "已按新的时间边界重新分配。原有完成记录和小目标已保留。") {
  await saveSettings();
  state.plan = buildPlan();
  stopTimer();
  saveState();
  render();
  showToast(message);
}

function resetToday() {
  const confirmed = window.confirm("确定清空今天的完成状态、小目标和复盘内容吗？时间设置会保留。");
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

function flashSaveStatus() {
  dom.saveStatus.textContent = connection === "server" ? "已保存" : "未连接服务器，没有保存";
  window.clearTimeout(flashSaveStatus.timeout);
  flashSaveStatus.timeout = window.setTimeout(() => {
    dom.saveStatus.textContent = SAVED_HINT;
  }, 1400);
}

function showConnectionBanner() {
  dom.connectionBanner.hidden = connection !== "offline";
  dom.connectionBanner.textContent =
    "未连接本地服务器，现在看到的是默认方向，改动不会保存。请用开机自启的工作台打开 http://127.0.0.1:8000 。";
}

// ---------- 视图切换 ----------

function showView() {
  const requested = window.location.hash.slice(1);
  const view = VIEWS.includes(requested) ? requested : "today";
  document.querySelectorAll("[data-view]").forEach((section) => {
    section.hidden = section.dataset.view !== view;
  });
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const current = link.dataset.nav === view;
    link.classList.toggle("is-current", current);
    if (current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  // 时间轴在隐藏时量不出位置，切回来再放一次“现在”线。
  if (view === "today") positionNowLine(dom.scheduleList, nowMinutes());
}

// ---------- 桌面程序独有的设置 ----------

async function setupDesktopSettings() {
  const desktop = window.desktop;
  if (!desktop) return;
  dom.autostartRow.hidden = false;
  dom.dataRow.hidden = false;
  dom.autostartToggle.checked = await desktop.getAutoStart();
  dom.dataPath.textContent = await desktop.getDataPath();
  dom.autostartToggle.addEventListener("change", async () => {
    const enabled = await desktop.setAutoStart(dom.autostartToggle.checked);
    dom.autostartToggle.checked = enabled;
    showToast(enabled ? "已开启开机自启：登录后在托盘里运行。" : "已关闭开机自启。");
  });
  dom.openDataButton.addEventListener("click", () => desktop.openDataFolder());
}

// ---------- 启动 ----------

async function loadData() {
  if (isDemoMode) {
    days = createDemoDays(dateKey);
    return;
  }
  try {
    let loaded = await store.loadWorkbench();
    if (!loaded.migratedFromBrowserAt) {
      const result = await store.migrateFromBrowser();
      if (result.migrated) showToast(`已把浏览器里 ${result.migrated} 天的旧记录搬进本机 data 文件夹。`);
      loaded = await store.loadWorkbench();
    }
    workbench = loaded;
    const oldest = historyDateKeys(dateKey, HISTORY_DAYS).at(-1);
    days = await store.loadDays(oldest, dateKey);
  } catch {
    connection = "offline";
  }
}

// 工作台常驻开着，过了零点就重新载入，换成新一天的计划。
function watchDateChange() {
  window.setInterval(() => {
    if (formatDateKey(new Date()) !== dateKey && !activeTimer) window.location.reload();
  }, 60 * 1000);
}

async function initialize() {
  if (isDemoMode) document.body.classList.add("demo-mode");
  if (isScreenshotMode) document.body.classList.add("screenshot-mode");

  dom.todayLabel.textContent = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());

  await loadData();
  configureViews();
  await loadTodosData(isDemoMode);
  state = { ...defaultState(), ...days[dateKey] };
  days[dateKey] = state;
  showConnectionBanner();
  store.setSaveErrorHandler((error) =>
    showToast(`保存失败：${error.message}。请确认本地服务器在运行。`),
  );

  const settings = { ...DEFAULT_SETTINGS, ...workbench.settings };
  dom.totalMinutes.value = settings.totalMinutes;
  dom.startTime.value = settings.startTime;
  dom.dayEnd.value = settings.dayEnd;
  dom.breakMinutes.value = settings.breakMinutes;
  dom.longBreakMinutes.value = settings.longBreakMinutes;
  dom.reflection.value = state.reflection || "";
  dom.saveStatus.textContent = SAVED_HINT;

  configureRecruit({
    dateKey,
    isDemoMode,
    getSettings: currentSettings,
    onChange: onRecruitChange,
    onEditItem: openEditDialog,
  });

  configureExtract({
    canSave: connection === "server",
    isDemoMode,
    onSaved: loadRecruitData,
  });
  renderExtractPanel(document.querySelector("#extractPanel"));

  dom.regenerateButton.addEventListener("click", () => regeneratePlan());
  dom.saveSettingsButton.addEventListener("click", () =>
    regeneratePlan("设置已保存，今天的计划已按新边界重新分配。完成记录和小目标都保留。"),
  );
  window.addEventListener("hashchange", showView);
  showView();
  setupDesktopSettings();
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
  renderFocusSettings();
  render();
  loadRecruitData();
  window.setInterval(loadRecruitData, RECRUIT_POLL_MS);
  window.setInterval(checkReminders, REMINDER_CHECK_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadRecruitData();
  });
  watchDateChange();
  window.setInterval(() => positionNowLine(dom.scheduleList, nowMinutes()), 60 * 1000);
}

initialize();
