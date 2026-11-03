// 邮件解析评估：用 evals/extract/cases.json 里标注好的邮件调用真实模型，按字段统计准确率。
// 会产生 API 费用（每封邮件一次调用）。用法：npm run eval:extract [-- 用例 id ...]

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, extractFromEmail, loadApiKey } from "./extract.mjs";
import { dataDir } from "./serve.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIELDS = ["kind", "start", "deadline", "durationMinutes", "estimatedMinutes", "mode", "status"];

const sameTime = (a, b) => Date.parse(a) === Date.parse(b);
const timeOf = (item) => Date.parse(item.start || item.deadline) || Infinity;
const byTime = (a, b) => a.kind.localeCompare(b.kind) || timeOf(a) - timeOf(b);

function compare(expected, actual) {
  const fields = {};
  const exp = [...expected.items].sort(byTime);
  const act = [...actual.items].sort(byTime);
  exp.forEach((want, index) => {
    const got = act[index];
    for (const field of FIELDS) {
      if (!(field in want)) continue;
      const ok =
        Boolean(got) &&
        (field === "start" || field === "deadline" ? sameTime(want[field], got[field]) : want[field] === got[field]);
      fields[field] = [...(fields[field] || []), ok];
    }
  });
  return {
    recruiting: expected.isRecruiting === actual.isRecruiting,
    count: exp.length === act.length,
    fields,
  };
}

const apiKey = await loadApiKey(dataDir);
if (!apiKey) {
  console.error("没有找到 Anthropic API 密钥：设置环境变量 ANTHROPIC_API_KEY，或写在 data/llm.json 的 anthropicApiKey 里。");
  process.exit(1);
}
const client = createClient(apiKey);
const { cases } = JSON.parse(await readFile(path.join(root, "evals/extract/cases.json"), "utf8"));
const only = process.argv.slice(2);
const selected = only.length ? cases.filter((entry) => only.includes(entry.id)) : cases;

const totals = { recruiting: [], count: [], fields: {} };
let tokens = { input: 0, output: 0 };
for (const entry of selected) {
  try {
    const actual = await extractFromEmail(entry.email, client);
    tokens = { input: tokens.input + actual.usage.inputTokens, output: tokens.output + actual.usage.outputTokens };
    const result = compare(entry.expected, actual);
    totals.recruiting.push(result.recruiting);
    totals.count.push(result.count);
    for (const [field, oks] of Object.entries(result.fields)) totals.fields[field] = [...(totals.fields[field] || []), ...oks];
    const wrong = Object.entries(result.fields)
      .filter(([, oks]) => oks.includes(false))
      .map(([field]) => field);
    const pass = result.recruiting && result.count && !wrong.length;
    console.log(`${pass ? "✔" : "✘"} ${entry.id}${pass ? "" : `  不一致：${[!result.recruiting && "是否招聘", !result.count && "事项数", ...wrong].filter(Boolean).join("、")}`}`);
    if (!pass) console.log(`    模型输出：${JSON.stringify(actual.items.map(({ evidence, reason, ...rest }) => rest))}`);
  } catch (error) {
    totals.recruiting.push(false);
    totals.count.push(false);
    console.log(`✘ ${entry.id}  调用失败：${error.message}`);
  }
}

const rate = (oks) => (oks.length ? `${((oks.filter(Boolean).length / oks.length) * 100).toFixed(1)}%（${oks.filter(Boolean).length}/${oks.length}）` : "—");
console.log(`\n共 ${selected.length} 封邮件`);
console.log(`是否招聘邮件：${rate(totals.recruiting)}`);
console.log(`事项数量：${rate(totals.count)}`);
for (const field of FIELDS) if (totals.fields[field]) console.log(`${field}：${rate(totals.fields[field])}`);
const timeOks = [...(totals.fields.start || []), ...(totals.fields.deadline || [])];
console.log(`关键时间（start + deadline）：${rate(timeOks)}`);
console.log(`用量：输入 ${tokens.input} tokens，输出 ${tokens.output} tokens`);
