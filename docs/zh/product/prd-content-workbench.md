# PRD · Pixelle 内容工作台（ContentItem 看板）与收尾项

日期：2026-07-05
读者：**实施本 PRD 的工程执行者（可能是能力较弱的模型）**。本文自包含：不需要读聊天记录，但实施前必须通读第 1-3 章。设计依据见 `docs/zh/product/target-architecture-and-journeys.md` 与 `product-definition-and-unification-spec.md`（只作背景，冲突时以本 PRD 为准）。

---

## 1. 背景速览（必读）

Pixelle-Video-plus 是单运营者的 AI 短视频内容工厂：选题 → 文案 → 出片 → 发布（Buffer）→ 数据。技术栈：FastAPI 后端（`api/`，业务在 `pixelle_video/`）+ React 控制台（`apps/production-template-demo`，Vite + TS + Tailwind v4 + shadcn 风格组件）。

**已完成且不可破坏的架构不变量**：

1. **所有出片必须经过生产模板编译**：`pixelle_video/generation/templates.py` 的 `registry.compile_request(template_id, input=...)`。禁止任何新代码手工构造 `GenerationRequest(pipeline_id=..., ...)`。
2. **三层配置**：设置管接入（`/api/settings/*`）；模板管默认（`data/production-template-overrides.json`，经 `template_overrides.py` 合并进 fixed_params）；表单管这一次（提交时放进 input 的白名单参数）。
3. **前端唯一生产配置 UI** 是 `src/components/shared/ProductionSubmitPanel.tsx`。任何"选模板出片"的界面必须复用它，禁止新建参数表单。
4. **workflow/provider 级字段只在专家模式渲染**（`src/lib/expertMode.ts` 的 `useExpertMode()`）。
5. 前端规范见 `apps/production-template-demo/DESIGN.md`——新代码必须遵循（组件选用表、文案禁用词、toast/InlineError 分工、AlertDialog 确认等）。

**本 PRD 的目标**：在上述地基上，把产品从"工具形"升级为"内容流水线工作台"——新增一等公民实体 ContentItem（内容条目）及其看板首页，并完成三个收尾项。

## 2. 已定设计决策（不重开讨论）

| 决策 | 内容 |
| --- | --- |
| D1 | 首页为看板（六列：选题池/草稿/待确认/生产中/待发布/已发布），不是列表 |
| D2 | 多语言是条目的**变体**维度，不是多个条目 |
| D3 | 生产/发布动作由**前端编排**调用现有 API，再回写条目状态；不在后端做事件驱动重构 |
| D4 | 数据回填首期 = 手动录入 + 预留字段；不做平台爬取 |
| D5 | 现有页面（新建视频/任务/作品库/设置）**全部保留**，看板是新增入口；导航新增「工作台」为第一项 |
| D6 | 存储沿用现有模式：`data/` 下 JSON 文件（参照 `data/generation-batches/`、`data/script-review-drafts/` 的做法），不引入数据库 |
| D7 | 自动化档位（M5）本期**不做**，但数据结构预留 `automation` 字段 |

## 3. 代码地图（实施时的定位手册）

后端：
- 路由：`api/routers/*.py`，在 `api/app.py` 注册（新增 router 照抄现有注册方式）
- 模板体系：`pixelle_video/generation/templates.py`（注册表）、`template_overrides.py`（默认覆盖）
- 生成任务 API：`api/routers/generation.py`（`/generation/templates/{id}/tasks`、`/generation/batches`、task 查询）
- 历史/发布：`api/routers/history.py`、`publish.py`
- 数据目录工具：`pixelle_video/utils/os_util.py` 的 `get_data_path(*paths)`
- 测试：`tests/*.py`，风格参照 `tests/generation_api_test.py`（TestClient + dependency_overrides + tmp_path 隔离目录）

前端（`apps/production-template-demo/src/`）：
- 路由：`lib/router.ts`（hash 路由，`usePath`/`navigate`/`parsePath`），页面在 `App.tsx` 按 segments 分发
- 布局：`components/AppShell.tsx`（侧边导航 NAV_ITEMS 数组）
- 任务轮询：`lib/taskCenter.tsx`（全局，`trackTask/updateTask/getTask`）
- API client：`lib/generationApi.ts`（`fetchJson` 模式，所有新 API 在此加函数与类型）
- 共享组件：`components/shared/`（ProductionSubmitPanel、AdvancedGroup、FileDropzone、feedback.tsx 的 InlineError/Fact/StatusBadge/TechDetails）
- UI 基件：`components/ui/`（button/card/select/sheet/tabs/toast/alert-dialog/slider/toggle-group…）
- 验证命令（前端，必须全绿才算完成）：`npm run typecheck && npm run lint && npm run test:p1`；交付前跑 `npm run build`
- 验证命令（后端）：`uv run pytest tests/ -q`

