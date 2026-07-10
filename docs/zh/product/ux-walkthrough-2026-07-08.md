# 控制台体验走查 · 2026-07-08

> 只读走查，未改任何代码。范围：六步内容旅程（添加选题→起草→确认→出片→轮询回写→发布）× 三种产物形态（video / image_set / text）。方法：先读架构总览、DESIGN §2.5、统一 spec 实施记录与图文/长文两条最新 PRD 建立基准，再逐格核对前端（apps/production-template-demo/src）与后端（pixelle_video、api、ops）落地代码，重点追产物形态分支完整性、断链、历史守则违规与容器规范。类型层面沙箱未跑 tsc（受限），问题均以源码行号佐证。

**问题总数：8 条。P0 × 1，P1 × 3，P2 × 4。**

核心结论一句话：三种产物形态在「起草→确认→出片→轮询回写」四步已经打通且共用同一提交管线，行为一致；**断裂全部集中在最后一步「发布」和「快速生产直跑」——这两处仍是当年只有视频时写的老代码，没跟上产物三态。**

---

## P0

### P0-1 · 图集/长文的「发布」误走视频发布路径，后端硬报错

> **处理状态（2026-07-08 已修）**：详情页发布区与作品库发布按钮按 artifact_type 分支，非视频改手动下载/复制指引；`publish_manager` 补非视频可读 400。

- **位置**：`pixelle_video/services/publish_manager.py:140-142`（根因）；`apps/production-template-demo/src/components/ContentItemDetailPage.tsx:746-788`（详情页发布区无分支）；`apps/production-template-demo/src/components/HistoryWorkspace.tsx:354-360, 740-744`（作品库发布按钮无分支）
- **旅程步骤 / 形态**：第 6 步发布 · image_set 与 text
- **现象**：一条内容用「小红书图文帖」或「长文」模板出片、走到 produced 后，内容详情页右栏「发布」区照常显示「去发布 / 已排期 / 已发布」（746-788 行完全没按 `artifact_type` 分支）。点「去发布」跳到 `/library?task=`，作品库对图集/长文同样亮出「发布」按钮（`canPublish` 只校验 completed + 平台 + caption，见 354 行，不看产物形态）。用户勾平台、填文案、提交后，后端 `publish_manager.publish_task` 在 140 行 `metadata["result"]["video_path"]` 取空 → 142 行抛 `ValueError: Task has no result.video_path`。而图集/长文的 result 里根本没有 `video_path`（`service.py:284/240` 只写 image_paths / article，`primary_video=None`）。
- **为什么是问题**：这正是这轮走查该抓的那类断链——"一稿三出"是长文/图文两条 PRD 的核心验收口径，可发布链路却对 3 种形态里的 2 种直接死在后端报错，且报错信息是内部字段名，用户完全无法理解。图集/长文的**设计发布路径本就是手动**（PRD 非目标：本期下载后手动发小红书），真发布入口是产物区 `ImageSetView`「下载图集去发布」/`TextArticleView`「复制长文去发布」。所以详情页右栏那个通用「发布」区对这两种形态是彻头彻尾的错误引导，把用户领进一条注定报错的死路。
- **建议修法**：详情页「发布」区与作品库「发布」按钮都按 `artifact_type` 分支——video 保持现状；image_set/text 隐藏 Buffer 发布，改为指向产物区的「下载/复制去发布」（或直接把下载动作提到发布区）。后端 `publish_task` 顺手对非视频任务给可读 400（"图集/长文暂不支持自动发布，请下载后手动发布"）兜底，防止 agent 或深链绕过前端触发裸 ValueError。
- **成本**：M（前端两处分支 + 后端一处兜底，半天）

---

## P1

### P1-1 · 快速生产直跑「图文线/长文线」落到全视频框架的生成页

> **处理状态（2026-07-08 已修）**：ProductionStudio 读 pipeline_id，非视频隐藏声音与音乐组（长文再隐藏画面组）、标题去「视频」、script 描述三态化。

