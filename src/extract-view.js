// 招聘页的“粘贴邮件解析”：把一封邮件交给 /api/extract，预览抽出来的事项，确认后再存。
// 自己用时邮件仍走 Gmail 转发 + 定时任务；这里用于手头的单封邮件和演示。见 docs/adr/0004。
/* global Recruiting -- 由 index.html 先加载的 recruiting.js 声明 */

import { escapeHtml } from "./format.js";
import { showToast } from "./ui.js";

let context = { canSave: false, isDemoMode: false, onSaved: async () => {} };
let result = null;
let lastEmail = null;

export function configureExtract(options) {
  context = { ...context, ...options };
}

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function nowLocal() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
  return parts.replace(" ", "T");
}

function whenText(item) {
  const time = Recruiting.parseTime(item.kind === "appointment" ? item.start : item.deadline);
  if (time === null) return "时间待补全";
  return item.kind === "appointment"
    ? `${Recruiting.formatDayLabel(time)} · ${item.durationMinutes} 分钟 · ${item.mode === "offline" ? "线下" : "线上"}`
    : `截止 ${Recruiting.formatDayLabel(time)} · 约 ${item.estimatedMinutes} 分钟`;
}

function candidateHtml(item, index) {
  return `
    <label class="extract-item ${item.status === "needs_review" ? "is-review" : ""}">
      <input type="checkbox" data-index="${index}" checked />
      <div>
        <div class="task-meta">
          <span class="duration-pill recruit-pill">${escapeHtml(item.type)}</span>
          <strong>${escapeHtml(Recruiting.describe(item))}</strong>
          <span class="status-chip status-${item.status}">${Recruiting.STATUS_LABELS[item.status] || item.status}</span>
        </div>
        <p class="task-description">${escapeHtml(whenText(item))}</p>
        ${item.reviewNote ? `<p class="extract-note">需要核对：${escapeHtml(item.reviewNote)}</p>` : ""}
        ${item.evidence ? `<p class="small-text">原文：“${escapeHtml(item.evidence)}”</p>` : ""}
        ${item.reason ? `<p class="small-text">判断依据：${escapeHtml(item.reason)}</p>` : ""}
      </div>
    </label>`;
}

function renderResult(box) {
  if (!result) {
    box.innerHTML = "";
    return;
  }
  if (!result.items.length) {
    box.innerHTML = `<p class="empty-note">${
      result.isRecruiting ? "没有找到需要排进日程的事项。" : "这封邮件看起来不是面试、测评之类的招聘事项。"
    }</p>`;
    return;
  }
  box.innerHTML = `
    <p class="small-text">抽出 ${result.items.length} 条，勾选要加入的。标成“待核对”的不会排进日程，加入后在上方补全时间即可。</p>
    ${result.items.map(candidateHtml).join("")}
    <div class="dialog-actions">
      <span class="small-text extract-meta">${escapeHtml(result.model || "")}</span>
      <button class="primary-button" type="button" data-save>加入日程</button>
    </div>`;
  box.querySelector("[data-save]").addEventListener("click", async (event) => {
    const chosen = [...box.querySelectorAll("input[data-index]:checked")].map(
      (input) => result.items[Number(input.dataset.index)],
    );
    if (!chosen.length) return;
    if (!context.canSave) {
      showToast("演示模式不保存。");
      return;
    }
    event.target.disabled = true;
    try {
      await post("/api/items/extracted", { items: chosen, email: lastEmail, model: result.model });
      showToast(`已加入 ${chosen.length} 条招聘事项。`);
      result = null;
      renderResult(box);
      await context.onSaved();
    } catch (error) {
      event.target.disabled = false;
      showToast(`没有保存：${error.message}`);
    }
  });
}

export function renderExtractPanel(container) {
  container.innerHTML = `
    <form class="extract-form">
      <div class="form-grid">
        <label><span>邮件标题</span><input name="subject" type="text" maxlength="300" placeholder="可不填" /></label>
        <label><span>收信时间（推算“72 小时内”这类说法用）</span><input name="receivedAt" type="datetime-local" /></label>
      </div>
      <label><span>邮件正文</span>
        <textarea name="body" rows="7" maxlength="30000" required placeholder="把面试邀请、测评通知的正文粘贴到这里"></textarea></label>
      <div class="dialog-actions">
        <span class="small-text extract-status"></span>
        <button class="primary-button" type="submit">解析</button>
      </div>
    </form>
    <div class="extract-result"></div>`;

  const form = container.querySelector("form");
  const status = container.querySelector(".extract-status");
  const box = container.querySelector(".extract-result");
  form.elements.receivedAt.value = nowLocal();

  if (!context.isDemoMode) {
    fetch("/api/extract/status")
      .then((response) => response.json())
      .then((data) => {
        if (!data.configured) status.textContent = "还没配置 Anthropic API 密钥，解析前请先按 README 配置。";
      })
      .catch(() => {});
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const f = form.elements;
    lastEmail = {
      subject: f.subject.value,
      body: f.body.value,
      receivedAt: f.receivedAt.value ? `${f.receivedAt.value}:00+08:00` : null,
    };
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    status.textContent = "正在解析，通常要十几秒…";
    try {
      result = context.isDemoMode ? demoResult() : await post("/api/extract", lastEmail);
      status.textContent = "";
    } catch (error) {
      result = null;
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
    renderResult(box);
  });
}

function demoResult() {
  const day = (offset, time) => {
    const date = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
    return `${date.toISOString().slice(0, 10)}T${time}:00+08:00`;
  };
  return {
    isRecruiting: true,
    model: "演示数据",
    items: [
      {
        kind: "deadline",
        type: "在线测评",
        company: "示例科技",
        title: "在线测评",
        status: "scheduled",
        deadline: day(2, "23:59"),
        windowStart: null,
        estimatedMinutes: 60,
        evidence: "请于收到邮件后 48 小时内完成在线测评",
        reason: "相对时间，按收信时间推算截止",
      },
      {
        kind: "appointment",
        type: "一面",
        company: "示例科技",
        title: "产品经理一面",
        status: "needs_review",
        start: null,
        durationMinutes: 60,
        mode: "online",
        reviewNote: "邮件里的时间说法含糊，请核对",
        evidence: "测评通过后，我们将在下周安排一面",
        reason: "只写了“下周”，没有具体时间",
      },
    ],
  };
}
