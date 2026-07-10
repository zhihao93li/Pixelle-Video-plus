# Pixelle 产品定位与生产提交层统一 · 产品文档

日期：2026-07-05
依据：通读原始 Streamlit（`web/`：app、pipelines、components、pages）、当前 React 控制台（`apps/production-template-demo`）、后端生产体系（`pixelle_video/generation`、`api/routers`）、运营层（`ops/`、`api/routers/publish.py`、`marketing/`）。

---

## 一、这个产品到底是什么

**Pixelle-Video-plus 不是视频剪辑工具，而是一个单运营者的 AI 短视频内容工厂。**

证据在代码里：

- `ops/models.py` 定义了完整的**经营实验循环**：锁定预测 → 生成 → 发布 → 记录数据 → 写复盘（prediction_locked → generation → publish → metrics_recorded → retro_written）。这不是给"想做个视频的人"用的，是给"持续经营内容渠道的人"用的。
- 生产模板写死了 `project="PetWoods", channel="xiaohongshu"`，发布走 Buffer 多平台，文案审核流程专为**多语言出海**设计。真实用户是内容运营（当前就是你自己），一人管多渠道、多语言、成规模出片。
- 旧 UI 里的一句话暴露了系统的设计意图："保存后，Ops/Codex 和 React 都会使用同一个项目默认模板"——**人和 agent 共用同一套生产配置**，agent 也是这个工厂的操作员。

所以这个产品的价值链是：

```
内容策划（选题/文案/审核稿）→ 生产（模板化出片）→ 发布（Buffer）→ 数据 → 复盘
        内容资产                  生产能力            分发          经营闭环
```

**核心资产有三类：内容（文案/确认稿）、生产能力（模板）、成片。** 产品设计好坏的判断标准：这三类资产能否被沉淀、复用、规模化。

## 二、两版对照：原版做对了什么，React 哪里偏了

### 原版 Streamlit 的隐含模型（比现在更对的部分）

原版 Create 页只有**一个创作面**：顶部选创作类型（快速创建/素材/图生视频/动作迁移/数字人），快速创建内部：

- 单条还是批量 → 一个 **checkbox**（`content_input.py` L88）
- 选题生成还是固定文案 → 一个 **radio**（L99）
- 直接生成还是先审核 → 一个 **模式开关**（`standard.py` L57）
- 而**风格配置（画面模板/TTS/BGM）永远是同一份共享组件** `render_style_config()`——审核模式也复用它（`standard.py` L104，仅关掉 TTS 段改用每语言配置）

也就是说原版虽然是工程师表单，但产品模型是对的：**"内容怎么来、来多少条"是模式，"长什么样、什么声音"是一份共享的生产配置。内容维度和生产维度正交。**

原版的真问题（迁移的正当理由）：全是表单没有产品化；provider/workflow 直接暴露；同步阻塞生成（页面必须一直开着）；session state 一刷就丢；配置无法沉淀成可复用的"模板"。

### React 现状哪里偏了

迁移矩阵按"能力条目"逐条验收（每行一个 Streamlit 来源 → 一个 React 入口），于是**原版的三个"模式开关"被升格成了三个平级入口**（单条生成/批量生产/文案审核），正交性被打破：

| | 单条生成 | 批量生产 | 文案审核 |
| --- | --- | --- | --- |
| 生产配置面板 | 高级设置三分组 | 自己复制一份 SharedSettingsPanel | 自己再配一份（画面/BGM/TTS） |
| 后端走生产模板体系（compile_request） | ✅ | ✅（`POST /batches` 按 template_id 编译） | ❌ 直拼 GenerationRequest（`_submit_generation_jobs_as_batch`，pipeline 写死 standard） |
| 模板级默认配置实际生效 | ✅ | ❌ **前端把整套生产参数塞进每个 item.input，作为 allowed_user_params 每次覆盖模板默认** | ❌ 前端直拼 baseParams（frame/bgm/compose_runtime 等），后端又不走模板 |
| 能选生产模板出片 | ✅ | ❌ 前端写死 topic/script 两个批量模板 | ❌ |

注：批量路径的问题不在后端管线，而在前端行为——通道是对的，但每次提交都"自带全套参数"，模板默认形同虚设。审核路径则是后端通道本身就绕过了模板。

**后果**：同一个用户在三个入口面对三套不一样的生产配置；刚建好的"设置管接入，模板管默认，表单管这一次"三层模型只覆盖 1/3 的出片量（批量和审核恰恰是量最大的场景）；审核产出的多语言确认稿——整个系统里最贵的内容资产（LLM 生成 + 人工审核过）——被锁死在一条硬编码管线上，不能选模板、不能存着复用、不能二次出片。

一句话诊断：**Phase 1-3 修好了"车间的动线和门面"，但三条流水线还各用各的图纸。**

## 三、问题陈述

内容运营在三个创作入口面对三套互不一致的生产配置，其中产量最大的两条路径上模板默认配置均不生效（审核：后端绕过模板体系；批量：前端每次提交自带全套参数覆盖模板默认），导致：模板沉淀的经验（画面/声音/BGM 调优）无法作用于主要产量；多语言确认稿作为最高成本的内容资产不可复用；每次批量/审核出片都要人工重配参数，出错即浪费真实生成额度。不解决，模板体系形同虚设，规模化出片的边际成本降不下来，agent 自动化（ops loop）也无法复用人调好的生产配置。

## 四、目标

1. **一份生产配置**：全站只存在一个"生产提交"概念——选生产模板 + 少量表单级覆盖；三个入口共用，模板默认配置 100% 覆盖出片量。
2. **内容与生产解耦**：审核确认稿、批量文案条目都能配任意兼容的生产模板出片（衡量：审核稿可用模板数从 1 → 全部 script 类模板）。
3. **零重复配置**：批量/审核出片时需要人工填写的生产参数项 ≤ 3（模板选择 + 流程特有项），其余全部继承模板默认。
4. **配置一次、处处生效**：在模板默认配置里调一次 BGM/声音，单条、批量、审核三条路径下一次出片全部生效。

