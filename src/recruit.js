// 招聘事项：读 data/items.json、在页面上展示和操作、到点提醒。
// 排程和提醒的计算在 recruiting.js（全局 Recruiting），这里只管页面。

import { escapeHtml, formatClock } from "./format.js";
import * as store from "./store.js";
import { notify, playChime, showToast } from "./ui.js";

/* global Recruiting -- 由 index.html 先加载的 recruiting.js 声明（普通脚本，不挂在 globalThis 上） */

const dom = {
  syncStatus: document.querySelector("#syncStatus"),
  syncButton: document.querySelector("#syncButton"),
  recruitAlerts: document.querySelector("#recruitAlerts"),
  recruitList: document.querySelector("#recruitList"),
};

const FIRED_REMINDERS_KEY = "self-work-station:fired-reminders";
const RECRUIT_UPCOMING_DAYS = 14;
const RECRUIT_TYPE_ICONS = {
  appointment: "约",
  deadline: "限",
};

export const recruit = {
  data: { items: [], lastSyncedAt: null },
  source: "loading", // loading | server | offline
  schedule: { placements: {}, unplaceable: [] },
};

let context = {
  dateKey: null,
  isDemoMode: false,
  getSettings: () => ({}),
  onChange: () => {},
  onEditItem: () => {},
};

export function configureRecruit(options) {
  context = { ...context, ...options };
  dom.syncButton.addEventListener("click", async () => {
    await loadRecruitData();
    showToast(recruit.source === "server" ? "已刷新招聘事项。" : "未连接本地服务器。");
  });
}

function recruitSettings() {
  const settings = context.getSettings();
  return { startTime: settings.startTime, dayEnd: settings.dayEnd };
}

function refreshRecruitSchedule() {
  recruit.schedule = Recruiting.placeDeadlineTasks(
    recruit.data.items || [],
    recruitSettings(),
    Date.now(),
  );
}

export function todayBusyMinutes() {
  return Recruiting.busyMinutesForDay(
    context.dateKey,
    recruit.data.items || [],
    recruit.schedule.placements,
    recruitSettings(),
  );
}

export function freeMinutesToday(busy, settings) {
  return Recruiting.freeMinutes(context.dateKey, busy, settings);
}

export function layoutFocusEntries(options) {
  return Recruiting.layoutBalanceTasks(options);
}

function recruitTypeLabel(item) {
  return item.type || (item.kind === "appointment" ? "面试" : "截止任务");
}