## 4. 工作包总览与顺序

| WP | 内容 | 优先级 | 依赖 |
| --- | --- | --- | --- |
| WP0 | 收尾三件：模板克隆 API+UI、确认稿二次出片、Gallery/模板文案重述 | P1 | 无 |
| WP1 | ContentItem 后端（实体+存储+API+existing 数据导入） | P0 | 无 |
| WP2 | 工作台看板（只读）+ 条目抽屉（只读） | P0 | WP1 |
| WP3 | 看板可操作（添加内容/审核确认/多选出片/状态回写） | P0 | WP2 |
| WP4 | 发布排期列 + 手动数据录入 + 衍生选题 | P1 | WP3 |

按顺序实施；每个 WP 结束跑全部验证命令并提交一次。

---

## 5. WP0 · 收尾三件

### WP0-A 模板克隆（自定义生产模板 CRUD）

**需求**：运营者在不改代码的情况下，从现有模板克隆出一条新风格线。

后端：
1. 新文件 `pixelle_video/generation/custom_templates.py`：
   - 存储：`data/production-templates-custom.json`，结构 `{template_id: ProductionTemplate 字段的 dict}`
   - `load_custom_templates() -> list[ProductionTemplate]`：读文件，逐个 `ProductionTemplate(**data)`，解析失败的条目跳过
   - `save_custom_template(template: ProductionTemplate)`、`delete_custom_template(template_id)`（写文件用临时文件 + `os.replace`，加 `threading.Lock`，照抄 `template_overrides.py` 的做法）
2. `templates.py` 的 `build_default_production_template_registry()`：builtin 列表后追加 custom 模板（id 冲突时 custom 覆盖无效、跳过并保留 builtin），再应用 overrides。
3. `api/routers/generation.py` 新端点：
   - `POST /generation/templates`：body `{source_template_id, id, display_name, description?, fixed_params_patch?}`。逻辑：取 source 模板 → 深拷贝 → 覆写 id/display_name/description → `fixed_params.update(fixed_params_patch)`（patch 的 key 必须 ∈ source.allowed_user_params，否则 400）→ 校验 id 唯一（400）→ save。返回完整模板。
   - `DELETE /generation/templates/{id}`：仅允许删 custom（builtin 返回 400）。
4. 测试 `tests/custom_templates_test.py`：克隆成功出现在 `GET /generation/templates`；fixed_params_patch 生效；非法 patch key 400；id 冲突 400；删除 builtin 400；克隆的模板能被 `compile_request` 编译。

前端：
1. `lib/generationApi.ts` 加 `cloneProductionTemplate(input)`、`deleteProductionTemplate(id)`。
2. `components/TemplateStatusPanel.tsx`：专家模式下每张模板卡加「克隆」按钮 → 弹 Sheet：新 id（自动建议 `{source}_copy`）、名称、描述 → 提交 → toast + 刷新列表；custom 模板卡显示「自定义」Badge 和「删除」（AlertDialog 确认）。

**验收**：克隆一个 daily 模板改名保存 → 出现在 Gallery、批量/审核的 ProductionSubmitPanel 兼容列表、模板状态页；对它配置默认覆盖并出片，参数生效；删除后从所有列表消失。

### WP0-B 确认稿二次出片

**需求**：已提交过的审核稿（draft set）可以换模板再次出片，不重新生成草稿。

前端（无后端改动，R1 已支持重复提交）：
1. `components/ScriptReviewWorkspace.tsx`「最近审核草稿」列表中，status 为 `submitted` 的条目加按钮「再次出片」：`setDraftSet(item); setStep(3)`。
2. 第三步顶部当 `draftSet.status === "submitted"` 时显示 InlineNotice：「这批确认稿已出过 N 次片（读 submissions 长度），可换模板再次提交」。

**验收**：选择历史 draft set → 直接到第 3 步 → 换 static 模板提交成功 → 新 batch 进任务中心。

### WP0-C 文案重述

1. 后端 `templates.py`：`pixelle_script_review_v1` 的 `display_name` 改为「多语言审核出片」，description 改为「AI 起草多语言文案，人工审核后批量出片」。`pixelle_batch_production_v1` 的 display_name 改为「批量生产」。所有模板 display_name 去掉「 v1」后缀（version 字段保留）。
2. 同步更新 `tests/` 中断言这些 display_name 的用例。
3. 前端 `CreateGallery.tsx` 分组描述核对（已是"内容从哪来"口径，不需大改）。

