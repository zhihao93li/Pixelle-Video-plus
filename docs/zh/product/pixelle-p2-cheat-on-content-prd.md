# Pixelle P2 cheat-on-content 集成 PRD

版本：v0.1
日期：2026-06-24
状态：P2 需求基准稿
适用范围：P1 Ops UI 完成后，优先实现 `cheat-on-content` 与 Pixelle Ops 的受控集成
目标读者：产品、后端、前端、Codex/插件执行者
相关文档：

- `docs/zh/product/pixelle-main-rebuild-prd.md`
- `docs/zh/product/pixelle-main-rebuild-technical-architecture.md`
- `docs/zh/product/pixelle-main-rebuild-implementation-plan.md`
- `docs/zh/product/pixelle-p1-ui-prd.md`
- `docs/zh/product/pixelle-p1-ui-information-architecture.md`

## 1. 一句话目标

P2 要把 `cheat-on-content` 作为 Pixelle 的运营方法论层接入：Codex 使用 `cheat-on-content` 做选题、评分、盲预测、发布登记、复盘、persona、rubric 和 memory 判断；Pixelle Ops 负责保存产品事实、校验证据和应用结果；两者通过只读摘要和 `writeback draft -> validate -> apply` 受控同步。

P2 不是自动发布、不是自动抓数、不是 UI 运营后台，也不是把 cheat workspace 迁进 Pixelle 数据库。

## 2. 背景和问题

P1 已经完成 Ops UI 和配置展示：用户可以在 `/ops` 看项目、平台账号、运营轮次、6 步闭环、生成资产、发布证据、指标、复盘和 memory。

但当前系统仍有一个关键缺口：Pixelle UI 和 Ops DB 只能展示已经写入 Pixelle 的事实，不能稳定理解 `cheat-on-content` 的方法论状态。

现在的问题包括：

1. Codex 依赖对话上下文理解项目，而不是稳定读取 Pixelle + cheat 的联合上下文。
2. `cheat-on-content` 的候选、预测、persona、rubric、复盘和 memory 输出没有受控写回机制。
3. UI 不能展示 cheat workspace 的健康状态、一致性状态和已应用来源。
4. 如果粗暴把 cheat workspace 当数据库扫描导入，会污染 Pixelle 产品事实。
5. 如果完全分开，用户不知道 Pixelle 和 cheat workspace 是否已经不同步。

P2 要解决的是受控集成，而不是物理合库。

## 3. 设计原则

### 3.1 一个事实只有一个主存储

Pixelle Ops DB 是产品事实主库。以下内容以 Pixelle 为准：

1. 项目。
2. 平台账号。
3. 运营周期。
4. 内容实验。
5. 生成资产。
6. 发布证据。
7. 指标快照。
8. 复盘事件。
9. ProjectMemoryEvent。
10. writeback draft 的 validate/apply 审计。

cheat workspace 是方法论工作区。以下内容以 cheat workspace 为准：

1. `rubric_notes.md`。
2. `rubric-memo.md`。
3. `script_patterns.md`。
4. `audience.md`。
5. `benchmark.md`。
6. `candidates.md`。
7. `scripts/*.md`。
8. `predictions/*.md` 完整 markdown。
9. `videos/*/report.md` 原始复盘资料。
10. `.cheat-state.json`。

Pixelle 可以保存 cheat 输出的结构化快照、source file、source hash、rubric version 和 apply 审计，但不能把 cheat workspace 当作自动同步数据库。

### 3.2 读摘要，写 draft，apply 后才是事实

P2 的集成路径固定为：

```text
Pixelle ContextExport
  -> Codex + cheat-on-content 处理
  -> CodexWritebackDraft
  -> Pixelle Ops validate
  -> 用户确认 apply
  -> Pixelle Ops DB 产生事实事件
  -> UI 展示事实、来源和一致性状态
```

任何 cheat 文件变化都不能自动改变 Pixelle 状态。文件变化只能产生：

