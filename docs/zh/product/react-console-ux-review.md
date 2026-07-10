# React 控制台 UX 审视与改版方案

日期：2026-07-04
范围：`apps/production-template-demo`（React 主控制台），以 PM + UI/UX 双视角审视信息架构、用户动线、交互与视觉一致性。

---

## 一、现状速写

当前应用是单组件路由（`ProductionStudio` 内 `activeView` state），顶部一行 8 个平铺按钮作为全局导航：

```
生成视频 | 历史与发布 | 文案审核 | 特殊生成 | 批量生产 | 模板状态 | 设置 | 帮助
```

各视图均为「左侧表单 + 右侧任务/状态卡」的双栏卡片布局。没有 URL 路由，没有全局任务状态，没有 toast/通知体系，表单控件混用原生 `<select>/<input>` 与 shadcn 组件。

**一句话诊断：这是一个按"迁移矩阵"逐条搬运 Streamlit 功能长出来的界面，信息架构反映的是工程迁移结构，而不是用户的创作动线。** 每个能力都能用，但用户需要先理解你们的 pipeline 分类学（标准/特殊/批量/审核后生成）才能开始干活。

---

## 二、问题清单（按严重度分级）

### P0 — 结构性问题，直接阻碍用户理解与任务完成

**P0-1｜四个并列的"创作入口"，用户无法预先判断该走哪个。**
生成视频 / 文案审核 / 特殊生成 / 批量生产 本质都是"我要做一条（批）视频"，区别只是输入物（文案/选题/素材/图片）和数量。现在它们是四个平级 tab，分类依据是后端 pipeline 归属（standard / script_review / special / batch），不是用户意图。用户第一次进来必须试错才能找到正确入口。

**P0-2｜模板选择会"瞬移"页面。**
`selectTemplateOrRoute`：在「生成视频」页更换生产线时，点到 `product_entry` 为 special/script_review/batch 的模板卡片，会直接把整个页面切到另一个 tab，且不提示、不保留已填内容。这是最反直觉的交互——用户以为在选模板，结果被传送走了。

**P0-3｜没有全局任务感知。**
任务状态只活在提交它的那个视图的局部 state 里（ProductionStudio、SpecialPipelinesWorkspace、BatchWorkspace 各自一套 task/poll state）。用户切换 tab 就"丢失"了正在跑的任务，只能去历史里翻；任务完成也没有任何通知。生成一条视频要 2–5 分钟，这段时间的体验是空白的。

**P0-4｜没有路由与状态持久化。**
无 URL（不能刷新恢复、不能分享链接、浏览器后退直接退出应用）；除主题外所有草稿、表单、选中项刷新即丢。批量和文案审核这类长流程输入丢一次就足够劝退。

**P0-5｜工程语言全面泄漏到 UI。**
"创建真实生成任务"、"真实后端生成"、"不选择 provider"、`generation_task_id`、`stage: xxx`、`pipeline_id`、migration_status/streamlit_source 徽章、成片/音频的 `/api/files` 文件路径 mono 块……这些是给开发者自证"不是 mock"的验收语言，不是产品语言。用户不需要被反复保证"这是真的"。

**P0-6｜「模板状态」作为一级导航暴露迁移矩阵。**
"React 可提交 / Legacy only / Planned"是团队内部的迁移进度看板，对用户是噪音。模板对用户的意义是"我能做什么样的视频"，应该是带预览的模板库，而不是状态表。

### P1 — 动线断裂与交互缺陷

**P1-1｜生成页首屏是"模板元信息"而不是"开始创作"。**
进入生成页，第一张卡是「当前真实生成方式」：版本号、entry 徽章、迁移状态、迁移备注、"项目默认生产线"下拉 + 保存按钮，然后才是"1. 填入文案"。主输入被推到第二屏。项目默认生产线是低频管理动作，不该占据核心动线首屏。

**P1-2｜"1 → 2 → 3"步骤编号横跨两栏，动线不连贯。**
"1. 填入文案"在左栏，"2. 任务状态""3. 结果"在右栏。视觉上它是并列双栏，编号却暗示纵向流程；窄屏时 2/3 沉到页面底部，提交后用户看不到任何反馈发生的位置。

