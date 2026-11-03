// 大模型解析邮件：给一封邮件，返回结构化的招聘事项候选。见 docs/adr/0004。
// 只负责“邮件 → 事项”，不写数据；调用方预览、确认后再存。
// 模型的输出先用 JSON Schema 约束格式，回来后再用代码规则核对一遍，含糊的一律标成待核对。

import { readFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";
const MAX_EMAIL_CHARS = 30000;
const DEFAULT_DURATION = 60;
const DEFAULT_ESTIMATE = { "AI 面试": 45 };

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });

// 结构化输出不支持数值和长度约束，这些交给 validateExtraction。
export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_recruiting", "items"],
  properties: {
    is_recruiting: {
      type: "boolean",
      description: "这封邮件是否包含需要求职者在某个时间参加或完成的事项。职位推送、营销、投递回执为 false。",
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "kind",
          "type",
          "company",
          "title",
          "start",
          "duration_minutes",
          "mode",
          "window_start",
          "deadline",
          "estimated_minutes",
          "link",
          "location",
          "needs_confirmation",
          "time_certainty",
          "evidence",
          "reason",
        ],
        properties: {
          kind: {
            type: "string",
            enum: ["appointment", "deadline"],
            description: "appointment：对方定好时间的面试、宣讲会；deadline：给一个截止时间、自己选时间完成的测评、笔试、AI 面试。",
          },
          type: { type: "string", description: "类别，如 一面、二面、HR 面、笔试、在线测评、AI 面试、宣讲会。" },
          company: nullable({ type: "string" }),
          title: { type: "string", description: "岗位或轮次，例如“数据分析岗一面”。" },
          start: nullable({ type: "string", description: "appointment 的开始时间，ISO 8601，带 +08:00。" }),
          duration_minutes: nullable({ type: "integer" }),
          mode: nullable({ type: "string", enum: ["online", "offline"] }),
          window_start: nullable({ type: "string", description: "deadline 最早可开始的时间，ISO 8601。" }),
          deadline: nullable({ type: "string", description: "deadline 的截止时间，ISO 8601，带 +08:00。" }),
          estimated_minutes: nullable({ type: "integer" }),
          link: nullable({ type: "string" }),
          location: nullable({ type: "string" }),
          needs_confirmation: { type: "boolean", description: "邮件是否要求回复确认参加。" },
          time_certainty: {
            type: "string",
            enum: ["exact", "relative_resolved", "vague", "missing"],
            description:
              "exact：邮件写明了日期和时间；relative_resolved：写的是“收到后 72 小时内”这类相对时间，已按收信时间推算；vague：只说了“下周”“近期”；missing：没写时间。",
          },
          evidence: { type: "string", description: "邮件里写明时间的那句原文，原样摘抄；没有就填空字符串。" },
          reason: { type: "string", description: "一句话说明为什么这样判断类型和时间。" },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `你帮求职者把招聘邮件整理成日程。读一封邮件，找出其中需要求职者在某个时间参加或完成的事项。

规则：
- 一封邮件可以有多个事项，例如“3 日前完成测评，通过后 5 日面试”是两条。条件性的后续事项（“通过后另行通知”）不算。
- 所有时间写成 ISO 8601 并带 +08:00（北京时间）。邮件只写了月日没写年份时，取收信时间之后最近的那个日期。
- “收到邮件后 72 小时内”这类相对时间，按收信时间推算，time_certainty 填 relative_resolved。
- 只写了“下周”“近期”“另行通知”的，时间字段填 null，time_certainty 填 vague 或 missing。不要猜具体时间。
- 邮件没写的信息填 null，不要编造。链接只填邮件里出现过的完整网址。
- evidence 必须是邮件原文里的连续片段，原样复制。
- 职位推送、订阅、营销、投递成功回执等，is_recruiting 为 false，items 为空数组。`;

export function buildUserMessage({ subject = "", from = "", receivedAt, body = "" }) {
  return [
    `收信时间：${receivedAt}`,
    `发件人：${from || "（未提供）"}`,
    `标题：${subject || "（无标题）"}`,
    "正文：",
    body,
  ].join("\n");
}

// ---------- 校验 ----------

const squash = (text) => String(text || "").replace(/\s+/g, "");

// 没写时区的时间按北京时间理解；解析不了返回 null。
function normalizeTime(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)) {
    text = `${text.length === 16 ? `${text}:00` : text}+08:00`;
  }
  return Number.isFinite(Date.parse(text)) ? text : null;
}

