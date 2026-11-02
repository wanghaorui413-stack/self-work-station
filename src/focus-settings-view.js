// 投入方向的编辑界面：增删改、调顺序、归档。改完点“保存”才写入。

import { DEFAULT_PLACEHOLDER } from "./focus-areas.js";
import { escapeHtml } from "./format.js";
import { showToast } from "./ui.js";

const WEEKDAYS = [
  [1, "一"],
  [2, "二"],
  [3, "三"],
  [4, "四"],
  [5, "五"],
  [6, "六"],
  [0, "日"],
];
const PALETTE = ["#1f5c48", "#6b91a8", "#e68a53", "#927ca5", "#c57365", "#b08b42", "#3f6fb0", "#5b8c5a"];

let draft = [];
let savedIds = new Set();
let dirty = false;
let container = null;
let options = { canSave: false, readOnlyNote: "", onSave: async () => {} };

export function renderFocusEditor(target, areas, nextOptions) {
  container = target;
  options = nextOptions;
  draft = structuredClone(areas);
  savedIds = new Set(areas.map((area) => area.id));
  dirty = false;
  draw();
}

function markDirty() {
  dirty = true;
  container.querySelector("[data-focus-status]").textContent = "有未保存的修改";
  container.querySelector("[data-focus-save]").disabled = !options.canSave;
}

function areaCard(area, index, activeCount) {
  const dayChips = WEEKDAYS.map(
    ([day, label]) => `
      <label class="day-chip">
        <input type="checkbox" data-field="day" value="${day}" ${
          !area.days.length || area.days.includes(day) ? "checked" : ""
        } />
        <span>${label}</span>
      </label>`,
  ).join("");

  return `
    <article class="focus-card" data-index="${index}" style="--task-color: ${escapeHtml(area.color)}">
      <div class="focus-card-head">
        <input class="focus-color" type="color" data-field="color" value="${escapeHtml(area.color)}" aria-label="颜色" />
        <label class="focus-name"><span>名称</span>
          <input type="text" data-field="name" maxlength="30" value="${escapeHtml(area.name)}" /></label>
        <label class="focus-short"><span>简称</span>
          <input type="text" data-field="shortName" maxlength="10" placeholder="默认用名称" value="${escapeHtml(area.shortName)}" /></label>
        <div class="focus-order">
          <button class="text-button" type="button" data-move="-1" ${index === 0 ? "disabled" : ""} aria-label="上移">↑</button>
          <button class="text-button" type="button" data-move="1" ${index === activeCount - 1 ? "disabled" : ""} aria-label="下移">↓</button>
          <button class="text-button" type="button" data-remove>${savedIds.has(area.id) ? "归档" : "删除"}</button>
        </div>
      </div>
      <div class="focus-card-grid">
        <label><span>最低保障（分钟）</span>
          <input type="number" data-field="minimum" min="5" max="240" step="5" value="${area.minimum}" /></label>
        <label><span>权重</span>
          <input type="number" data-field="weight" min="0" max="1000" step="1" value="${area.weight}" /></label>
        <label><span>每天拆成</span>
          <select data-field="segments">
            ${[1, 2, 3, 4].map((n) => `<option value="${n}" ${area.segments === n ? "selected" : ""}>${n} 段</option>`).join("")}
          </select></label>
        <label class="focus-keep">
          <input type="checkbox" data-field="keepWhenCrowded" ${area.keepWhenCrowded ? "checked" : ""} />
          <span>空档不够时优先保留</span>
        </label>
      </div>
      <div class="focus-days" role="group" aria-label="生效日">
        <span class="focus-days-label">哪几天排</span>${dayChips}
      </div>
      <label><span>做法提示（显示在时间表里）</span>
        <input type="text" data-field="description" maxlength="200" value="${escapeHtml(area.description)}" /></label>
    </article>
  `;
}

