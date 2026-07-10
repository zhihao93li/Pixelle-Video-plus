# PRD · 配置就地可得（Point-of-use Configuration）

> 执行对象：实施模型。产品决策已定稿；实现遵循本文与 `apps/production-template-demo/DESIGN.md`。
> 配套阅读：`prd-multi-project.md`（项目/解析链）、`drafting-config-design.md`（配方）。

## 1. 背景与问题

三层配置模型（设置管接入、项目/配方/模板管默认、表单管这一次）架构正确，但**表单上看不出一个预填值来自哪一层、内容是什么、去哪改**。具体断点（已核对代码）：

- 审核页第一步选了 Prompt 模板，正文只能去 设置→起草配方→编辑 里翻。
- 添加内容对话框的配方下拉只显示名字，看不到 Prompt 与模型。
- 所有「去设置」跳转都是 `navigate("/settings")` 裸跳页顶（全站仅 AppShell 一处，ProductionSubmitPanel 的「调整默认 → 设置」同样裸跳），设置页无锚点机制。
- 后端每份草稿都记录了 `draft_settings.drafting_profile_name/script_model` 等溯源字段，前端零展示。
- 看板多选「生成草稿」静默用项目默认配方，用户看不到将用什么。

用户诉求原话："我做哪一步，就可以获取哪一步的必要信息，而不是退到其他 tab 再去翻找。"

## 2. 目标与非目标

**目标（验收口径）**

1. 任何预填的关键默认值旁边能看到来源（项目默认/配方默认/内置默认/本次覆盖），点一下直达设置页对应区块。
2. 在选 Prompt/配方的地方能就地看到 Prompt 正文，不离开当前页面。
3. 每份草稿能看到"是谁生成的"（配方名+模型）。
4. 全程不新增任何"就地改默认"的入口——改默认仍去设置（deep-link 直达），就地只做查看、快速换"这一次"和新建。

**非目标**

- 就地编辑全局默认（误改风险，产品决策保留设置页仪式感）。
- 设置页信息架构重构（tab 结构不动，只加锚点）。
- 移动端适配、键盘快捷键。

## 3. 代码地图（已核对）

- 路由：`lib/router.ts` 的 `parsePath` **已支持 query**（返回 `URLSearchParams`），无需改路由层。
- 设置页：`components/SettingsWorkspace.tsx`，Tabs 结构 `value="general"/"templates"/"help"`；general tab 内依次 DiagnosticsPanel → ProjectsPanel → DraftingProfilesPanel → ExpertModeSection → 各 Section。
- Prompt 编辑 Sheet：内嵌在 `DraftingProfilesPanel.tsx`（`promptOpen` 状态，Sheet 在 ~521 行）——**不要抽取它**，另建轻量只读组件（见 WP-C）。
- 提交面板：`components/shared/ProductionSubmitPanel.tsx`（chips 组装在 ~55 行，「调整默认 → 设置」在 ~315 行）。
- 类型：`lib/generationApi.ts` 中 `draft_settings: Record<string, unknown>`（~183 行），溯源字段读取时收窄类型。
- 当前项目：`lib/currentProject.ts` 的 `useCurrentProject()`。
- 验证命令：前端 `npm run typecheck && npm run lint && npm run test:p1`，交付前 `npm run build`；本 PRD 无后端改动。

## 4. 工作包总览与顺序

| WP | 内容 | 优先级 | 依赖 |
|---|---|---|---|
| WP-A | 设置页锚点机制 + 全站 deep-link | P0 | 无 |
| WP-B | SourceChip 来源显性化 | P0 | WP-A |
| WP-C | Prompt 就地查看（PromptPeekSheet） | P0 | WP-A |
| WP-D | 草稿溯源展示 | P1 | 无 |
| WP-E | 看板起草配方确认 + 切换器摘要 | P1 | WP-B |

## 5. WP-A · 设置页锚点机制

约定 URL：`/settings?tab=<general|templates|help>&section=<id>`，可选 `template=<模板id>`。