- **位置**：`apps/production-template-demo/src/components/ProductionStudio.tsx:560-566`（描述文案）、`621-633`（StandardInput script 分支无形态感知）、`1585-1740`（TTS 引擎/音色/试听区无条件渲染）；入口 `CreateGallery.tsx:198-205` + `templatePresentation.ts:24-35`
- **旅程步骤 / 形态**：第 4 步出片（直跑）· image_set 与 text
- **现象**：快速生产页把「图文线」「长文线」和标准线并列成产线板块，卡片「开始制作」经 `templateRoute` 一律路由到 `/create/generate/:id` → `GenerateWorkspace`（ProductionStudio）。该页对 `product_entry==="generate"` 只按 assets/topic/script 三分支，**不看 pipeline_id**：图文/长文都是 script 输入，落进 565 行的 else 分支，标题「填入文案」，副文案写死「文案不会被改写，将按原文进行拆分、配音、配画面并合成视频」——对长文（LLM-only，无配音无画面无合成）和图文（无配音无合成）完全是假的。同时 StandardInput 无条件渲染 TTS 引擎/音色/语速/试听（1585 行起）、BGM、「视频标题」（1165 行）。用户对着一个纯文字/图集产物填了一堆声音参数，提交时这些参数因不在模板 `allowed_user_params` 白名单被后端静默丢弃。
- **为什么是问题**：产物形态分支不完整 + 明显误导。图文线/长文线是被正式陈列、鼓励直跑的产线（`CreateGallery.tsx` FAMILIES 82-158 行），不是隐藏路径；用户按页面承诺以为会"配音配画面合成视频"，结果拿到一篇纯文字，且填的声音全是无用功。
- **建议修法**：ProductionStudio 读到模板 pipeline_id ∈ {image_post, long_form} 时，隐藏 TTS/BGM/画面/试听区（可复用审核页已有的 `isNonVideoTemplate` 判定），描述与按钮文案按形态三态化；或产物结果区已支持（2059-2074 已分支），只需补齐输入侧。
- **成本**：M（半天）

### P1-2 · 生产提交面板对非视频模板仍展示「预览画面 / 试听声音」与画面/BGM/TTS 覆盖项

> **处理状态（2026-07-08 已修）**：ProductionSubmitPanel 从 selected.pipeline_id 判非视频，隐藏「默认效果预览」与视频专属专家覆盖区；长文保留 word_count/llm_model 两项本次覆盖（PRD §5.2，审核补齐）。三入口共用，行为一致。

- **位置**：`apps/production-template-demo/src/components/shared/ProductionSubmitPanel.tsx:360-456`（默认效果预览）、`458-596`（专家覆盖全是画面/BGM/TTS 项）、`238` 预览兜底 `frame_template ?? "1080x1920/image_default.html"`
- **旅程步骤 / 形态**：第 4 步出片（看板多选 + 详情页出片 Sheet + 审核第三步共用此面板）· image_set 与 text
- **现象**：`ProductionSubmitPanel` 是全站唯一生产提交组件，`compatible`（123-132 行）按 `input_requirements.includes("script")` 过滤，会把图文/长文模板一并列进出片选择器（这本身是对的，就是这么选形态）。但面板下方「默认效果预览」永远给「预览画面 / 试听声音」两个按钮，长文按它去渲染帧图（238 行会拿 image_default.html 兜底渲一张图）、试听一段根本不存在的配音；专家覆盖区（469-595 行）也永远是画面模板/BGM/TTS 模式/声音/语速——对长文全部无意义、对图文无 TTS。
- **为什么是问题**：面板是主力出片路径（看板→确认→出片 Sheet）的核心，选中长文/图文后满屏视频专属控件，既误导又让人怀疑"是不是选错了"。
- **建议修法**：面板接收所选模板的 pipeline_id（或从 `selected.pipeline_id` 直接读），非视频形态隐藏预览按钮与画面/BGM/TTS 覆盖项，长文只保留（若要）字数/模型类覆盖。
- **成本**：S（半天内，纯前端条件渲染）