function draw() {
  const active = draft.filter((area) => !area.archived);
  const archived = draft.filter((area) => area.archived);

  container.innerHTML = `
    <div class="focus-list">
      ${active.map((area, index) => areaCard(area, index, active.length)).join("")}
    </div>
    <div class="focus-actions">
      <button class="secondary-button" type="button" data-focus-add>新增方向</button>
      <p class="small-text" data-focus-status>${
        options.canSave ? "列表越靠上，越先排进当天；空档不够时也按这个顺序保留。" : options.readOnlyNote
      }</p>
      <button class="primary-button" type="button" data-focus-save disabled>保存投入方向</button>
    </div>
    ${
      archived.length
        ? `<details class="focus-archived">
            <summary>已归档（${archived.length}）：不再排进计划，历史统计里仍保留</summary>
            ${archived
              .map(
                (area) => `<p><span>${escapeHtml(area.name)}</span>
                  <button class="text-button" type="button" data-restore="${escapeHtml(area.id)}">恢复</button></p>`,
              )
              .join("")}
          </details>`
        : ""
    }
  `;

  container.querySelectorAll(".focus-card").forEach((card) => {
    const area = active[Number(card.dataset.index)];
    card.addEventListener("input", (event) => updateField(area, event.target, card));
    card.addEventListener("change", (event) => updateField(area, event.target, card));
    card.querySelectorAll("[data-move]").forEach((button) =>
      button.addEventListener("click", () => move(area, Number(button.dataset.move))),
    );
    card.querySelector("[data-remove]").addEventListener("click", () => remove(area));
  });
  container.querySelector("[data-focus-add]").addEventListener("click", add);
  container.querySelector("[data-focus-save]").addEventListener("click", save);
  container.querySelectorAll("[data-restore]").forEach((button) =>
    button.addEventListener("click", () => {
      draft.find((area) => area.id === button.dataset.restore).archived = false;
      draw();
      markDirty();
    }),
  );
  if (dirty) markDirty();
}

function updateField(area, input, card) {
  const field = input.dataset.field;
  if (!field) return;
  if (field === "day") {
    const checked = [...card.querySelectorAll('[data-field="day"]:checked')].map((box) => Number(box.value));
    // 全选和全不选都当作“每天”。
    area.days = checked.length === 7 ? [] : checked;
  } else if (field === "keepWhenCrowded") {
    area.keepWhenCrowded = input.checked;
  } else if (["minimum", "weight", "segments"].includes(field)) {
    area[field] = Number(input.value);
  } else {
    area[field] = input.value;
    if (field === "color") card.style.setProperty("--task-color", input.value);
    // 改了名字，图标在保存时按新名字重新取第一个字。
    if (field === "name" || field === "shortName") area.icon = "";
  }
  markDirty();
}

// 在“未归档”的顺序里移动；归档的方向留在原位不影响排序。
function move(area, step) {
  const active = draft.filter((item) => !item.archived);
  const target = active[active.indexOf(area) + step];
  if (!target) return;
  const from = draft.indexOf(area);
  const to = draft.indexOf(target);
  [draft[from], draft[to]] = [draft[to], draft[from]];
  draw();
  markDirty();
}

function remove(area) {
  if (draft.filter((item) => !item.archived).length <= 1) {
    showToast("至少保留一个投入方向。");
    return;
  }
  if (savedIds.has(area.id)) {
    area.archived = true;
  } else {
    draft.splice(draft.indexOf(area), 1);
  }
  draw();
  markDirty();
}

function add() {
  const used = new Set(draft.map((area) => area.color));
  draft.push({
    id: `fa-${Date.now().toString(36)}`,
    name: "新方向",
    shortName: "",
    icon: "",
    color: PALETTE.find((color) => !used.has(color)) || PALETTE[draft.length % PALETTE.length],
    minimum: 30,
    weight: 10,
    days: [],
    segments: 1,
    keepWhenCrowded: false,
    archived: false,
    description: "",
    placeholder: DEFAULT_PLACEHOLDER,
  });
  draw();
  markDirty();
  container.querySelector(".focus-card:last-child [data-field='name']")?.select();
}

async function save() {
  const button = container.querySelector("[data-focus-save]");
  button.disabled = true;
  try {
    // 简称和图标跟着名称走，除非用户自己填了。
    const areas = draft.map((area) => ({
      ...area,
      shortName: area.shortName?.trim() || area.name.trim().slice(0, 10),
      icon: area.icon || (area.shortName?.trim() || area.name.trim()).slice(0, 1),
    }));
    await options.onSave(areas);
  } catch (error) {
    showToast(`没有保存：${error.message}`);
    button.disabled = false;
  }
}