**P1-3｜生成完成 → 发布，动线断裂。**
结果卡里只有视频预览和元数据，没有"去发布"动作。用户要自己切到「历史与发布」→ 在列表中找到任务 → 点选 → 滚到下方发布卡。最核心的价值闭环（生成→发布）要跨 3 步手工导航。

**P1-4｜高级设置是一个 20+ 字段的无分组大抽屉。**
原生 `<details>` 里平铺：标题、分镜数、画面模板、画面 workflow、TTS 模式/声音/workflow/语速/参考音频、BGM 选择/上传/音量/模式、模板参数、三个预览面板、提示词前缀/视觉上下文/生成规则。内容设定（标题、分镜数）和基础设施设定（workflow）混在一起——这直接违反你们自己在迁移矩阵里写的原则："普通用户不选择 provider、workflow、runtime"。

**P1-5｜三个预览（声音/画面/媒体）埋在高级设置底部。**
预览是建立信心、减少废片的关键功能，却被藏在折叠区第三屏，且"预览媒体"会真实消耗 RunningHub 额度而无任何成本提示。

**P1-6｜示例文案被预填成真实可提交内容。**
`sampleScript`（母猫配种文案）和默认选题直接填在输入框里，一键就能提交出一条用户根本不想要的视频（真实消耗额度）。示例应该是 placeholder 或"填入示例"按钮。

**P1-7｜批量输入靠裸 textarea + `---` 分隔符约定。**
只有"已识别 N 条"一行反馈，没有逐条解析预览，格式错了（如空行处理）用户在提交前无法发现，提交后是 N 个真实任务的浪费。

**P1-8｜历史页筛选器永久占据 4 个下拉的空间，列表无缩略图、无标题搜索。**
视频类内容的列表却纯靠文字（标题+task_id+时间）识别；发布卡在未选中/未完成任务时也整卡渲染。删除用 `window.confirm`，与整体 UI 割裂。

**P1-9｜文案审核页三区关系不明。**
左栏"生成草稿"和"草稿编辑器"上下叠，右栏是"确认与提交"+"最近草稿"。实际流程是 生成→编辑→提交 三步，但空间布局暗示不了顺序；草稿编辑器出现前右栏提交卡就已存在，处于长期不可用状态。

**P1-10｜禁用按钮不解释原因。**
`canSubmit` 为 false 时按钮只是灰掉。缺文案还是模板不支持？用户要自己猜。所有 workspace 都有这个问题。

### P2 — 一致性与打磨

- **控件混用**：`ui/select.tsx`、`ui/tabs.tsx`、`ui/sheet.tsx` 等 shadcn 组件已存在却大量使用原生 `<select>`、裸 `<input>`、`<details>`；音量/语速用 number input 而非 Slider；文件上传是原生 file input，无拖拽、无缩略图、无单文件移除。
- **反馈体系缺失**：无 toast；成功/失败靠散落的 InlineError/InlineNotice；"重新读取"按钮直接 `window.location.reload()`。
- **代码级重复**：InlineError、Fact、StatusBadge、readableError、formatDuration 等在 5+ 个文件里各复制一份，样式已开始漂移（历史页与生成页 StatusBadge 配色不完全一致的风险）。
- **导航自身**：8 个按钮在 <1100px 时换行成两行药丸；无 aria-current；当前页标题与 tab 高亮双重表达但 header 高度不稳定。
- **主题**：ThemeProvider 支持暗色但界面没有任何切换入口。
- **空状态**：全部是灰底文字框，无引导动作（例外：历史页有一句"先去生成视频"，但不可点击）。
- **无 i18n 层**：全部中文硬编码，夹杂 provider 英文名，后续做英文版要全量返工。

---

## 三、改版方案

### 3.1 目标信息架构：从"pipeline 分类"转向"创作动线"

用侧边导航（可折叠）替代顶部 8 按钮，收敛为 5 个一级区：

