// 投入方向（Focus Area）：用户自定义的长期方向，以及把它们排成当天时段的纯函数。
// 词汇见 GLOSSARY.md。浏览器和本地服务器共用这个模块，所以这里不碰 DOM 和存储。

export const DEFAULT_FOCUS_AREAS = [
  {
    id: "vocabulary",
    name: "雅思单词复习",
    shortName: "单词",
    icon: "Aa",
    color: "#6b91a8",
    minimum: 20,
    weight: 10,
    days: [],
    segments: 1,
    keepWhenCrowded: true,
    archived: false,
    description: "复习旧词优先于盲目加新词；最后 5 分钟集中处理错词。",
    placeholder: "今日小目标：例如复习 120 个旧词 + 20 个错词",
  },
  {
    id: "research",
    name: "科研深度工作",
    shortName: "科研",
    icon: "研",
    color: "#1f5c48",
    minimum: 60,
    weight: 34,
    days: [],
    segments: 2,
    keepWhenCrowded: true,
    archived: false,
    description: "只定义一个可交付结果，避免把“做科研”当成无限任务。",
    placeholder: "今日小目标：例如完成图 3 初稿 / 修改方法部分两段",
  },
  {
    id: "listening",
    name: "雅思听力练习",
    shortName: "听力",
    icon: "听",
    color: "#e68a53",
    minimum: 25,
    weight: 14,
    days: [],
    segments: 1,
    keepWhenCrowded: false,
    archived: false,
    description: "做题、核对、精听各占一部分；记录漏听原因，不只记录分数。",
    placeholder: "今日小目标：例如完成 Section 3 并精听错题句",
  },
  {
    id: "reading",
    name: "雅思阅读练习",
    shortName: "阅读",
    icon: "读",
    color: "#927ca5",
    minimum: 35,
    weight: 18,
    days: [],
    segments: 1,
    keepWhenCrowded: false,
    archived: false,
    description: "限时完成后复盘定位依据；卡住超过 3 分钟先标记再继续。",
    placeholder: "今日小目标：例如限时完成一篇 + 整理 5 个同义替换",
  },
  {
    id: "speaking",
    name: "雅思口语练习",
    shortName: "口语",
    icon: "说",
    color: "#c57365",
    minimum: 20,
    weight: 10,
    days: [],
    segments: 1,
    keepWhenCrowded: false,
    archived: false,
    description: "必须开口并录音；追求表达完整，不在脑内反复准备。",
    placeholder: "今日小目标：例如录制 2 个 Part 2 话题并复述一次",
  },
  {
    id: "writing",
    name: "雅思写作练习",
    shortName: "写作",
    icon: "写",
    color: "#b08b42",
    minimum: 30,
    weight: 14,
    days: [],
    segments: 1,
    keepWhenCrowded: false,
    archived: false,
    description: "完整作文与局部训练交替；时间少时也至少写提纲和一个主体段。",
    placeholder: "今日小目标：例如完成 Task 2 提纲 + 一个主体段",
  },
];

// V3 及以前，每日记录里的时段 id 就是写死的任务 id；科研固定拆成两段。
const LEGACY_ENTRY_AREAS = { research1: "research", research2: "research" };

const LIMITS = {
  maxAreas: 20,
  minMinimum: 5,
  maxMinimum: 240,
  maxWeight: 1000,
  maxSegments: 4,
};

export const DEFAULT_PLACEHOLDER = "今日小目标：写一个今天能完成的具体结果";

// 一条时段属于哪个投入方向；兼容旧记录。
export function areaIdOf(entry) {
  if (entry.areaId) return entry.areaId;
  return LEGACY_ENTRY_AREAS[entry.id] || entry.id;
}

export function entryId(areaId, segment, segments) {
  return segments > 1 ? `${areaId}#${segment}` : areaId;
}