1. 新的 draft。
2. stale 标记。
3. conflict 标记。
4. 用户确认后的 apply。

### 3.3 不复制 cheat 方法论到 UI

UI 的职责是展示状态、证据、来源和冲突，不承担 seed、predict、retro、bump、persona rebuild 的主操作。

用户真正做运营判断仍在 Codex 中完成。

## 4. P2 范围

### 4.1 必须做

1. 项目绑定 `cheat_workspace_path`。
2. `CheatWorkspaceSummary` 只读摘要。
3. `ContextExport` 联合上下文导出。
4. `CodexWritebackDraft` 模型和状态流。
5. draft validate/apply/reject。
6. prediction、draft、publish、metrics、retro、memory 的受控写回。
7. ProjectMemoryEvent 与 cheat retro/persona/rubric 结果的来源关联。
8. source file/hash 一致性检测。
9. UI 展示 cheat workspace 健康状态、摘要、一致性状态和已应用来源。
10. Codex 插件工具补齐。
11. P2 smoke 和回归测试。

### 4.2 明确不做

1. 不自动发布。
2. 不自动抓小红书后台数据。
3. 不做 Buffer 状态自动回读。
4. 不做多平台 metrics adapter。
5. 不在 UI 里执行 seed / predict / retro / bump。
6. 不自动执行 `cheat-bump`。
7. 不把 cheat workspace 整体迁入 Pixelle DB。
8. 不扫描 cheat workspace 后批量导入所有历史 prediction。
9. 不把 `rubric-memo.md` 或 `audience.md` 暴露给 blind scoring 通道。

## 5. cheat-on-content 能力映射

| cheat 能力 | Pixelle P2 集成方式 | 是否写 Pixelle 事实 |
|---|---|---|
| `cheat-init` | 检测 workspace 是否初始化，展示 health | 否 |
| `cheat-migrate` | 检测 schema mismatch，提示回 Codex 处理 | 否 |
| `cheat-status` | 抽取 summary：buffer、pending retros、confidence、health | 否 |
| `cheat-learn-from` | 展示 benchmark 状态和样本数 | 否 |
| `cheat-seed` | 生成候选或 draft 后，经 writeback draft 创建 experiment | apply 后是 |
| `cheat-trends` | 候选池摘要；不直接进 Pixelle | 否 |
| `cheat-recommend` | 推荐结果经 writeback draft 创建 experiment | apply 后是 |
| `cheat-score` | 可作为 draft 依据的一部分保存摘要 | apply 后可作为 evidence |
| `cheat-predict` | 完整 prediction 留在 cheat；Pixelle apply 结构化预测快照 | apply 后是 |
| `cheat-shoot` | P2 不作为 Pixelle 核心事件；可在 summary 展示 buffer | 否 |
| `cheat-publish` | Pixelle publish evidence 仍以 Pixelle 为准；可保存 cheat source | apply 后是 |
| `cheat-retro` | retro draft 经 validate/apply 写 Pixelle retro 和 memory | apply 后是 |
| `cheat-persona` | 展示 persona 摘要和更新时间；不进入 blind scoring | 否 |
| `cheat-bump` | 展示 rubric version/bump 状态；不自动执行 | 否 |

## 6. UI 信息披露规则

P2 UI 不是 cheat workspace 浏览器。UI 必须按“用户此刻是否需要看、是否需要在这里看、看了是否会误解为产品事实”裁剪信息。

### 6.1 四档披露

| 披露档位 | 含义 | 使用场景 |
|---|---|---|
| 主展示 | 当前项目/当前轮次必须直接看到 | 影响下一步、阻断、冲突、已应用事实 |
| 二级详情 | 用户点开后可看 | 来源、摘要、校验结果、最近几条记录 |
| 只做引用 | 不展开全文，只提供 source path/hash/mtime | 完整 markdown、长期方法论文件 |
| 不展示 | UI 不展示，最多用于健康检测 | secret、cache、blind 污染源、过长原始材料 |

