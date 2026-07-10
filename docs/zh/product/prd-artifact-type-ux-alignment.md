# PRD · 产物三态对齐：发布层与直跑输入层修复（交实施模型执行）

> 执行对象：实施模型。依据：`docs/zh/product/ux-walkthrough-2026-07-08.md`（只读走查报告，8 条问题的行号佐证都在里面，动手前先通读）。
> 遵循既有守则：DESIGN.md §2.5（容器四禁令、弹层白名单 8 类不得新增）；判空 default 字段用 `||` 禁 `??`；effect 依赖数组不放 isLoading/busy；数据到达初始化编辑态用渲染期 initKey 模式；面向用户文案不暴露内部 key。
> 验证：前端 `npm run typecheck && npm run lint && npm run test:p1`，后端 `py_compile` + 补测试；沙箱跑不了 pytest/vite build，这两项和真实出片留给用户本地。

## 1. 背景

走查结论一句话：三种产物形态（video / image_set / text）在「起草→确认→出片→轮询回写」四步已打通且行为一致，**断裂全部集中在「发布」和「快速生产直跑」两层——它们还是只有视频时代的老代码**。最严重的是 P0-1：图集/长文照常显示「去发布」，点了必然死在后端 `ValueError: Task has no result.video_path`。

八条问题同源，本 PRD 一个批次修完批次一（P0-1、P1-1~3、P2-1、P2-2），批次二（P2-3、P2-4）作为可选收尾。

## 2. 目标与非目标

**目标（验收口径）**

1. 图集/长文出片走到 produced 后，所有发布入口不再引向 Buffer 视频发布；给出正确的手动发布路径（下载图集 / 复制长文），且条目仍能正常流转到已发布、回填数据。
2. 直跑图文线/长文线的生成页与全站出片面板不再展示配音/画面/合成视频等视频专属控件与承诺文案。
3. 后端对非视频任务的自动发布请求返回可读 400，防 agent/深链绕过前端触发裸 ValueError。
4. 视频路径零回归。

**非目标**

- 图集/长文的平台自动发布（小红书图文 API / 公众号 API）——发布集成是 backlog 独立方向，本期仍是手动。
- ProductionStudio 的整体重构——只做形态分支收敛，不动它的三分支结构。
- 新增任何弹层。

## 3. WP-A · 公用判定抽取（先做，其余 WP 都吃它）

审核页已有 `isNonVideoTemplate`（pipeline_id ∈ {image_post, long_form}，grep 定位）。提取到共享模块（建议 `lib/artifactKind.ts`），提供两个纯函数：

- `templateArtifactType(pipelineId): "video" | "image_set" | "text"`（image_post→image_set，long_form→text，其余→video）
- `isNonVideoPipeline(pipelineId): boolean`

原审核页改为从 lib 导入。**所有新分支一律走这两个函数或 `GenerationResult.artifact_type`，禁止再散落 `pipeline_id === "image_post"` 字面比较。** 已有产物结果时优先读 `result.artifact_type`（真源）；只有模板未跑时才用 pipelineId 推断。

## 4. WP-B · 发布层（P0-1 + P1-3）

### 4.1 内容详情页发布区 `ContentItemDetailPage.tsx:746-788`

按产物形态分支（产物 result 的 artifact_type；多任务并存时以本条目最新任务为准，若三态并存则发布区按视频产物处理并保留手动路径提示）：

- **video**：现状不动。
- **image_set / text**：隐藏平台选择与「去发布」；替换为手动发布指引块——一句话（「图集/长文暂不支持自动发布，下载/复制后手动发布」）+ 直达产物区对应动作（ImageSetView 下载 / TextArticleView 复制，锚点滚动或按钮复用同一 handler）+ 「标记为已发布」按钮走既有 `transitionContentItem` 到 published（若详情页已有该手动跃迁入口则复用，勿做两个）。已发布后数据回填区行为不变。

### 4.2 作品库 `HistoryWorkspace.tsx`