---

## 6. WP1 · ContentItem 后端

### 6.1 数据模型

新文件 `pixelle_video/content/models.py`（新包 `pixelle_video/content/`，含 `__init__.py`）：

```python
STATUSES = ["idea", "drafting", "draft_ready", "pending_review", "confirmed",
            "producing", "produced", "scheduled", "published", "measured", "archived"]

class ContentVariant(BaseModel):
    language: str
    status: Literal["pending", "confirmed", "rejected"] = "pending"
    title: str = ""
    script: str = ""
    narrations: list[str] = []

class ContentEvent(BaseModel):
    type: str          # created / status_changed / draft_generated / confirmed / produced / scheduled / published / metrics_recorded / note
    actor: str         # "user" | "agent" | "system"
    at: str            # ISO 时间
    detail: dict = {}

class ContentItem(BaseModel):
    item_id: str                    # uuid4().hex
    project: str = "PetWoods"
    channel: str = "xiaohongshu"
    title: str                      # 选题/标题
    kind: Literal["text", "asset"] = "text"
    source: Literal["manual", "agent", "derived"] = "manual"
    status: str = "idea"            # ∈ STATUSES
    languages: list[str] = ["Chinese"]
    variants: dict[str, ContentVariant] = {}
    asset_paths: list[str] = []
    links: dict = {}                # {"draft_set_id": str|None, "task_ids": [str], "batch_ids": [str], "publish_record_ids": [str]}
    metrics: dict = {}              # {"likes": int, "favorites": int, "comments": int, "note": str, "recorded_at": str}
    automation: dict = {}           # 预留，本期不用
    events: list[ContentEvent] = []
    created_at: str
    updated_at: str
```

**状态迁移合法表**（存为模块常量 `ALLOWED_TRANSITIONS: dict[str, list[str]]`）：
idea→[drafting, confirmed, archived]；drafting→[draft_ready, idea]；draft_ready→[pending_review, confirmed, archived]；pending_review→[confirmed, draft_ready, archived]；confirmed→[producing, archived]；producing→[produced, confirmed]（失败回 confirmed）；produced→[scheduled, producing, archived]（可重出）；scheduled→[published, produced]；published→[measured, archived]；measured→[archived]；archived→[idea]（复活）。非法迁移返回 400。

### 6.2 存储

新文件 `pixelle_video/content/store.py`：每个条目一个文件 `data/content-items/{item_id}.json`；`list_items(status=None, limit=200)`（按 updated_at 倒序）、`load_item`、`save_item`（tmp+replace）、`delete_item`。目录不存在时自动创建。

### 6.3 API

