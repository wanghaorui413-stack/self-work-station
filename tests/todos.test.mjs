import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTodos, normalizeTodos, todosForToday } from "../src/todos.js";

const today = "2026-11-02";
const todo = (overrides) => ({
  id: "t1",
  title: "写周报",
  note: "",
  due: null,
  todayDate: null,
  done: false,
  doneAt: null,
  createdAt: "x",
  ...overrides,
});

test("今天的待办：标了今天做的、今天到期的、已逾期的；已完成的不算", () => {
  const list = [
    todo({ id: "marked", todayDate: today }),
    todo({ id: "due-today", due: `${today}T18:00` }),
    todo({ id: "overdue", due: "2026-10-30" }),
    todo({ id: "later", due: "2026-11-09" }),
    todo({ id: "no-date" }),
    todo({ id: "done", todayDate: today, done: true }),
  ];
  assert.deepEqual(todosForToday(list, today).map((t) => t.id), ["marked", "due-today", "overdue"]);
});

test("“今天做”只在标记当天有效，第二天自动回到清单", () => {
  const list = [todo({ id: "yesterday-mark", todayDate: "2026-11-01" })];
  assert.deepEqual(todosForToday(list, today), []);
  assert.deepEqual(groupTodos(list, today).someday.map((t) => t.id), ["yesterday-mark"]);
});

test("待办页分组：即将到期按日期排序，已完成单独一组", () => {
  const groups = groupTodos(
    [
      todo({ id: "b", due: "2026-11-10" }),
      todo({ id: "a", due: "2026-11-05" }),
      todo({ id: "c" }),
      todo({ id: "d", done: true, doneAt: "2026-11-01T10:00:00Z" }),
    ],
    today,
  );
  assert.deepEqual(groups.upcoming.map((t) => t.id), ["a", "b"]);
  assert.deepEqual(groups.someday.map((t) => t.id), ["c"]);
  assert.deepEqual(groups.done.map((t) => t.id), ["d"]);
});

test("校验：拒绝空内容、格式错的截止时间、重复 id", () => {
  assert.throws(() => normalizeTodos([todo({ title: "  " })]), /不能为空/);
  assert.throws(() => normalizeTodos([todo({ due: "下周五" })]), /格式/);
  assert.throws(() => normalizeTodos([todo({}), todo({})]), /重复/);
  const [saved] = normalizeTodos([todo({ due: "2026-11-05T09:30", done: true })]);
  assert.equal(saved.due, "2026-11-05T09:30");
  assert.ok(saved.doneAt);
});