## 五、非目标

- **不做多项目/多租户**：当前单运营者（PetWoods），项目维度保留在 ops 层即可，UI 不引入项目切换。
- **不动内容准备阶段的差异化**：选题生成、多语言审核、素材上传各自的输入表单保留——差异化本来就该在内容侧。
- **不做内容库（确认稿资产管理页）**：本期只保证确认稿"能选模板出片"；独立的内容资产页放 P2。
- **不做数据回流 UI**：ops 的 metrics/retro 环节已有模型，发布后数据展示是独立 initiative。
- **不改 Buffer 发布流程**：刚打通，保持稳定。

## 六、用户故事

- 作为内容运营，我在模板默认配置里把日常模板的 BGM 换成新曲子后，希望**批量生产的下一批视频自动用上**，而不是想起来去批量页再改一遍。
- 作为内容运营，我审核完 5 个选题 × 3 种语言的确认稿后，希望**选「静态字幕模板」低成本出一版试水**，数据好再用日常模板重新出——同一批确认稿，不用重新生成、重新审核。
- 作为内容运营，我在批量提交前只想决定两件事：**用哪个模板、这批共用什么标题前缀**，其余画面声音参数不想每次都看到。
- 作为内容运营（专家模式），我希望在任何入口提交前都能**临时覆盖个别参数**（这一次换个声音试试），且明确知道这只影响本次。
- 作为 ops agent（Codex），我通过同一套模板 API 提交生成，**与人类调好的模板默认完全一致**，不需要在 prompt 里硬编码生产参数。

## 七、改哪里（Requirements）

### P0 — 统一生产提交层

**R1｜后端：审核提交走模板体系。**
`POST /script-review/draft-sets/{id}/tasks` 增加可选 `template_id`（默认取项目默认模板）；`_submit_generation_jobs_as_batch` 改为 `registry.compile_request(template_id, input={script,...}, ...)`，语言级 TTS 覆盖作为 allowed_user_params 传入。
验收：Given 模板默认 BGM 已改，When 审核稿提交，Then 生成任务的 params 携带模板默认 BGM；Given 选了 static 模板，Then 出片不触发媒体生成。

**R2｜前端：批量提交停止覆盖模板默认。**
后端通道已正确（`compile_request`）；改前端——批量 item.input 只携带内容字段（topic/script/title），生产参数不再默认注入；模板可选（不写死 topic/script 两个批量模板），专家模式下才允许显式覆盖个别参数。
验收：Given 用户未做任何覆盖，When 批量提交，Then 任务 params 全部来自模板 fixed_params（含 overrides）；模板默认配置变更后新批次生效。

**R3｜前端：审核第三步简化为「选模板 + 每语言声音」。**
生产模板选择器（只列 script 输入的可用模板，默认项目默认模板）+ 每语言 Fish reference_id/语速；画面模板/BGM/提示词字段移除，改为显示所选模板的默认摘要（只读），专家模式下可展开覆盖。
验收：非专家模式下第三步人工输入项 ≤ 3 类；提交后任务进任务中心。

**R4｜前端：批量共享设置面板替换为同一个「生产提交」组件。**
与审核第三步共用组件（模板选择 + 只读默认摘要 + 专家模式覆盖），删除 BatchSharedSettingsPanel 的重复实现。
验收：批量页与审核页的生产配置 UI 为同一组件；代码中生产参数表单只存在一处。

### P1 — 资产复用与体验补全

**R5｜确认稿二次出片**：审核历史（draft set 列表）中已提交的确认稿支持"再次出片"——重新选模板提交，不需要重新生成草稿。
**R6｜Gallery 文案按内容来源重述**：卡片描述改为"内容从哪来"（我有完整文案/只有选题/需要多语言审核/用我的素材），模板名去掉 v1/工程后缀（后端 display_name 同步改）。
**R7｜提交组件内嵌模板默认预览**：选中模板后展示其默认画面帧缩略 + 声音试听入口，减少"选错模板出废片"。

### P2 — 架构性预留（本期不做，但不能堵死）

- **内容库**：确认稿/常用文案作为独立资产页，支持标签、搜索、批量选取出片。设计 R1 时保持 draft_set 与 batch 的引用关系（已有 `draft_set_id` metadata，保留）。
- **数据回流**：发布记录 → ops metrics 的展示层。R2 保留 batch metadata 的可扩展性。
- **多项目**：模板已有 project/channel 字段，UI 层不做但 API 不写死 PetWoods 之外的假设（R1/R2 的默认模板解析继续走 project 默认链路）。

## 八、为什么这么改（决策依据）

1. **顺着系统已有的设计意图，而不是逆着**：模板注册表、compile_request、allowed_user_params 白名单、项目默认模板、模板级 overrides——整套机制已经存在且经过测试，批量/审核绕开它是迁移时的偷懒，不是设计选择。统一是把现有机制用满，不是新造抽象。
2. **恢复原版就有的正交性**：原版 style_config 共享一份就是这个道理；迁移把它拆散了，本方案是"用模板体系重新实现原版的共享风格配置"，产品模型回到对的位置，工程实现比原版更好（可持久化、可被 agent 复用）。
3. **成本结构**：批量和审核是额度消耗大户，恰恰是最需要"模板沉淀经验、防止配错"的地方。一次配错 = N 条废片的真实成本。
4. **为 agent 化铺路**：ops loop 里 agent 提交生成时只应该说"用 X 模板生成这批内容"——生产参数属于模板，不属于每次调用。人机共用一个配置层，人调优、agent 执行。

## 九、开放问题

- **［产品/你］** 审核流程的每语言 Fish 音色，要不要也沉淀到模板级（如"多语言模板"的默认音色映射）？本期作为表单级参数，若使用频繁建议 P1 升级。（非阻塞）
- **［工程］** 批量两个内置模板（topic/script batch）统一后是否下线，还是保留为"批量默认模板"？建议保留为默认值以兼容 ops 历史数据。（R2 实施前决定）
- **［产品］** 「文案审核后生成」更名：建议「多语言审核出片」。改名涉及后端 display_name 与文档，低成本，随 R6 一起做。（非阻塞）

