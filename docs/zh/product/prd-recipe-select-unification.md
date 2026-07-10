# PRD · 生成页换配方去 Sheet 化：全站统一配方选择器（交实施模型执行）

> 执行对象：实施模型。方向已用户批准（2026-07-08，起因：生成页「更换模板」Sheet 被用户截图质疑）。
> 遵循既有守则：判空 default 字段用 `||` 禁 `??`；effect 依赖不放 isLoading/busy；面向用户文案禁止内部 key（use_case/input_requirements 生值都算）；产物形态判定一律走 `lib/artifactKind.ts`；产线 chip 走 `lib/templatePresentation.ts` 的 `pipelineChipLabel`。
> 验证：前端 `npm run typecheck && npm run lint && npm run test:p1`；本 PRD 纯前端 + 文档，后端零改动。

## 1. 背景

生成页（`/create/generate/:id`，ProductionStudio）的「更换模板」是白名单内的 Sheet（容器合法），但内容是快速生产页改版前的化石：`use_case` 内部 key 当徽标裸奔（`standard_base`/`topic_to_video`…）、「输入：script」生 key、退役 PetWoods 全员到场当「暂不可用」噪音、专用入口混列还要走跨页确认弹窗、文案"模板决定视频风格"停在视频时代。用户在快速生产页按产线选好配方，点一下「更换模板」就掉回平铺世界。

同时全站已有一套成熟的"在生产点选配方"模式：ProductionSubmitPanel 的 Select（形态徽标 + 只列本入口可用启用配方 + 来源 chip + 「调整默认配方」深链）。**本 PRD 把生成页的换配方收敛到同一套选择器，Sheet 退役，白名单 8 → 7。**

教训入规（本次一并写进 DESIGN.md）：容器审计只看"弹层在不在白名单"是不够的，**白名单弹层的内容同样受陈列与文案规范约束**——内部 key 禁裸奔、退役项不得出现在任何选择器。

## 2. 目标与非目标

**目标（验收口径）**

1. 生成页页头用下拉选择器换配方：只列启用、非退役、`product_entry === "generate"` 的配方，带形态徽标；选择即切换（URL 同步为 `/create/generate/{新id}`，已输入的文案保留——现状行为）。
2. 「更换模板」按钮、模板 Sheet、跨入口确认弹窗（pendingRouteTemplate AlertDialog）全部删除；无任何内部 key 或退役项出现在生成页。
3. 出片面板与生成页共用同一个选择器组件，未来改一处两处生效。
4. DESIGN.md §2.5 白名单「换模板」条目移除（8→7），并新增"白名单弹层内容规范"一条。

**非目标**

- 设置页模板库存管理（TemplateStatusPanel）的陈列——那是管理员视角的库存清单，允许显示停用/退役分组，不动。
- SpecialPipelinesWorkspace（直跑三管线模板固定，无换配方需求）。
- 配方搜索/分组下拉（配方数量到几十个再说，开放项）。

## 3. WP-A · 共享选择器组件

新建 `components/shared/RecipeSelect.tsx`：

- Props：`templates: ProductionTemplate[]`（调用方过滤好）、`value: string`、`onChange: (template: ProductionTemplate) => void`、可选 `triggerClassName`。
- SelectItem 渲染：`display_name · {artifactKindLabel(templateArtifactType(pipeline_id))}`——即出片面板现有样式（ProductionSubmitPanel 316-332 行），抽出来复用。
- ProductionSubmitPanel 的模板 Select 改用本组件（行为零变化：compatible 过滤、来源 chip、配方默认 chips 都留在面板里，组件只管"选"）。

## 4. WP-B · 生成页页头改造（ProductionStudio）

1. 页头（913-1037 行区域）重构：
   - 标题行 = `RecipeSelect`（当前配方为选中项）+ 产线·形态 chip（`pipelineChipLabel(pipeline_id)` + `artifactKindLabel(...)`，即批量 mockup 里的「图文线 · 图集」样式）+ 「预计 {estimated_turnaround}」Badge。
   - 描述行保留 `template.description`。
   - 加「调整默认配方」链接 → `/create/recipes/{id}`（与出片面板同款文案，就地配置动线闭环）。
2. 选择器数据源：`templates.filter(isActiveProductTemplate)`（lib/templatePresentation 现成谓词：enabled && !retired && product_entry === "generate"）。**不按 input_requirements 过滤**——生成页本就按模板形态自适应输入区（script/topic/assets 三分支 + 批量），切到不同入口形态就换表单，现状行为。
3. 切换逻辑：`onChange` = `setTemplate(next)` + `navigate(\`/create/generate/${next.id}\`)`（即现有 `selectTemplateOrRoute` 的 generate 分支）。**删除**：Sheet 及其 JSX、`isTemplateSheetOpen`、`pendingRouteTemplate` 状态 + 跨入口确认 AlertDialog、`selectTemplateOrRoute`/`applyTemplateRoute` 中不再可达的专用入口分支、`routeEntryLabel`（若无他处引用）。
4. 批量态切换配方：允许（批量文本保留，量词/措辞随新形态刷新）；若新配方不满足 canBatch（如切到素材入口），自动落回单条模式并保留 batchText 以免丢字。

## 5. WP-C · 文档同步

1. `apps/production-template-demo/DESIGN.md` §2.5：白名单删「换模板」（8→7，逐字数一遍剩余：出片×2、PromptPeekSheet、新建项目、克隆模板、发布、添加内容 + AlertDialog 豁免）；新增一条硬规则：**"白名单只豁免容器，不豁免内容——弹层/选择器内禁止内部 key（use_case、input_requirements 生值、pipeline_id）、禁止退役与停用项出现在可选项里。"**
2. `product-definition-and-unification-spec.md` §十 头部追加实施记录。

## 6. 开放项（遇到再问）

- 配方多到需要分组/搜索的下拉（按产线分组的 SelectGroup）。
- TemplateStatusPanel 的 use_case 徽标是否也该换成中文（管理员视角暂容忍，用户提出再改）。

## 7. 验收清单

- [ ] 生成页页头：下拉换配方（形态徽标），选图文配方 → 表单变图文形态、URL 变、已输入文案还在
- [ ] 下拉里无退役 PetWoods、无专用入口、无 `standard_base` 类内部 key
- [ ] 「更换模板」按钮与 Sheet 消失；跨入口确认弹窗消失；批量态切配方按 §4.4 行为
- [ ] 出片面板选择器外观行为零回归（共用组件后）
- [ ] DESIGN.md 白名单 7 条 + 内容规范新条目
- [ ] 前端三件套全绿；`npm run build` 留用户本地