- SettingsWorkspace 用 `usePath()+parsePath()` 读 query：`tab` 控制 Tabs 的受控 value（无参默认现状）；`section` 匹配时对目标区块 `scrollIntoView({behavior:"smooth", block:"start"})` 并加一次性高亮（`ring-2 ring-primary/40` 类，1.5s 后移除，用 setTimeout + state）。
- 给四个区块加稳定 id：`projects`（ProjectsPanel 根）、`drafting-profiles`（DraftingProfilesPanel 根）、`llm`（LLM Section）、`tts`（语音 Section）。区块根元素加 `scroll-mt-20`（顶部导航遮挡补偿）。
- `tab=templates&template=<id>`：TemplateStatusPanel 滚动到该模板卡片并同样高亮（模板卡片加 `id={template.id}`）。
- 新增 `lib/settingsLinks.ts`：导出 `settingsLink(target)` 工具，target ∈ `{kind:"projects"} | {kind:"drafting-profiles"} | {kind:"template", id} | {kind:"llm"} | {kind:"tts"}`，返回完整路径字符串。**全站跳设置一律经它**，禁止再写裸 `/settings`。
- 改造存量入口：ProductionSubmitPanel「调整默认 → 设置」→ `settingsLink({kind:"template", id: 当前模板id})`。

验收：
- [ ] 从提交面板点「调整默认」，落到设置页模板 tab 且目标模板卡片高亮可见
- [ ] 手输 `#/settings?tab=general&section=drafting-profiles` 直达配方区
- [ ] 无 query 时设置页行为与现状完全一致

## 6. WP-B · SourceChip 来源显性化

新增 `components/shared/SourceChip.tsx`：

```tsx
type SourceChipProps = {
  source: "project" | "profile" | "builtin" | "override"
  to?: string          // settingsLink(...) 结果；不传则纯展示
}
// 文案：project→"项目默认"、profile→"配方默认"、builtin→"内置默认"、override→"本次覆盖"
// 样式：muted 小 chip（参照现有 chips），有 to 时可点击（navigate），hover 加下划线
```

接入点（判定规则：当前值 === 对应层的默认值时显示该层 chip；用户改过则显示「本次覆盖」，不带链接）：

1. **ProductionSubmitPanel** 模板选择行：选中模板 === 项目 `default_production_template_id` → `项目默认`（to=projects）；=== registry 内置默认 → `内置默认`；其他 → 无 chip（用户显式选的）。
2. **审核页第一步**顶部加一行来源说明（不做每字段 chip，降低噪音）：`默认值来自：项目「X」的配方「Y」`，「X」链到 projects 锚点、「Y」链到 drafting-profiles 锚点；数据用初始化时已拉的 project 与 profile。用户改动任一字段后此行文案变为 `默认值来自配方「Y」，部分字段已修改`（比较当前值与 profile 值）。
3. **审核页第三步**每语言音色输入：预填值 === 项目 `tts_voice_by_language[语言]` → `项目默认`（to=projects）chip。
4. **AddContentDialog**：配方下拉旁——选中 === 项目默认配方 → `项目默认` chip；语言 chips 标题改为 `语言`+`项目默认` chip（to=projects），用户改动 chips 后该 chip 消失。

验收：
- [ ] 上述 4 处 chip 按规则出现/消失；点击 chip 落到设置页正确锚点
- [ ] 全部走 settingsLink，`grep 'navigate("/settings")'` 仅剩 AppShell 的「管理项目…」（也改为 settingsLink({kind:"projects"})）

## 7. WP-C · Prompt 就地查看

新增 `components/shared/PromptPeekSheet.tsx`（**只读**，不复用 DraftingProfilesPanel 的编辑 Sheet）：