## 十、实施记录

- **2026-07-08｜生成页两处就地修复（用户点名，直接实施）**：① 画面模板静态预览接回——Streamlit 原版的 docs/images/{size}/{stem}.jpg|png 预览图库 React 迁移时漏接（迁移回归），现 `TemplateInfo.preview_url` + `GET /resources/templates/preview/{size}/{stem}`（路径穿越防护）+ 生成页画面模板下拉选择即显预览图；「生成预览」保留为带自定义参数的真渲染。② 配音引擎（TTS 提供方）移出专家模式门控常驻显示，改名「配音引擎」——提供方决定音色 ID 取值方式，藏起来使音色框变谜语。前端三件套 + 后端 py_compile 全绿；需重启后端生效。

- **2026-07-08｜视觉批次二：任务页 + 内容详情页套 §2.7 工艺（prd-visual-batch2-tasks-and-item-detail.md WP-A~D，DESIGN.md §2.7 逐页施工第二批，第一批=作品库）**：把作品库同族手法（行列表、区题+发丝线、速览定义行、StatusBadge 语义色、裸数字统计）搬到内容消费侧剩下两页，只改皮，数据流/轮询/编辑/动线零变动。① **WP-A StatusBadge 收敛**：`shared/StatusBadge.tsx` 加 `ContentStatusBadge`（内容条目状态→语义色：producing 黄、published/measured 绿、archived/其余 中性、failed/error 红；标签取 `contentItemMeta.statusLabel`，缺省回落中性+原文）；抽内部 `Pill` 供两徽标共用。迁移 ProductionStudio 的 1 处 import 到新版；**删除 `feedback.tsx` 旧 icon 版 StatusBadge + STATUS_CONFIG + 失效 icon import**（grep 全站零残留，状态徽标唯一来源锁定 `shared/StatusBadge.tsx`）。新 `shared/Stat.tsx`（页内头裸数字统计项，作品库 + 任务页共用，作品库本地 Stat 改引用）。② **WP-B 任务页（TaskCenterWorkspace）**：去「任务」Card，页内头=裸数字统计（进行中/已完成/失败，失败>0 红）+ 打开作品库 outline sm + 发丝线；任务行去边框盒改 `border-b py-2.5 last:border-0`（新 StatusBadge + 名称 13px + 提交时间 12px + 右操作 ghost sm；进度/失败因由改 12px 行内文案，删 Progress 条与逐行 TechDetails，fallback「视频生成任务」→「生成任务」）；空态去盒改纯文字 py-10；批次区 Card→区题「批次」+发丝线（批次行与展开 BatchStatusCard bare 保持现状）；轮询/taskCenter 零改。③ **WP-C 内容详情页右栏（ContentItemDetailPage）**：aside 去逐区块 `rounded-lg border p-3` 盒，改无边框列、区块 `border-b pb-4 mb-4 last:无线`、区题 `text-sm font-medium`；状态区→ContentStatusBadge + 逐语言确认摘要 + 生产中提示；溯源盒 + 底部 Fact 网格（来源/语言，内部 key `manual` 裸奔）合并为速览定义行（项目/创建时间/语言数/溯源/关联任务数，缺值不渲染）；产物/发布/数据区退壳区题化（分支逻辑、`id="product-artifacts"` 锚点、按钮组全不动）；动态事件改行式 `py-2 border-b`（事件文案 13px + actor/时间 12px muted，失败因由 text-destructive 去红盒）；header 状态 Badge 也换 ContentStatusBadge。左栏编辑/出片 Sheet/发布跃迁/数据回填/15s 轮询/深链零回归。④ **WP-D 文档**：DESIGN.md §2.7 首行加逐页进度（作品库 ✓ 任务 ✓ 内容详情 ✓）；本条。**Fact 迁移进度 1/3**（内容详情页已迁，ProductionStudio/TemplateStatusPanel 待批次三/五）。**全绿**：typecheck/lint/21 前端测试；本地待验：`npm run build` + 用户截图（任务页全景、内容详情页视频态+长文态）交审核。

- **2026-07-08｜全站容器左对齐（用户反馈"切页宽度跳变"，审核中直接修）**：三档 max-width 保留，但全部主容器与顶栏标题容器去 `mx-auto` 改左对齐——内容左缘恒贴侧栏，切页只变右侧延展不跳位（YT Studio/Stripe 同款）。AppShell 的 `contentWidth` 宽度联动机制随之删除（左对齐后标题与内容天然同左缘）；DESIGN.md §2.6 更新。11 个页面组件批量替换，三件套全绿。

