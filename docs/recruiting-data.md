# 招聘事项数据格式（data/items.json）

工作台和 Claude 定时任务共用这个文件。词汇含义见 [GLOSSARY.md](../GLOSSARY.md)。

- 位置：项目目录下的 `data/items.json`（已加入 `.gitignore`，不会提交到 GitHub）。
- 编码：UTF-8，无 BOM。所有时间都写成带时区的 ISO 8601 字符串，统一用北京时间，例如 `2026-11-05T14:00:00+08:00`。
- 写入方：
  - **定时任务**：新增事项，更新从邮件里提取的字段。
  - **工作台**：只改用户操作相关的字段（见下文“谁改哪些字段”），由本地服务器 `PATCH /api/items/:id` 写入。

## 顶层结构

```json
{
  "version": 1,
  "updatedAt": "2026-11-01T08:31:05+08:00",
  "lastSyncedAt": "2026-11-01T08:31:05+08:00",
  "processedMessageIds": ["18f3a..."],
  "items": []
}
```

| 字段 | 含义 |
| --- | --- |
| `lastSyncedAt` | 定时任务最近一次跑完的时间，工作台显示为“上次从邮件同步”。 |
| `processedMessageIds` | 已处理过的 Gmail 邮件 id，避免重复处理。只保留最近 500 条。 |
| `items` | 招聘事项列表。 |

## 事项（item）

```json
{
  "id": "rc-20261101-a1b2",
  "kind": "appointment",
  "type": "一面",
  "status": "scheduled",
  "company": "某某科技",
  "title": "数据分析岗一面",
  "start": "2026-11-05T14:00:00+08:00",
  "durationMinutes": 60,
  "mode": "online",
  "travelMinutes": null,
  "windowStart": null,
  "deadline": null,
  "estimatedMinutes": null,
  "link": "https://meeting.tencent.com/...",
  "location": null,
  "reviewNote": null,
  "changeNote": null,
  "changedAt": null,
  "sourceEmails": [
    {
      "messageId": "18f3a...",
      "subject": "【某某科技】面试邀请",
      "receivedAt": "2026-11-01T07:12:00+08:00",
      "url": "https://mail.google.com/mail/u/0/#all/18f3a..."
    }
  ],
  "createdAt": "2026-11-01T08:31:05+08:00",
  "updatedAt": "2026-11-01T08:31:05+08:00",
  "manualSlot": null,
  "completedAt": null,
  "userNote": null,
  "userUpdatedAt": null
}
```

| 字段 | 说明 |
| --- | --- |
| `id` | 唯一 id，定时任务生成，之后不再改变。 |
| `kind` | `appointment`（固定日程：时间由对方定）或 `deadline`（截止任务：给一个时间窗口，由用户自己选时间做）。 |
| `type` | 给人看的类别，如 `一面`、`二面`、`HR 面`、`笔试`、`在线测评`、`AI 面试`、`宣讲会`。 |
| `status` | 见下文“状态”。 |
| `company`、`title` | 公司名；岗位或轮次。 |
| `start`、`durationMinutes` | 只用于固定日程：开始时间和时长。邮件没写时长时，默认 60 分钟。 |
| `mode`、`travelMinutes` | `online` 或 `offline`。线下事项的往返交通时间，留空则默认 60 分钟。 |
| `windowStart`、`deadline`、`estimatedMinutes` | 只用于截止任务：最早可以开始的时间、截止时间、预计用时（没写时测评默认 60 分钟，AI 面试默认 45 分钟）。 |
| `link`、`location` | 会议或测评链接；线下地址。 |
| `reviewNote` | 状态为待核对时，写明缺少什么信息。 |
| `changeNote`、`changedAt` | 状态为已变更时，写明改了什么、什么时候改的。 |
| `sourceEmails` | 产生或更新这条事项的邮件，按时间顺序排列。 |
| `manualSlot` | `{ "start": "..." }`，用户手动指定的截止任务时段；为 `null` 时自动安排。 |
| `completedAt`、`userNote`、`userUpdatedAt` | 由工作台写入。 |

## 状态

| status | 中文 | 什么时候用 |
| --- | --- | --- |
| `needs_review` | 待核对 | 关键时间缺失或含糊，比如只写了“下周”，或者“72 小时内”但无法确定起算时间。此时不排进日程。 |
| `pending_confirmation` | 待确认 | 固定日程的邀约，需要回复确认。时间会先占住。 |
| `scheduled` | 已排定 | 时间已经确定。 |
| `changed` | 已变更 | 后续邮件改了时间、形式或链接。用户点“知道了”后，状态回到 `scheduled`。 |
| `done` | 已完成 | 终态。 |
| `cancelled` | 已取消 | 终态。对方取消，或者用户判断这不是招聘事项。 |

## 定时任务的合并规则

1. **同一事项**：公司相同、轮次或类型相同、而且没有到终态的事项，视为同一条，更新它，不新建。
2. **改期或改形式**：更新 `start`、`deadline`、`link` 等字段，状态设为 `changed`，同时写上 `changeNote` 和 `changedAt`，并把这封邮件追加到 `sourceEmails`。
3. **取消邮件**：状态设为 `cancelled`。
4. **不覆盖用户的操作**：
   - 用户已经设为 `done` 或 `cancelled` 的事项，只有新邮件明确改了时间时，才重新打开（设为 `changed`）。
   - `manualSlot`、`completedAt`、`userNote` 一律不改。
5. **不是招聘事项的邮件不建条目**：职位推送、订阅、营销、投递成功回执等，只把邮件 id 记进 `processedMessageIds`。
6. **相对时间**：像“收到邮件后 72 小时内”这样的说法，按邮件的接收时间推算截止时间。实在推不出来，才设为 `needs_review`。

## 谁改哪些字段

| 字段 | 定时任务 | 工作台 |
| --- | --- | --- |
| `kind`、`type`、`company`、`title`、`start`、`durationMinutes`、`mode`、`windowStart`、`deadline`、`estimatedMinutes`、`link`、`location` | ✅ | ✅（补全待核对事项时） |
| `status` | ✅ | ✅ |
| `reviewNote`、`changeNote`、`changedAt`、`sourceEmails`、`createdAt` | ✅ | — |
| `manualSlot`、`completedAt`、`userNote` | — | ✅ |