function weekdayOf(dateKey) {
  // dateKey 是北京时间的日期，按 UTC 解析只用来取星期几，结果不受时区影响。
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

// 今天要排的方向：未归档，且今天在它的生效日里（不设生效日 = 每天）。
export function areasActiveOn(areas, dateKey) {
  const weekday = weekdayOf(dateKey);
  return areas.filter(
    (area) => !area.archived && (!area.days?.length || area.days.includes(weekday)),
  );
}

// 把方向展开成当天的时段顺序：每个方向的第一段按列表顺序排，
// 多出来的段均匀插到后面，避免同一方向连着出现。
export function planEntries(areas) {
  const n = areas.length;
  const keyed = [];
  areas.forEach((area, index) => {
    const segments = area.segments || 1;
    for (let segment = 1; segment <= segments; segment += 1) {
      // 第 j 段往后挪 (j-1)/segments 个列表长度，落在那个位置的方向之前。
      const key = segment === 1 ? index : index + ((segment - 1) * n) / segments - 0.5;
      keyed.push({ key, entry: { id: entryId(area.id, segment, segments), areaId: area.id, segment } });
    }
  });
  return keyed.sort((a, b) => a.key - b.key).map(({ entry }) => entry);
}

function roundToFive(value) {
  return Math.max(5, Math.round(value / 5) * 5);
}

export function minimumTotal(areas) {
  return areas.reduce((sum, area) => sum + area.minimum, 0);
}

// 先给每个方向最低保障，剩余时间按权重分；再把方向的时间平分到它的各段。
// 结果按时段 id 返回，总和严格等于 totalMinutes。
export function allocateDurations(totalMinutes, areas) {
  if (!areas.length) return {};
  const minTotal = minimumTotal(areas);
  const weightTotal = areas.reduce((sum, area) => sum + (area.weight || 0), 0);
  // 权重全为 0 时平分。
  const share = (area) => (weightTotal ? (area.weight || 0) / weightTotal : 1 / areas.length);
  const byArea = {};

  areas.forEach((area) => {
    byArea[area.id] =
      totalMinutes < minTotal
        ? roundToFive((area.minimum * totalMinutes) / minTotal)
        : roundToFive(area.minimum + (totalMinutes - minTotal) * share(area));
  });

  // 取整误差放进权重最大的方向，那里多几分钟少几分钟影响最小。
  const sink = [...areas].sort((a, b) => b.weight - a.weight)[0].id;
  const allocated = Object.values(byArea).reduce((sum, value) => sum + value, 0);
  byArea[sink] += totalMinutes - allocated;
  // 时间极少时取整会把它扣得太短：每段至少留 5 分钟，差额从最长的其他方向扣。
  const sinkArea = areas.find((area) => area.id === sink);
  const floor = 5 * (sinkArea.segments || 1);
  if (byArea[sink] < floor && areas.length > 1) {
    const donor = areas
      .filter((area) => area.id !== sink)
      .sort((a, b) => byArea[b.id] - byArea[a.id])[0].id;
    byArea[donor] -= floor - byArea[sink];
    byArea[sink] = floor;
  }

  const result = {};
  areas.forEach((area) => {
    const segments = area.segments || 1;
    const total = byArea[area.id];
    const each = segments > 1 ? Math.max(5, Math.floor(total / segments / 5) * 5) : total;
    for (let segment = 1; segment <= segments; segment += 1) {
      result[entryId(area.id, segment, segments)] =
        segment === segments ? total - each * (segments - 1) : each;
    }
  });
  return result;
}

// 长休息放在当天时段的中间（默认方向下正好在阅读之后，和以前一致）。
export function longBreakIndex(entryCount) {
  return entryCount >= 3 ? Math.floor((entryCount - 1) / 2) : -1;
}

export function breakOverhead(entryCount, breakMinutes, longBreakMinutes) {
  if (entryCount <= 1) return 0;
  const longBreak = longBreakIndex(entryCount) >= 0 ? longBreakMinutes - breakMinutes : 0;
  return (entryCount - 1) * breakMinutes + longBreak;
}

function entryCountOf(areas) {
  return areas.reduce((sum, area) => sum + (area.segments || 1), 0);
}

// 选出今天要排的方向：空档够就全排；不够最低保障时，只保留“空档不够时保留”的方向，
// 再不够就从这些方向的末尾逐个去掉。没被选上的算挤占。
export function chooseAreas(areas, { totalMinutes, freeMinutes, breakMinutes, longBreakMinutes }) {
  const budget = (chosen) =>
    Math.min(
      totalMinutes,
      freeMinutes - breakOverhead(entryCountOf(chosen), breakMinutes, longBreakMinutes),
    );

  if (!areas.length) return { areas: [], total: 0 };
  if (budget(areas) >= minimumTotal(areas)) {
    return { areas, total: budget(areas) };
  }
  const protectedAreas = areas.filter((area) => area.keepWhenCrowded);
  const pool = protectedAreas.length ? protectedAreas : areas;
  for (let count = pool.length; count >= 1; count -= 1) {
    const chosen = pool.slice(0, count);
    if (budget(chosen) >= minimumTotal(chosen) || count === 1) {
      return { areas: chosen, total: Math.max(0, budget(chosen)) };
    }
  }
  return { areas: [], total: 0 };
}

// ---------- 校验（服务器写入前用） ----------

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// 返回规整后的方向列表；不合法时抛出带中文说明的错误。
export function normalizeFocusAreas(input, previous = []) {
  if (!Array.isArray(input)) throw new Error("投入方向必须是列表");
  if (input.length > LIMITS.maxAreas) throw new Error(`投入方向最多 ${LIMITS.maxAreas} 个`);

  const seen = new Set();
  const areas = input.map((raw) => {
    const id = String(raw?.id || "");
    if (!ID_PATTERN.test(id)) throw new Error(`方向 id 不合法：${id}`);
    if (seen.has(id)) throw new Error(`方向 id 重复：${id}`);
    seen.add(id);

    const name = text(raw.name, 30);
    if (!name) throw new Error("方向名称不能为空");
    const minimum = Math.round(Number(raw.minimum));
    if (!(minimum >= LIMITS.minMinimum && minimum <= LIMITS.maxMinimum)) {
      throw new Error(`「${name}」的最低保障时间要在 ${LIMITS.minMinimum}-${LIMITS.maxMinimum} 分钟之间`);
    }
    const weight = Number(raw.weight);
    if (!(weight >= 0 && weight <= LIMITS.maxWeight)) {
      throw new Error(`「${name}」的权重要在 0-${LIMITS.maxWeight} 之间`);
    }
    const segments = Math.round(Number(raw.segments) || 1);
    if (!(segments >= 1 && segments <= LIMITS.maxSegments)) {
      throw new Error(`「${name}」每天最多拆成 ${LIMITS.maxSegments} 段`);
    }
    const days = Array.isArray(raw.days)
      ? [...new Set(raw.days.map(Number))].filter((day) => day >= 0 && day <= 6).sort()
      : [];
    const shortName = text(raw.shortName, 10) || name.slice(0, 10);

    return {
      id,
      name,
      shortName,
      icon: text(raw.icon, 2) || shortName.slice(0, 1),
      color: COLOR_PATTERN.test(raw.color || "") ? raw.color : "#1f5c48",
      minimum,
      weight,
      days: days.length === 7 ? [] : days,
      segments,
      keepWhenCrowded: Boolean(raw.keepWhenCrowded),
      archived: Boolean(raw.archived),
      description: text(raw.description, 200),
      placeholder: text(raw.placeholder, 100) || DEFAULT_PLACEHOLDER,
    };
  });

  if (!areas.some((area) => !area.archived)) throw new Error("至少保留一个投入方向");
  // 删除只是归档：历史记录还要用到旧方向的名称。
  const missing = previous.filter((area) => !seen.has(area.id));
  if (missing.length) {
    throw new Error(`不能直接移除方向（${missing.map((area) => area.name).join("、")}），请改为归档`);
  }
  return areas;
}