- **2026-07-08｜作品库成熟化 + 视觉 token 第一批（prd-library-maturity-and-visual-tokens.md WP-A~D，方向/mockup/参考分工已批准）**：作品库（用户点名「最难受的一页」）从卡片网格套盒子改为 YouTube Studio 式紧凑行列表 + 去盒子详情，双栏主从骨架保留（不引二级页）。① **WP-A 地基**：新 `components/shared/StatusBadge.tsx`（pill：中文 + 语义色 绿完成/红失败/黄进行/灰中性，缺省回落中性 + 原文防裸奔），替换 `BatchStatusCard` 内部 `BatchStatusBadge`（删）+ 作品库列表/详情/发布记录；`lib/format.ts` 加 `paramValueLabel`（fixed→固定文案/local→本地/comfyui/fish 等）+ `voiceLabel`（音色 id→中文名，查不到显原值）。DESIGN.md 新增 §2.7 排版工艺（字阶四档 18/14/13/11-12、盒子降级发丝线、状态色唯一映射、主色纪律、参考分工表：作品库→YouTube Studio、配方→HeyGen/Synthesia、发布→Buffer、工艺→Stripe）。② **WP-B 左栏 + 顶部（HistoryWorkspace）**：统计裸数字（全部/完成/失败，失败>0 红字，删三个统计盒 + Metric）；搜索 + 形态/状态/排序 Select 平铺一行（删「筛选与排序」AdvancedGroup 折叠盒；排序合并 field+order 为一个 Select；每页固定 20）；卡片网格 → 紧凑行列表（`LibraryRow`：缩略 32×44 + 标题 13px + 元行 形态·时长/页数/字数·日期，失败行红字带简因，键盘上下导航）；`listContentItems({limit:500})` 建 task_id→metrics 映射，有回填数据的行元行追加「赞x·藏x·评x」（失败静默）；行悬停浮出下载（视频直下/非视频开详情）+ 发布（仅视频完成）icon。③ **WP-C 右栏去盒子（DetailCard）**：删整个 Card 壳与全部 Fact 盒；标题行 = 标题 18px + StatusBadge + 发布（唯一实心，视频完成）/下载 outline/删除 ghost；速览定义行（发丝线，label 11px muted 上/值 13px 下，缺值不渲染、无「未返回」占位，全中文化：创建/完成时间、时长/页数/字数、文件大小、声音 voiceLabel、配方 display_name 模板在则链 `/create/recipes/:id`（listTemplates 建 id 集验存在）已删则纯文本）；主体两栏 = 产物区 220px（视频 9:16/ImageSetView/TextArticleView）+ 输入文案（13px，`CollapsibleText` 6 行截断 + 展开全文）；`StoryboardRow` 紧凑行（帧缩略 24×36 + 旁白首行截断 +「配图提示词」inline 展开，删灰盒堆叠 + 英文提示词大段直出）。发布 Sheet 动线保留（白名单），发布记录改行列表、job status 用 StatusBadge。④ **WP-D 文档**：DESIGN.md §2.7 + §2.5 筛选 Popover 备注；本条。**非目标**（未做）：二级详情页、悬停自动播放、换主色/其余页面重刷（后续批次逐页套 §2.7）、后端改动。**全绿**：typecheck/lint/21 前端测试；本地待验：`npm run build` + 三形态详情截图对照 mockup（附录 B 视觉验收，预期一轮微调）。

- **2026-07-08｜页宽规范 + 顶栏对齐（用户点名，直接实施）**：DESIGN.md 新增 §2.6 页宽三档强制规范（基准 1240 / 看板宽表 1600 / 窄栏阅读 960，禁止自创第四档）；AppShell 加 `contentWidth` prop（default/wide/narrow，Tailwind 字面类名映射），顶栏标题容器与当前页主容器同档对齐，修复看板页（1600）标题按 1240 对齐的左缘错位；路由宽度在 App.tsx 声明（board→wide、script-review→narrow）。前端三件套全绿；`npm run build` 留本地。

- **2026-07-08｜生成页换配方去 Sheet 化：全站统一配方选择器（prd-recipe-select-unification.md WP-A~C，方向已批准，起因：生成页「更换模板」Sheet 被用户截图质疑）**：生成页换配方从白名单 Sheet 收敛到出片面板同款下拉选择器，Sheet 退役，弹层白名单 8→7。纯前端 + 文档，后端零改动。① **WP-A 共享件**：新 `components/shared/RecipeSelect.tsx`（`display_name · 形态徽标`，调用方过滤好可选项、组件只管选）；出片面板 `ProductionSubmitPanel` 的模板 Select 改用之（行为零变化，`artifactKindLabel` 因移入组件而从面板 import 移除）。② **WP-B 生成页页头（ProductionStudio）**：`TemplateSummaryBar` 重构为 `RecipeSelect`（数据源 `templates.filter(isActiveProductTemplate)` = enabled && !retired && generate，兜底把当前配方并入避免下拉空白）+ 「产线 · 形态」chip（`pipelineChipLabel` + `artifactKindLabel(templateArtifactType)`）+ 「预计」Badge + 「调整默认配方」→ `/create/recipes/{id}`。**删除**：模板 Sheet 及 JSX、`isTemplateSheetOpen`/`pendingRouteTemplate` 状态、跨入口确认 AlertDialog、`applyTemplateRoute`/`selectTemplateOrRoute`/`confirmPendingRoute`/`routeEntryLabel`/`isSpecialProductEntry`、`Sheet*`/`Repeat2`/`FileText`/`SpecialPipelineMode` 死 import。换配方 = `setTemplate` + `navigate`；批量态切到不支持批量的配方（素材/选题入口）自动落回单条但保留 `batchText`（§4.4）。③ **WP-C 文档**：DESIGN.md §2.5 加禁令 5「白名单只豁免容器不豁免内容——弹层/选择器内禁内部 key（use_case/input_requirements 生值/pipeline_id）、禁退役停用项进可选项」+ 列当前合法弹层白名单 7 项（出片×2、PromptPeek、新建项目、克隆配方、发布、添加内容；AlertDialog 豁免不计）。**教训入规**：容器审计只看「弹层在不在白名单」不够，白名单弹层的内容同样受陈列与文案规范约束。**全绿**：typecheck/lint/21 前端测试；本地待验：`npm run build`。

