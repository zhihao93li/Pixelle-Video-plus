# PRD · 配方详情页与容器清扫（交 Opus 实施）

> 执行对象：实施模型。产品决策与 mockup 已经用户批准（2026-07-07）；实现遵循本文与 `apps/production-template-demo/DESIGN.md`（尤其 §2.5 容器选型，违反任何禁令 = 审核不通过）。
> 参照实现：`ContentItemDetailPage.tsx` 与 `ProjectDetailPage.tsx`（同一"左工作区 + 右信息栏"页面骨架，头部返回、hash 路由）。

## 1. 背景

`shared/PipelinePartsSheet.tsx`（产线零件抽屉）经历三轮膨胀：只读清单 → 就地编辑 → 「更多可调参数」兜底区，现为两个分区 + 十几个可编辑参数的分钟级工作面，违反 DESIGN.md §2.5（>2 分区或大量输入必须页面）。同时设置页 `TemplateStatusPanel` 内还有旧的 `GenerationConfigEditor`（key-value 折叠表格），与产线编辑功能完全重复——同一参数有两个编辑入口。

**全站容器审计结论**（本 PRD 只处理违规项，观察项见 §7）：

| 弹层 | 判定 | 处置 |
| --- | --- | --- |
| PipelinePartsSheet | 违规（多分区+大量输入） | → 配方详情页（WP-1），组件删除 |
| GenerationConfigEditor（设置页折叠编辑器） | 功能重复 | 删除（WP-2） |
| 出片 Sheet ×2、PromptPeekSheet、新建项目、TemplateCloneSheet、各 AlertDialog | 合规 | 不动 |
| 发布 Sheet、AddContentDialog、生成页换模板 Sheet | 边界观察 | 本期不动（§7） |

## 2. 目标与非目标

**目标（验收口径）**

1. 全站点「看产线」进入的是**页面**（`/create/recipes/:id`），就地换零件的全部能力无损平移；「更多可调参数」两列排布。
2. 每个模板参数**只有一个编辑入口**（配方详情页）；设置页模板面板只做库存管理（启用/停用/克隆/退役分组）。
3. 克隆闭环：配方详情页「克隆为新配方」→ 起名 → 直接落到新配方的详情页。
4. `npm run typecheck && npm run lint && npm run test:p1` 全绿；交付前 `npm run build`。本 PRD 纯前端，不改后端。

**非目标**

- 不动出片 Sheet、PromptPeekSheet、发布 Sheet 等合规/观察弹层。
- 不动后端 API（页面全部复用现有 `getTemplateGenerationConfig` / `updateTemplateGenerationConfig` / `cloneProductionTemplate`）。
- 不做成品示例缩略图（页面留出右栏「成品」卡位置即可，backlog）。

## 3. WP-1 · 配方详情页 `/create/recipes/:id`

新组件 `components/RecipeDetailPage.tsx`，页面骨架照抄 `ProjectDetailPage.tsx`（`max-w-[1240px]`、`grid lg:grid-cols-[minmax(0,1fr)_280px]`、BackRow 返回 `/create`）。

**数据**：按 id 从 `listTemplates()` 找模板（找不到给 InlineError「配方不存在，可能已停用或删除」）；`getTemplateGenerationConfig(id)` 拿 `overridable_keys / effective_params / overrides`。加载与保存逻辑**整体平移** `PipelinePartsSheet.tsx`（load effect——注意保留"isLoading 不能进依赖"的注释与写法、`startEdit` / `savePart` / `renderEditor`、`PART_EDIT_OPTIONS/HINTS/NUMBER_KEYS`、extraKeys 兜底计算）。

**头部**：← 快速生产 | 模板名 | 产线 chip（`pipelineChipLabel`）| 右侧主按钮「开始制作」（`navigate(templateRoute)`——路由函数在 CreateGallery 里，抽到 `lib/templatePresentation.ts` 共享）。

**左列两个区块**：

1. 「产线」：步骤行（序号 + 步骤名 + 当前值 + 已自定义徽标），可换 →「更换」就地展开编辑器；写稿步骤 →「在项目里改」（跳 `settingsLink({kind:"projects"})`）；固定步骤 → 锁徽标。交互与 Sheet 版完全一致。
2. 「更多可调参数」：`grid gap-2 sm:grid-cols-2` 两列；行样式同产线步骤（标签用 `PART_KEY_LABELS`）；编辑器展开时该行占满整行（`sm:col-span-2`）。

**右栏三张卡**：