### 6.2 建议展示什么

| cheat 内容 | 主展示 | 二级详情 | 只做引用 | 不展示 | 理由 |
|---|---:|---:|---:|---:|---|
| workspace 绑定状态 | 是 | 是 | 否 | 否 | 影响 P2 是否可用 |
| `.cheat-state.json` 派生状态 | 是 | 是 | 否 | 否 | 只展示安全派生字段 |
| schema version | 是 | 是 | 否 | 否 | schema mismatch 会阻断 |
| rubric version | 是 | 是 | 否 | 否 | 解释预测口径 |
| calibration samples / confidence | 是 | 是 | 否 | 否 | 影响预测可信度 |
| buffer count / buffer color | 是 | 是 | 否 | 否 | 影响下一步是拍、发还是复盘 |
| pending retros count | 是 | 是 | 否 | 否 | 影响下一步优先级 |
| benchmark status | 是 | 是 | 否 | 否 | 冷启动方向依据 |
| latest publish / retro time | 是 | 是 | 否 | 否 | 判断闭环进度 |
| applied prediction snapshot | 是 | 是 | 是 | 否 | Pixelle 事实，必须可见 |
| applied retro summary | 是 | 是 | 是 | 否 | Pixelle 事实，必须可见 |
| ProjectMemoryEvent | 是 | 是 | 是 | 否 | 下一轮判断依据 |
| source file/hash/mtime | 是 | 是 | 否 | 否 | 检测一致性 |
| pending writeback drafts | 是 | 是 | 否 | 否 | 用户需要知道待确认 |
| validation errors | 是 | 是 | 否 | 否 | 阻断下一步 |
| conflict/stale 状态 | 是 | 是 | 否 | 否 | 必须显式暴露 |
| persona 摘要 | 否 | 是 | 是 | 否 | 有用但不该抢主线 |
| top audience traits | 否 | 是 | 是 | 否 | 选题参考，不是当前事实 |
| candidate count | 否 | 是 | 是 | 否 | 用于状态判断，不是主流程 |
| top 3 candidate titles | 否 | 是 | 是 | 否 | 只在没有当前实验时辅助 |
| script pattern 摘要 | 否 | 是 | 是 | 否 | 写作参考，非运营事实 |
| rubric bump 建议 | 否 | 是 | 是 | 否 | 提醒即可，不自动执行 |

### 6.3 不建议主展示什么

| cheat 内容 | 处理方式 | 原因 |
|---|---|---|
| `rubric_notes.md` 全文 | 只展示 version、维度摘要、source link | 全文过长，主界面不需要 |
| `rubric-memo.md` 全文 | 只展示最近 bump 摘要和 source link | 含实绩和样本证据，容易污染 blind 判断 |
| `audience.md` 全文 | 只展示 persona 摘要和 confidence | 含评论派生信号，不应进入 blind scoring |
| `candidates.md` 全量列表 | 只展示计数和少量候选摘要 | UI 不做候选池管理 |
| `scripts/*.md` 全文 | 只展示已 apply 草稿或 source preview | 草稿不是产品事实 |
| `predictions/*.md` 全文 | 默认展示 apply 快照；全文二级预览 | 完整预测日志由 cheat workspace 管 |
| `videos/*/report.md` 全文 | 展示已 apply metrics/retro 摘要 | 原始报告长且可能含噪声 |
| `.cheat-cache/*` | 不展示 | 内部缓存，不应成为产品信息 |
| `.claude/settings.json` / hooks 脚本 | 只展示 hook health | 用户不需要看实现 |
| API key、cookie、登录态 | 不展示 | 安全边界 |
| 本机绝对路径 | 默认展示相对路径，详情可复制完整路径 | 避免第一屏泄露噪声和路径细节 |

### 6.4 每个闭环步骤的展示策略