- **2026-07-08｜批量从独立入口改为生成页的提交模式（prd-batch-as-submit-mode.md WP-A~E，方向+mockup 已批准）**：核心重定义——**批量不是入口，而是任一配方生成页的一种提交模式**；净减一个页面、一个占位模板、一次重复决策，直跑线首获批量能力。① **WP-A 共享件**：`lib/batchInput.ts`（`parseFixedScriptItems`/`removeScriptItem`/预览标题·正文·行数/`isTerminalBatchStatus`）、`lib/useBatchPolling.ts`（hook：仅非终态 2s 轮询，依赖数组只 `[batchId, isTerminal]` **不放 batch 对象/isLoading 以免打断轮询**，含 `retryItem`）、`components/shared/BatchStatusCard.tsx`（状态行+每条状态+单条重试，`bare` 变体供行内展开复用）。② **WP-B 生成页批量（ProductionStudio）**：页头「单条｜批量」ToggleGroup，显示条件 `product_entry==="generate" && input_requirements 含 script && 非素材 && 非 topic`；批量态换多条粘贴区（复用解析+预览+逐条移除、隐藏单条「标题」字段，标题取每条首行），高级设置作共享参数 merge 进每条 input；措辞按形态（图文帖/长文/视频，量词 篇/条）；提交按钮「批量生成 N 量词形态」走 AlertDialog（额度确认豁免）→ `createGenerationBatch`（`metadata.source:"react_generate_batch"`, `mode:"fixed"`，沿当前项目）→ 就地 `BatchStatusCard` + `trackBatchTasks` 并入任务中心。③ **WP-C i2v 批量（SpecialPipelinesWorkspace）**：i2v 加同款切换，多图上传逐张可移除，每图一条 item（`input.assets=[该图 path]`、其余共享），提交同上；动作迁移/数字人本期不加。④ **WP-D 任务中心「批次」区**：任务列表之上加「批次」区块，`listGenerationBatches`×`listTemplates` 映射出形态徽标+配方名 ×N+汇总状态，行可展开 `BatchStatusCard` 单条重试；仅非终态轮询、空批次整区不渲染。⑤ **WP-E 退役**：删 `BatchWorkspace.tsx`，`/batch`·`/create/batch` 重定向 `/create` 不 404；后端 `templates.py` 删「批量生产」占位注册（净减一个占位模板）、`production_templates_test.py` 断言同步；`templateRoute`/`CreateGallery` 流程入口/`templatePresentation` 的 `product_entry==="batch"` 分支全清。产物形态一律走 `lib/artifactKind.ts`，无字面 `pipeline_id` 比较；弹层白名单零新增。**全绿**：typecheck/lint/21 前端测试、后端 py_compile；本地待验：pytest、build、真实批量一次（图文 ×2 + i2v 多图）。

- **2026-07-08｜产物三态对齐：发布层与直跑输入层修复（prd-artifact-type-ux-alignment.md，走查 ux-walkthrough-2026-07-08.md 8 条问题）**：三种产物形态在「起草→确认→出片→轮询」已一致，断链集中在「发布」与「快速生产直跑」两层的视频时代老代码。批次一（P0-1/P1-1~3/P2-1/P2-2）+ 批次二（P2-3/P2-4）全做：① **WP-A 公用判定**：新 `lib/artifactKind.ts`（`templateArtifactType(pipelineId)` + `isNonVideoPipeline` + `artifactKindLabel`），审核页 `isNonVideoTemplate` 改从 lib 导入，全站禁止再散落 `pipeline_id === "image_post"` 字面比较（有结果读 `result.artifact_type` 真源，无结果才按 pipelineId 推断）。② **WP-B 发布层**：内容详情页发布区按本条目最新完成任务的 artifact_type 分支——video 不变，image_set/text 隐藏「去发布」、换手动指引（一句话 + 滚动到产物区下载/复制锚点）+ 保留「已排期/已发布」手动跃迁；作品库 `canPublish` 补视频条件（非视频不亮发布按钮、PublishCard 提交禁用），详情标题三态（视频/图文帖/长文 详情）、Facts 三态（video 保持模式/分镜数/TTS/声音；image_set→页数/语言、text→字数/语言，缺值不占位）；后端 `publish_manager.publish_task` 取 video_path 前判 artifact_type，非视频抛可读 400（route 已 ValueError→400），补单测（非视频→400 且 message 可读、视频回归不破）。③ **WP-C 直跑输入层**：ProductionStudio 读 pipeline_id，非视频隐藏声音与音乐组（TTS/试听/BGM）、长文再隐藏画面风格组、「视频标题」→「标题」、script 描述三态；ProductionSubmitPanel（看板/详情/审核三入口共用）非视频隐藏「默认效果预览」与视频专属专家覆盖区（长文保留 word_count/llm_model 两项本次覆盖，审核补齐）；路由标题「生成视频」→中性「生成」。④ **WP-D+批次二**：任务中心空态「视频」→「内容」；出片模板选择器 SelectItem 加形态徽标；克隆入口去掉手填「模板 ID」改自动生成（`my_${pipeline_id}_${ts}`，对齐 CreateGallery），容器仍用白名单内的克隆 Sheet（无独立 Dialog 原语，Sheet 非违规——降级为 Dialog 属可选优化，本期未做，DESIGN.md 白名单无需改）。**验证**：typecheck/lint/21 前端测试全绿、后端 py_compile + 新单测；本地待验：pytest、build、真实出片一条图文+一篇长文并走完手动发布。

- **2026-07-07｜长文生产线上线（prd-long-form-text-pipeline.md，Opus 实施 + 审核通过零修复）**：第三种产物形态 `text`。管线 `long_form`（LLM-only：`long_form_prompt` 占位替换 {script}/{title}/{language}/{word_count} → `_call_llm_retrying_empty`（调用形状与既有调用点核对一致）→ article.md 落盘 + metadata.article 全文）；max_tokens 随字数动态封顶防截断；空响应多次重试后给可读报错。校验器：long_form_prompt 必含 {script}、word_count 200–20000。骨架 `pipeline_long_form_base_v1`「长文」内置中性 markdown 结构化 Prompt（无品牌词）。前端：零件编辑器多行文本升级（PART_LONG_TEXT_KEYS，长文 Prompt + 生图三长文本参数）、「长文线」板块+产线图、共享 `TextArticleView`（复制全文/下载 .md/字数）接入三处、`isImagePostTemplate`→`isNonVideoTemplate`（音色隐藏/提交豁免/按钮文案三态）。全绿：typecheck/lint/21 前端测试/py_compile；本地待验：pytest（long_form 新测试）、build、真实生成一篇长文。至此产物三态齐备：视频/图集/长文，同一确认稿一稿三出。

