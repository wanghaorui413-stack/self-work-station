// 待办：待办页、今天页上的“今天的待办”卡片，以及待办数据的读写。

import { escapeHtml } from "./format.js";
import * as store from "./store.js";
import { showToast } from "./ui.js";
import {
  dueDateOf,
  dueTimeOf,
  groupTodos,
  isMarkedToday,
  newTodoId,
  todosForToday,
} from "./todos.js";

const MAX_DONE_SHOWN = 20;

let todos = [];
let editingId = null;
let context = {
  todayKey: null,
  canSave: false,
  onChange: () => {},
  onSchedule: () => {},
};

export function configureTodos(options) {
  context = { ...context, ...options };
}

export function getTodos() {
  return todos;
}

export async function loadTodosData(isDemoMode) {
  if (isDemoMode) {
    todos = demoTodos(context.todayKey);
    return;
  }
  try {
    todos = await store.loadTodos();
  } catch {
    todos = [];
  }
}

async function commit(next, message) {
  const previous = todos;
  todos = next;
  context.onChange();
  if (!context.canSave) return;
  try {
    todos = await store.saveTodos(next);
    if (message) showToast(message);
  } catch (error) {
    todos = previous;
    context.onChange();
    showToast(`待办没有保存：${error.message}`);
  }
}

function update(id, patch, message) {
  return commit(
    todos.map((todo) => (todo.id === id ? { ...todo, ...patch } : todo)),
    message,
  );
}

export function addTodo({ title, due = null, today = false }) {
  const trimmed = title.trim();
  if (!trimmed) return Promise.resolve();
  return commit([
    ...todos,
    {
      id: newTodoId(),
      title: trimmed,
      note: "",
      due,
      todayDate: today ? context.todayKey : null,
      done: false,
      doneAt: null,
      createdAt: new Date().toISOString(),
    },
  ]);
}

export function toggleTodoDone(id) {
  const todo = todos.find((item) => item.id === id);
  return update(id, { done: !todo.done, doneAt: todo.done ? null : new Date().toISOString() });
}

function toggleToday(id) {
  const todo = todos.find((item) => item.id === id);
  const on = !isMarkedToday(todo, context.todayKey);
  return update(id, { todayDate: on ? context.todayKey : null }, on ? "已加入今天。" : "已移出今天。");
}

export function removeTodo(id) {
  return commit(todos.filter((todo) => todo.id !== id));
}

// ---------- 显示 ----------

