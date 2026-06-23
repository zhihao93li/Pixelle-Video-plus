# Pixelle 从 main 重做实施计划

版本：v1.0  
日期：2026-06-20  
状态：收敛版执行计划  
依据文档：

1. `docs/zh/product/pixelle-main-rebuild-prd.md`
2. `docs/zh/product/pixelle-main-rebuild-technical-architecture.md`

## 1. 本计划的目标

用最小代码从 `main` 重做一条 Codex 插件化运营闭环。

一句话：

```text
Codex 通过 Pixelle 插件工具发起运营动作，Pixelle Ops 负责保存状态和校验证据，pixelle_video 只负责生成，UI 暂时只保留只读查询能力。
```

## 2. 对上一版计划的处理

废弃上一轮复杂实施计划，相关临时计划文档不进入主线。

废弃原因：

1. 计划过长，执行成本高。
2. 过早拆出了 domain/application/adapters/infrastructure 多层框架。
3. 过早加入 UI 页面。
4. 过早设计 12 张规范化表。
5. 没有解决 PRD 里的开放问题，反而默认做了复杂选择。

后续只以本目录下这组中文产品文档作为本项目实施计划来源。

## 3. P0 明确取舍

### 3.1 P0 做

1. 从 `main` 新开干净分支。
2. 新增一个轻量 `ops/` 模块。
3. 新增 `api/routers/ops.py`。
4. 新增本地 SQLite 状态库。
5. Codex 通过 Pixelle 插件工具创建项目、周期、实验、预测、发布证据、指标、复盘、记忆。
6. 生成前做 preflight：必须有项目、周期、实验、locked prediction。
7. 生成请求绑定 `operation_context`。
8. 发布必须有 `PublishRecord` 证据。
9. 没有预测的复盘只能是 observation。
10. 提供只读 `GET /api/ops/current`，让未来 UI 展示。
11. P0.9 增加项目/平台账号选择，避免多账号运营时默认混用最近项目。

### 3.2 P0 不做

1. 不做新的 UI 页面。
2. 不恢复 `apps/console`。
3. 不恢复旧 `marketing/` 整体目录。
4. 不做多页面后台。
5. 不做完整 ORM 或迁移系统。
6. 不做复杂 adapter 框架。
7. 不做自动平台数据 readback。
8. 不做完整 Buffer 数据回读。
9. 不改 `pixelle_video/` 内部结构。
10. 不提交截图、demo HTML、audit 产物。

## 4. 对 PRD 开放问题的 P0 决策

### 4.1 UI 范围

P0 不做 UI 页面。

只交付只读 API：

```text
GET /api/ops/current
GET /api/ops/experiments/{experiment_id}
```

UI 页面等 Codex API 闭环跑通后再做。

### 4.2 OperationCycle 存储

P0 新建轻量 `operation_cycles` 表，不沿用旧 `Campaign`。

原因：

1. 从 `main` 重做时没有稳定可复用的 `Campaign` 主线。
2. 新表更清楚，不需要继承旧 marketing console 语义。
3. 表很小，不引入明显复杂度。

### 4.3 ContentExperiment 存储

P0 新建 `content_experiments` 表。

原因：

1. 它是运营校准容器。
2. locked prediction、publish evidence、metrics、retro 都要挂在它下面。
3. 用现有 ContentItem 字段承载会让内容生成反过来定义运营闭环。

### 4.4 发布证据迁移

P0 不做 legacy 迁移。

从新闭环产生的发布状态必须通过 `PublishRecord` 事件写入。

### 4.5 项目记忆

P0 只写 Pixelle Ops 状态库。

是否同步写入 cheat workspace 文件，放到 P1。

## 5. 最小代码结构

P0 只新增这些文件：

```text
ops/
  __init__.py
  models.py
  store.py
  service.py
api/
  routers/
    ops.py
  schemas/
    ops.py
codex_plugin/
  __init__.py
  server.py
tests/
  test_ops_store.py
  test_ops_service.py
  test_codex_plugin.py
  test_ops_api.py
```

P0 只修改这些现有文件：

```text
api/app.py
api/routers/__init__.py
api/schemas/__init__.py
```

暂不修改：

```text
web/
pixelle_video/
apps/
marketing/
```

## 6. 状态存储方案

