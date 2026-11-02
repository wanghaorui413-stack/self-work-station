// 今天页的竖向时间轴：高度大致按时长比例，空档也画出来，有一条“现在”线。
// 每个时段默认收起，只显示时间、名称和完成勾选；点开才看小目标和按钮。

import { escapeHtml, formatClock, formatDuration } from "./format.js";

const PX_PER_MINUTE = 1.1;
const MIN_ITEM_PX = 48;
const GAP_PX_PER_MINUTE = 0.6;
const MAX_GAP_PX = 120;
const LABELED_GAP_MINUTES = 20;

function gapElement(start, end) {
  const minutes = end - start;
  const gap = document.createElement("div");
  gap.className = "tl-gap";
  gap.dataset.start = start;
  gap.dataset.end = end;
  gap.style.height = `${Math.min(MAX_GAP_PX, Math.max(6, minutes * GAP_PX_PER_MINUTE))}px`;
  if (minutes >= LABELED_GAP_MINUTES) {
    gap.innerHTML = `<span>${formatClock(start)} · 空档 ${formatDuration(minutes)}</span>`;
  }
  return gap;
}

// entries: [{ key, start, end, color, title, meta, complete, active, checkable, detail: () => Node }]
export function renderTimeline(container, entries, { openKeys, onToggleOpen, onToggleComplete }) {
  container.innerHTML = "";
  let cursor = null;

  entries.forEach((entry) => {
    if (cursor !== null && entry.start > cursor) {
      container.appendChild(gapElement(cursor, entry.start));
    }
    cursor = Math.max(cursor ?? entry.end, entry.end);

    const isOpen = openKeys.has(entry.key);
    const item = document.createElement("article");
    item.className = [
      "tl-item",
      `kind-${entry.kind}`,
      entry.complete ? "is-complete" : "",
      entry.active ? "is-active" : "",
      isOpen ? "is-open" : "",
    ]
      .filter(Boolean)
      .join(" ");
    item.dataset.start = entry.start;
    item.dataset.end = entry.end;
    item.style.setProperty("--task-color", entry.color);
    item.style.minHeight = `${Math.max(MIN_ITEM_PX, (entry.end - entry.start) * PX_PER_MINUTE)}px`;

    item.innerHTML = `
      <div class="tl-row">
        ${
          entry.checkable
            ? `<button class="tl-check" type="button" aria-pressed="${entry.complete}" aria-label="${
                entry.complete ? "撤销完成" : "标记完成"
              }：${escapeHtml(entry.title)}">✓</button>`
            : `<span class="tl-badge">${escapeHtml(entry.badge || "")}</span>`
        }
        <button class="tl-summary" type="button" aria-expanded="${isOpen}">
          <span class="tl-time">${formatClock(entry.start)}–${formatClock(entry.end)}</span>
          <span class="tl-title">${escapeHtml(entry.title)}</span>
          ${entry.meta ? `<span class="tl-meta">${entry.meta}</span>` : ""}
          <span class="tl-chevron" aria-hidden="true">›</span>
        </button>
      </div>
    `;
    if (isOpen) {
      const detail = document.createElement("div");
      detail.className = "tl-detail";
      detail.appendChild(entry.detail());
      item.appendChild(detail);
    }

    item.querySelector(".tl-summary").addEventListener("click", () => onToggleOpen(entry.key));
    item.querySelector(".tl-check")?.addEventListener("click", () => onToggleComplete(entry.key));
    container.appendChild(item);
  });

  const now = document.createElement("div");
  now.className = "tl-now";
  now.innerHTML = "<span>现在</span>";
  container.appendChild(now);
}

// 把“现在”线放到对应时段或空档里按比例的位置；不在今天的范围内就藏起来。
export function positionNowLine(container, nowMinutes) {
  const line = container.querySelector(".tl-now");
  if (!line) return;
  const blocks = [...container.querySelectorAll(".tl-item, .tl-gap")];
  if (!blocks.length) {
    line.hidden = true;
    return;
  }
  const first = Number(blocks[0].dataset.start);
  const last = Math.max(...blocks.map((block) => Number(block.dataset.end)));
  if (nowMinutes < first || nowMinutes > last) {
    line.hidden = true;
    return;
  }
  const block =
    blocks.find(
      (candidate) =>
        nowMinutes >= Number(candidate.dataset.start) && nowMinutes < Number(candidate.dataset.end),
    ) || blocks.at(-1);
  const start = Number(block.dataset.start);
  const end = Number(block.dataset.end);
  const ratio = end > start ? Math.min(1, (nowMinutes - start) / (end - start)) : 0;
  line.hidden = false;
  line.style.top = `${block.offsetTop + ratio * block.offsetHeight}px`;
}