```
┌─ Pixelle
│
│  ➕ 新建视频        ← 唯一创作入口（含单条/批量/所有管线）
│  📋 任务            ← 全局任务中心（进行中 + 批次）
│  🎬 作品库          ← 原「历史」，成片资产视角 + 发布
│  🧩 模板库          ← 面向用户的模板浏览（内部状态移到设置）
│  ⚙️ 设置            ← 系统设置 + 项目默认生产线 + 帮助/FAQ
```

要点：

1. **「新建视频」统一收口四个创作入口。** 点击后进入模板/方式选择页（Gallery 形态，每个模板卡带预览帧图、输入要求、预计耗时），按用户意图分组而不是按 pipeline 分组：
   - 从文字开始（已有文案 / 只有选题 / 选题+多语言审核）
   - 从素材开始（照片视频成片 / 真实素材混剪 / 图生视频）
   - 数字人与动作迁移
   - 批量生产（选题批量 / 文案批量）

   选完模板进入对应表单。这样 P0-1、P0-2 一并消除——不存在"选模板跳 tab"，因为选模板本来就是流程第一步。

2. **「任务」成为全局对象。** 任务 state 提升为 context/store（一个 `useTaskCenter`），提交后动线是：表单页 → 跳转任务详情页（URL: `/tasks/:id`）。侧边栏"任务"项常驻运行中数量角标；任一页面任务完成时 toast +（可选）浏览器通知。TaskPanel 三份重复实现合并成一个任务详情组件。

3. **「作品库」= 成片视角。** 网格卡片（封面帧 + 标题 + 时长 + 状态），顶部一个搜索框 + 一个状态 segmented control，其余筛选收进「筛选」popover。详情抽屉（Sheet）内：预览、元数据、质量评审、**主 CTA「发布」**。发布表单只在点击后展开。

4. **「模板库」去工程化。** 只展示 enabled 模板：名称、描述、示例成片/帧图、输入要求、预计耗时，CTA「用它创建」。migration_status、pipeline_id、streamlit_source 移到设置页的"高级/诊断"折叠区，供团队自查。

5. **模板详情内提供「默认生成配置」编辑（专家模式）。** 配置分三层，各有明确入口：

   | 层级 | 影响范围 | 入口 |
   | --- | --- | --- |
   | 系统级服务接入 | provider 能不能用（Key/URL/音色） | 设置页（现有） |
   | 模板级默认 | 这条生产线以后每次生成（TTS 模式/声音/workflow、媒体 workflow、BGM 默认等） | 模板库 → 模板详情 → 默认生成配置（专家模式可见，**新增**） |
   | 单次任务覆盖 | 只影响本条视频 | 创建表单高级设置（专家模式可见） |

   记忆口径：**设置管接入，模板管默认，表单管这一次。** "把某个模板的 TTS 换成 Fish"这类诉求走第二层，改的是模板配置而非 pipeline 代码。此层需要后端补一个生产模板配置的读写 API（如 `GET/PUT /api/production-templates/{id}/generation-config`），并做参数白名单校验，防止把 pipeline 不支持的 provider 写进模板。

5. 路由采用 react-router（或 TanStack Router）：`/create`、`/create/:templateId`、`/tasks`、`/tasks/:id`、`/library`、`/templates`、`/settings`。刷新可恢复、可分享。

### 3.2 核心动线重设计

**A. 单条生成（最高频）**

```
新建视频 → 选模板（默认高亮项目默认生产线，一步可跳过）
        → 填内容（一栏式表单，主输入置顶）
        → [可选] 调整风格与声音（分组的高级设置）
        → 提交 → 任务详情页（进度 + 完成后就地预览）
        → 详情页 CTA：「发布」/「再来一条」/「存入作品库」
```

