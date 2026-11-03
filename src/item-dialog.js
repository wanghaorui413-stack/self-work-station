// 新建或编辑固定日程、截止任务的弹窗。日历点空白处或拖选时段、待办“排进日程”、“新建”按钮、事项上的“编辑”都用它。
/* global Recruiting -- 由 index.html 先加载的 recruiting.js 声明 */

import * as store from "./store.js";
import { showToast } from "./ui.js";

const dialog = document.querySelector("#itemDialog");
const form = document.querySelector("#itemForm");
const error = document.querySelector("#itemFormError");
const heading = document.querySelector("#itemDialogTitle");

let context = { canSave: false, onCreated: async () => {}, onUpdated: async () => {} };
let pending = null;

function syncKind() {
  const kind = form.elements.kind.value;
  form.querySelectorAll("[data-kind]").forEach((field) => {
    field.hidden = field.dataset.kind !== kind;
  });
}

// 弹窗里的时间是本地输入（无时区），存的时候一律按北京时间。
function toIso(local) {
  return local ? `${local}:00+08:00` : null;
}

function toLocal(value) {
  const ms = Recruiting.parseTime(value);
  return ms === null ? "" : Recruiting.toIso(ms).slice(0, 16);
}

function clockOf(local) {
  return local ? local.slice(11, 16) : "";
}

function addMinutes(local, minutes) {
  const ms = Date.parse(`${local}:00+08:00`) + minutes * 60000;
  return Recruiting.toIso(ms).slice(0, 16);
}

// 开始时间 + 结束时刻 → 时长。结束时刻早于开始时，算到第二天（比如 23:00-01:00）。
function durationOf(startLocal, endClock) {
  if (!startLocal || !endClock) return null;
  const [sh, sm] = clockOf(startLocal).split(":").map(Number);
  const [eh, em] = endClock.split(":").map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes;
}

export function configureItemDialog(options) {
  context = { ...context, ...options };
  form.elements.kind.forEach((radio) => radio.addEventListener("change", syncKind));
  form.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
  // 改开始时间时，结束时间跟着平移，保持原来的时长。
  let lastStart = "";
  form.elements.start.addEventListener("focus", () => {
    lastStart = form.elements.start.value;
  });
  form.elements.start.addEventListener("change", () => {
    const f = form.elements;
    const kept = durationOf(lastStart, f.end.value) || 60;
    if (f.start.value) f.end.value = clockOf(addMinutes(f.start.value, kept));
    lastStart = f.start.value;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!context.canSave) {
      error.textContent = "未连接数据服务，不能保存。";
      return;
    }
    const f = form.elements;
    const kind = f.kind.value;
    const fields = {
      kind,
      title: f.title.value,
      location: f.location.value,
      link: f.link.value,
      userNote: f.userNote.value,
    };
    if (kind === "appointment") {
      const duration = durationOf(f.start.value, f.end.value);
      if (!f.start.value || !duration) {
        error.textContent = "请填写开始和结束时间。";
        return;
      }
      Object.assign(fields, {
        start: toIso(f.start.value),
        durationMinutes: duration,
        mode: f.mode.value,
        prepMinutes: Number(f.prepMinutes.value),
        bufferMinutes: Number(f.bufferMinutes.value),
      });
    } else {
      Object.assign(fields, {
        deadline: toIso(f.deadline.value),
        estimatedMinutes: Number(f.estimatedMinutes.value),
        windowStart: toIso(f.windowStart.value),
      });
    }
    try {
      if (pending.editId) {
        await store.updateItem(pending.editId, fields);
        dialog.close();
        await context.onUpdated();
        showToast("已保存修改。");
      } else {
        const item = await store.createItem(fields);
        dialog.close();
        await context.onCreated(item, pending);
        showToast(kind === "appointment" ? "已加进日程。" : "已建好截止任务，会自动排进空档。");
      }
    } catch (failure) {
      error.textContent = failure.message;
    }
  });
}

// preset: { kind, title, start, end, deadline, estimatedMinutes, note, fromTodoId }，
// start 用 "YYYY-MM-DDTHH:MM"，end 用 "HH:MM"。
export function openItemDialog(preset = {}) {
  pending = preset;
  form.reset();
  error.textContent = "";
  heading.textContent = "新建";
  form.querySelector("[data-new-only]").hidden = false;
  const f = form.elements;
  f.kind.value = preset.kind || "appointment";
  f.title.value = preset.title || "";
  if (preset.start) {
    f.start.value = preset.start;
    f.end.value = preset.end || clockOf(addMinutes(preset.start, 60));
  }
  if (preset.deadline) f.deadline.value = preset.deadline;
  if (preset.estimatedMinutes) f.estimatedMinutes.value = preset.estimatedMinutes;
  f.userNote.value = preset.note || "";
  syncKind();
  dialog.showModal();
  f.title.focus();
}

// 编辑已有的手动事项。类型不能改：改类型等于删掉重建。
export function openEditDialog(item) {
  pending = { editId: item.id };
  form.reset();
  error.textContent = "";
  heading.textContent = item.kind === "appointment" ? "编辑日程" : "编辑截止任务";
  form.querySelector("[data-new-only]").hidden = true;
  const f = form.elements;
  f.kind.value = item.kind;
  f.title.value = item.title || "";
  f.location.value = item.location || "";
  f.link.value = item.link || "";
  f.userNote.value = item.userNote || "";
  if (item.kind === "appointment") {
    f.start.value = toLocal(item.start);
    f.end.value = clockOf(addMinutes(f.start.value, Number(item.durationMinutes) || 60));
    f.mode.value = item.mode === "offline" ? "offline" : "online";
    f.prepMinutes.value = Number(item.prepMinutes) || 0;
    f.bufferMinutes.value = Number(item.bufferMinutes) || 0;
  } else {
    f.deadline.value = toLocal(item.deadline);
    f.estimatedMinutes.value = Number(item.estimatedMinutes) || 60;
    f.windowStart.value = toLocal(item.windowStart);
  }
  syncKind();
  dialog.showModal();
  f.title.focus();
}