- **2026-07-07｜图文帖管线 + HyperFrame 解锁上线（prd-image-post-and-hyperframes.md，Opus 实施 + 审核通过零修复）**：① 新管线 `image_post`（标准线减法：分页=分镜行、每页配图+HTML 排版渲染 PNG、封面用 cover 版式、正文 ≤17 页上限校验、caption=全文）；骨架 `pipeline_image_post_base_v1`「小红书图文帖」+ 两个 1080×1440 排版模板；产物模型 `GenerationResult.artifact_type`（video/image_set，旧数据默认 video）、`primary_video` 可空，service/ops asset-ref/Streamlit 遗留读取端全部分支。② 前端：共享 `ImageSetView`（封面首位缩略网格+下载图集去发布）、快速生产页「图文线」板块+产线图、内容详情页/作品库/生成页按 artifact_type 渲染、审核页选图文模板时隐藏音色区且 canSubmit 豁免音色校验（提交文案随之变"图文帖"）。③ HyperFrame：`compose_runtime` 入覆盖白名单（枚举校验 + 保存时 npx 存在性检查，缺 Node 给可执行 400）、标准/素材骨架白名单放开（图文线合成保持固定）、产线零件表合成步骤解锁——用户克隆标准骨架换合成零件即得动效线，不预置模板。审核确认 hyperframes 消费 segment_paths 与 html_ffmpeg 同构、无 frame_template 依赖。**运行时告警**：沙箱无法实际跑图（无 ComfyUI/浏览器），配图+排版渲染路径系静态验证——用户须本地实测一条图文帖。全绿：typecheck/lint/21 前端测试/py_compile；9 个后端新测试待本地 pytest。

- **2026-07-07｜配方详情页上线（prd-recipe-detail-page.md WP-1~4，Opus 实施 + 审核通过零修复）**：`/create/recipes/:id`（RecipeDetailPage）替代 PipelinePartsSheet（已删）；就地换零件逻辑无损平移（含两条历史教训注释），「更多可调参数」两列、编辑时占满整行；右栏配方身份（含"是哪些项目的默认"交叉引用）/成品/操作（克隆→直落新配方详情页、在设置里管理）。设置页重复的 GenerationConfigEditor 删除，模板面板纯库存管理 + 「调参数」链接。五处入口全部重定向（看产线、新建后、项目页、提交面板「调整默认配方」、模板面板）。architecture-map.md 事实同步（模板默认配置→配方详情页唯一编辑入口）。**全站弹层白名单锁定 8 类，实测零新增**；每个模板参数只有一个编辑入口。全绿：typecheck/lint/21 单测；附带修复一处我此前在 ContentItemDetailPage 留下的回调返回类型问题（tsc -b 严格模式暴露）。

- **2026-07-07｜项目详情页上线（容器选型规范 P1，mockup 批准后实施）**：新路由 `/settings/projects/:id`（`ProjectDetailPage`），项目编辑 Sheet 与嵌套 Prompt 编辑 Sheet（全站最挤双层窄条）退役。分区块保存：基本信息 / 起草配置（**Prompt 正文页内展开编辑**，copy-on-write 保留且副本创建后立即接管本项目引用避免悬空）/ 语言与音色，各自保存互不牵连；右栏生产默认（模板 Select 改动即存 + 看产线直达该配方零件视图）、发布平台预选（点击即存）、项目概况（创建时间 + 进行中内容数）与设为默认/归档。ProjectsPanel 瘦身为卡片列表 + 轻量新建 Sheet（3 输入合规），**创建成功直接进详情页继续配置**。`shared/PromptEditorSheet.tsx` 删除。全绿：typecheck/lint/21 单测。至此容器选型规范的两个存量违规（内容条目抽屉、项目编辑嵌套抽屉）全部清零。

- **2026-07-07｜内容详情页上线，抽屉退役（容器选型规范 P0，mockup 批准后实施）**：新路由 `/board/item/:id`（`ContentItemDetailPage`），看板卡点击整页跳转、浏览器可后退。布局=左工作区（语言 tab 带确认状态、标题/口播全文宽幅编辑、分镜逐行编辑：加一镜/删一镜/行数即镜头数）+ 右信息栏（状态/溯源/产物/发布/数据录入/衍生选题/动态默认 3 条可展开/TechDetails）。承接原抽屉全部能力：逐语言确认打回、确认全部、生成草稿（idea）、素材指引、发布衔接、数据回填、衍生选题。出片提交逻辑抽为共享 `lib/produceContent.ts`（buildProduceSubmissions/submitContentProduction），看板多选与详情页单条共用同一管线（分镜按行直出、任务 id 追加不替换）；出片确认仍为 Sheet（短任务合规）。`ContentItemDrawer.tsx` 删除。生产中状态 15s 轮询回写。全绿：typecheck/lint/21 单测。下一个：P1 项目详情页（消灭嵌套 Prompt Sheet）。

- **2026-07-07｜快速生产页 v3 上线（先出 mockup 经用户批准后实施）**：① 直跑三管线（i2v/动作迁移/数字人）合并为一个「Workflow 直跑」板块，区名不再重复；② 「+ 新建配方」移到板块头右上（直跑板块先选输入形态再起名），创建后自动打开产线零件视图；③ 配方卡减负：名称+成品一句+一行 meta（需要 X · 出厂配置/我的配方/已自定义：差异零件），「已自定义」摘要来自并行拉取各卡默认配置的 overrides keys；④ 当前项目默认模板卡带高亮边框+「项目默认」徽标（定位锚点）；⑤ 「看产线」缩为图标按钮；⑥ 流程入口降级为列表条，与配方卡视觉区分。流程修订同步生效：**交互变更先出方案（mockup）经批准再实施，代码缺陷才直接修**。

- **2026-07-07｜快速生产页恢复层级：按产线分行 + 行尾「+ 新建」（用户反馈：全平铺把"加模板"的动线拍没了）**：纯平铺丢掉了真实存在的机身→预设层级。改为按产线分区（区头=产线名+步骤预览），区内=该产线的效果卡，行尾一张虚线「+ 新建」卡——起名→克隆该产线骨架→创建成功自动打开产线零件视图当场换零件，全程不离开快速生产页。流程入口卡单列一区。至此三个动作各有其位：选产线=选区、套模板=点卡、自己调=新建或看产线。配音零件拆为引擎+音色两项（用户发现漏登记），零件清单加「更多可调参数」兜底区（白名单有而产线图没画的自动出现，杜绝漏登记这一类问题）。