// 招聘事项在今天时间表里的条目：固定日程按实际开始时间，截止任务按排定时段。
export function todayRecruitEntries() {
  const entries = [];
  for (const item of recruit.data.items || []) {
    if (!Recruiting.BLOCKING_STATUSES.includes(item.status)) continue;
    if (item.kind === "appointment") {
      const block = Recruiting.blockedTime(item, recruitSettings());
      if (block && Recruiting.dateKeyOf(block.eventStart) === context.dateKey) {
        entries.push({
          type: "recruit",
          item,
          start: Recruiting.minutesOfDay(block.eventStart),
          end: Recruiting.minutesOfDay(block.eventEnd),
          block,
        });
      }
    } else {
      const slot = recruit.schedule.placements[item.id];
      if (slot && Recruiting.dateKeyOf(slot.start) === context.dateKey) {
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

export function renderRecruitTimelineCard(entry) {
  const { item } = entry;
  const card = document.createElement("article");
  card.className = "task-card recruit-card";
  card.style.setProperty("--task-color", recruitTimelineSummary(entry).color);
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

// 时间轴上收起时显示的一行。
export function recruitTimelineSummary(entry) {
  const { item } = entry;
  return {
    title: Recruiting.describe(item),
    badge: RECRUIT_TYPE_ICONS[item.kind] || "招",
    // 手动建的日程用中性的灰蓝，和招聘事项区分开。
    color: item.source === "manual" ? "#5b6b8c" : item.kind === "appointment" ? "#c0503a" : "#3f6fb0",
    meta: `<span class="duration-pill recruit-pill">${escapeHtml(recruitTypeLabel(item))}</span>${
      item.status === "scheduled" ? "" : statusChip(item)
    }`,
    complete: false,
    active: false,
    checkable: false,
  };
}

// 需要用户处理的招聘事项数：待核对、待确认、已变更。
export function pendingRecruitCount() {
  return (recruit.data.items || []).filter((item) =>
    ["needs_review", "pending_confirmation", "changed"].includes(item.status),
  ).length;
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
  if (item.source === "manual") {
    buttons.push('<button class="task-button" type="button" data-recruit="edit">编辑</button>');
  }
  if (isDeletable(item)) {
    buttons.push('<button class="task-button quiet" type="button" data-recruit="delete">删除</button>');
  } else if (Recruiting.isOpen(item)) {
    buttons.push('<button class="task-button quiet" type="button" data-recruit="cancel">取消</button>');
  }
  return buttons.join("");
}

// 自己建的（手动、粘贴解析）可以删；邮件同步来的只能取消，否则下次同步又会建回来。
export function isDeletable(item) {
  return item.source === "manual" || item.source === "paste";
}

export async function deleteRecruitItem(item) {
  if (!window.confirm(`确定删除「${Recruiting.describe(item)}」吗？删除后不能恢复。`)) return;
  try {
    await store.deleteItem(item.id);
    await loadRecruitData();
    showToast("已删除。");
  } catch (error) {
    showToast(`没有删除：${error.message}`);
  }
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
  if (action === "delete") await deleteRecruitItem(item);
  if (action === "edit") context.onEditItem(item);
  if (action === "cancel") {
    if (!window.confirm(`确定把「${Recruiting.describe(item)}」标为已取消吗？`)) return;
    await patchRecruitItem(item.id, { status: "cancelled" }, "已取消，并从日程中移除。");
  }
  if (action === "move") {
    if (container.querySelector(".move-form")) return;
    const slot = recruit.schedule.placements[item.id];
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
    return recruit.schedule.placements[item.id]?.start ?? Recruiting.parseTime(item.deadline) ?? Infinity;
  };
  return (recruit.data.items || [])
    .filter((item) => item.source !== "manual" && Recruiting.BLOCKING_STATUSES.includes(item.status))
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
  const slot = recruit.schedule.placements[item.id];
  const deadline = Recruiting.parseTime(item.deadline);
  const planned = slot
    ? `安排在 ${Recruiting.formatDayLabel(slot.start)}`
    : "排不进日程，请手动改时间";
  return `${planned} · 截止 ${Recruiting.formatDayLabel(deadline)} · 约 ${Number(item.estimatedMinutes) || 60} 分钟`;
}

export function renderRecruit() {
  const items = recruit.data.items || [];
  const lastSynced = Recruiting.parseTime(recruit.data.lastSyncedAt);
  if (recruit.source === "offline") {
    dom.syncStatus.textContent = "未连接本地服务器：请用开机自启的工作台打开（http://127.0.0.1:8000）。";
  } else if (recruit.source === "loading") {
    dom.syncStatus.textContent = "正在读取…";
  } else {
    dom.syncStatus.textContent = lastSynced
      ? `上次从邮件同步：${Recruiting.formatDayLabel(lastSynced)}`
      : "还没有从邮件同步过";
  }

  const alerts = items.filter((item) => item.status === "needs_review");
  const stuck = recruit.schedule.unplaceable
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
        recruit.source === "server" ? "未来两周没有待办的招聘事项。" : "暂无数据。"
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

export async function loadRecruitData() {
  if (context.isDemoMode) {
    recruit.data = createDemoRecruitData(context.dateKey);
    recruit.source = "server";
  } else {
    try {
      const response = await fetch("/api/items", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      recruit.data = await response.json();
      recruit.source = "server";
    } catch {
      recruit.source = "offline";
    }
  }
  refreshRecruitSchedule();
  context.onChange();
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

export function checkReminders() {
  if (recruit.source !== "server" || context.isDemoMode) return;
  const fired = loadFiredReminders();
  const reminders = Recruiting.computeReminders(
    recruit.data.items || [],
    recruit.schedule.placements,
    recruit.schedule.unplaceable,
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

function createDemoRecruitData(dateKey) {
  const day = (offset, time) => `${Recruiting.addDays(dateKey, offset)}T${time}:00+08:00`;
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