| 闭环步骤 | 主展示 | 二级详情 | 不展示 |
|---|---|---|---|
| 1. 复盘选题与预测 | 当前选题、预测摘要、rubric version、confidence、source hash、上一轮 memory 摘要 | candidate source、benchmark/persona 摘要、完整 prediction source preview | 全量 candidates、rubric-memo 全文 |
| 2. 选题后草稿 | 已 apply 的生成稿、pipeline、草稿审核状态 | script source、draft history、clean text check | 未 apply 的所有 script 草稿 |
| 3. 草稿审核 | 审核结论、确认版本、阻断原因 | 审核记录、source diff | 视频指标、发布字段 |
| 4. 审核后生成内容 | 资产、生成状态、asset check、source draft | generation event、asset metadata | cheat persona/rubric 细节 |
| 5. 内容审核后发布 | 发布证据、平台账号、URL/post id/Buffer id、mock 标记 | source publish draft、审计记录 | 仅口头备注作为发布事实 |
| 6. 观测复盘沉淀 | metrics 摘要、retro 摘要、memory、是否建议 persona/bump | report source、retro source、学习项详情 | 未 apply 的 retro 全文当作事实 |

### 6.5 按页面和区域放置

| UI 位置 | 应该放什么 | 不应该放什么 | 原因 |
|---|---|---|---|
| Projects | cheat workspace 绑定、health、schema 状态、最近检查时间、绑定/解绑入口 | rubric、persona、候选、预测全文 | Projects 只解决“这个项目接了哪个方法论工作区” |
| Ops 顶部状态 | cheat summary 是否可用、是否 stale/conflict、是否有 pending draft | 长文本摘要、候选列表、rubric 细节 | 顶部只回答“当前闭环能不能信、能不能继续” |
| Ops 左侧轮次地图 | 当前步骤是否有 cheat source、是否 mock、是否缺证据 | source hash、文件名、详细错误 | 左侧只做定位，不做详情阅读 |
| Ops 中间工作面 | 当前步骤必须看的 cheat 派生信息，例如预测摘要、rubric version、confidence、source synced、memory 摘要 | 与当前步骤无关的 persona、benchmark、所有候选 | 工作面只服务当前判断 |
| Inspector | 当前步骤的校验标准、阻断原因、source stale/conflict 对下一步的影响 | 完整原文、实现日志、缓存字段 | Inspector 帮用户判断“能不能过” |
| 证据抽屉 | source file、hash、mtime、apply audit、原始 payload 摘要、可复制引用 | secret、cookie、cache、全部历史文件 | 证据区负责追溯，不抢主线 |
| Settings / Integrations | cheat 集成能力是否启用、依赖是否健康 | workspace 绑定编辑、rubric 编辑、persona 编辑 | Settings 只做全局能力，不管理项目方法论 |
| Create / History | 不展示 cheat workspace 内容 | 运营预测、复盘、rubric、memory | 旧 Video 模块不是运营闭环真相源 |

判断规则：

1. 影响当前下一步的，放主展示。
2. 解释当前判断依据的，放二级详情。
3. 只用于追溯的，放证据抽屉。
4. 方法论全文、缓存、敏感信息和 blind 污染源，不进 UI 主路径。

## 7. 核心对象

### 7.1 ProjectCheatWorkspaceBinding

项目绑定 cheat workspace 的配置对象。

字段：

1. `project_id`
2. `workspace_path`
3. `status`
4. `state_schema_version`
5. `last_checked_at`
6. `health_issues`
7. `source`

状态：

1. `not_configured`
2. `valid`
3. `missing`
4. `unreadable`
5. `schema_mismatch`
6. `invalid_workspace`

### 7.2 CheatWorkspaceSummary

只读摘要，不改变任何文件。

字段：