function minutesOr(value, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 5 && number <= 24 * 60 ? number : fallback;
}

function textOr(value, max) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

// 把模型输出变成可以存进 items.json 的候选事项。每条都会带上 status 和 reviewNote，
// 规则不通过的标成 needs_review，不会直接排进日程。
export function validateExtraction(output, email) {
  const received = Date.parse(email.receivedAt);
  const source = squash(`${email.subject}\n${email.body}`);
  const rawItems = output?.is_recruiting && Array.isArray(output.items) ? output.items : [];

  const items = rawItems.slice(0, 10).map((raw) => {
    const problems = [];
    const kind = raw.kind === "deadline" ? "deadline" : "appointment";
    const type = textOr(raw.type, 20) || (kind === "appointment" ? "面试" : "测评");
    const item = {
      kind,
      type,
      company: textOr(raw.company, 60),
      title: textOr(raw.title, 60) || type,
      link: /^https?:\/\/\S+$/.test(raw.link || "") && source.includes(squash(raw.link)) ? raw.link : null,
      location: textOr(raw.location, 200),
    };

    let when;
    if (kind === "appointment") {
      item.start = normalizeTime(raw.start);
      item.durationMinutes = minutesOr(raw.duration_minutes, DEFAULT_DURATION);
      item.mode = raw.mode === "offline" ? "offline" : "online";
      item.travelMinutes = null;
      when = item.start;
      if (!when) problems.push("邮件里没有确定的开始时间");
    } else {
      item.deadline = normalizeTime(raw.deadline);
      item.windowStart = normalizeTime(raw.window_start);
      item.estimatedMinutes = minutesOr(raw.estimated_minutes, DEFAULT_ESTIMATE[type] || DEFAULT_DURATION);
      when = item.deadline;
      if (!when) problems.push("邮件里没有确定的截止时间");
    }

    if (when && (raw.time_certainty === "vague" || raw.time_certainty === "missing")) {
      problems.push("邮件里的时间说法含糊，请核对");
    }
    // 早于收信时间一天以上，多半是年份或月份推错了。
    if (when && Number.isFinite(received) && Date.parse(when) < received - 24 * 60 * 60 * 1000) {
      problems.push("时间早于收信时间，可能推算错了");
    }
    // 模型摘抄的原文在邮件里找不到，说明时间可能是编的。
    if (when && raw.evidence && !source.includes(squash(raw.evidence))) {
      problems.push("模型引用的原文在邮件里找不到");
    }
    if (when && !raw.evidence) problems.push("没有找到写明时间的原文");

    item.status = problems.length ? "needs_review" : raw.needs_confirmation ? "pending_confirmation" : "scheduled";
    item.reviewNote = problems.length ? problems.join("；") : null;
    item.evidence = textOr(raw.evidence, 300);
    item.reason = textOr(raw.reason, 300);
    return item;
  });

  return { isRecruiting: Boolean(output?.is_recruiting), items };
}

