// 招聘事项的排程与提醒逻辑。纯函数，不碰 DOM 和存储，方便测试。
// 词汇见 GLOSSARY.md：固定日程（appointment）、截止任务（deadline）、占用时段、空档、挤占。
// 所有时间都按北京时间（UTC+8，无夏令时）处理；绝对时间用毫秒时间戳。

const Recruiting = (() => {
  const OFFSET_MS = 8 * 60 * 60 * 1000;
  const MINUTE = 60 * 1000;
  const DAY_MINUTES = 24 * 60;

  const DEFAULTS = {
    startTime: "09:00",
    dayEnd: "21:30",
    prepMinutes: 30,
    bufferMinutes: 15,
    defaultTravelMinutes: 60,
    slotGapMinutes: 15,
    mealWindows: [
      ["11:30", "13:30"],
      ["17:30", "19:00"],
    ],
    dayBeforeReminderTime: "20:00",
    leadReminderMinutes: 60,
    deadlineWarningHours: 24,
  };

  // 占用时间的状态：待确认也先占着，避免确认后才发现撞车。
  const BLOCKING_STATUSES = ["scheduled", "changed", "pending_confirmation"];
  const OPEN_STATUSES = ["needs_review", ...BLOCKING_STATUSES];

  const STATUS_LABELS = {
    needs_review: "待核对",
    pending_confirmation: "待确认",
    scheduled: "已排定",
    changed: "已变更",
    done: "已完成",
    cancelled: "已取消",
  };

  function withDefaults(settings = {}) {
    return { ...DEFAULTS, ...settings };
  }

  function hhmmToMinutes(time) {
    const [hours, minutes] = String(time).split(":").map(Number);
    return hours * 60 + (minutes || 0);
  }

  function parseTime(value) {
    if (value === null || value === undefined || value === "") return null;
    const ms = typeof value === "number" ? value : Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  function dateKeyOf(ms) {
    return new Date(ms + OFFSET_MS).toISOString().slice(0, 10);
  }

  function minutesOfDay(ms) {
    const shifted = new Date(ms + OFFSET_MS);
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  }

  function atDayMinutes(dateKey, minutes) {
    return Date.parse(`${dateKey}T00:00:00+08:00`) + minutes * MINUTE;
  }

  function addDays(dateKey, days) {
    return dateKeyOf(atDayMinutes(dateKey, 12 * 60) + days * DAY_MINUTES * MINUTE);
  }

  function toIso(ms) {
    const key = dateKeyOf(ms);
    const minutes = minutesOfDay(ms);
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    return `${key}T${hh}:${mm}:00+08:00`;
  }

  function ceilToQuarter(ms) {
    const step = 15 * MINUTE;
    return Math.ceil(ms / step) * step;
  }

  // ---------- 区间工具 ----------

  function mergeIntervals(intervals) {
    const sorted = intervals
      .filter((item) => item.end > item.start)
      .sort((a, b) => a.start - b.start);
    const merged = [];
    for (const item of sorted) {
      const last = merged[merged.length - 1];
      if (last && item.start <= last.end) {
        last.end = Math.max(last.end, item.end);
      } else {
        merged.push({ start: item.start, end: item.end });
      }
    }
    return merged;
  }

  function subtractIntervals(base, cuts) {
    let pieces = [{ ...base }];
    for (const cut of mergeIntervals(cuts)) {
      pieces = pieces.flatMap((piece) => {
        if (cut.end <= piece.start || cut.start >= piece.end) return [piece];
        const parts = [];
        if (cut.start > piece.start) parts.push({ start: piece.start, end: cut.start });
        if (cut.end < piece.end) parts.push({ start: cut.end, end: piece.end });
        return parts;
      });
    }
    return pieces;
  }

  // ---------- 事项 ----------

  function isOpen(item) {
    return OPEN_STATUSES.includes(item.status);
  }

  // 固定日程的占用时段：准备 + 事项本身 + 缓冲，线下另加往返交通。
  function blockedTime(item, settings) {
    const s = withDefaults(settings);
    const start = parseTime(item.start);
    if (start === null) return null;
    const duration = Number(item.durationMinutes) || 60;
    const travel =
      item.mode === "offline"
        ? Number(item.travelMinutes ?? s.defaultTravelMinutes) || 0
        : 0;
    // 手动建的日程可以自带准备和缓冲时间（例如组会不需要提前半小时准备）。
    const prep = Number(item.prepMinutes ?? s.prepMinutes) || 0;
    const buffer = Number(item.bufferMinutes ?? s.bufferMinutes) || 0;
    return {
      itemId: item.id,
      start: start - (prep + travel) * MINUTE,
      end: start + (duration + buffer + travel) * MINUTE,
      eventStart: start,
      eventEnd: start + duration * MINUTE,
    };
  }

  function appointmentBlocks(items, settings) {
    return items
      .filter((item) => item.kind === "appointment" && BLOCKING_STATUSES.includes(item.status))
      .map((item) => blockedTime(item, settings))
      .filter(Boolean);
  }

  function workWindow(dateKey, settings) {
    const s = withDefaults(settings);
    return {
      start: atDayMinutes(dateKey, hhmmToMinutes(s.startTime)),
      end: atDayMinutes(dateKey, hhmmToMinutes(s.dayEnd)),
    };
  }

  function mealIntervals(dateKey, settings) {
    const s = withDefaults(settings);
    return s.mealWindows.map(([from, to]) => ({
      start: atDayMinutes(dateKey, hhmmToMinutes(from)),
      end: atDayMinutes(dateKey, hhmmToMinutes(to)),
    }));
  }

  // 截止任务自动排位：截止早的先排；在窗口内找最早的整块空档，
  // 优先排在截止日之前，实在排不下才退到截止当天。手动指定的时段原样保留。
  function placeDeadlineTasks(items, settings, nowMs) {
    const s = withDefaults(settings);
    const gap = s.slotGapMinutes * MINUTE;
    const placements = {};
    const unplaceable = [];
    const taken = appointmentBlocks(items, s).map((block) => ({
      start: block.start - gap,
      end: block.end + gap,
    }));

    const deadlineItems = items
      .filter((item) => item.kind === "deadline" && BLOCKING_STATUSES.includes(item.status))
      .sort((a, b) => (parseTime(a.deadline) ?? Infinity) - (parseTime(b.deadline) ?? Infinity));

    for (const item of deadlineItems) {
      const minutes = Number(item.estimatedMinutes) || 60;
      const manualStart = parseTime(item.manualSlot?.start);
      if (manualStart !== null) {
        const slot = { start: manualStart, end: manualStart + minutes * MINUTE, manual: true };
        placements[item.id] = slot;
        taken.push({ start: slot.start - gap, end: slot.end + gap });
      }
    }

    for (const item of deadlineItems) {
      if (placements[item.id]) continue;
      const deadline = parseTime(item.deadline);
      if (deadline === null) {
        unplaceable.push(item.id);
        continue;
      }
      const minutes = Number(item.estimatedMinutes) || 60;
      const earliest = Math.max(
        ceilToQuarter(nowMs + 15 * MINUTE),
        parseTime(item.windowStart) ?? -Infinity,
      );
      const firstDay = dateKeyOf(earliest);
      const deadlineDay = dateKeyOf(deadline);

      const tryDays = (lastDay) => {
        for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
          const work = workWindow(day, s);
          const bounded = {
            start: Math.max(work.start, earliest),
            end: Math.min(work.end, deadline),
          };
          if (bounded.end <= bounded.start) continue;
          const free = subtractIntervals(bounded, [...taken, ...mealIntervals(day, s)]);
          const fit = free.find((piece) => piece.end - piece.start >= minutes * MINUTE);
          if (fit) return { start: fit.start, end: fit.start + minutes * MINUTE, manual: false };
        }
        return null;
      };

      const slot =
        (deadlineDay > firstDay ? tryDays(addDays(deadlineDay, -1)) : null) ||
        tryDays(deadlineDay);
      if (slot) {
        placements[item.id] = slot;
        taken.push({ start: slot.start - gap, end: slot.end + gap });
      } else {
        unplaceable.push(item.id);
      }
    }

    return { placements, unplaceable };
  }

  // 某一天里招聘事项占掉的区间（按当天分钟数表示，用于均衡任务填空）。
  function busyMinutesForDay(dateKey, items, placements, settings) {
    const dayStart = atDayMinutes(dateKey, 0);
    const dayEnd = atDayMinutes(dateKey, DAY_MINUTES);
    const absolute = [
      ...appointmentBlocks(items, settings),
      ...Object.values(placements),
    ];
    return mergeIntervals(
      absolute
        .filter((block) => block.end > dayStart && block.start < dayEnd)
        .map((block) => ({
          start: Math.max(0, Math.round((block.start - dayStart) / MINUTE)),
          end: Math.min(DAY_MINUTES, Math.round((block.end - dayStart) / MINUTE)),
        })),
    );
  }

  // 把均衡任务按顺序放进空档。放不下的记为“挤占”，不算回避。
  function layoutBalanceTasks({
    order,
    durations,
    busy,
    dayStart,
    dayEnd,
    breakMinutes,
    longBreakAfter,
    longBreakMinutes,
  }) {
    const plan = [];
    const crowdedOut = [];
    let cursor = dayStart;

    order.forEach((id) => {
      const duration = durations[id];
      if (!duration) return;
      let start = cursor;
      for (const block of busy) {
        if (start < block.end && start + duration > block.start) {
          start = block.end;
        }
      }
      const end = start + duration;
      if (end > dayEnd) {
        crowdedOut.push(id);
        return;
      }
      plan.push({ id, start, end, duration });
      cursor = end + (id === longBreakAfter ? longBreakMinutes : breakMinutes);
    });

    return { plan, crowdedOut };
  }

  function freeMinutes(dateKey, busy, settings) {
    const s = withDefaults(settings);
    const window = {
      start: hhmmToMinutes(s.startTime),
      end: hhmmToMinutes(s.dayEnd),
    };
    return subtractIntervals(window, busy).reduce(
      (sum, piece) => sum + (piece.end - piece.start),
      0,
    );
  }

  // ---------- 提醒 ----------

  function describe(item) {
    return [item.company, item.title].filter(Boolean).join(" · ") || "招聘事项";
  }

  function formatClock(ms) {
    const minutes = minutesOfDay(ms);
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }

  function formatDayLabel(ms) {
    const key = dateKeyOf(ms);
    const [, month, day] = key.split("-").map(Number);
    return `${month}月${day}日 ${formatClock(ms)}`;
  }

  // 生成全部提醒；每条有唯一 key，页面记住哪些已经弹过。
  function computeReminders(items, placements, unplaceable, settings) {
    const s = withDefaults(settings);
    const reminders = [];
    const push = (reminder) => reminders.push({ expires: Infinity, ...reminder });

    for (const item of items) {
      const name = describe(item);

      if (item.status === "needs_review") {
        push({
          key: `${item.id}:review:${item.updatedAt || ""}`,
          itemId: item.id,
          at: 0,
          title: "有招聘事项待核对",
          body: `${name}：${item.reviewNote || "邮件信息不完整，请在工作台补全。"}`,
        });
        continue;
      }

      if (item.status === "changed") {
        push({
          key: `${item.id}:changed:${item.changedAt || item.updatedAt || ""}`,
          itemId: item.id,
          at: 0,
          title: "招聘事项有变更",
          body: `${name}：${item.changeNote || "时间或形式有调整，请查看。"}`,
        });
      }

      if (item.kind === "appointment" && BLOCKING_STATUSES.includes(item.status)) {
        const start = parseTime(item.start);
        if (start === null) continue;

        if (item.status === "pending_confirmation") {
          push({
            key: `${item.id}:confirm`,
            itemId: item.id,
            at: 0,
            expires: start,
            title: "邀约待回复确认",
            body: `${name}（${formatDayLabel(start)}）还没确认，记得回复 HR。`,
          });
        }

        const dayBefore = atDayMinutes(
          addDays(dateKeyOf(start), -1),
          hhmmToMinutes(s.dayBeforeReminderTime),
        );
        push({
          key: `${item.id}:day-before:${start}`,
          itemId: item.id,
          at: dayBefore,
          expires: start,
          title: "明天有安排",
          body: `${name}：明天 ${formatClock(start)}。提前准备材料，确认链接或地址。`,
        });
        push({
          key: `${item.id}:lead:${start}`,
          itemId: item.id,
          at: start - s.leadReminderMinutes * MINUTE,
          expires: start,
          title: `${s.leadReminderMinutes} 分钟后开始`,
          body: `${name}：${formatClock(start)} 开始。检查链接、设备和环境。`,
        });
      }

      if (item.kind === "deadline" && BLOCKING_STATUSES.includes(item.status)) {
        const slot = placements[item.id];
        const deadline = parseTime(item.deadline);
        if (slot) {
          push({
            key: `${item.id}:slot:${slot.start}`,
            itemId: item.id,
            at: slot.start,
            expires: slot.end,
            title: "现在开始这项",
            body: `${name}：按计划 ${formatClock(slot.start)}-${formatClock(slot.end)} 完成。`,
          });
        }
        if (deadline !== null) {
          push({
            key: `${item.id}:deadline-warning:${deadline}`,
            itemId: item.id,
            at: deadline - s.deadlineWarningHours * 60 * MINUTE,
            expires: deadline,
            title: "距截止不到 24 小时",
            body: `${name} 还没标记完成，截止时间 ${formatDayLabel(deadline)}。`,
          });
        }
        if (unplaceable.includes(item.id)) {
          push({
            key: `${item.id}:unplaceable:${item.deadline || ""}`,
            itemId: item.id,
            at: 0,
            expires: deadline ?? Infinity,
            title: "有截止任务排不进日程",
            body: `${name}：窗口内找不到足够长的空档，请手动指定时间。`,
          });
        }
      }
    }

    return reminders;
  }

  function dueReminders(reminders, nowMs, firedKeys) {
    return reminders.filter(
      (reminder) =>
        reminder.at <= nowMs && nowMs < reminder.expires && !firedKeys.has(reminder.key),
    );
  }

  return {
    DEFAULTS,
    STATUS_LABELS,
    BLOCKING_STATUSES,
    OPEN_STATUSES,
    MINUTE,
    parseTime,
    dateKeyOf,
    minutesOfDay,
    atDayMinutes,
    addDays,
    toIso,
    hhmmToMinutes,
    isOpen,
    blockedTime,
    appointmentBlocks,
    placeDeadlineTasks,
    busyMinutesForDay,
    layoutBalanceTasks,
    freeMinutes,
    computeReminders,
    dueReminders,
    describe,
    formatClock,
    formatDayLabel,
    subtractIntervals,
    mergeIntervals,
  };
})();

if (typeof module !== "undefined") {
  module.exports = Recruiting;
}