- **2026-07-06｜产线零件就地更换（用户反馈：跳设置页打断心智）**：PipelinePartsSheet 从只读+跳转升级为就地编辑——点「更换」当场展开控件（已知枚举出 Select：分镜切法/算力/TTS 模式/合成引擎，其余 Input），保存直接写该模板默认配置（PUT generation-config），带「已自定义」徽标与「恢复内置」；写稿步骤归项目管、保留「在项目里改」跳转。**设计边界修订**：「就地只看不改默认」规则对产线零件视图不再适用——它本身就是该模板最自然的编辑界面；其余表面（提交面板来源 chip 等）仍维持查看+直达。另修：加载 effect 把 isLoading 放进依赖导致 cleanup 取消请求、转圈永不结束（用户实测发现）；快速生产卡输入标签补人话映射（参考动作视频/角色图/提示词/多条现成文案）；「新建视频」全站更名「快速生产」（产物不再限于视频）。

- **2026-07-06｜骨架模板化上线（prd-pipeline-skeleton-templates.md WP-1~3，实施+审核完毕）**：新增标准线/素材线两张中性骨架（fixed_params 无品牌残留），6 张 PetWoods 预设代码级退役（enabled=False 不删，annotate_retired 展示分组）；主力 static_subtitle 生效参数迁成自定义模板 `migrated_static_subtitle_v1` 并重指项目默认（幂等，含指向失效模板的兜底重指标准骨架）；workflow_key 入覆盖白名单（文件存在性校验）；overrides 存储升级包裹格式 `{overrides, enabled}`（旧扁平格式兼容解析）；`PUT /templates/{id}/enabled`（退役不可复活、被项目默认引用不可停用）；前端模板面板启用/停用 Switch + 管线 chip + 已退役分组，新建视频页平铺成品导向卡 + PipelinePartsSheet「看产线」零件视图。**审核后处理**：批量页选题模式下线（用户拍板，30 批次仅用过 1 次且绕过审核）——只留现成文案模式，加工作台引导；顺带清理 topic 相关状态与解析。全绿：typecheck/lint/21 前端测试/py_compile；本地待跑 pytest（新增 skeleton_templates_migration_test.py）与 build。

- **2026-07-06｜修复：看板/抽屉出片丢失已确认分镜（用户实测发现）**：看板出片 input 只传 `{script, title}`，模板 fixed_params 的 `split_mode: "paragraph"` 兜底，导致按行确认的分镜被整段重切（审核页路径一直是 `text=narrations 按行 join` + `split_mode: "line"`，两条路径不一致）。已对齐：produceSubmissions 组装时，变体有已确认 narrations → `script = narrations.join("\n")` + `split_mode: "line"`；无分镜退回原行为。专家覆盖仍可显式改 split_mode（表单覆盖优先级最高）。`split_mode` 在 daily/static 模板白名单内，注入合法。

- **2026-07-06｜抽屉补出片入口（用户反馈动线断点）**：抽屉承载全部单条操作唯独出片要退回看板勾选。已修：ContentItemDrawer 加「出片」区块（confirmed 显示「出片（N 个任务）」、produced 显示「再次出片」，无已确认变体时禁用并给原因），onProduce 回调由看板接线——单选该条目并打开既有出片 Sheet，与多选出片同一提交管线零重复；Sheet 标题「批量出片」改「出片」。

- **2026-07-06｜配方与项目 1:1 绑定上线（prd-drafting-profile-per-project.md，实施+审核完毕）**：用户拍板消灭多对多。后端：`DraftingProfile.project_id` 反向索引为真源，`get_profile_for_project()` 自愈补建；`_provision_profile` 三分支迁移（认领未占用/克隆被占用/新建）挂进 `ensure_migrated()`；建项目自动配起草配置（copy_from 克隆不共享）；配置不可单独删、每项目仅一份、`PUT /profiles/default` 路由下线；解析链去掉全局默认层。前端：`DraftingProfilesPanel` 删除，Prompt 编辑抽为 `shared/PromptEditorSheet`（copy-on-write：内置或被其他项目引用的提示词，保存自动另存 `<项目名> · <原名>` 副本并改引用）；起草配置并入项目编辑器；添加对话框/看板/审核页删配方选择改纯展示；settingsLinks 去掉 drafting-profiles target；面向用户文案统一「起草配置」。**审核修复**：后端 3 处错误信息残留「配方」字样。验证：前端 typecheck/lint/20 单测全绿、后端 py_compile 通过；新增/更新测试（1:1 约束、自愈幂等、克隆不共享、迁移补齐、起草走项目配置）待本地 pytest。

- **2026-07-06｜配置就地可得上线（prd-config-at-point-of-use.md WP-A~E，实施+审核完毕）**：`lib/settingsLinks.ts` 成为全站跳设置唯一入口（tab/section/template 深链，设置页滚动+一次性高亮，带 15 次重试等异步区块）；`shared/SourceChip`（项目默认/配方默认/内置默认/本次覆盖）接入提交面板、审核页第一步来源说明行+第三步音色、添加内容对话框；`shared/PromptPeekSheet` 只读查看 Prompt 正文（审核页两处 + 添加内容配方旁）；草稿溯源（`draftSetProvenance`）展示在审核页与条目抽屉；看板多选起草可当场确认/切换配方；切换器下拉每项目显示语言/平台概况。**审核修复 1 族**：项目默认配方/模板被清空为空串后，4 处 `??` 判空不回落（ProjectsPanel 编辑器初始化×2、审核页初始化、看板配方初选），统一改 `||`。纯前端改动，无需重启后端；前端 typecheck/lint/20 单测全绿。

