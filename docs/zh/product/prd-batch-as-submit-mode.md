# PRD · 批量从独立入口改为生成页的提交模式（交实施模型执行）

> 执行对象：实施模型。方向与 mockup 已用户批准（2026-07-08）。
> 遵循既有守则：DESIGN.md §2.5（容器四禁令、弹层白名单 8 类不得新增——批量提交确认继续用 AlertDialog，属破坏性/额度确认豁免类）；判空 default 字段用 `||` 禁 `??`；effect 依赖数组不放 isLoading/busy；数据到达初始化编辑态用渲染期 initKey 模式；面向用户文案不出现 pipeline_id/enabled 等内部 key；产物形态判定一律走 `lib/artifactKind.ts`，禁止字面比较。
> 验证：前端 `npm run typecheck && npm run lint && npm run test:p1`，后端 py_compile + 更新受影响测试；沙箱跑不了 pytest/vite build，留用户本地。

## 1. 背景与定位

批量页（`/create/batch`，BatchWorkspace）是和产线陈列割裂的孤岛：用哪个配方的决策在快速生产页和批量页各做一遍；只吃 script 入口；文案与默认值停在视频时代；批次进度与单条重试被困在页内。而后端 `POST /api/.../batches` 早已模板无关（逐条 compile_request，白名单/优先级/幂等键全生效）——断裂只在前端交互层。

**核心重定义：批量不是一个入口，而是任何配方生成页的一种提交模式。** 净减一个页面、一个占位模板、一次重复决策；直跑线获得此前不存在的批量能力。

## 2. 目标与非目标

**目标（验收口径）**

1. 所有 script 入口配方（标准/HyperFrame 克隆/图文/长文）在 `/create/generate/:id` 页头可切「单条｜批量」，批量粘贴多条 → 每条一个任务，形态措辞正确（图文帖/长文/视频）。
2. 图生视频（i2v）支持批量：多图上传、共享参数、每图一条任务。
3. 提交后就地看到批次进度卡（含单条重试）；离开后可在任务页「批次」区找回任意近期批次。
4. 批量页与「批量生产」占位模板退役，`/batch`、`/create/batch` 重定向不 404。
5. 单条路径零回归。

**非目标**

- 素材线批量（素材+文案逐条配对，交互复杂度不同，需要时单独设计）。
- 动作迁移/数字人批量（多输入配对，见开放项）。
- topic 入口批量（选题批量的正路是工作台：入池起草→批量确认→出片，2026-07-06 已定，不重开）。
- 后端 batches API 改动（现状够用）。

## 3. WP-A · 共享件抽取（先做）

从 `BatchWorkspace.tsx` 抽到共享层，供 WP-B/C/D 复用：

1. `parseFixedScriptItems`、`getBatchPreviewTitle/Body` → `lib/batchInput.ts`（若已在 lib 则只挪用）。
2. `BatchStatusCard`（批次进度卡：状态行 + 单条重试 `retryGenerationBatchItem`）→ `components/shared/BatchStatusCard.tsx`。2 秒轮询逻辑一并抽出（hook `useBatchPolling(batchId)`：仅非终态轮询，**isLoading/batch 状态不得进依赖数组引发轮询取消**，参照 `lib/trackBatch.ts` 既有模式）。
3. 批次共用文案/徽标：形态徽标用 `artifactKindLabel(templateArtifactType(pipelineId))`；批次的 pipeline_id 由 template_id 经 `listTemplates` 映射，模板已删时徽标回落「产线」。

## 4. WP-B · 生成页批量模式（ProductionStudio）

### 4.1 切换

页头右侧（配方徽标同一行）加「单条｜批量」segmented 切换。显示条件：`template.product_entry === "generate"` 且 `input_requirements` 含 `"script"`。topic/assets 入口不显示。切换状态本页内存即可，不持久化。

### 4.2 批量态的输入区

替换 script 输入区为多条粘贴区（复用 WP-A 的解析 + 预览列表 + 逐条移除），其余高级设置组保持单条模式原样，其值作为共享参数 merge 进每条 input（与旧批量页 `{...item.input, ...overrides}` 语义一致）。形态措辞按 mockup：