- Props：`{open, onOpenChange, kind: "script"|"split", name: string}`；打开时用现有 `listScriptReviewTemplates()` 拉全量并按 name 匹配（数据量小，可接受）。
- 内容：标题 = Prompt 名 + source Badge（内置/自定义）；正文只读 mono 展示（样式参照配方管理区的 Prompt 编辑器，但 textarea 换 `<pre>` 或 readOnly）；底部按钮「去编辑」→ `settingsLink({kind:"drafting-profiles"})`（navigate 前先 `onOpenChange(false)`）。不提供就地编辑与复制为自定义（保持只读边界，编辑动作收敛到设置页）。

接入点（均为 Select 旁 ghost 图标按钮 `Eye`，aria-label「查看提示词」）：

1. 审核页第一步：口播 Prompt Select 旁、分镜 Prompt Select 旁。
2. AddContentDialog：配方下拉旁（查看的是该配方的 script Prompt；tooltip 文案「查看口播提示词」）。

验收：
- [ ] 三处入口打开 Sheet 能看到完整 Prompt 正文与内置/自定义标识，不离开当前页
- [ ] 「去编辑」落到设置页配方区锚点

## 8. WP-D · 草稿溯源展示（P1）

`draft_settings` 读取收窄：`lib/generationApi.ts` 加导出类型 `DraftSetSettings = { drafting_profile_name?: string; script_model?: string; script_template_name?: string; project_id?: string }`（其余字段保留 unknown），提供 `draftSetProvenance(draftSet): string | null` 工具（`lib/format.ts` 或就地）：有配方名时返回 `配方「X」· <script_model 或 "默认模型">`。

接入点：
1. 审核页第二步草稿集头部（草稿集标题/状态行附近）加一行 muted 文案：`由 配方「X」· deepseek-v4 生成`。
2. ContentItemDrawer：draft_ready/pending_review 状态区块加同样一行（drawer 已 sync draftSet，数据可得；拿不到 draftSet 时不显示，不加载不阻塞）。

验收：
- [ ] 新起草的草稿两处都能看到配方名与模型；旧草稿（无字段）不显示且无报错

## 9. WP-E · 看板起草确认 + 切换器摘要（P1）

**看板**：WorkbenchBoard 多选动作栏的「生成草稿(N)」旁加一个紧凑 Select（宽度自适应，选项 = active 配方列表，初始 = 项目默认配方，显示为 `配方：X`）；选择结果传入现有 `generateDraftsForItems(..., { profileId, projectId })`。配方列表懒加载：动作栏首次出现时 `listDraftingProfiles()` 一次。无配方时不渲染该 Select（回落行为不变）。

**切换器**：AppShell 项目下拉的每个 SelectItem 加第二行 muted 小字：语言集（`languageLabel` 拼接）+ 发布平台数（如 `中文 / English · 2 平台`）。不 join 配方名（避免在 AppShell 拉配方列表）。当前项目的完整默认值看板 = 设置页项目卡片（已有）。

验收：
- [ ] 看板多选后能看到并当场换配方，起草结果 draft_settings 记录所选配方
- [ ] 切换器下拉能看出每个项目的语言/平台概况

## 10. 全局守则

同 `prd-content-workbench.md` 第 10 节全部条款。补充：

1. 本 PRD 纯前端，不改任何 API/后端文件；`draft_settings` 类型收窄只加不改。
2. 所有新组件进 `components/shared/`；chip/高亮样式用 Tailwind 语义类，禁止硬编码颜色。
3. 来源 chip 判定一律"当前值与该层默认值全等比较"，不引入 dirty-flag 状态机。
4. 每个 WP 完成跑 `npm run typecheck && npm run lint && npm run test:p1`；交付前 `npm run build`。

## 11. 开放项（遇到再问，不要自行发挥）

- 设置页锚点高亮的具体动效时长/样式可微调，但必须自动消失。
- 审核页第一步"部分字段已修改"的比较范围：script/split 模板名 + 两个模型字段，语言不参与（语言归项目）。
- deep-link 返回：不做"返回上一页"按钮，浏览器后退已可用（hash 路由）。
