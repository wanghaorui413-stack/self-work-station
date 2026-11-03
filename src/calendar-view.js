// 日历周视图。未来的日子只显示时间已确定的东西：固定日程、已排定的截止任务、有截止日期的待办；
// 投入方向的时段只在今天和过去几天出现（见 GLOSSARY.md“关系”）。
/* global Recruiting -- 由 index.html 先加载的 recruiting.js 声明 */

import { areaIdOf } from "./focus-areas.js";
import { escapeHtml, formatClock, timeToMinutes } from "./format.js";
import { dueDateOf, dueTimeOf } from "./todos.js";

const HOUR_PX = 44;
const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

let weekOffset = 0;
let selectedKey = null;
let context = {
  todayKey: null,
  getItems: () => [],
  getPlacements: () => ({}),
  getTodos: () => [],
  getDays: () => ({}),
  getAreas: () => [],
  getSettings: () => ({ startTime: "09:00", dayEnd: "21:30" }),
  renderItemDetail: () => document.createElement("div"),
  onSlot: () => {},
  onNewItem: () => {},
  onEditItem: () => {},
  onDeleteItem: () => {},
  onChange: () => {},
};

export function configureCalendar(options) {
  context = { ...context, ...options };
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// 周一开头。
function weekDays() {
  const monday = addDays(mondayOf(context.todayKey), weekOffset * 7);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

function mondayOf(dateKey) {
  const weekday = (new Date(`${dateKey}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(dateKey, -weekday);
}

// 从 fromKey 所在的周到 toKey 所在的周差几周。
function weeksBetween(fromKey, toKey) {
  const ms = Date.parse(`${mondayOf(toKey)}T00:00:00Z`) - Date.parse(`${mondayOf(fromKey)}T00:00:00Z`);
  return Math.round(ms / (7 * 86400000));
}

function shortDate(dateKey) {
  const [, month, day] = dateKey.split("-").map(Number);
  return `${month}/${day}`;
}

// 这一周里要画的东西，按天分组；时间都换算成当天的分钟数。
function collect(days) {
  const byDay = Object.fromEntries(days.map((day) => [day, { timed: [], allDay: [] }]));
  const settings = context.getSettings();
  const placements = context.getPlacements();
  const items = context.getItems().filter((item) => Recruiting.BLOCKING_STATUSES.includes(item.status));

  for (const item of items) {
    const manual = item.source === "manual";
    if (item.kind === "appointment") {
      const block = Recruiting.blockedTime(item, settings);
      const day = block && Recruiting.dateKeyOf(block.eventStart);
      if (!byDay[day]) continue;
      byDay[day].timed.push({
        key: `item:${item.id}`,
        kind: manual ? "manual" : "recruit",
        title: Recruiting.describe(item),
        start: Recruiting.minutesOfDay(block.eventStart),
        end: Recruiting.minutesOfDay(block.eventEnd) || 24 * 60,
        padStart: Recruiting.minutesOfDay(block.start),
        padEnd: Recruiting.minutesOfDay(block.end) || 24 * 60,
        entry: {
          item,
          block,
          start: Recruiting.minutesOfDay(block.eventStart),
          end: Recruiting.minutesOfDay(block.eventEnd),
        },
      });
    } else {
      const slot = placements[item.id];
      const slotDay = slot && Recruiting.dateKeyOf(slot.start);
      if (byDay[slotDay]) {
        byDay[slotDay].timed.push({
          key: `item:${item.id}`,
          kind: "deadline",
          title: Recruiting.describe(item),
          start: Recruiting.minutesOfDay(slot.start),
          end: Recruiting.minutesOfDay(slot.end) || 24 * 60,
          entry: {
            item,
            slot,
            start: Recruiting.minutesOfDay(slot.start),
            end: Recruiting.minutesOfDay(slot.end),
          },
        });
      }
      const deadline = Recruiting.parseTime(item.deadline);
      const deadlineDay = deadline !== null && Recruiting.dateKeyOf(deadline);
      if (byDay[deadlineDay]) {
        byDay[deadlineDay].allDay.push({
          key: `item:${item.id}`,
          kind: "deadline",
          label: `截止 ${Recruiting.formatClock(deadline)} · ${Recruiting.describe(item)}`,
        });
      }
    }
  }

  for (const todo of context.getTodos()) {
    const day = dueDateOf(todo);
    if (!byDay[day]) continue;
    const time = dueTimeOf(todo);
    byDay[day].allDay.push({
      key: `todo:${todo.id}`,
      kind: todo.done ? "todo is-done" : "todo",
      label: `${time ? `${time} ` : ""}${todo.title}`,
    });
  }

  // 投入方向：只画今天和过去有记录的日子。
  const records = context.getDays();
  const areas = context.getAreas();
  for (const day of days) {
    if (day > context.todayKey) continue;
    const record = records[day];
    for (const entry of record?.plan || []) {
      const area = areas.find((candidate) => candidate.id === areaIdOf(entry));
      byDay[day].timed.push({
        key: `focus:${day}:${entry.id}`,
        kind: `focus ${record.tasks?.[entry.id]?.complete ? "is-done" : ""}`,
        title: area?.shortName || area?.name || entry.id,
        color: area?.color,
        start: entry.start,
        end: entry.end,
      });
    }
  }
  return byDay;
}

function hourRange(byDay) {
  const settings = context.getSettings();
  let first = Math.floor(timeToMinutes(settings.startTime) / 60);
  let last = Math.ceil(timeToMinutes(settings.dayEnd) / 60);
  Object.values(byDay).forEach(({ timed }) =>
    timed.forEach((block) => {
      first = Math.min(first, Math.floor((block.padStart ?? block.start) / 60));
      last = Math.max(last, Math.ceil((block.padEnd ?? block.end) / 60));
    }),
  );
  return { first: Math.max(0, first), last: Math.min(24, Math.max(last, first + 1)) };
}

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

function blockHtml(block, range) {
  const top = ((block.start - range.first * 60) / 60) * HOUR_PX;
  const height = Math.max(18, ((block.end - block.start) / 60) * HOUR_PX - 2);
  const pad =
    block.padStart !== undefined && (block.padStart < block.start || block.padEnd > block.end)
      ? `<div class="cal-pad" style="top:${((block.padStart - range.first * 60) / 60) * HOUR_PX}px;height:${
          ((block.padEnd - block.padStart) / 60) * HOUR_PX
        }px" title="含准备、缓冲和交通"></div>`
      : "";
  // 不到 40 分钟的块放不下两行，时间和名称挤在一行。
  const short = height < 34 ? "is-short" : "";
  return `${pad}<button class="cal-block kind-${block.kind} ${short} ${selectedKey === block.key ? "is-selected" : ""}"
      type="button" data-key="${escapeHtml(block.key)}"
      style="top:${top}px;height:${height}px;${block.color ? `--task-color:${block.color}` : ""}">
      <span class="cal-block-time">${formatClock(block.start)}</span>
      <span class="cal-block-title">${escapeHtml(block.title)}</span>
    </button>`;
}

const SNAP_MINUTES = 15;
const DRAG_THRESHOLD_PX = 6;

function minutesAt(column, clientY, range) {
  const offset = clientY - column.getBoundingClientRect().top;
  return range.first * 60 + (offset / HOUR_PX) * 60;
}

// 在空白处按住拖动选出一段时间，松开后新建这段时间的日程；只单击时按半小时取整、默认 1 小时。
function bindSlotSelection(column, range) {
  column.addEventListener("pointerdown", (event) => {
    if (event.target !== column || event.button !== 0) return;
    event.preventDefault();
    const anchorY = event.clientY;
    const anchor = minutesAt(column, anchorY, range);
    const preview = document.createElement("div");
    preview.className = "cal-selection";
    let dragging = false;
    let span = null;

    const update = (clientY) => {
      const current = minutesAt(column, clientY, range);
      const low = Math.max(range.first * 60, Math.floor(Math.min(anchor, current) / SNAP_MINUTES) * SNAP_MINUTES);
      const high = Math.min(range.last * 60, Math.ceil(Math.max(anchor, current) / SNAP_MINUTES) * SNAP_MINUTES);
      span = { start: low, end: Math.max(high, low + SNAP_MINUTES) };
      preview.style.top = `${((span.start - range.first * 60) / 60) * HOUR_PX}px`;
      preview.style.height = `${((span.end - span.start) / 60) * HOUR_PX}px`;
      preview.textContent = `${formatClock(span.start)} – ${formatClock(span.end)}`;
    };
    const move = (moveEvent) => {
      if (!dragging && Math.abs(moveEvent.clientY - anchorY) < DRAG_THRESHOLD_PX) return;
      if (!dragging) column.appendChild(preview);
      dragging = true;
      update(moveEvent.clientY);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      preview.remove();
      const date = column.dataset.date;
      if (dragging && span) {
        context.onSlot(`${date}T${formatClock(span.start)}`, formatClock(span.end % (24 * 60)));
      } else {
        const rounded = Math.min(23 * 60 + 30, Math.floor(anchor / 30) * 30);
        context.onSlot(`${date}T${formatClock(rounded)}`);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

function itemOfKey(key) {
  if (!key?.startsWith("item:")) return null;
  return context.getItems().find((candidate) => `item:${candidate.id}` === key) || null;
}

// 右键菜单：自己建的事项可以编辑、删除；邮件来的只能看详情。
function showItemMenu(item, x, y) {
  document.querySelector(".context-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.setAttribute("role", "menu");
  const actions = [];
  if (item.source === "manual") actions.push(["edit", "编辑"]);
  if (item.source === "manual" || item.source === "paste") actions.push(["delete", "删除"]);
  if (!actions.length) actions.push(["detail", "邮件同步来的事项，请在招聘页处理"]);
  menu.innerHTML = actions
    .map(([act, label]) => `<button type="button" role="menuitem" data-act="${act}" class="${act === "delete" ? "is-danger" : ""}">${label}</button>`)
    .join("");
  document.body.appendChild(menu);
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - height - 8)}px`;

  const close = () => {
    menu.remove();
    window.removeEventListener("pointerdown", outside, true);
    window.removeEventListener("keydown", escape);
  };
  const outside = (event) => {
    if (!menu.contains(event.target)) close();
  };
  const escape = (event) => {
    if (event.key === "Escape") close();
  };
  window.addEventListener("pointerdown", outside, true);
  window.addEventListener("keydown", escape);
  menu.querySelectorAll("[data-act]").forEach((button) =>
    button.addEventListener("click", () => {
      close();
      if (button.dataset.act === "edit") context.onEditItem(item);
      if (button.dataset.act === "delete") context.onDeleteItem(item);
      if (button.dataset.act === "detail") window.location.hash = "#recruit";
    }),
  );
  menu.querySelector("button").focus();
}

export function renderCalendar(container) {
  const days = weekDays();
  const byDay = collect(days);
  const range = hourRange(byDay);
  const hours = range.last - range.first;
  const label = `${days[0].slice(0, 4)}年 ${shortDate(days[0])} – ${shortDate(days[6])}`;

  container.innerHTML = `
    <div class="cal-toolbar">
      <div class="cal-nav">
        <button class="secondary-button" type="button" data-week="-1" aria-label="上一周">‹</button>
        <button class="secondary-button" type="button" data-week="0">本周</button>
        <button class="secondary-button" type="button" data-week="1" aria-label="下一周">›</button>
        <label class="cal-range" title="选日期跳到那一周">
          <strong>${label}</strong>
          <input type="date" data-jump value="${days[0]}" aria-label="跳到某一天所在的周" />
        </label>
      </div>
      <div class="cal-actions">
        <button class="secondary-button" type="button" data-new="deadline">新建截止任务</button>
        <button class="primary-button" type="button" data-new="appointment">新建日程</button>
      </div>
    </div>
    <p class="small-text cal-hint">在空白处拖动选出时间段新建日程（单击默认 1 小时）；点事项查看详情，右键可编辑或删除自己建的事项。浅色底表示准备、缓冲和交通占掉的时间。</p>
    <div class="cal-grid" style="--cal-height:${hours * HOUR_PX}px">
      <div class="cal-corner"></div>
      ${days
        .map((day) => {
          const weekday = WEEKDAY_NAMES[new Date(`${day}T00:00:00Z`).getUTCDay()];
          return `<div class="cal-dayhead ${day === context.todayKey ? "is-today" : ""}">周${weekday}<b>${shortDate(day)}</b></div>`;
        })
        .join("")}
      <div class="cal-allday-label">全天</div>
      ${days
        .map(
          (day) => `<div class="cal-allday">${byDay[day].allDay
            .map(
              (chip) =>
                `<button class="cal-chip kind-${chip.kind}" type="button" data-key="${escapeHtml(chip.key)}">${escapeHtml(chip.label)}</button>`,
            )
            .join("")}</div>`,
        )
        .join("")}
      <div class="cal-hours">${Array.from(
        { length: hours },
        (_, index) => `<span style="top:${index * HOUR_PX}px">${String(range.first + index).padStart(2, "0")}:00</span>`,
      ).join("")}</div>
      ${days
        .map((day) => {
          const now =
            day === context.todayKey &&
            nowMinutes() >= range.first * 60 &&
            nowMinutes() <= range.last * 60
              ? `<div class="cal-now" style="top:${((nowMinutes() - range.first * 60) / 60) * HOUR_PX}px"></div>`
              : "";
          return `<div class="cal-col ${day === context.todayKey ? "is-today" : ""} ${
            day < context.todayKey ? "is-past" : ""
          }" data-date="${day}">${byDay[day].timed.map((block) => blockHtml(block, range)).join("")}${now}</div>`;
        })
        .join("")}
    </div>
    <div class="cal-detail" id="calendarDetail"></div>
  `;

  container.querySelectorAll("[data-week]").forEach((button) =>
    button.addEventListener("click", () => {
      const step = Number(button.dataset.week);
      weekOffset = step === 0 ? 0 : weekOffset + step;
      selectedKey = null;
      renderCalendar(container);
    }),
  );
  const jump = container.querySelector("[data-jump]");
  // 点日期范围就弹出日期选择；Chromium 里点 input 本身不一定弹，所以主动调 showPicker。
  jump.closest("label").addEventListener("click", (event) => {
    event.preventDefault();
    try {
      jump.showPicker();
    } catch {
      jump.focus();
    }
  });
  jump.addEventListener("change", () => {
    if (!jump.value) return;
    weekOffset = weeksBetween(context.todayKey, jump.value);
    selectedKey = null;
    renderCalendar(container);
  });
  container.querySelectorAll("[data-new]").forEach((button) =>
    button.addEventListener("click", () => context.onNewItem(button.dataset.new)),
  );

  container.querySelectorAll(".cal-col").forEach((column) => bindSlotSelection(column, range));

  const lookup = new Map();
  Object.values(byDay).forEach(({ timed }) => timed.forEach((block) => lookup.set(block.key, block)));
  container.querySelectorAll("[data-key]").forEach((button) => {
    button.addEventListener("contextmenu", (event) => {
      const item = itemOfKey(button.dataset.key);
      if (!item) return;
      event.preventDefault();
      showItemMenu(item, event.clientX, event.clientY);
    });
    button.addEventListener("click", () => {
      const key = button.dataset.key;
      if (key.startsWith("focus:")) {
        window.location.hash = "#today";
        return;
      }
      if (key.startsWith("todo:")) {
        window.location.hash = "#todos";
        return;
      }
      selectedKey = selectedKey === key ? null : key;
      renderCalendar(container);
    });
  });

  const detail = container.querySelector("#calendarDetail");
  const selected = lookup.get(selectedKey);
  if (selected?.entry) {
    detail.appendChild(context.renderItemDetail(selected.entry));
  } else if (selectedKey?.startsWith("item:")) {
    // 只点了全天栏里的“截止”标记，而这一周没有排定时段。
    const item = context.getItems().find((candidate) => `item:${candidate.id}` === selectedKey);
    if (item) detail.innerHTML = `<p class="empty-note">${escapeHtml(Recruiting.describe(item))}：还没排进这一周的时间表，可以在招聘页或今天页查看。</p>`;
  }
}