使用 stdlib `sqlite3`，不新增依赖。

数据库默认路径：

```text
data/ops.db
```

P0.9 表结构控制在 6 张表内：

```text
operating_projects
channel_accounts
operation_cycles
content_experiments
content_items
ops_events
```

### 6.1 为什么用 `ops_events`

预测、生成请求、发布证据、指标、复盘、项目记忆都先作为事件存储。

这样 P0 不需要一次性建：

```text
prediction_locks
generation_jobs
media_asset_refs
publish_records
metrics_snapshots
content_retros
project_memory_events
codex_writeback_drafts
audit_events
```

这些可以在 P1 根据真实使用再拆表。

### 6.2 `ops_events` 类型

P0 支持：

```text
prediction_locked
generation_requested
generation_completed
generation_failed
publish_recorded
metrics_recorded
retro_written
memory_written
observation_written
```

每条 event 必须有：

```text
id
operating_project_id
operation_cycle_id
content_experiment_id
content_item_id nullable
event_type
payload_json
source_json
created_at
```

`source_json` 用来记录 Codex 来源：

```json
{
  "kind": "codex",
  "skill": "cheat-on-content",
  "workspace_path": "/local/path",
  "confirmed_by_user": true
}
```

## 7. Codex 插件与 API 范围

### 7.1 Pixelle Codex Plugin tools

P0 的写入口是 Codex 插件工具：

```text
pixelle_get_capabilities
pixelle_list_projects
pixelle_get_current
pixelle_create_project
pixelle_create_channel_account
pixelle_create_cycle
pixelle_create_experiment
pixelle_lock_prediction
pixelle_list_generation_pipelines
pixelle_submit_generation_draft
pixelle_approve_generation_draft
pixelle_request_generation
pixelle_get_generation_status
pixelle_check_generation_asset
pixelle_record_publish
pixelle_record_metrics
pixelle_write_retro
pixelle_write_memory
```

新线程、P0 验证、状态查看、续跑、推荐、生成和恢复必须先调用 `pixelle_get_capabilities`。当前期望协议版本和对话契约版本都是 `p0.9.20260622`，并且 `conversation_contract.requires_capability_first = true`，项目选择、平台账号选择、内容形态选择、已有成片处理、pipeline 选择、文案审批、异步生成状态、资产检查这些 conversation gates 必须全部可用；否则停止，不走旧的直接生成流程。

P0.9 对话体验收口要求 capability 返回 `intent_routes`：Codex 自然语言入口、UI 兜底上下文、项目选择、平台账号选择、状态查看、内容推荐、模糊文案请求、已明确文案请求、完整运营实验、视频生成、已有成片处理、发布证据、mock P0 收口、metrics/retro。Codex 应该用这些 route 解释自然语言请求，避免要求用户发送长工具清单；UI 复制内容只能作为新对话、多项目、多账号或历史轮次定位不清时的兜底上下文。

mock P0 收口只用于验收闭环，不代表真实发布或真实平台数据。mock 发布证据和 mock metrics 必须同时带 `mock: true` 和非空 `mock_label`；普通确认备注不能被当作发布证据。

项目是顶层长期运营对象，通常是一个品牌、业务、IP 或账号矩阵。平台账号是项目下的分发渠道。内容在项目内生产和判断；同一条内容可以生成多条发布记录，每条发布记录指向一个平台账号。

如果 Pixelle Ops 里存在多个运营项目或多个平台账号，Codex 不能默认把最近项目当成当前项目。推荐、生成、发布、指标和复盘写入前，必须先调用 `pixelle_list_projects`，让用户选择项目或平台账号，再用 `pixelle_get_current(project_id=...)` 或 `pixelle_get_current(channel_account_id=...)` 读取明确选择。`pixelle_create_channel_account` 只记录平台账号元数据和 credential reference；它不是 OAuth、自动发布或平台数据回收能力。

阻断动作必须区分：

```text
multiple_projects -> select_project
multiple_accounts -> select_channel_account
```

P0.7-B 进一步要求生成前必须显式选择 pipeline。默认 pipeline 只是推荐，用户说“直接生成视频”不能自动解释为选择 `standard`；除非用户明确说“用 standard/custom/asset_based”，否则 Codex 必须先展示当前注册 pipeline 并等待用户选择。

