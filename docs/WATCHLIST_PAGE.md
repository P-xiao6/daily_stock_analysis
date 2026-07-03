# 自选股看板

## 功能定位

自选股看板为 WebUI 新增的 `/watchlist` 页面，用于把系统设置中的 `STOCK_LIST` 变成可视化股票列表。用户可以直接查看行情、最近深度分析记录、下一次自动分析时间和最新 AI 建议，并在页面内维护每只股票的分析策略。

## 数据来源

- 自选股列表：读取并写回 `STOCK_LIST`。
- 实时行情：调用现有股票行情接口 `/api/v1/stocks/{stock_code}/quote`。
- 最近一次分析：调用历史报告列表接口，按股票代码读取最新一条记录。
- 最新 AI 建议：调用 DecisionSignal 最新 active 信号接口。
- 换手率/量比：优先展示最近历史分析记录中的 `turnover_rate` 与 `volume_ratio`；实时行情源不支持时显示为空。
- 每股策略与自动分析计划：读取 `watchlist_profiles` 持久化表。

页面不会读取、展示或导出 API Key、Webhook、邮箱密码、Cookie、Token 等敏感配置。

## 主要能力

- 左侧菜单新增“自选股”。
- 新增路由 `/watchlist`。
- 支持添加股票。
- 支持删除股票。
- 支持拖拽排序和上下移动排序。
- 排序、添加、删除后同步更新 `STOCK_LIST`。
- 支持单只股票一键分析。
- 支持全部自选股一键分析，并在提交前二次确认，避免误触发高 token 消耗。
- 支持每只股票独立设置默认策略 `default_skill`。
- 支持每只股票独立设置模型策略：`auto`、`flash`、`pro`。
- 支持每只股票独立设置自动深度分析计划。
- 支持深度分析按钮弹窗确认，临时选择策略和模型，并可保存为该股票默认策略。
- 桌面端使用表格布局。
- 手机端使用卡片式布局。
- 最新历史报告可在页面内打开报告抽屉。

## 每股策略设置

每只自选股可以在“配置”中设置 `default_skill`。可选项来自现有 `/api/v1/agent/skills` 返回的 Strategy Skill 列表，例如通用分析、均线金叉、放量突破、缩量回踩、热点题材、事件驱动、成长质量、预期重估、箱体震荡、底部放量、龙头策略和情绪周期等。

未设置 `default_skill` 时，分析请求不会传入单股策略，后端继续回退到全局 `AGENT_SKILL_ROUTING` 或 `AGENT_SKILLS`。

## 自动深度分析计划

每股 profile 支持以下字段：

- `auto_analysis_enabled`：是否启用自动深度分析。
- `schedule_mode`：`manual_only`、`daily_close`、`intraday`、`custom_times`、`alert_triggered`。
- `schedule_times`：多个 `HH:MM` 时间点，例如 `15:10`、`18:00`、`09:45,13:30,14:45`。
- `cooldown_minutes`：冷却时间，默认 30 分钟。
- `max_daily_runs`：每天最多自动运行次数，默认 1，最高 3。

后端会计算 `next_analysis_at`。自动扫描接口会在交易日内提交到期任务，非交易日跳过；同一股票处于冷却期或达到当日上限时不会重复触发，并会推进下一次扫描时间，避免低配服务器反复空跑。

当系统运行时调度器启用时，后端会每 60 秒轻量扫描一次自选股自动分析计划；未启用运行时调度器时，也可以由宝塔计划任务调用 `POST /api/v1/stocks/watchlist/auto-analysis/run-due`。低配服务器默认每轮只提交 1 只，避免队列拥塞。

## 手动深度分析

每行“深度分析”按钮会弹出确认框，可临时选择：

- 分析策略
- 模型策略：自动、Flash、Pro
- 是否保存为该股票默认策略

点击开始后调用现有分析队列接口，页面显示排队中、分析中、已完成或失败。任务完成并返回报告 ID 后，可以直接查看报告。

模型策略说明：`auto` 跟随全局模型路由策略，`pro` 会临时请求本次任务使用 Pro，`flash` 表示不额外请求 Pro，适合全局默认 Flash 的部署。若生产环境全局已固定为 Pro，Flash 不会绕过显式环境变量覆盖。

## AI 建议联动

看板会显示每只股票最新 active DecisionSignal：

- `action`
- `confidence`
- `score`
- `horizon`
- `source_report_id`
- `created_at`

点击 AI 建议可进入 AI 建议页并带上股票筛选参数。没有 active 信号时显示“暂无”。

## 登录与权限

当 `ADMIN_AUTH_ENABLED=true` 时，现有认证中间件会保护 `/api/v1/*` 接口，未登录用户无法访问修改接口。前端页面也会根据登录状态禁用添加、删除和排序控件。

## API

已有接口：

- `GET /api/v1/stocks/watchlist`
- `POST /api/v1/stocks/watchlist/add`
- `POST /api/v1/stocks/watchlist/remove`

新增接口：

- `POST /api/v1/stocks/watchlist/reorder`
- `GET /api/v1/stocks/watchlist/profiles`
- `PUT /api/v1/stocks/watchlist/profiles/{stock_code}`
- `POST /api/v1/stocks/watchlist/auto-analysis/run-due`

请求示例：

```json
{
  "stock_codes": ["600519", "000001", "HK00700"]
}
```

该接口会校验股票代码格式，重复代码按首次出现保留，并把最终顺序写回 `STOCK_LIST`。

自动扫描接口可以不带请求体，默认 `limit=1`；也可以传入：

```json
{
  "limit": 1
}
```

`watchlist_profiles` 字段：

- `stock_code`
- `market`
- `enabled`
- `default_skill`
- `model_strategy`
- `auto_analysis_enabled`
- `schedule_mode`
- `schedule_times`
- `cooldown_minutes`
- `max_daily_runs`
- `last_analysis_at`
- `next_analysis_at`
- `last_report_id`
- `last_decision_signal_id`
- `created_at`
- `updated_at`

## 2核2G服务器推荐配置

- `MAX_WORKERS=1`
- 自动扫描每轮最多提交 1 只股票。
- 默认每只股票每天最多自动深度分析 1 次。
- 不启用本地大模型。
- 使用云端 API 模型。
- 自选股超过 10 只时，谨慎启用批量或盘中多次自动分析。

## 为什么不建议高频自动深度分析

深度分析会调用行情、新闻、上下文构建和 LLM。高频自动运行会带来：

- token 成本增加。
- 数据源压力增加，可能触发限流。
- 低配服务器 CPU/内存压力增加。
- 同一股票短时间内重复分析，信息增量有限。

因此默认每只股票每天最多自动分析 1 次，并设置 30 分钟冷却。

## 验收建议

1. 打开 `/watchlist`，确认左侧菜单“自选股”可进入。
2. 添加一只股票，确认 `STOCK_LIST` 同步更新。
3. 删除一只股票，确认 `STOCK_LIST` 同步更新。
4. 使用上下移动或拖拽排序，刷新后确认顺序保持。
5. 点击单只股票“深度分析”，确认弹出策略和模型选择框，任务进入分析队列。
6. 点击“一键分析全部”，确认出现二次确认弹窗。
7. 设置单股默认策略、自动分析时间、冷却时间和每日上限，刷新后确认配置仍存在。
8. 确认最新 active DecisionSignal 可显示并可跳转。
9. 确认页面未展示任何 API Key、Webhook、密码、Cookie 或 Token。
10. 在手机视口验证卡片布局，在桌面视口验证表格布局。