### P1-3 · 作品库详情标题恒为「视频详情」，并对图集/长文照渲「模式/分镜数/TTS/声音」

> **处理状态（2026-07-08 已修）**：标题按 artifact_type 三态；Facts 三态（image_set→页数/语言、text→字数/语言），缺值不占位。

- **位置**：`apps/production-template-demo/src/components/HistoryWorkspace.tsx:733`（CardTitle 写死「视频详情」）、`806-811`（模式/分镜数/TTS/声音 Facts 无形态分支）、`734-736` 描述「查看这条记录的输入、成片和分镜」
- **旅程步骤 / 形态**：第 6 步（作品库回看）· image_set 与 text
- **现象**：作品库右侧产物区已按 `artifact_type` 正确渲染 TextArticleView / ImageSetView / video（889-929 行 OK），但卡头标题恒为「视频详情」，中部 Facts 恒展示「模式 / 分镜数 / TTS / 声音」四项——长文/图文这些全是「未返回」，却照样占位渲染。
- **为什么是问题**：文案与信息结构与产物形态不符，长文/图文帖被硬贴上视频专属元数据，观感割裂。
- **建议修法**：标题按 `artifact_type` 三态（长文/图文帖/视频 详情）；「模式/分镜数/TTS/声音」四 Facts 仅 video 渲染，长文/图文换成字数/页数/语言等对应元数据。
- **成本**：S

---

## P2

### P2-1 · 直跑生成页路由标题写死「生成视频」

> **处理状态（2026-07-08 已修）**：`App.tsx` `/create/generate/:id` 标题改中性「生成」。

- **位置**：`apps/production-template-demo/src/App.tsx:46`
- **形态**：image_set / text · 全局导航标题
- **现象**：`/create/generate/:id` 的 `title = "生成视频"` 写死，图文/长文直跑时顶栏也叫「生成视频」。
- **建议修法**：与 P1-1 一起，按所选模板形态动态化标题（或退一步用中性「生成」）。DESIGN §4 禁用词虽未含"视频"，但产物已非仅视频，措辞该跟上。
- **成本**：S

### P2-2 · 任务中心空状态文案仍以视频为唯一产物

> **处理状态（2026-07-08 已修）**：空态文案「创建第一条视频后…」→「创建第一条内容后…」。

- **位置**：`apps/production-template-demo/src/components/TaskCenterWorkspace.tsx:69`
- **现象**：空状态写「还没有生成任务。创建第一条视频后，进度会显示在这里。」有空状态、无死转圈（已核查），仅措辞把产物窄化成视频。
- **建议修法**：「创建第一条内容后…」。
- **成本**：S

### P2-3 · 出片模板选择器混列三种形态、无形态标识，易误选

> **处理状态（2026-07-08 已修，批次二）**：ProductionSubmitPanel 模板 SelectItem 后缀形态徽标（视频/图集/长文，用 templateArtifactType）。

- **位置**：`apps/production-template-demo/src/components/shared/ProductionSubmitPanel.tsx:316-327`
- **现象**：出片时下拉把视频/图文/长文模板平铺混列，仅靠 display_name 区分（"长文""小红书图文帖"尚算清楚，但自定义克隆名可能不带形态词）。单人高频出片时有点错产物的风险。
- **建议修法**：SelectItem 后缀一个形态徽标（视频/图集/长文）或分组。
- **成本**：S

### P2-4 · 克隆模板用 Sheet 且要手填「模板 ID」，与新建配方路径双入口不一致

> **处理状态（2026-07-08 部分修复，批次二）**：已去掉手填「模板 ID」，改自动生成 `my_${pipeline_id}_${ts}`（对齐 CreateGallery），消除内部 ID 暴露。容器仍为白名单内的克隆 Sheet——UI 套件无独立居中 Dialog 原语，且 Sheet 本非违规（走查原文即认定），降级 Dialog 属可选优化，暂缓；DESIGN.md §2.5 白名单表述无需变动。