所有写工具都必须接收 `source` 字段。

如果 `source.kind == "codex"`，必须满足：

```text
source.confirmed_by_user == true
```

这表示 Codex 是入口，但不是绕过用户确认的状态写入器。

生成链路还必须额外满足：用户没有明确内容形态时，Codex 先问短视频字幕稿、图文笔记、只做 hook、还是完整运营实验；进入视频生成前调用 `pixelle_list_generation_pipelines` 让用户选择已注册 pipeline，默认 pipeline 只作为推荐，不能自动代替用户选择；Codex 先提交 `pixelle_submit_generation_draft`，把实际文案给用户审核；用户确认后再调用 `pixelle_approve_generation_draft`；最后 `pixelle_request_generation` 只能使用已批准草稿对应的 approval event，不能直接传入自由文案。

如果同主题或当前实验已经有 `generation_completed`，Codex 必须先问用户是复用旧成片、用当前审核稿重新生成、还是新建干净实验重新生成。只有选择复用时才能检查并返回旧资产；选择重新生成时必须新建实验或使用未完成生成的干净实验。

`pixelle_request_generation` 默认使用异步状态流：先写入 `generation_requested` 并返回，后台继续生成；Codex 用 `pixelle_get_generation_status` 查询结果。生成完成后必须调用 `pixelle_check_generation_asset`，资产检查通过后才进入发布记录。

`pixelle_submit_generation_draft` 的 `text` 必须是最终上屏字幕或口播稿，不允许包含 `【视频目标】`、`【内容形式】`、`【发布标题】`、`【发布正文】`、`【标签】` 等生成说明或发布字段。

插件工具只调用 `ops.service`，不直接写 SQLite。

### 7.2 UI query API

P0 只做：

```text
GET /api/ops/current
GET /api/ops/experiments/{experiment_id}
```

这两个接口只读。

## 8. 核心不变量

P0 必须保护以下规则：

1. 没有真实 `OperatingProject`，不能进入主流程。
2. `OperationCycle` 必须属于 `OperatingProject`。
3. `ContentExperiment` 必须属于 `OperationCycle`。
4. 内容生成必须绑定 `ContentExperiment`。
5. 内容生成前必须有 `prediction_locked` event。
6. 已经有 `publish_recorded` 或 `metrics_recorded` 后，不能再写 blind prediction。
7. `confirmation_note` 不算发布证据。
8. 发布证据至少需要一个：平台 URL、平台 post id、Buffer post id、平台 API 等价响应。
9. 没有 prediction 的 retro 只能写 `observation_written`。
10. UI/query API 不能写状态。
11. Codex 插件不能直接写 SQLite，必须调用 `ops.service`。
12. 多项目/多平台账号时，未选择项目或平台账号不能继续推荐或写状态。
13. 平台账号记录只能保存平台账号元数据和 credential reference，不能保存明文平台凭据。

## 9. 实施步骤

### Step 0：开干净分支

从 `main` 新开：

```bash
git switch main
git switch -c codex/pixelle-codex-first-ops-p0
```

只带入三份文档：

```text
docs/zh/product/pixelle-main-rebuild-prd.md
docs/zh/product/pixelle-main-rebuild-technical-architecture.md
docs/zh/product/pixelle-main-rebuild-implementation-plan.md
```

不带入：

```text
marketing/
apps/console/
audits/
临时实验运行产物/
docs/zh/product/assets/
demo HTML
screenshots
```

### Step 1：实现 `ops/models.py`

内容：

1. Pydantic 或 dataclass 模型。
2. 枚举：`ExperimentStage`、`OpsEventType`。
3. 输入模型：项目、周期、实验、预测、发布证据、metrics、retro、memory。
4. 输出模型：`CurrentOpsView`、`NextAction`。

限制：

1. 不 import `api`。
2. 不 import `web`。
3. 不 import `pixelle_video`。

验收：

1. `ops/models.py` 可以被 Python import。
2. 不引入 `api`、`web`、`pixelle_video`。
3. 具体行为由 Step 2 和 Step 3 的测试覆盖。

### Step 2：实现 `ops/store.py`

内容：

1. `init_db()`
2. 创建 5 张表。
3. 基础 CRUD。
4. `append_event()`
5. `list_events_for_experiment()`
6. `get_current_view()`