新文件 `api/routers/content_items.py`，prefix `/content-items`，在 `api/app.py` 注册：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/content-items?status=&limit=` | 列表（status 可省略=全部，多值逗号分隔） |
| POST | `/content-items` | body `{titles: [str], kind?, languages?, source?, initial_status?}`；批量建卡，一行一条；`initial_status` 仅允许 idea/confirmed（现成文案场景）；返回创建的条目列表 |
| GET | `/content-items/{id}` | 单条 |
| PATCH | `/content-items/{id}` | 部分更新：title/variants/languages/asset_paths/metrics/links（浅合并 links 与 metrics；写 event `type=note` 或对应类型） |
| POST | `/content-items/{id}/transition` | body `{to: str, actor?: "user", detail?: {}}`；校验合法表；写 status + event；返回条目 |
| DELETE | `/content-items/{id}` | 物理删除（前端用 AlertDialog 确认） |
| POST | `/content-items/import-existing` | 见 6.4 |

### 6.4 存量数据导入（幂等）

`POST /content-items/import-existing`：扫描并为没有对应条目的存量数据建卡（幂等：用 links 里的 id 去重，重复调用不产生新条目）：
- `data/script-review-drafts/*.json` → 每个 draft set 的每个 draft（topic）建一条 kind=text 的条目；有 submissions 的 status=produced，否则 pending_review；variants 从 language_drafts 映射；links.draft_set_id 记录。
- 历史任务（用 `api/routers/history.py` 现成的列表函数）→ 每个 completed 任务若其 metadata 无 draft_set 关联且标题不重复 → 建 status=produced 条目，links.task_ids=[task_id]；有发布记录的 → published。
返回 `{created: n, skipped: n}`。

### 6.5 测试

`tests/content_items_test.py`：CRUD 全链路；非法迁移 400；合法迁移写入 event（actor/at/detail）；批量创建 initial_status=confirmed；import-existing 幂等（跑两次 created=0）。存储目录用 tmp_path 隔离（模块级目录变量照 `GENERATION_BATCH_DIR` 的可覆盖模式实现）。

---

## 7. WP2 · 工作台（只读）

前端新页面，不改任何现有页面。

1. `lib/generationApi.ts`：加 ContentItem 类型与 `listContentItems/getContentItem/createContentItems/patchContentItem/transitionContentItem/importExistingContentItems` 函数。
2. 新组件 `components/WorkbenchBoard.tsx`：
   - 路由 `/board`（`App.tsx` 加分支，标题「工作台」）；`AppShell.tsx` NAV_ITEMS **首位**加 `{path:"/board", label:"工作台", icon: LayoutKanban}`（lucide 的 `LayoutKanban`，若无则 `Columns3`）。
   - 六列布局：`grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2`。列定义（列名→包含的 status）：选题池=[idea]；草稿=[drafting, draft_ready]；待确认=[pending_review]；生产中=[producing]；待发布=[produced, scheduled]；已发布=[published, measured]。archived 不显示。
   - 每列头：列名 + 数量。卡片：title、语言变体徽章（每语言一个小 Badge，confirmed 绿 `variant="secondary"`、pending 黄 `variant="outline"`）、source 为 agent 时显示 agent 图标（lucide `Bot`）+「agent」小字、更新时间（`formatDate`）。
   - 生产中列的卡片：若 links.task_ids 里有任务在 `taskCenter` 中，显示其进度条（复用 `ui/progress`）与失败红标（StatusBadge）。
   - 数据加载：进页 `listContentItems()`；顶部「导入存量」按钮（仅当列表为空时显示）调 import-existing 后刷新。
   - 30 秒轮询刷新列表（`setInterval`，卸载清理）。
3. 新组件 `components/ContentItemDrawer.tsx`（Sheet，从右侧滑出，点卡片打开）只读版：
   - 头部：title + StatusBadge + source 标记。
   - 语言变体区：每语言一块（title/script 摘要 + 变体状态徽章）。
   - 产物区：links.task_ids 对应任务的成片（用 history detail API 或 task result API 取 video url，找不到就显示占位图标）；每个产物标注生产模板名（task metadata.production_template.name）。
   - 发布区：links.publish_record_ids 非空时列出。
   - 事件区：events 倒序，`{actor 图标} {type 中文} · {formatDate(at)}`。type 中文映射表放组件内常量。
   - 底部 TechDetails：item_id、draft_set_id、task_ids。

**验收**：跑 import-existing 后，看板各列出现历史数据卡片；点卡开抽屉能看到变体/产物/事件；typecheck/lint 全绿。

## 8. WP3 · 看板可操作

1. **添加内容**（`components/AddContentDialog.tsx`，看板头部主按钮触发，Sheet 或 AlertDialog 样式弹层）：
   - 三个 tab（ui/tabs）：选题（textarea 一行一条 → `createContentItems({titles, initial_status:"idea"})`）；现成文案（textarea `---` 分块，第一行标题 → 建条目 initial_status=confirmed，且写入 variants[主语言].script）；素材（FileDropzone → 先 `uploadGenerationAssets` → 建 kind=asset 条目，asset_paths 填上传路径）。
   - 语言 chips（复用 ScriptReviewWorkspace 的 PRESET_LANGUAGES 模式；把该常量提到 `lib/languages.ts` 供两处共用）。
   - 底部按钮：「仅入池」；选题 tab 额外有「入池并生成草稿」→ 创建后对每条调用现有 `createScriptReviewDraftSet`（topics=该批，languages=所选）→ 成功后逐条 transition 到 drafting，并 PATCH links.draft_set_id；draft set 生成完成后（该 API 是同步的）transition 到 pending_review。
2. **审核确认**（ContentItemDrawer 升级）：
   - pending_review 状态：变体块内 script/narrations 可编辑（Textarea，参照 ScriptReview DraftEditor 的字段），「确认」/「打回」按钮：确认=PATCH variants[lang].status=confirmed；全部勾选语言 confirmed 后底部主按钮「确认条目」→ transition confirmed。打回=variants 状态 rejected + transition draft_ready。
   - 若 links.draft_set_id 存在，编辑需同步保存回 draft set（调现有 `updateScriptReviewDraftSet`），保持两边一致。
3. **多选出片**：
   - 列内卡片支持多选（checkbox，hover 显示）；选中 ≥1 条 confirmed/produced 条目时底部浮出操作条（sticky bottom bar）：「出片」。
   - 点「出片」→ Sheet 内嵌 `ProductionSubmitPanel`（requiredInput：全部 kind=text 且有 script → "script"；否则若来源是 topic 且无确认稿 → "topic"）+ 数量预告 + 确认按钮。
   - 提交：走现有 `createGenerationBatch({templateId, items})`——text 条目 item.input={script: 主语言确认稿 script, title}；多语言条目每个 confirmed 语言一个 batch item。成功后：每条目 transition producing、PATCH links.task_ids/batch_ids；任务注册进 taskCenter（复用 BatchWorkspace 的 trackBatchTasks 模式，抽成 `lib/trackBatch.ts` 共用函数）。
   - **生产完成回写**：在 `lib/taskCenter.tsx` 的 `notifyIfTerminal` 处加钩子：任务 completed 且能通过 `listContentItems` 匹配 links.task_ids 时…（实现太重）。改为简单方案：WorkbenchBoard 的 30s 轮询中，对 producing 状态条目检查其 task_ids 在 taskCenter/任务 API 中的状态，全部 completed → transition produced（actor="system"），有 failed → 卡片红标（不自动回退状态）。
4. **发布衔接**：produced 条目抽屉加「去发布」按钮 → `navigate("/library?task="+首个completed task_id)`（复用现有发布 Sheet）。发布完成的回写：本期手动——抽屉里「标记已发布」按钮 → transition scheduled→published 或 produced→scheduled→published（提供两个按钮：「已排期」「已发布」）。

**验收（端到端脚本）**：添加 3 个选题（入池并生成草稿）→ 待确认列出现 3 卡 → 抽屉逐个确认 → 多选 3 卡出片（选 static 模板）→ 生产中列显示进度 → 完成后自动到待发布 → 「去发布」跳作品库发布 → 回看板「标记已发布」→ 已发布列 +3。全程 typecheck/lint/test 全绿。

## 9. WP4 · 排期视图与数据录入（P1）

1. 「待发布」列按钮「按节奏排期」：对列内所有 produced 条目按项目发布节奏（本期常量：每天 09:00，Asia/Shanghai）依次生成建议时间，逐条打开现有发布 Sheet 预填 scheduled 时间（不自动提交，人工确认每条）。
2. 已发布条目抽屉加「录入数据」：likes/favorites/comments 三个数字 + 备注 → PATCH metrics + transition measured。卡片上有 metrics 时显示 `赞 {likes}`。
3. 「衍生选题」：measured/published 条目抽屉按钮 → 弹输入框（默认 `{title} 的后续`）→ `createContentItems({titles:[...], source:"derived"})` → toast「已入选题池」。

**验收**：录入数据后卡片显示赞数；衍生选题出现在选题池且 source 标记 derived。

## 10. 全局守则（执行者必须遵守）

1. 每个 WP 完成后运行并保证全绿：后端 `uv run pytest tests/ -q`；前端 `npm run typecheck && npm run lint && npm run test:p1`；最后 `npm run build`。
2. 禁止：绕过 `compile_request` 出片；在非专家模式渲染 workflow 字段；新建与 ProductionSubmitPanel 重复的参数表单；使用 `window.confirm`/`alert`；硬编码颜色（用 Tailwind 语义类）；在面向用户文案中出现 pipeline/provider/workflow/task_id 字样（技术信息进 TechDetails）。
3. 复用优先：InlineError/StatusBadge/Fact/TechDetails/AdvancedGroup/FileDropzone/toast/AlertDialog/Sheet/Select/Slider/ToggleGroup 都已存在，先找后造。
4. 所有新 API 函数与类型集中加在 `lib/generationApi.ts`；错误统一 `readableError`（`lib/format.ts`）。
5. 后端新文件遵循现有模式：pydantic BaseModel、`get_data_path` 存储、tmp+`os.replace` 写文件、测试用 tmp_path 隔离。
6. 不修改：`lib/router.ts`、`lib/taskCenter.tsx` 核心逻辑（WP3 的回写用轮询方案，不改 taskCenter）、已有测试的语义（只允许因文案改名而更新断言）。
7. 提交粒度：每个 WP 一次提交，提交信息格式 `WP{n}: {一句话}`。

## 11. 开放项（遇到再问，不要自行发挥）

- WP3 出片时素材类条目（kind=asset）的 input 组装（video_title/intent/assets）——首期可以只支持 text 条目出片，asset 条目出片按钮置灰并提示「素材条目请从新建视频入口出片」。
- 发布记录 id 的自动回写（需要 publish API 返回后由作品库页回调）——首期用手动「标记已发布」代替，不要试图改 publish 流程。
- 看板拖拽换列——**不做**，状态迁移只通过按钮，避免拖拽引发非法迁移。
