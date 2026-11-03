// 待办（To-do）：不占时间表的一次性清单项（见 GLOSSARY.md）。
// 纯函数，浏览器和本地服务器共用。

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DUE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
const MAX_TODOS = 1000;

export function newTodoId() {
  return `td-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// due 可以只有日期（"2026-11-05"），也可以带时间（"2026-11-05T18:00"），都按北京时间。
export function dueDateOf(todo) {
  return todo.due ? todo.due.slice(0, 10) : null;
}

export function dueTimeOf(todo) {
  return todo.due && todo.due.length > 10 ? todo.due.slice(11, 16) : null;
}

// “今天做”只在标记的那一天有效，过了这天自动失效。
export function isMarkedToday(todo, todayKey) {
  return todo.todayDate === todayKey;
}

// 今天要看到的待办：标了今天做的、今天到期的、已经逾期的。
export function todosForToday(todos, todayKey) {
  return todos.filter((todo) => {
    if (todo.done) return false;
    const due = dueDateOf(todo);
    return isMarkedToday(todo, todayKey) || (due !== null && due <= todayKey);
  });
}

// 待办页的分组。
export function groupTodos(todos, todayKey) {
  const open = todos.filter((todo) => !todo.done);
  const today = todosForToday(open, todayKey);
  const rest = open.filter((todo) => !today.includes(todo));
  const byDue = (a, b) => (a.due || "9999").localeCompare(b.due || "9999");
  return {
    today: [...today].sort(byDue),
    upcoming: rest.filter((todo) => todo.due).sort(byDue),
    someday: rest.filter((todo) => !todo.due),
    done: todos
      .filter((todo) => todo.done)
      .sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || "")),
  };
}

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// 服务器写入前用；不合法时抛出带中文说明的错误。
export function normalizeTodos(input) {
  if (!Array.isArray(input)) throw new Error("待办必须是列表");
  if (input.length > MAX_TODOS) throw new Error(`待办最多 ${MAX_TODOS} 条`);
  const seen = new Set();
  return input.map((raw) => {
    const id = String(raw?.id || "");
    if (!ID_PATTERN.test(id)) throw new Error(`待办 id 不合法：${id}`);
    if (seen.has(id)) throw new Error(`待办 id 重复：${id}`);
    seen.add(id);
    const title = text(raw.title, 200);
    if (!title) throw new Error("待办内容不能为空");
    const due = raw.due ? String(raw.due) : null;
    if (due && !DUE_PATTERN.test(due)) throw new Error(`「${title}」的截止时间格式不对`);
    const todayDate = raw.todayDate ? String(raw.todayDate) : null;
    if (todayDate && !DATE_PATTERN.test(todayDate)) throw new Error("“今天做”的日期格式不对");
    const done = Boolean(raw.done);
    return {
      id,
      title,
      note: text(raw.note, 1000),
      due,
      todayDate,
      done,
      doneAt: done ? String(raw.doneAt || new Date().toISOString()) : null,
      createdAt: String(raw.createdAt || new Date().toISOString()),
    };
  });
}