限制：

1. 只用 stdlib `sqlite3`。
2. 不加 SQLAlchemy。
3. 不加 Alembic。
4. 不设计迁移系统。

验收：

```bash
uv run pytest tests/test_ops_store.py -q
```

### Step 3：实现 `ops/service.py`

内容：

1. `create_project`
2. `create_cycle`
3. `create_experiment`
4. `lock_prediction`
5. `list_generation_pipelines`
6. `request_generation`
7. `get_generation_status`
8. `check_generation_asset`
9. `record_publish`
10. `record_metrics`
11. `write_retro`
12. `write_memory`
13. `current_view`

这里写所有不变量。

`request_generation` 的 P0 行为：

1. 先做 preflight。
2. 记录 `generation_requested` event。
3. 默认不等待生成完成，返回 `check_generation_status`。
4. 后台或同步兼容路径调用现有 `pixelle_video.generate_video`。
5. 成功后记录 `generation_completed` event。
6. 失败时记录 `generation_failed` event，保留失败信息，不生成 content item，不伪成功。
7. 生成成功必须能提取资产引用；没有 `path`、`video_path`、`url`、`asset_url` 或 `output_path` 时仍按失败处理。
8. 生成完成后下一步是 `check_generation_asset`，检查真实资产引用、本地文件可读性和 draft 文本污染。
9. 资产检查失败时停在 `resolve_asset_issue`，不能记录发布。
10. 如果已有未完成的 `generation_requested`，返回 `generation_in_progress`，不能重复发起生成。
11. 如果已有 `generation_completed`，返回 `generation_already_completed`，不能在同一实验里静默重生成。

注意：

1. 不把 `operation_context` 强行传进 `pixelle_video` 内部。
2. `operation_context` 存在 Pixelle Ops 的 event payload 里。
3. 如果现有生成入口支持 metadata，再传；不支持就不传。

验收：

```bash
uv run pytest tests/test_ops_service.py -q
```

### Step 4：实现 API

新增：

```text
api/schemas/ops.py
api/routers/ops.py
```

修改：

```text
api/routers/__init__.py
api/schemas/__init__.py
api/app.py
```

API 只调用 `ops.service`。

API 不直接写 SQLite。

验收：

```bash
uv run pytest tests/test_ops_api.py -q
```

### Step 5：实现 Pixelle Codex Plugin

新增：

```text
codex_plugin/__init__.py
codex_plugin/server.py
```

内容：

1. 暴露 `pixelle_*` 工具。
2. 每个写工具都要求 `source.confirmed_by_user == true`。
3. 工具内部只调用 `ops.service`。
4. 不直接写 SQLite。
5. 不调用 `web`。
6. P0 使用本地 MCP/FastMCP server 形态，不做发布市场或远程插件包装。
7. 本地启动和调用说明写入 `docs/zh/product/pixelle-codex-plugin-p0-usage.md`。
8. 业务错误返回 `status=error` + `error.code`，不暴露 Python exception 文本。

验收：

```bash
uv run pytest tests/test_codex_plugin.py -q
```

### Step 6：Codex-plugin smoke

用插件工具跑一条完整闭环：

```text
create project
create cycle
create experiment
lock prediction
request generation
record publish
record metrics
write retro
write memory
GET /api/ops/current
```

验收：

1. 每一步返回 next action。
2. 缺 prediction 时 generation blocked。
3. 只有 confirmation_note 时 publish blocked。
4. 事后 retro 没有 prediction 时只能 observation。
5. `/api/ops/current` 能展示当前项目、周期、实验、状态和下一步。

### Step 7：边界检查

必须通过：

```bash
uv run pytest tests/test_ops_store.py tests/test_ops_service.py tests/test_codex_plugin.py tests/test_ops_api.py -q
uv run ruff check ops codex_plugin api/routers/ops.py api/schemas/ops.py tests/test_ops_store.py tests/test_ops_service.py tests/test_codex_plugin.py tests/test_ops_api.py
```

再检查没有误带文件：

```bash
git status --short
git diff --stat main..HEAD
```

禁止出现：

```text
apps/console
marketing
audits
临时实验运行产物
docs/zh/product/assets
*.html demo
*.png screenshot
```

## 10. 测试清单

只写三组测试。