1. 「配方」：产线名 · 出厂骨架/我的配方（`is_custom`）· 已自定义 N 项（`Object.keys(overrides).length`）· 若为某项目默认则列项目名（`listProjects()` 比对 `default_production_template_id`，多项目引用都列出）。
2. 「成品」：`template.description`。
3. 「操作」：「克隆为新配方」（展开名称输入 → `cloneProductionTemplate({sourceTemplateId, id: \`my_${pipeline_id}_${Date.now().toString(36)}\`, displayName})` → toast → `navigate(\`/create/recipes/${created.id}\`)`）；「在设置里管理」（`settingsLink({kind:"template", id})`）。

**路由**：`App.tsx` 加 `segments[0]==="create" && segments[1]==="recipes" && segments[2]` → `<RecipeDetailPage key={segments[2]} templateId={segments[2]} />`，title「配方详情」。

## 4. WP-2 · 退役与清理

1. 删除 `shared/PipelinePartsSheet.tsx`；所有引用点改跳转（WP-3）。
2. 删除 `TemplateStatusPanel.tsx` 里的 `GenerationConfigEditor`（函数 + 挂载 + 相关常量 `CONFIG_KEY_LABELS/NUMBER_KEYS` 若无他用一并删）；模板卡片上加一个「调参数」链接 → `/create/recipes/:id`（仅 enabled 模板显示）。
3. `TemplateStatusPanel` 其余保留：启用/停用 Switch、克隆 Sheet、已退役分组、管线 chip。

## 5. WP-3 · 入口重定向（全部改为跳配方详情页）

| 现有入口 | 现行为 | 改为 |
| --- | --- | --- |
| CreateGallery 卡片「看产线」 | 开 Sheet | `navigate(\`/create/recipes/${id}\`)` |
| CreateGallery「+ 新建配方」创建成功 | 弹 Sheet（justCreated） | 直接 `navigate` 到新配方详情页（justCreated 状态与 Sheet 渲染删除） |
| ProjectDetailPage 右栏「看这套配方的产线」 | 开 Sheet | `navigate` 到详情页（partsOpen 状态与 Sheet 渲染删除） |
| ProductionSubmitPanel「调整默认 → 设置」 | 深链设置页模板卡 | `navigate(\`/create/recipes/${templateId}\`)`，按钮文案改「调整默认配方」 |
| SourceChip `to=settingsLink({kind:"template",…})` 的调用点 | 深链设置页 | 改传 `/create/recipes/:id`（SourceChip 本身不动，只改调用方传的 to） |

`settingsLink` 的 `template` kind **保留**（「在设置里管理」与模板面板锚点仍用），不要删。

## 6. WP-4 · 文档同步

`docs/zh/product/architecture-map.md` 已过时处更新：§2 词典「在哪改」列（起草配置→项目详情页；模板默认配置→配方详情页「看产线/更换零件」；生产模板→设置页模板 tab 仅库存管理）；§3 旅程第 3/4 步"抽屉"字样→"内容详情页"；§5 P0 命名与陈列标记已完成（快速生产页 v3 按产线分区，非"我有 X"三组）；§6 速查表对应行更新。**只改事实陈述，不重写结构。**

## 7. 观察项（本期明确不做，遇到再议）

- **发布 Sheet**（HistoryWorkspace，~6 输入）：边界超标但需参照选中作品上下文；待图文发布落地时随发布改版一并升级为页面。
- **AddContentDialog**（三 tab 入料）：不需要背景上下文，理论上居中 Dialog 更合适；低价值，不动。
- **ProductionStudio「选择生成模板」Sheet**：点选即换，合规；与快速生产页选卡存在概念重叠，待生成页下一轮改版再议。
- 「更多可调参数」中 `frame_template` 做成 Select（画面模板有列表接口）：可选增强，做不做都不算失败。

## 8. 全局守则

同 `prd-content-workbench.md` 第 10 节全部条款。补充：

1. DESIGN.md §2.5 四禁令强制；本 PRD 完成后全站弹层清单 = 出片确认×2、PromptPeekSheet、新建项目、克隆模板、发布 Sheet、AddContentDialog、生成页换模板、各 AlertDialog——**不得新增**。
2. 平移 PipelinePartsSheet 逻辑时保留两条历史教训注释：load effect 的 isLoading 依赖坑；判空 `||` 禁 `??`。
3. 每个 WP 完成跑前端三件套；交付前 `npm run build`。文案守则照旧（不出现内部 key，禁用 window.confirm）。