- `canPublish`（354 行）补形态条件：非视频任务不亮「发布」按钮，列表/详情改为「下载/复制去发布」引导（复用产物区已有动作，不新增弹层）。
- 详情卡标题（733 行）按 artifact_type 三态：「视频详情 / 图文帖详情 / 长文详情」；描述文案（734-736）同步中性化。
- Facts（806-811 行）：「模式/分镜数/TTS/声音」仅 video 渲染；image_set 换「页数/语言」、text 换「字数/语言」（result 里已有对应字段，缺则不渲染该项，不显示「未返回」占位）。

### 4.3 后端兜底 `pixelle_video/services/publish_manager.py:140-142`

取 `video_path` 前先判产物形态（读 result 的 artifact_type，缺省按 video 兼容旧数据）：非视频 → 抛带可读 message 的业务异常（HTTP 400）「该任务产物为图集/长文，暂不支持自动发布，请下载后手动发布」。补一条单测（非视频任务 publish → 400 且 message 可读；视频路径回归不破）。

## 5. WP-C · 直跑输入层（P1-1 + P1-2 + P2-1）

### 5.1 `ProductionStudio.tsx`

读所选模板 pipeline_id，`isNonVideoPipeline` 为真时：

- 隐藏 TTS 引擎/音色/语速/试听区（1585-1740）、BGM、「视频标题」改「标题」（1165）。
- script 分支描述（560-566、621-633）三态化：长文「文案将扩写成结构化长文，不配音、不合成视频」；图文「文案将逐行排版成图集」；视频维持原文案。
- 结果区已按 artifact_type 分支（2059-2074），不动。

### 5.2 `ProductionSubmitPanel.tsx`

从 `selected` 模板读 pipeline_id，非视频时：

- 隐藏「默认效果预览」的预览画面/试听按钮（360-456）——顺带确认 238 行的 `frame_template ?? "1080x1920/image_default.html"` 兜底不再被非视频路径触达。
- 专家覆盖区（458-596）隐藏画面/BGM/TTS 项；长文若 `allowed_user_params` 含 word_count/llm_model 则保留这两项的覆盖输入，无则整区隐藏。
- 该面板被看板多选、详情页出片 Sheet、审核第三步共用——三处行为必须一致，改完在三个入口各验一遍。

### 5.3 路由标题 `App.tsx:46`

`/create/generate/:id` 标题「生成视频」改中性「生成」（该路由拿不到模板形态就不强行三态化，中性即可）。

## 6. WP-D · 文案（P2-2）

`TaskCenterWorkspace.tsx:69` 空状态「创建第一条视频后…」→「创建第一条内容后…」。

## 7. 批次二（可选，与上面无耦合，时间富余再做）

- **P2-3** `ProductionSubmitPanel.tsx:316-327`：模板选择器 SelectItem 加形态徽标（视频/图集/长文，用 templateArtifactType）。
- **P2-4** `TemplateStatusPanel.tsx:148-168`：克隆从 Sheet 降为居中 Dialog（§2.5 硬判据：<5 输入、无需参照背景），去掉手填「模板 ID」，改自动生成（对齐 CreateGallery `NewRecipeForm` 的 `my_${pipelineId}_${ts}` 模式）。注意：白名单里「克隆模板」条目形态从 Sheet 改 Dialog，需同步更新 DESIGN.md §2.5 白名单清单的表述，不新增条目。

## 8. 文档同步

- `product-definition-and-unification-spec.md`「## 十、实施记录」头部追加本批次条目（既有惯例：日期 + 改了什么 + 验证结果）。
- `ux-walkthrough-2026-07-08.md` 各问题条目标注处理状态（已修/批次二待做），不删原文。

## 9. 验收清单

- [ ] 图文帖/长文条目 produced 后：详情页与作品库均无 Buffer 发布入口，有下载/复制指引 + 可标记已发布并回填数据
- [ ] curl 直接对非视频任务调发布 API → 400 且 message 可读（不再是 ValueError 堆栈）
- [ ] 直跑图文线/长文线：生成页无 TTS/BGM/试听/「合成视频」承诺文案；出片面板（看板/详情/审核三入口）同样干净
- [ ] 视频全链路（出片→预览试听→发布）零回归
- [ ] 作品库图集/长文详情：标题与 Facts 按形态渲染，无「未返回」占位
- [ ] 前端三件套 + 后端单测全绿；`npm run build`、`uv run pytest tests/ -q`、真实出片一条图文+一篇长文并走完手动发布留用户本地验证
