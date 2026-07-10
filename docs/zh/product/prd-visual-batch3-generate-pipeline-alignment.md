# PRD · 视觉批次三：生成页产线同构 + 画面模板图选 + shadcn 官方排版参照（交实施模型执行）

> 执行对象：实施模型。方向与完整 mockup 已用户批准（2026-07-08）。排版决定（已定）：**用 shadcn 官方规范，不自创字号密度**——mockup 只定结构与分组，字号/控件高度/间距一律照 shadcn 官方 blocks 的用法（见附录 A 规格表）。
> 遵循既有守则：判空 `||` 禁 `??`；effect 依赖不放 isLoading/busy；渲染期 initKey；面向用户文案禁内部 key；产物形态走 `lib/artifactKind.ts`；零件中文标签走 `lib/pipelineParts.ts` 的 `PART_KEY_LABELS`；**弹层白名单 7 项不得新增（图选网格必须 inline，不做 Dialog/Sheet）**。
> 验证：前端 `npm run typecheck && npm run lint && npm run test:p1`；纯前端，后端零改动。实施完成 ≠ 验收：用户截图（视频配方全组、图文配方、批量态）交审核方对照。

## 1. 背景

用户实测反馈两个困扰：① 画面模板用下拉框选文件名，看不到样式——预览图（preview_url，已接回）该直接当选择器；② 生成页高级设置按"内容结构/画面风格/声音与音乐"分组，配方详情页按"产线步骤"分组，**同一批参数两张地图**，对不上。本批把生成页高级设置重排为与配方产线图同构：两页变成同一张地图的两个图层——配方页调长期默认，生成页调本次覆盖。

## 2. 目标与非目标

**目标（验收口径）**

1. 画面模板三处（生成页、配方详情页零件编辑、出片面板专家覆盖）统一为共享图选网格：缩略图点选、选中态、按方向过滤、无预览图显示名字卡。
2. 生成页高级设置按产线步骤分组（编号胶囊与配方页产线图一致），字段标签与 `PART_KEY_LABELS` 一字不差；惰性步骤显示"跳过"而不是隐藏。
3. 每字段有来源标注（改动过→「本次」chip；未动→灰字「配方默认」），提交区总结"本次覆盖 n 项（名称）"。
4. **提交 payload 语义零变化**：`buildStandardTemplateInput` 的字段集合与值来源与改造前完全一致（本批只动排布与选择器形态，不动数据流）。

**非目标**

- 已完成页面（作品库/任务/内容详情）的排版回改——观感统一留观察，违和再议。
- topic 入口的完整适配（当前无启用 topic 模板；代码分支保留，组映射按附录 B 预留即可，不必精修）。
- 来源标注的深度解析链（v1 = 与进入页面时的初值做脏值比较，不逆向解析 fixed_params/overrides 优先级）。
- 后端改动、新增弹层、帧图真渲染逻辑变更（按钮保留原功能）。

## 3. WP-A · 共享图选组件 `components/shared/FrameTemplatePicker.tsx`

- Props：`templates: ResourceTemplate[]`、`value: string`、`onChange: (key: string) => void`、可选 `defaultOrientation`（初始过滤，默认取当前选中模板的 orientation，找不到则 portrait）。
- 布局：inline 网格 `grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2`；每格 = 预览图（`apiResourceUrl(preview_url)`，按模板 width/height 设 aspect-ratio）+ 文件名去后缀（`text-xs text-muted-foreground truncate`）；无 preview_url 的模板 = 同尺寸名字卡（muted 底 + 模板名居中）。选中格 `ring-2 ring-primary` + 右上角 Check 图标。
- 顶部一行方向过滤（竖版/横版/方形，`ToggleGroup` size sm，按 orientation 分组计数，空分组不显示）。
- 默认显示前 12 格，超出显示「全部 N 个」按钮 inline 展开（不弹层）。
- 图片 `loading="lazy"`；点选即 `onChange`，无确认步。
- **三处接入**：① 生成页「5 每镜画面」组替换现有 Select+预览图；② RecipeDetailPage 的 `frame_template` 零件编辑器（`renderEditor` 对该 key 分支用本组件，替换文本/下拉）；③ ProductionSubmitPanel 专家覆盖的画面模板 Select（保留「使用模板默认」选项——网格顶部加一张"配方默认"卡代表 null）。

## 4. WP-B · 生成页高级设置产线同构（ProductionStudio）

### 4.1 组结构（视频/标准线，照批准 mockup）

删除现有「内容结构 / 画面风格 / 声音与音乐」三个 AdvancedGroup，重排为：

| 组头（编号胶囊 + 标题） | 内容 | 备注 |
|---|---|---|
| `1 写稿` | script 入口：一行灰字「本次跳过——你直接提供了文案」；topic 入口：说明"AI 将按内容方向写稿" | 惰性也显示，保证两页步骤编号对齐 |
| `2 分镜` | 拆分方式 ToggleGroup（topic 入口再加分镜数量） | |
| `3·4 配音` | 配音引擎 / 音色 / 语速 / 「试听这段声音」；TTS workflow 仍在专家行 | 引擎已常驻（上批修复），沿用 |
| `5 每镜画面` | FrameTemplatePicker + 模板自定义参数（嵌套小区块，标注"来自 {模板名} 模板"）；生图提示词 3 项 + 帧图真渲染按钮在专家行 | |
| `6 合成` | 背景音乐 / 音量 / 播放方式；行尾灰字「合成引擎：{值}（在配方里换）」链到配方详情页 | 合成引擎是配方级参数，如实告知不可本次覆盖 |

