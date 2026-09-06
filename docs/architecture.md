# 工程架构说明

## 当前结构

```text
daily-balance-planner/
├── index.html
├── styles.css
├── app.js
├── smoke-test.mjs
├── package.json
└── docs/
```

项目保持零依赖、静态部署和本地优先，方便通过 GitHub Pages 或直接打开文件演示。

## 主要模块

虽然当前仍是单页静态项目，但 `app.js` 已按职责划分函数：

- 任务模型：`TASK_TYPES`、`ORDER`、`CATEGORY_DEFINITIONS`
- 时间分配：`allocateDurations`、`buildPlan`
- 本地存储：`loadState`、`saveState`、`loadStateForDate`
- 历史统计：`summarizeDay`、`buildAnalytics`、`buildInsights`
- 页面渲染：`render`、`renderAnalytics`、`updateProgress`
- 计时提醒：`startTimer`、`tickTimer`、`notify`

## 数据模型

每日记录按日期存入 localStorage：

```text
daily-balance:YYYY-MM-DD
```

主要字段：

- `plan`：当天生成的计划。
- `tasks`：每项任务的完成状态、小目标、计时记录。
- `reflection`：每日复盘。

设置单独存储：

```text
daily-balance:settings
```

## 统计逻辑

近 7 天分析基于每日记录生成：

- 完成率 = 已完成任务数 / 计划任务数
- 薄弱模块 = 跳过次数最多且完成率最低的类别
- 连续均衡日 = 从今天向前连续满足所有类别至少完成一次的天数
- 完成专注时长 = 已完成任务对应的计划时长之和

## 为什么暂不引入框架

当前项目目标是作品集中的轻量工具，原生 HTML/CSS/JavaScript 更利于展示：

- local-first 思路
- 无构建依赖
- 可直接演示
- 规则逻辑清晰可读

后续如果扩展为多页面项目，可以迁移到 Vite + React 或 Vue。