- 视频/HyperFrame：「文案列表」，hint「用 --- 分隔多条；每条首行作标题。」
- 图文帖：「文案列表」，hint 追加「图文线按行分页，注意换行即分页」；预览行显示「N 字 · M 行」。
- 长文：「稿件列表」，hint「每篇会按配方的长文提示词扩写成结构化 markdown，换行不影响结果」；预览行显示「素材 N 字」；专家覆盖（word_count/llm_model）标注「应用到每一篇」。
- 单条模式的「标题」字段批量态隐藏（标题取每条首行）。

### 4.3 提交与就地进度

提交按钮文案 = 「批量生成 {N} {量词}{形态}」（3 条图文帖 / 3 篇长文 / 3 条视频；长文有 word_count 覆盖时追加「· 每篇约 {字数} 字」）。AlertDialog 确认（每条占一次生成额度）。提交走 `createGenerationBatch`（`templateId` = 当前配方，`metadata.source: "react_generate_batch"`, `mode: "fixed"`，projectId 沿当前项目）；成功后本页下方渲染共享 `BatchStatusCard`，任务并入任务中心（沿用 trackBatch）。

## 5. WP-C · 直跑 i2v 批量（SpecialPipelinesWorkspace）

i2v 模式加同款「单条｜批量」切换。批量态：多图上传（`uploadGenerationAssets` 本就支持多文件），缩略格逐张可移除；共享参数区 = 该模式现有单条表单（提示词等），hint「{N} 张图 → {N} 个任务，参数全同」。提交：每张图构造一条 item（`input.assets=[该图 path]`，其余共享），走 `createGenerationBatch`；成功后就地 `BatchStatusCard`。动作迁移/数字人不加切换（本期不做）。

## 6. WP-D · 任务中心「批次」区

TaskCenterWorkspace 顶部（现有任务列表之上）加「批次」区块：`listGenerationBatches` 渲染近期批次行——形态徽标 + 配方名 ×N + 汇总状态（全部完成 / x/N 完成 · y 失败）。行可展开为共享 `BatchStatusCard`（含单条重试）。仅对非终态批次轮询；空批次时区块整体不渲染（不加空状态噪音）。

## 7. WP-E · 退役

1. 删除 `BatchWorkspace.tsx`；`/batch`、`/create/batch` 路由重定向到 `/create`（App.tsx，保留一段时间防书签断链）。
2. 「批量生产」占位模板下线：后端 `templates.py` 该占位注册删除（或 enabled=False 且 retired，若测试断言存在性则取后者）；`templateRoute` 的 `product_entry === "batch"` 分支删除；CreateGallery「流程入口」列表条移除批量项（保留多语言审核出片项）。
3. 受影响测试同步：`production_templates_test.py` 等对占位模板/入口数量的断言、前端 `generationApi.test.ts` 若涉及。
4. grep 清理指向 `/create/batch` 的残链（HelpWorkspace 等）。

## 8. 文档同步

- `architecture-map.md`：概念词典「入口」行与 §3 旅程中的批量描述改为"生成页批量模式"；纠缠点 2（真假模板混列）标注批量占位已消灭。
- `product-definition-and-unification-spec.md`「## 十、实施记录」头部追加本批次条目。

## 9. 开放项（遇到再问，不要自行发挥）

- 动作迁移批量（共享参考视频 + 多图，每图一任务）——语义成立但输入配对交互待定。
- 素材线批量（manifest/文件夹式配对上传）。
- 批次列表的归档/清理策略（现在只增不减）。

## 10. 验收清单

- [ ] 图文配方生成页切批量：粘 3 条 → 预览 3 条（字数·行数）→ 提交按钮「批量生成 3 条图文帖」→ 3 个任务，就地批次卡可见、失败可单条重试
- [ ] 长文配方批量：稿件措辞、覆盖区「应用到每一篇」、按钮带每篇字数；产物为 3 篇长文
- [ ] 标准/HyperFrame 配方批量出 3 条视频，分镜按模板默认切（无回归）
- [ ] i2v 批量：4 张图 → 4 条任务，参数全同
- [ ] 任务页「批次」区能找回上述批次并重试失败条目
- [ ] `/batch`、`/create/batch` 重定向；快速生产页无批量占位；单条生成全链路零回归
- [ ] 前端三件套 + 后端受影响测试全绿；`npm run build`、`uv run pytest tests/ -q`、真实批量一次（图文 ×2）留用户本地
