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

项目保持零依赖、本地优先。正式使用要通过本地服务器；GitHub Pages 上只能看 `?demo=1` 演示。

## V3 新增

- `recruiting.js`：招聘事项的纯函数模块，负责占用时段、截止任务排位、均衡任务填空与挤占、提醒计算。测试在 `tests/recruiting.test.mjs`。
- `scripts/serve.mjs`：静态服务之外，新增 `GET /api/items` 和 `PATCH /api/items/:id`。数据写在本机的 `data/items.json`，写入原子化、串行化，可改字段有白名单。
- `scripts/windows/`：开机自启脚本。
- 数据格式和合并规则见 `docs/recruiting-data.md`，架构决策见 `docs/adr/0001-*`。

## V4 第 1 段：投入方向可配置，数据迁到 data/

原来的 `app.js` 拆成 `src/` 下的原生 ES module，不引入框架和构建步骤：

| 文件 | 职责 |
| --- | --- |
| `src/focus-areas.js` | 投入方向的默认值、展开成当天时段、时间分配、挤占选择、校验。纯函数，浏览器和服务器共用。 |
| `src/analytics.js` | 近 7 天统计和系统提醒。纯函数。 |
| `src/format.js` | 日期、时长、HTML 转义。 |
| `src/store.js` | 调用本地服务器的 `/api`；每日记录合并后再写；首次连接时迁移浏览器旧数据。 |
| `src/recruit.js` | 招聘事项的展示、操作和提醒（计算在 `recruiting.js`）。 |
| `src/focus-settings-view.js` | 投入方向编辑界面。 |
| `src/main.js` | 入口：“今天”时间表、计时、设置。 |
| `src/demo.js`、`src/ui.js` | 演示数据；页面提示、通知和提示音。 |

`recruiting.js` 仍是普通脚本（测试用 `vm` 加载），先于模块加载，模块直接引用全局的 `Recruiting`。

## V4 第 2 段：桌面外壳

- `electron/main.mjs`：Electron 主进程。在本进程里直接启动 `scripts/serve.mjs` 的接口（固定端口 37800，被占用时随机），窗口加载它；关窗口缩到托盘；单实例；开机自启用 `app.setLoginItemSettings`。`--install` 生成 `build/icon.ico`、用 `shell.writeShortcutLink` 创建带 AppUserModelID 的快捷方式（Windows 通知需要），并删除旧版自启脚本。
- `electron/preload.cjs`：给页面开放 `window.desktop`（开机自启、打开数据文件夹、唤出窗口）。页面在浏览器里打开时没有它，相关设置项自动隐藏。
- 页面改成左侧导航 + 多视图（`#today`、`#focus`、`#recruit`、`#review`、`#settings` 等，用 hash 切换）。
- `src/timeline.js`：今天页的时间轴，高度大致按时长比例，空档和“现在”线都画出来；时段默认收起，点开显示详情。
- `npm run serve` 仍可只起 Node 服务器，在浏览器里看页面（演示、调试用）。

## V4 第 3、4 段：待办、手动事项、日历

- `src/todos.js`（纯函数，前后端共用）：待办的分组、“今天做”、校验。`src/todos-view.js`：待办页和今天页的待办卡片。数据在 `data/todos.json`，`GET/PUT /api/todos` 整体读写。
- 手动新建的固定日程、截止任务走 `POST /api/items`，和邮件来的事项存在同一个 `items.json`，用 `source: "manual"` 区分，复用同一套排程和提醒。弹窗在 `src/item-dialog.js`；待办“排进日程”就是带上标题和截止时间打开这个弹窗，保存后删掉原待办。
- `src/calendar-view.js`：周视图。未来只画时间已确定的东西；投入方向的时段只画今天和过去有记录的日子；点空白处按半小时取整新建日程。

## 手动调整时间

- 手动日程：日历上拖选时段新建（`bindSlotSelection`，按 15 分钟取整）；弹窗用开始 + 结束时间，存的时候换算成时长。自己建的事项（`source` 为 `manual` 或 `paste`）可以 `DELETE /api/items/:id`；邮件同步来的只能取消，否则下次同步会建回来。手动事项的 PATCH 带 `kind` 时整条重新校验。
- 投入方向：方向的 `fixedTime: { start, end }`（"HH:MM"）和每日记录里的 `pins: { 时段 id: { start, end } }`（当天分钟数）由 `pinsForDay` 合并，当天的优先。`buildPlan` 先把钉住的时段当作占用，其余时段照常分配、绕开它们排。

## V4 第 8 段：大模型解析邮件（ADR 0004）

- `scripts/extract.mjs`：提示词、JSON Schema、调用 Claude API、规则校验（`validateExtraction`）。模型客户端可以注入，测试里换成假的。
- `POST /api/extract` 只返回候选；`POST /api/items/extracted` 保存用户确认的事项（`source: "paste"`，id 以 `p-` 开头）。`GET /api/extract/status` 告诉页面密钥配没配。
- `src/extract-view.js`：招聘页的粘贴、预览、勾选、保存。
- `scripts/eval-extract.mjs` + `evals/extract/cases.json`：用真实模型跑标注邮件，按字段统计准确率。

## 数据模型

所有用户数据都在本机 `data/`（见 ADR 0002）：

```text
data/
├── items.json          招聘事项（定时任务和工作台共写，见 recruiting-data.md）
├── workbench.json      设置、投入方向、是否已从浏览器迁移
└── days/YYYY-MM-DD.json  每日记录
```

接口：

- `GET /api/workbench`，`PUT /api/workbench/settings`，`PUT /api/workbench/focus-areas`（不合法返回 400 和中文原因；已存在的方向只能归档，不能移除）
- `GET /api/days?from=&to=`，`PUT /api/days/:date`
- `POST /api/migrate`：一次性搬入 localStorage 旧记录，已有文件不覆盖，搬过一次不再搬

每日记录的字段：

- `plan`：当天的时段，每段有 `id`、`areaId`、`segment`、起止时间和时长。拆成多段的方向，时段 id 是 `方向id#段号`。
- `tasks`：按时段 id 记录完成状态、小目标、计时。
- `reflection`：每日复盘。
- `crowdedOut`：当天被挤占的方向。

V3 及以前的旧记录里，时段 id 是写死的任务 id（`research1`、`research2` 等），统计时由 `areaIdOf` 归到对应方向，旧记录不需要改写。

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