- **2026-07-05｜多项目上线（prd-multi-project.md WP1-WP5，实施+审核完毕）**：品牌级项目实体（`pixelle_video/content/projects.py`，存 `data/projects.json`）+ `api/routers/projects.py`（CRUD/设默认/归档恢复，默认与最后一个 active 项目不可归档）；幂等迁移从 ops.db 建 PetWoods 项目并归拢存量条目；content-items/草稿集/三个出片入口全部打 project_id 标（旧数据读取端兜底默认项目）；解析链接通（起草配方插项目层、`_default_template_for_project` 替换两处硬编码、语言真源从配方迁到项目、音色/发布平台预填项目默认）；前端 `lib/currentProject.ts` + AppShell 切换器 + ProjectsPanel 管理区，删除 ProjectDefaultsSection。**审核修复 4 处**：① 添加内容对话框配方预选忽略项目默认配方（改为 项目默认>全局默认，且随项目切换重置）；② 项目编辑里「用全局默认配方/内置默认模板」被 undefined 序列化丢弃、永远清不掉已设默认（改发空串，后端真值判断天然兼容）；③ `list_projects` 默认回退用 set 迭代序（不确定性漂移，改 created_at 序）；④ 配方管理区描述仍写"写哪些语言"（语言已归项目）。测试：`projects_test.py`/`projects_resolution_test.py` 已审读，前端 typecheck/lint/20 单测全绿；pytest 与 build 待本地跑。

- **2026-07-05｜起草配方全自助（D1-D4 完成）**：内容侧对齐生产侧的"配方管默认"。① 后端 `pixelle_video/content/drafting_profiles.py`：DraftingProfile 模型（口播/分镜 Prompt 名、模型、默认语言、每语言模型），存 `data/drafting-profiles.json`，首个配方自动设默认，删默认配方自动改派；② API `api/routers/drafting.py`：配方 CRUD + 设默认，Prompt 模板 CRUD（内置只读，改/删内置返回 400 并引导"复制为自定义"；被配方引用的 Prompt 禁删）；③ 起草解析链（`create_script_review_draft_set`）：显式传参 > 指定/默认配方 > 安全内置（Short Oral Script / Copy-Safe Scene Split），draft_settings 记录配方 id/名与实际模型（可审计）；④ 前端：设置页新增「起草配方」管理区（配方卡片 + 编辑 Sheet + Prompt 内容编辑 Sheet，内置模板一键复制为自定义），添加内容对话框选题页新增配方下拉（默认选中星标配方并带入其语言），文案审核页首步默认值改从默认配方初始化。验收口径：**新增/修改配方（含 Prompt 正文）零代码；改默认配方一处，看板起草/添加入池/审核页下次起草全部生效**。附带修复：`_resolve_prompt_template` 此前取列表第一项（自定义排前）导致宠物内容误用八字命理 Prompt，现固定安全内置兜底 + 回归测试。测试：`tests/drafting_profiles_test.py`（配方 CRUD/默认链/Prompt CRUD/起草走默认配方），前端 typecheck/lint/21 单测全绿。

- **2026-07-05｜技术债清偿**：① 修复 R1 遗漏——批次重试（`_compile_batch_retry_request`）此前丢弃 item.params 中的白名单覆盖（每语言 Fish 音色等），现合并进 input 经白名单还原，遗留占位批次保留旧分支兼容，配两个回归测试；② 起草失败原因（draft set errors 按选题匹配）写进条目退回事件 detail，抽屉动态区红字展示；③ 素材条目在抽屉给出出片指引（本期从新建视频入口）；④ `source`（selfhost/runninghub 执行端）纳入覆盖白名单并补 i2v 的 allowed_user_params，模板默认配置可零代码切换素材分析执行端；⑤ 生产提交面板专家覆盖补 TTS 模式选择，与模板编辑器白名单对齐；⑥ LLM 空响应重试（`_call_llm_retrying_empty`，3 次退避）覆盖起草三个调用点。**明确缓拆**：两个占位模板（script_review/batch_production）因 ops 验收脚本与遗留批次数据深度引用而保留，拆除收益不抵风险，待 ops 验收脚本退役时一并清理。

- **2026-07-05｜R2/R3/R4 完成（前端）**：新增共享组件 `shared/ProductionSubmitPanel`（模板选择 + 模板默认只读摘要 chips + 「调整默认 → 设置」入口 + 专家模式「本次覆盖」折叠区）。批量页：删除 `BatchSharedSettingsPanel` 与 `buildBatchSharedInput`，item.input 只带内容字段（topic/script/title/n_scenes），模板可选、覆盖仅专家显式设置；审核第三步：删除画面/BGM/提示词字段，改为「选生产模板 + 每语言 Fish 音色」，baseParams 只剩流程强制项（split_mode=line、fish）+ 专家覆盖。全站生产参数表单收敛为一处。前端 typecheck/lint/21 单测全绿。
- **2026-07-05｜R1 完成（后端）**：`POST /script-review/draft-sets/{id}/tasks` 支持可选 `template_id`（默认走项目默认模板链路），校验模板必须 enabled + generate 入口 + script 输入；`_submit_generation_jobs_as_batch` 改走 `registry.compile_request`——模板 fixed_params（含模板级 overrides）打底、表单字段仅白名单内生效、`review_*` 溯源字段移入 metadata；batch 记录真实生产模板 id。API 客户端已支持 `templateId`。测试：更新既有审核提交用例 + 新增「指定 static 模板/拒绝非法模板」「模板默认 overrides 对审核出片生效（验收口径）」两个用例（`tests/generation_api_test.py`，待本地 pytest 确认）。

## 十一、阶段建议

- **第一步（后端先行）**：R1 + R2，接口向后兼容（`template_id` 可选，缺省行为不变），配 pytest；React 不动也能先验收后端。
- **第二步（前端统一）**：抽出共享「生产提交」组件 → R3、R4 落地 → 删除两处重复面板。
- **第三步（打磨）**：R5、R6、R7。
- 全程验收口径：**"在模板默认配置里改一个参数，三个入口的下一次出片全部生效"** ——这一条通过，本方案即成立。