1. `workspace_path`
2. `state_schema_version`
3. `skill_version`
4. `content_form`
5. `rubric_version`
6. `calibration_samples`
7. `confidence`
8. `benchmark_status`
9. `candidate_count`
10. `prediction_count`
11. `pending_retro_count`
12. `buffer_count`
13. `buffer_status`
14. `audience_status`
15. `rubric_memo_status`
16. `latest_published_at`
17. `latest_retro_at`
18. `latest_bump_at`
19. `health_issues`

### 7.3 ContextExport

Pixelle 导出给 Codex 的联合上下文。

必须包含：

1. project。
2. channel account。
3. current cycle。
4. current experiment。
5. next action。
6. recent ops events。
7. content item asset summary。
8. project memory summary。
9. cheat workspace summary。
10. sync status。

### 7.4 CodexWritebackDraft

Codex 或 cheat 输出进入 Pixelle 的唯一待确认写入对象。

状态：

```text
draft_created
  -> validation_passed / validation_failed
  -> user_approved / rejected
  -> applied / apply_failed
```

允许 operation：

1. `create_content_experiment`
2. `lock_content_prediction`
3. `submit_generation_draft`
4. `record_publish_evidence`
5. `record_metrics_snapshot`
6. `record_retro_observation`
7. `write_project_memory_event`

每个 draft 必须保存：

1. operation。
2. target。
3. payload。
4. source kind。
5. source skill。
6. cheat workspace path。
7. source file。
8. source hash。
9. source mtime。
10. validation result。
11. applied entity。
12. audit event。

## 8. 校验规则

### 8.1 prediction

1. 已有 publish 或 metrics 后不能新增 blind prediction。
2. 已有 applied prediction 后不能覆盖，只能创建 observation 或 redo。
3. prediction draft 必须带 source file 和 source hash。
4. 如果 source hash 与当前文件不一致，必须标 `source_hash_changed`。

### 8.2 generation draft

1. draft text 只能是最终上屏字幕或口播稿。
2. 不能包含视频目标、发布标题、发布正文、标签、生成说明。
3. 未通过用户审核不能 request generation。
4. `request_generation` 只能读取已批准 draft 的正文；Codex 不能在调用生成时临时替换、扩写或重组文案。
5. `standard` pipeline 必须把已批准正文作为 fixed text 传入生成层，不能再让生成层重新创作文案。
6. `asset_check` 必须比较生成产物的 storyboard/narration 与已批准 draft；不一致时即使视频文件存在，也必须标记失败，不能进入发布。

### 8.3 publish evidence

有效证据至少包含一个：

1. 平台 URL。
2. 平台 post id。
3. Buffer post id。
4. 平台 API 等价响应。

口头备注不能让内容进入 `published`。

### 8.4 metrics

1. 必须存在 publish evidence。
2. 必须绑定已发布 content item。
3. mock metrics 必须带 `mock: true` 和非空 `mock_label`。

### 8.5 retro 和 memory

1. 正式 retro 必须有 prediction、publish、metrics。
2. 没有 prediction 只能写 observation。
3. ProjectMemoryEvent 必须来源于 retro 或 observation。
4. memory 不能凭空写入。
5. persona refresh / rubric bump 只能作为建议，不自动执行。

## 9. 一致性状态

P2 必须显式暴露一致性状态。

| 状态 | 含义 | 系统行为 |
|---|---|---|
| `source_synced` | Pixelle 保存的 source hash 与当前文件一致 | 正常展示 |
| `source_hash_changed` | source 文件存在但内容变了 | Pixelle 事实不变，提示可能 stale |
| `source_missing` | source 文件不存在 | Pixelle 事实不变，提示来源缺失 |
| `workspace_missing` | 绑定路径不存在 | 阻断读取 cheat summary |
| `workspace_schema_mismatch` | `.cheat-state.json` schema 不兼容 | 提示回 Codex 跑 migrate |
| `pending_writeback` | 有 draft 未 apply | 展示待确认 |
| `draft_conflict` | draft target 状态已变化 | 阻断 apply |
| `already_applied` | 同一 draft/source 已应用 | 幂等返回，不重复写事件 |
| `apply_rejected` | validate/apply 被拒 | 展示拒绝原因 |