- **位置**：`apps/production-template-demo/src/components/TemplateStatusPanel.tsx:148-168`
- **现象**：设置页模板面板的「克隆」是一个 Sheet（3 输入：模板 ID / 名称 / 描述），且要求用户手输内部风格的「模板 ID」（占位 `daily_copy`）。而快速生产页 `CreateGallery` 的新建配方（`NewRecipeForm`）自动生成 id、只要起名，创建后直落配方详情页换零件。两条克隆入口体验割裂，一条暴露内部 ID 概念。DESIGN §2.5 硬判据：克隆起名（<5 输入、不需参照背景）应是居中 Dialog 而非 Sheet——克隆在白名单内不算越界，但容器选型偏轻一级更合规。
- **建议修法**：克隆改居中 Dialog、去掉手填 ID（自动生成，与 CreateGallery 对齐）；或直接让设置页克隆复用 CreateGallery 那条路径。
- **成本**：S

---

## 已核查、无问题的维度（一句话带过）

- **历史守则**：全量 grep 未发现 `??` 判空默认字段回落错误（现存 `?? undefined / ?? null` 均为合法的空值转换）；未发现 effect 依赖数组里放 `isLoading/busy/loading`；数据到达初始化编辑态走渲染期 `initKey` 模式（`ContentItemDetailPage.tsx:129-159`、`ProductionSubmitPanel.tsx:216-224`），无 effect 内 setState 死循环风险。三类历史真 bug 的同款隐患本轮未复现。
- **容器规范**：现存 8 个 Sheet 恰好命中白名单（添加内容、克隆模板、发布、出片×2、新建项目、换模板、PromptPeekSheet），无白名单外新增；AlertDialog 均为破坏性确认（豁免）；未见弹层套弹层或弹层塞页面级内容。
- **深链一致性**：无裸 `navigate("/settings")` / 裸 `/settings?` 路径，全部经 `lib/settingsLinks.ts`。
- **出片主链一致性**：看板多选与详情页单条出片共用 `lib/produceContent.ts`，已确认分镜按行直出（`split_mode:"line"`）、任务 id 追加不替换——当年"分镜按段落重切"的 bug 已修且两路径对齐。
- **错误处理**：`readableError` 在 16 个组件普遍接入；起草/出片/保存失败均有 toast 或 InlineError；任务失败原因入条目事件红字展示。
- **轮询回写**：内容详情页 `producing` 状态 15s 轮询（97-126 行），cleanup 正确，无历史"cleanup 取消请求致永久转圈"问题。
- **后端产物分支**：`ops/service.py:1660-1720` 的 asset-ref 已对 image_set/text/video 三态分支；`generation/service.py:210-216` 结果构造三态分支；`schemas.py` `primary_video` 可空、`artifact_type` 默认 video 向后兼容。后端消费端干净，断链只在前端发布层与直跑输入层。

---

## 建议修复顺序（可打包成一个 Opus 实施批次）

三条 P1 + P0 全部同源：**"产物已三态，但发布层与直跑输入层还假设是视频"**，天然是一个批次。建议一次实施：

1. **批次一（发布与直跑的形态补齐，优先）**：P0-1 + P1-1 + P1-2 + P1-3 + P2-1 + P2-2。统一动作：抽一个 `isNonVideoTemplate(pipelineId)` / 从 result 读 `artifact_type` 的公用判定（审核页已有 `isNonVideoTemplate`，提取到 lib 复用），在四个消费点（详情页发布区、作品库发布按钮+详情标题+Facts、ProductionStudio 输入区、ProductionSubmitPanel 预览与覆盖区）按形态收敛视频专属 UI；后端 `publish_task` 补非视频可读 400。一个 PR 覆盖，验收口径："图集/长文出片→走到 produced→发布入口只给下载/复制、不再误走 Buffer 报错；直跑图文/长文的生成页不再显示配音/合成视频文案与 TTS 控件"。
2. **批次二（打磨，可选随手做）**：P2-3（选择器形态徽标）+ P2-4（克隆入口统一/降容器）。与批次一无耦合，独立小改。

先做批次一即可消除全部功能性断链；批次二是纯观感。