// 存进 items.json 之前再核一遍（页面可能改过候选内容）。和 validateExtraction 产出的形状一致。
export function normalizeExtractedItem(raw) {
  const kind = raw?.kind;
  if (kind !== "appointment" && kind !== "deadline") throw new Error("事项类型只能是固定日程或截止任务");
  const title = textOr(raw.title, 60);
  if (!title) throw new Error("请填写事项名称");
  const allowed = ["needs_review", "pending_confirmation", "scheduled"];
  const item = {
    kind,
    type: textOr(raw.type, 20) || "招聘",
    company: textOr(raw.company, 60),
    title,
    status: allowed.includes(raw.status) ? raw.status : "needs_review",
    link: /^https?:\/\/\S+$/.test(raw.link || "") ? String(raw.link).slice(0, 500) : null,
    location: textOr(raw.location, 200),
    reviewNote: textOr(raw.reviewNote, 300),
  };
  if (kind === "appointment") {
    item.start = normalizeTime(raw.start);
    item.durationMinutes = minutesOr(raw.durationMinutes, DEFAULT_DURATION);
    item.mode = raw.mode === "offline" ? "offline" : "online";
    item.travelMinutes = null;
    if (!item.start) item.status = "needs_review";
  } else {
    item.deadline = normalizeTime(raw.deadline);
    item.windowStart = normalizeTime(raw.windowStart);
    item.estimatedMinutes = minutesOr(raw.estimatedMinutes, DEFAULT_DURATION);
    if (!item.deadline) item.status = "needs_review";
  }
  if (item.status === "needs_review" && !item.reviewNote) item.reviewNote = "时间信息不完整，请补全。";
  return item;
}

export function normalizeEmail(raw) {
  const body = typeof raw?.body === "string" ? raw.body.trim() : "";
  if (!body) throw new Error("请粘贴邮件正文");
  if (body.length > MAX_EMAIL_CHARS) throw new Error(`邮件正文太长（超过 ${MAX_EMAIL_CHARS} 字）`);
  const receivedAt = normalizeTime(raw.receivedAt) || new Date().toISOString();
  return {
    subject: typeof raw.subject === "string" ? raw.subject.trim().slice(0, 300) : "",
    from: typeof raw.from === "string" ? raw.from.trim().slice(0, 200) : "",
    receivedAt,
    body,
  };
}

// ---------- 调用模型 ----------

export class ExtractUnavailable extends Error {}

// 密钥只从本机读：环境变量 ANTHROPIC_API_KEY，或 data/llm.json 里的 anthropicApiKey。不进 Git，也不发给页面。
export async function loadApiKey(dataDir) {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const config = JSON.parse(await readFile(path.join(dataDir, "llm.json"), "utf8"));
    return typeof config.anthropicApiKey === "string" && config.anthropicApiKey.trim()
      ? config.anthropicApiKey.trim()
      : null;
  } catch {
    return null;
  }
}

export function createClient(apiKey) {
  return new Anthropic({ apiKey, maxRetries: 2, timeout: 120 * 1000 });
}

export async function extractFromEmail(email, client) {
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // 模型因安全分类拒绝时，由服务端按类别换一个模型重试。
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: EXTRACTION_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(email) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new ExtractUnavailable("API 密钥无效，请检查配置。");
    if (error instanceof Anthropic.RateLimitError) throw new ExtractUnavailable("调用太频繁，请稍后再试。");
    if (error instanceof Anthropic.APIConnectionError) throw new ExtractUnavailable("连不上 Anthropic API，请检查网络。");
    if (error instanceof Anthropic.APIError) throw new ExtractUnavailable(`模型调用失败（${error.status}）：${error.message}`);
    throw error;
  }

  if (response.stop_reason === "refusal") throw new ExtractUnavailable("模型拒绝处理这封邮件。");
  if (response.stop_reason === "max_tokens") throw new ExtractUnavailable("模型输出被截断，请缩短邮件后重试。");
  const text = response.content.find((block) => block.type === "text")?.text;
  let output;
  try {
    output = JSON.parse(text);
  } catch {
    throw new ExtractUnavailable("模型返回的内容不是合法的 JSON。");
  }
  return {
    ...validateExtraction(output, email),
    model: response.model,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