## 10. Codex 体验

P2 完成后，用户在 Codex 里应该能自然问：

1. “现在该做什么？”
2. “下一条内容适合做什么？”
3. “基于上一轮复盘给我一个选题。”
4. “这条能不能锁预测？”
5. “我发布了，帮我登记。”
6. “数据来了，帮我复盘。”
7. “这轮学到了什么？”
8. “现在 cheat workspace 和 Pixelle 同步吗？”

Codex 不应该要求用户手写工具清单。

## 11. API 和插件工具

### 11.1 API query/config

P2 可新增：

```text
GET /api/ops/projects/{project_id}/cheat-workspace
PUT /api/ops/projects/{project_id}/cheat-workspace
GET /api/ops/projects/{project_id}/cheat-workspace-summary
GET /api/ops/context-export
GET /api/ops/writeback-drafts
GET /api/ops/writeback-drafts/{draft_id}
```

API 不提供运营 apply 写入口给 UI。UI 可以配置 workspace path 和查看 draft 状态；运营 apply 仍以 Codex 插件为主。

### 11.2 Codex plugin tools

P2 需要新增：

1. `pixelle_set_project_cheat_workspace`
2. `pixelle_get_cheat_workspace_summary`
3. `pixelle_get_context_export`
4. `pixelle_submit_writeback_draft`
5. `pixelle_validate_writeback_draft`
6. `pixelle_apply_writeback_draft`
7. `pixelle_reject_writeback_draft`
8. `pixelle_list_writeback_drafts`

`pixelle_get_capabilities` 必须升级：

1. protocol version bump。
2. 新增 P2 intent routes。
3. 声明 cheat workspace 只读边界。
4. 声明 writeback draft 是唯一写回路径。
5. 声明 UI 不是 cheat 操作入口。

## 12. UI 调整

P2 UI 只做展示和配置：

1. Projects 页面增加 cheat workspace 绑定状态。
2. Ops 页面增加 cheat summary 小节。
3. 6 步闭环详情里展示 source file/hash/sync status。
4. Pending draft 在 Ops 中可见，但主确认动作回 Codex。
5. conflict/stale 状态必须在主工作面可见。
6. Settings / Integrations 不承担 cheat workspace 编辑。

P2 UI 不新增大型候选池页面、rubric 编辑器、persona 编辑器或 retro 编辑器。

## 13. 实施顺序

### P2-0 文档收敛

更新主 PRD、技术架构、实施计划，把 P2 固定为 `cheat-on-content` 集成。

### P2-1 Workspace Binding

实现项目绑定、路径校验、health status。

### P2-2 CheatWorkspaceSummary

实现只读摘要 parser 和错误处理。

### P2-3 ContextExport

实现 Pixelle + cheat 联合上下文。

### P2-4 WritebackDraft

实现 draft 模型、持久化、validate。

### P2-5 Apply

实现 apply 到现有 Ops service 事件，不绕过状态机。

### P2-6 Learning Sync

实现 retro/memory/persona/rubric 建议的结构化同步和展示。

### P2-7 UI Integration

在 P1 Ops UI 上增量展示绑定、summary、source、sync、draft。

### P2-8 Smoke 和回归

补 P2 smoke、API/插件测试、UI 合同测试。

## 14. 验收场景

### 场景 A：未绑定 workspace

用户打开项目，UI 显示未绑定 cheat workspace。Codex 状态提示可以继续用 Pixelle 基础闭环，但 cheat summary 不可用。

验收：

1. 不报错。
2. 不阻断已有 P1 功能。
3. 提示可绑定路径。

### 场景 B：绑定有效 workspace

项目绑定本地 cheat workspace 后，UI 展示 rubric version、confidence、buffer、pending retro、benchmark、persona 状态。

验收：