### 10.1 `tests/test_ops_store.py`

验证：

1. 初始化数据库。
2. 创建 project/cycle/experiment/item。
3. append event。
4. current view 可读。

### 10.2 `tests/test_ops_service.py`

验证：

1. 没有 project 不能创建主流程对象。
2. cycle 必须属于 project。
3. experiment 必须属于 cycle。
4. prediction locked 后才能 request generation。
5. generation runner 失败时必须写 `generation_failed`，不能生成 content item。
6. generation runner 返回无资产引用时必须写 `generation_failed`。
7. publish evidence 不能只有 note。
8. metrics 必须挂在已发布 content item 上。
9. 没 prediction 的 retro 只能 observation。

### 10.3 `tests/test_ops_api.py`

验证：

1. API 只提供查询/调试能力，不提供 UI 可调用的写入口。
2. `GET /api/ops/current` 只读。
3. 错误返回明确 code。

### 10.4 `tests/test_codex_plugin.py`

验证：

1. 插件工具能调用 `ops.service` 跑通完整闭环。
2. 写工具缺少 `source.confirmed_by_user` 时拒绝。
3. 插件不能直接访问 SQLite。

## 11. 代码规模上限

P0 上限：

```text
ops/models.py       <= 200 行
ops/store.py        <= 350 行
ops/service.py      <= 450 行
api/schemas/ops.py  <= 180 行
api/routers/ops.py  <= 300 行
codex_plugin/       <= 300 行
tests/              <= 900 行
```

如果超过，先停下来讨论，不继续加抽象。

## 12. 提交顺序

建议 4 个提交：

```text
docs: add codex-first ops implementation plan
feat: add minimal ops state store
feat: add codex-first ops service
feat: expose pixelle codex plugin
feat: expose read-only ops api
```

不要出现：

```text
feat: add marketing console
feat: add ops framework
feat: add dashboard
chore: migrate old branch
```

## 13. 完成定义

P0 完成不是 UI 好看，也不是表结构完整。

P0 完成只有一个标准：

```text
Codex 能通过 Pixelle 插件工具跑通一条真实内容运营闭环，
Pixelle 能保存状态和证据，
生成、发布、指标、复盘不会被伪成功，
并且没有把旧分支的大量复杂代码带回来。
```

## 14. P0 后路线图

本节只用于防止范围漂移，不是 P0 执行计划。

真正执行时只做 Step 0 到 Step 7。下面内容必须等 P0 验收通过后再拆成新的实施计划。

### P1：cheat-on-content 深度接入

目标：

让 Codex 使用 `cheat-on-content` 时，可以稳定读取 Pixelle 当前运营上下文，并通过受控 draft/apply 写回 Pixelle。

范围：

1. `ContextExport`。
2. `CheatWorkspaceSummary`。
3. `CodexWritebackDraft`。
4. draft validate/apply。
5. 更完整的 `ProjectMemory` 同步。

不做：

1. 不自动扫描 cheat workspace 后直接写产品状态。
2. 不让 Codex 绕过 Pixelle Plugin 和 `ops.service`。

### P2：Pixelle 只读展示 UI

目标：

Pixelle UI 只展示 Codex 运营动作的结果，不承担运营入口。

范围：

1. 当前项目页。
2. 当前状态页。
3. 证据链结果页。
4. 生成资产预览。
5. Codex 操作审计记录。

不做：

1. 不做运营表单。
2. 不做多页面营销后台。
3. 不恢复 `apps/console`。

### P3：证据自动化

目标：

减少发布证据和指标数据的手工录入，但不改变 Pixelle Ops 的证据规则。

范围：

1. 平台数据 readback。
2. Buffer 发布状态回读。
3. 多平台 metrics adapter。
4. 更完整的内容队列。

不做：

1. 不把自动回读当成唯一证据来源。
2. 不在没有真实平台返回时伪造成功。

### P4：长期学习层

目标：

把多轮运营结果沉淀成可复用的账号经验、判断校准和内容策略。

范围：

1. ProjectMemory 结构升级。
2. rubric 与实际表现的长期校准。
3. 跨周期复盘摘要。
4. 可解释的下一轮建议。

不做：

1. 不在 P0 阶段提前设计复杂记忆系统。
2. 不在没有真实运营数据前固化复杂评分模型。