- 表单页布局改为**单栏主表单 + 右侧粘性摘要卡**（当前模板、输入类型、预计耗时、费用敏感操作提示、提交按钮）。步骤编号删除，摘要卡即"确认"。
- 高级设置从一个大抽屉拆成三个语义分组（Accordion）：**内容结构**（标题、分镜数/拆分方式、提示词规则）、**画面风格**（画面模板 + 帧预览、模板参数、提示词前缀/视觉上下文）、**声音与音乐**（TTS 模式/声音/语速 + 试听、BGM 选择/上传/音量）。
- workflow / media workflow / TTS workflow 下拉**默认隐藏**，在设置页开启"专家模式"后才出现——落实你们自己的产品原则。
- 预览动作放进对应分组的行内（选完声音旁边就是「试听」按钮，选完画面模板旁边就是缩略帧自动渲染），媒体 workflow 预览保留但标注"会消耗生成额度"。
- 预填示例改为 placeholder + 「填入示例」ghost 按钮。
- 提交按钮文案："开始生成"；禁用时下方一行灰字说明原因（"请先输入文案"/"该模板暂不可用"）。

**B. 生成 → 发布闭环**

任务完成视图（和作品库详情复用同一组件）底部固定操作条：`发布到社媒`（主）｜`下载`｜`重新生成`。发布点开为 Sheet，预填标题/caption（现有 buildDefaultTitle/Caption 逻辑保留），平台勾选 + queue/scheduled。发布成功 toast + 在卡片上留发布记录徽章。

**C. 批量**

- textarea 保留，但右侧实时渲染**解析预览列表**（每条：序号、标题、字数、可单条删除），解析错误行内标红。
- 提交前显示"将创建 N 个任务，预计消耗 X 分钟生成时长"确认。
- 批次进度并入全局任务中心（批次 = 可展开的任务组），移除独立的"最近批次"侧卡。

**D. 文案审核**

改为显式三步 Stepper：`1 生成草稿 → 2 逐条审核 → 3 提交生成`。步骤间线性推进，提交卡只在步骤 3 出现；每语言模型覆盖折叠进"高级"。

### 3.3 交互与视觉规范（一次性立规矩）

| 主题 | 规范 |
| --- | --- |
| 表单控件 | 全部换用 shadcn：Select、Slider（音量/语速）、Switch、RadioGroup（BGM 模式、拆分方式这类 ≤3 选项用 segmented 而非下拉） |
| 文件上传 | 统一 Dropzone 组件：拖拽、多文件、缩略图、单文件删除、上传进度；参考音频/BGM/素材共用 |
| 反馈 | 引入 sonner toast：提交成功、任务完成/失败、设置保存、复制成功；InlineError 只留给表单校验和面板内错误 |
| 确认 | 删除/取消任务/批量提交用 AlertDialog，替换 `window.confirm` |
| 折叠 | `<details>` 全部换 Accordion，记忆展开态（localStorage） |
| 状态徽章 | StatusBadge、Fact、InlineError、readableError、format* 收敛到 `src/components/shared/` 与 `src/lib/format.ts`，单一来源 |
| 文案 | 建立 `src/lib/copy.ts`（为将来 i18n 铺路）；禁用词表：真实、mock、provider、workflow、pipeline、entry、task_id（面向用户的文案中）；技术详情统一收进「技术详情」Collapsible（task_id、路径、stage 原文都放这里，服务排障） |
| 主题 | header 加暗色切换；空状态配图标 + 主 CTA 按钮 |
| 响应式 | 侧边栏 <1024px 折叠为图标栏 / Sheet；表单单栏化后天然适配窄屏 |

### 3.4 分阶段落地计划

**Phase 1（1–2 天，纯低风险改造，不动结构）**

1. 移除/收纳工程语言：按钮改"开始生成"，删掉"真实后端生成/不选择 provider"徽章，路径与 ID 收进「技术详情」折叠。（P0-5）
2. 生成页卡片重排：主输入卡置顶，模板信息压缩成一行摘要 + 「更换」按钮打开 Sheet；项目默认生产线移到设置。（P1-1）
3. 修复模板卡"瞬移"：跨入口模板在选择器中显示"将切换到 XX 入口"并要求确认。（P0-2 的临时解）
4. 预填示例改 placeholder + 按钮。（P1-6）
5. 禁用按钮加原因说明。（P1-10）
6. 引入 sonner；删除确认换 AlertDialog。
7. 抽取 shared 组件与 format 工具，消重复。