标题字段与文案输入区同卡（主料区），不进产线分组；批量态行为不变（多条粘贴区、标题隐藏、共享参数语义照旧）。

### 4.2 形态与白名单裁剪

组的显隐**禁止硬编码 pipeline 名**：按 `templateArtifactType` + 模板 `allowed_user_params` 裁剪——长文：1 写稿（跳过）+ 长文参数组（word_count/llm_model 若在白名单）；图文：无配音无合成组，保留分镜（注明按行分页）与画面组；i2v/assets 入口维持现有素材表单，仅组头样式统一。某组内字段全部不可用时整组隐藏（惰性"跳过"仅用于产线上真实存在但本次不执行的步骤）。

### 4.3 来源标注与提交总结

- 进入页面/切换配方时记录表单初值快照（沿用现有初始化时机，注意渲染期 initKey 守则）；字段当前值 ≠ 快照值 → 标签旁「本次」chip（`Badge` secondary + accent 文本），控件边框 `border-primary/50`；相等 → 标签旁灰字「配方默认」。
- 提交按钮左侧总结行：`本次覆盖 {n} 项（{中文名逗号列表，最多 3 个 + 等}）`，n=0 时显示「全部沿用配方默认」。
- 高级设置区头一行说明：「只影响本次 · 要长期生效去配方改默认」，后半句深链 `/create/recipes/{id}`。

## 5. WP-C · 排版规格：shadcn 官方 blocks 参照

执行时优先取官方源码对照（github.com/shadcn-ui/ui 仓库 blocks/ 目录，settings 与 dashboard 类 block）；不可联网则照附录 A。**禁止出现自创字号（如 text-[13px]）**，一律用 shadcn 默认档（text-xs/sm/base/lg）与默认控件高度。

## 6. WP-D · 文档同步

- DESIGN.md §2.7 追加一行：「排版参照 = shadcn 官方 blocks（settings/forms/dashboard 类）；mockup 只定结构分组，不定字号密度；禁自创字号档。」
- `product-definition-and-unification-spec.md` §十 头部追加实施记录。

## 7. 开放项（遇到再问）

- topic 入口骨架（产品上未决定要不要开）。
- 已完成三页与本批的观感统一（若上线后违和，单独小批次顺一遍）。
- 图选网格的预览图懒加载性能（模板超 50 个再优化）。

## 8. 回归清单（本批风险集中区，逐项验证）

- [ ] 提交 payload：视频/图文/长文各提交一次（可用 mock/单测断言），`buildStandardTemplateInput` 输出字段集合与改造前一致
- [ ] 批量模式：切换、粘贴解析、共享参数 merge、提交、就地批次卡全通
- [ ] 单条↔批量切换、配方下拉切换（视频↔图文↔长文）时组正确裁剪、表单值不串
- [ ] 试听、帧图真渲染、模板自定义参数提交照旧
- [ ] 出片面板（看板/详情/审核三入口）画面模板图选含「配方默认」项且行为不变
- [ ] 配方详情页 frame_template 零件图选保存后 overrides 正确落盘（校验器不变）

## 9. 验收清单

- [ ] 三处图选网格：点图即选、方向过滤、名字卡兜底、选中态清晰
- [ ] 生成页六组编号与配方详情页产线图一一对应；1 写稿显示"跳过"；6 合成指路配方
- [ ] 字段标签与配方页零件表一字不差；来源标注 + 提交总结正确
- [ ] 无自创字号；组间距/标签/描述节奏与 shadcn 官方 block 一致
- [ ] 回归清单全通过；前端三件套全绿；用户截三张图交审核

## 附录 A · shadcn 官方 blocks 排版规格摘录（不可联网时照此施工）

| 元素 | 规格 |
|---|---|
| 页面区块节奏 | 外层 `space-y-6`；表单内字段间 `space-y-8`（settings block） |
| 区块头 | 标题 `text-lg font-medium` + 描述 `text-sm text-muted-foreground` + `<Separator />`（settings block 模式；本页组头在标题行前加编号胶囊 `Badge variant="outline"`） |
| 字段 | `space-y-2`：`Label`（text-sm font-medium）→ 控件（默认高度，不缩）→ `FieldDescription`（`text-[0.8rem] text-muted-foreground`，这是 shadcn 自带档不算自创） |
| 两列字段 | `grid gap-4 lg:grid-cols-2` |
| 统计/摘要行 | dashboard-01 模式：数值 `text-2xl font-bold`，标签 `text-xs text-muted-foreground` |
| Card | 默认 padding（p-6），不加自定义 p-3/p-4 的紧缩变体 |
| 图标 | 16px（`size-4`）统一 |
| 主按钮 | 一屏一个 default variant（§2.7 既有规则） |

## 附录 B · 组编号与 PIPELINE_PARTS 对照

执行前先读 `lib/pipelineParts.ts` 的 `PIPELINE_PARTS`，组编号、零件中文名、字段 key 三者以它为唯一事实源；本 PRD 表格与其冲突时，以代码为准并在实施记录里注明。