function dayLabel(dateKey) {
  if (dateKey === context.todayKey) return "今天";
  const tomorrow = new Date(`${context.todayKey}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (dateKey === tomorrow.toISOString().slice(0, 10)) return "明天";
  const [, month, day] = dateKey.split("-").map(Number);
  return `${month}月${day}日`;
}

function dueLabel(todo) {
  const date = dueDateOf(todo);
  if (!date) return "";
  const overdue = !todo.done && date < context.todayKey;
  const time = dueTimeOf(todo);
  return `<span class="todo-due ${overdue ? "is-overdue" : ""}">${overdue ? "已逾期 · " : ""}${dayLabel(
    date,
  )}${time ? ` ${time}` : ""}</span>`;
}

function todoRow(todo, { compact = false } = {}) {
  const row = document.createElement("div");
  const marked = isMarkedToday(todo, context.todayKey);
  row.className = `todo-row ${todo.done ? "is-done" : ""}`;
  row.innerHTML = `
    <button class="tl-check" type="button" data-act="done" aria-pressed="${todo.done}"
      aria-label="${todo.done ? "撤销完成" : "完成"}：${escapeHtml(todo.title)}">✓</button>
    <button class="todo-title" type="button" data-act="edit" ${compact ? "disabled" : ""}>${escapeHtml(todo.title)}</button>
    ${dueLabel(todo)}
    ${
      todo.done
        ? ""
        : `<button class="todo-star ${marked ? "is-on" : ""}" type="button" data-act="today"
            title="${marked ? "移出今天" : "今天做"}" aria-pressed="${marked}">${marked ? "★" : "☆"}</button>`
    }
    ${
      compact || todo.done
        ? ""
        : `<button class="text-button" type="button" data-act="schedule" title="填上预计用时，变成会自动排进空档的截止任务">排进日程</button>
           <button class="text-button" type="button" data-act="delete">删除</button>`
    }
  `;
  row.querySelectorAll("[data-act]").forEach((button) =>
    button.addEventListener("click", () => {
      const act = button.dataset.act;
      if (act === "done") toggleTodoDone(todo.id);
      if (act === "today") toggleToday(todo.id);
      if (act === "delete") removeTodo(todo.id);
      if (act === "schedule") context.onSchedule(todo);
      if (act === "edit") {
        editingId = editingId === todo.id ? null : todo.id;
        context.onChange();
      }
    }),
  );
  return row;
}

function editForm(todo) {
  const form = document.createElement("form");
  form.className = "todo-edit";
  form.innerHTML = `
    <label class="todo-edit-title"><span>内容</span>
      <input name="title" type="text" maxlength="200" value="${escapeHtml(todo.title)}" required /></label>
    <label><span>截止日期</span><input name="date" type="date" value="${dueDateOf(todo) || ""}" /></label>
    <label><span>时间（可不填）</span><input name="time" type="time" value="${dueTimeOf(todo) || ""}" /></label>
    <label class="todo-edit-note"><span>备注</span>
      <textarea name="note" rows="2" maxlength="1000">${escapeHtml(todo.note || "")}</textarea></label>
    <div class="todo-edit-actions">
      <button class="secondary-button" type="button" data-cancel>取消</button>
      <button class="primary-button" type="submit">保存</button>
    </div>
  `;
  form.querySelector("[data-cancel]").addEventListener("click", () => {
    editingId = null;
    context.onChange();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const { title, date, time, note } = form.elements;
    editingId = null;
    update(todo.id, {
      title: title.value.trim() || todo.title,
      due: date.value ? (time.value ? `${date.value}T${time.value}` : date.value) : null,
      note: note.value,
    });
  });
  return form;
}

function section(title, list, empty) {
  const wrap = document.createElement("section");
  wrap.className = "todo-section";
  wrap.innerHTML = `<h2 class="section-title">${title}<span class="todo-count">${list.length}</span></h2>`;
  const box = document.createElement("div");
  box.className = "card todo-list";
  if (!list.length) box.innerHTML = `<p class="small-text">${empty}</p>`;
  list.forEach((todo) => {
    box.appendChild(todoRow(todo));
    if (editingId === todo.id) box.appendChild(editForm(todo));
  });
  wrap.appendChild(box);
  return wrap;
}

function quickAddForm({ compact = false } = {}) {
  const form = document.createElement("form");
  form.className = `todo-add ${compact ? "is-compact" : ""}`;
  form.innerHTML = `
    <input name="title" type="text" maxlength="200" placeholder="${
      compact ? "加一条今天的待办，回车保存" : "新待办，回车保存"
    }" aria-label="新待办" />
    ${compact ? "" : '<input name="date" type="date" aria-label="截止日期（可不填）" />'}
    ${compact ? "" : '<button class="primary-button" type="submit">添加</button>'}
  `;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = form.elements.title.value;
    const due = form.elements.date?.value || null;
    await addTodo({ title, due, today: compact });
    form.reset();
    form.elements.title.focus();
  });
  return form;
}

export function renderTodosView(container) {
  const focused = container.querySelector(".todo-add input[name=title]") === document.activeElement;
  const groups = groupTodos(todos, context.todayKey);
  container.innerHTML = "";
  container.appendChild(quickAddForm());
  container.appendChild(section("今天", groups.today, "今天没有要做的待办。点 ☆ 可以把任意待办加进今天。"));
  container.appendChild(section("即将到期", groups.upcoming, "没有设了截止日期的待办。"));
  container.appendChild(section("以后再说", groups.someday, "没有未定日期的待办。"));
  if (groups.done.length) {
    const done = document.createElement("details");
    done.className = "todo-done";
    done.innerHTML = `<summary>已完成（${groups.done.length}）</summary>`;
    const box = document.createElement("div");
    box.className = "card todo-list";
    groups.done.slice(0, MAX_DONE_SHOWN).forEach((todo) => box.appendChild(todoRow(todo)));
    done.appendChild(box);
    container.appendChild(done);
  }
  if (focused) container.querySelector(".todo-add input[name=title]").focus();
}

export function renderTodayTodos(container) {
  const focused = container.querySelector(".todo-add input") === document.activeElement;
  const list = todosForToday(todos, context.todayKey);
  container.innerHTML = `<h2>今天的待办 <a class="text-link" href="#todos">全部</a></h2>`;
  const box = document.createElement("div");
  box.className = "todo-list";
  if (!list.length) box.innerHTML = '<p class="small-text">没有今天要做的待办。</p>';
  list.forEach((todo) => box.appendChild(todoRow(todo, { compact: true })));
  container.appendChild(box);
  container.appendChild(quickAddForm({ compact: true }));
  if (focused) container.querySelector(".todo-add input").focus();
}

function demoTodos(todayKey) {
  const day = (offset) => {
    const date = new Date(`${todayKey}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const base = { note: "", done: false, doneAt: null, createdAt: "demo" };
  return [
    { ...base, id: "demo-t1", title: "回复导师关于实验方案的邮件", due: null, todayDate: todayKey },
    { ...base, id: "demo-t2", title: "交报销单", due: `${day(0)}T17:00`, todayDate: null },
    { ...base, id: "demo-t3", title: "改简历第二版", due: day(2), todayDate: null },
    { ...base, id: "demo-t4", title: "整理雅思口语题库", due: null, todayDate: null },
    { ...base, id: "demo-t5", title: "确认二面地址", due: day(-1), todayDate: null },
  ];
}