**Phase 2（3–5 天，结构改造）**

1. 引入 router，5 区侧边导航落地；「模板状态」并入设置。（P0-4、P0-6）
2. 任务状态提升为全局 store + 任务中心页 + 角标 + 完成 toast。（P0-3）
3. 「新建视频」模板 Gallery 作为统一创作入口，四个创作 tab 下线。（P0-1、P0-2）
4. 结果视图加「发布」CTA，发布改 Sheet，打通生成→发布。（P1-3）
5. 表单持久化（localStorage 草稿）。

**Phase 3（3–5 天，体验打磨）**

1. 高级设置三分组 + 专家模式开关 + 预览就近化。（P1-4、P1-5）
2. 作品库网格化 + 缩略图 + 搜索。（P1-8）
3. 批量解析预览 + 提交确认；批次并入任务中心。（P1-7）
4. 文案审核 Stepper 化。（P1-9）
5. 控件统一（Slider/Segmented/Dropzone）、暗色切换、空状态、响应式收尾。
6. 专家模式开关（设置页）+ 模板详情「默认生成配置」编辑；依赖后端模板配置读写 API，可与前端并行开发。

**验收口径建议**：每 Phase 结束跑一次"新用户 5 分钟测试"——一个没看过文档的人，能否在 5 分钟内从打开页面走到提交第一条视频并知道去哪看进度。Phase 2 后应能全程不碰帮助页完成"生成→发布"。

### 落地记录（2026-07-05）

Phase 1、2、3 已全部实现。关键落点：hash 路由 `src/lib/router.ts`；全局任务中心 `src/lib/taskCenter.tsx`（单一轮询源 + 终态 toast + localStorage 恢复）；侧边导航 `AppShell.tsx`（含暗色切换）；统一创建入口 `CreateGallery.tsx`；高级设置三分组（`shared/AdvancedGroup.tsx`，内容结构/画面风格/声音与音乐，记忆展开态）；专家模式 `src/lib/expertMode.ts`（设置页开关，workflow 级字段默认隐藏）；控件统一（`ui/slider.tsx`、ToggleGroup segmented、`shared/FileDropzone.tsx` 拖拽上传）；作品库网格缩略图 + 标题搜索 + 筛选折叠；批量解析预览（逐条可删）+ AlertDialog 提交确认 + 批次任务并入任务中心；文案审核三步 Stepper；模板级默认生成配置——后端 `GET/PUT /api/generation/templates/{id}/generation-config`（白名单校验，overrides 持久化在 `data/production-template-overrides.json`，`pixelle_video/generation/template_overrides.py`），前端在 设置→模板状态→专家模式 下编辑，测试见 `tests/template_overrides_test.py`。

尚待用户本地验证：`npm run build`（沙箱缺 rolldown Linux 原生依赖）与 `uv run pytest tests/template_overrides_test.py`（沙箱无法装 Python 依赖）。

---

## 四、附：本次审视依据的关键代码位置

| 问题 | 位置 |
| --- | --- |
| 8-tab 导航 / activeView | `ProductionStudio.tsx` L102–110, L615–680 |
| 模板选择瞬移 | `ProductionStudio.tsx` `selectTemplateOrRoute` L560–576 |
| 首屏模板元信息卡 | `ProductionStudio.tsx` `TemplateCard` L834–1046 |
| 20+ 字段高级抽屉 | `ProductionStudio.tsx` `StandardInput` L1342–1960 |
| 三份重复 TaskPanel/轮询 | `ProductionStudio.tsx` / `SpecialPipelinesWorkspace.tsx` / `BatchWorkspace.tsx` |
| window.confirm 删除 | `HistoryWorkspace.tsx` L338 |
| window.location.reload | `ProductionStudio.tsx` L692 |
| 预填示例文案 | `ProductionStudio.tsx` L98–99, L207 |
| 迁移状态外露 | `TemplateStatusWorkspace`（`ProductionStudio.tsx` L2450+） |