1. 不修改 cheat workspace。
2. summary 字段正确。
3. API 不返回 secret、cookie 或 cache 内容。

### 场景 C：prediction writeback

Codex 用 cheat-predict 产生预测，提交 writeback draft，Pixelle validate 通过，用户确认 apply。

验收：

1. Pixelle 写入 prediction event。
2. 保存 source file/hash/rubric version。
3. UI 显示 prediction snapshot 和 source synced。

### 场景 D：source hash 变化

apply 后用户改了 prediction markdown。

验收：

1. Pixelle 已应用事实不变。
2. UI 标 `source_hash_changed`。
3. Codex 不自动覆盖 Pixelle prediction。

### 场景 E：retro + memory

用户通过 cheat-retro 起草复盘，提交 retro 和 memory draft。

验收：

1. 没有 publish/metrics 时 retro validate 被拒。
2. 有完整证据时 retro apply。
3. memory 必须关联 retro 或 observation。
4. UI 显示学习项和 source。

### 场景 F：cheat 主路径生成

Codex 根据 cheat-on-content 推荐让用户确认选题，通过 `create_content_experiment` writeback 创建实验，再锁定预测、提交并审核 generation draft、请求生成、检查资产。

验收：

1. `create_content_experiment` 必须走 writeback draft，不允许直接调用底层 create experiment 绕过审核链。
2. `generation_requested.payload.text` 必须等于用户批准的 draft text。
3. `standard` pipeline 的 generation params 必须进入 fixed mode。
4. `asset_checked.checks.storyboard_text_matches_draft` 必须为 true，才允许进入 `record_publish`。
5. `current_view.content_item` 必须指向最新通过检查的 content item，旧失败资产不能污染当前状态。

### 场景 G：重复 apply

同一个 draft 被重复 apply。

验收：

1. 返回 `already_applied`。
2. 不重复写事件。
3. 审计记录可追踪。

### 场景 H：schema mismatch

workspace 的 `.cheat-state.json` schema 低于当前支持版本。

验收：

1. summary 返回 `workspace_schema_mismatch`。
2. UI 提示回 Codex 跑 migrate。
3. 不自动修改 workspace。

## 15. 测试计划

1. Unit：workspace path 校验。
2. Unit：CheatWorkspaceSummary parser。
3. Unit：source hash 计算。
4. Unit：writeback draft validate。
5. Unit：duplicate apply 幂等。
6. Unit：prediction after publish 被拒。
7. Unit：metrics without publish 被拒。
8. Unit：retro without metrics 被拒。
9. Unit：memory without retro/observation 被拒。
10. API：summary 不暴露敏感内容。
11. Plugin：capabilities 包含 P2 routes。
12. Smoke：从 context export 到 draft apply 的最小链路。
13. Smoke：`scripts/p2_cheat_main_path_smoke.py` 覆盖 cheat 推荐到生成 asset check 的主路径。
14. UI：workspace 未绑定、valid、schema mismatch、source changed、pending draft、conflict。
15. Regression：P1 Ops UI、Projects、Settings 仍可用。

## 16. 完成定义

P2 完成时，用户应该能：

1. 为 Pixelle 项目绑定一个 cheat workspace。
2. 在 UI 看到 cheat workspace 的健康和摘要。
3. 在 Codex 里读取 Pixelle + cheat 联合上下文。
4. 让 cheat 输出通过 writeback draft 进入 Pixelle。
5. 在 Pixelle UI 看到已 apply 的事实、来源和一致性状态。
6. 在 source 文件变化时看到显式 stale/conflict，而不是被自动覆盖。
7. 从 retro 同步 ProjectMemoryEvent，不把 memory 后移成未来阶段。

P2 不以 UI 页面数量为完成标准。P2 的核心验收是：`cheat-on-content` 能作为运营脑接入 Pixelle，但 Pixelle 产品事实仍稳定、可审计、不可被文件系统自动污染。
