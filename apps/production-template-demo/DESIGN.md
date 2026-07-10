# Pixelle React 控制台 · 设计规范（Phase 1 起生效）

依据 `/design-system audit` 输出。所有新代码必须遵循；改到旧代码时顺手迁移。

## 审计摘要

组件审查：16 个 ui/ 组件 + 7 个 workspace。主要问题：ui/ 已有 Select/Tabs/Sheet/Switch 但 workspace 大量使用原生 `<select>`、裸 `<input className="h-9 rounded-lg border...">`（重复 40+ 处）、`<details>`；InlineError/Fact/StatusBadge/readableError/format* 在 5+ 文件各复制一份；无 toast、确认用 `window.confirm`。

## 1. Design Tokens（已定义，禁止绕过）

- 颜色：只用语义 token（`bg-background/card/muted/primary/secondary/destructive/accent` 及对应 foreground）。禁止硬编码 hex/oklch。品牌主色为 teal（`--primary: oklch(0.48 0.11 180)`）。
- 圆角：`rounded-lg`（卡片、输入、按钮默认）；`rounded-md` 用于卡内嵌套小元素。禁止任意值。
- 间距：卡片内容 `p-4`，页面 gap `gap-5`，表单字段间 `gap-4`，字段内 label/控件 `gap-1.5`。
- 字体：Geist Variable 已全局；正文 `text-sm`，辅助 `text-xs text-muted-foreground`，卡片标题走 CardTitle。

## 2. 组件使用规则

| 场景 | 用 | 不要用 |
| --- | --- | --- |
| 下拉选择 | `ui/select`（Select/SelectTrigger/SelectContent/SelectItem） | 原生 `<select>` |
| 文本输入 | `ui/input` | 裸 `<input className="h-9 ...">` |
| 表单字段结构 | `ui/field`（Field/FieldLabel/FieldDescription） | 裸 `<label className="flex flex-col...">` |
| ≤3 个互斥选项 | `ui/toggle-group`（segmented） | 下拉 |
| 折叠区（排障信息） | `shared/TechDetails` | 原生 `<details>` |
| 折叠区（表单分组） | `shared/AdvancedGroup`（记忆展开态） | 原生 `<details>` |
| 文件上传 | `shared/FileDropzone`（拖拽/多选/单删） | 原生 file input |
| 数值范围（音量/语速） | `ui/slider` | number input |
| 破坏性确认（删除/取消任务） | `ui/alert-dialog` | `window.confirm` |
| 操作结果通知（成功/后台完成） | `ui/toast`（useToast） | InlineNotice / 无反馈 |
| 表单校验与面板内错误 | `shared/InlineError` | toast |
| 键值元数据 | `shared/Fact` | 各文件私有实现 |
| 任务状态 | `shared/StatusBadge` | 各文件私有实现 |

共享层唯一来源：`src/lib/format.ts`（readableError、formatDuration、formatBytes、formatDate）与 `src/components/shared/`。**禁止在 workspace 文件内再定义同名 helper。**

## 2.5 容器选型（2026-07-07 起强制；依据 IBM Carbon 对话框模式、Shopify Polaris、Material 3）

任何二级界面动手前，先按「任务时长 × 信息结构」选容器。**默认选更轻的一级；拿不准时问自己：用户在里面要待多久、要不要看着外面的信息做决定。**

| 容器 | 适用 | 硬判据 |
| --- | --- | --- |
| Popover / 轻量 Sheet | 瞬时查看，秒级 | 只读、一眼看完（如 Prompt 只读预览） |
| 居中 Dialog | 单一动作，10 秒级 | **< 5 个输入**、不需要参照背景内容（如克隆起名、破坏性确认） |
| 侧抽屉 Sheet | 上下文相关的快操作 | 单一分区、**5–10 个输入**、需要看着背后列表操作（如出片确认） |
| 页面 | 分钟级工作 | **> 2 个分区、或含长文本编辑、或做决定需参考其他信息** → 必须页面，hash 路由可返回 |

**禁令**（违反任何一条 = 审核不通过）：

1. **弹层里不重造页面**——内容超出侧抽屉容量就升级为页面，不加宽、不加 tab 硬塞（Carbon："A modal is not an alternative to page"）。
2. **禁止弹层套弹层**——Sheet 之上不再开 Sheet/Dialog（破坏性确认 AlertDialog 除外）。需要二层的，说明第一层就该是页面。
3. **弹层内容是临时的**——需要持续存在、反复回访的信息（对象详情、档案）不放弹层（Polaris）。
4. 弹层必须由用户动作触发，任务保持单一聚焦，避免功能蔓延——一个弹层开始长 tab、长分区，就是它该变页面的信号（Carbon）。
5. **白名单只豁免容器，不豁免内容**——合法弹层/选择器内禁止出现内部 key（`use_case`、`input_requirements` 生值、`pipeline_id` 等，见 §4），禁止退役与停用项进入可选项。容器进白名单 ≠ 内容可以随意；陈列与文案规范照样适用。（教训：2026-07-08 生成页换模板 Sheet 容器合法，内容却裸奔内部 key + 退役项 + 视频时代文案。）

**当前合法弹层白名单（7 项，新增需评审）**：出片确认 Sheet（看板多选 / 内容详情，共 2 处复用同一 Sheet）、Prompt 只读预览（PromptPeekSheet）、新建项目 Sheet、克隆配方 Sheet、发布 Sheet、添加内容 Dialog。破坏性 / 额度确认 AlertDialog 属豁免类，不计入。~~生成页「换模板」Sheet~~ 已退役（2026-07-08，8→7，改为页头统一配方下拉 `shared/RecipeSelect`）。

**只读筛选 / 排序的 Popover 不算白名单弹层**：与 Select 同级的轻量交互（非持久信息、非跨页动作、只读），列表页把放不下的筛选项收进筛选 Popover 是合法用法，无需评审。（作品库当前把筛选平铺进筛选行、未用 Popover；备注留作后续列表页扩展依据。）

已知存量违规（改造排期见产品 spec）：内容条目抽屉（→ 内容详情页，P0）、项目编辑 Sheet 含嵌套 Prompt 编辑（→ 项目详情页，P1）。

## 2.6 页宽规范（2026-07-08 起强制）

页面主容器宽度只有三档，**全部左对齐（不 `mx-auto` 居中）**，禁止自创第四档。左对齐是为了切页稳定：内容左缘恒贴侧栏，切页只变右侧延展，不整体跳位（2026-07-08 用户反馈"切一下变一下"后改定；YT Studio/Stripe 同款）。顶栏标题容器同样左对齐，与内容天然共享左缘，无需宽度联动。

| 档位 | 类名 | 适用 | 现用页面 |
|---|---|---|---|
| **基准** | `max-w-[1240px]` | 默认，所有页面先用它 | 快速生产、生成页、任务、作品库、设置、三大详情页 |
| **宽** | `max-w-[1600px]` | 多列看板 / 宽表格，内容天然横向铺开才允许 | 工作台看板 |
| **窄** | `max-w-[960px]` | 单栏纯阅读 / 线性流程 | 多语言审核出片 |

~~顶栏跟随内容宽（contentWidth prop）~~ 已废弃（2026-07-08）：全站左对齐后标题与内容天然同左缘，宽度联动机制删除。

## 2.7 排版工艺（Stripe 尺度；2026-07-08 起，逐页套用）

信息密度与层级靠字阶和留白，不靠盒子。**逐页套用进度：作品库 ✓、任务页 ✓、内容详情页 ✓；生成页/出片面板、快速生产/看板、设置/审核/特殊生成待后续批次。**

- **字阶四档**：页题 18px/500、区题 14px/500、正文 13px、辅助 11–12px muted。禁止一页只有 xl 和 xs 两档硬跳。
- **盒子降级**：区块用「区题 + 发丝线（`border-b` / `border-t`）+ 留白」分隔；边框盒只留给独立可交互对象（可点卡片、输入控件、播放器容器、AlertDialog）；禁止盒中盒超过两层；纯展示的元数据用定义列表（label 11px muted 在上、值 13px 在下），不装盒。
- **状态色语义**：绿=完成、红=失败、黄=进行、灰=中性/排队，全站唯一映射 = `shared/StatusBadge`（中文 + 语义色，缺省回落中性 + 原文）。禁止再散落裸 Badge 显英文 status。
- **主色纪律**：一屏至多一个实心主按钮；主色仅用于主动作 / 激活态 / 链接，禁止装饰性使用。主色保留现有绿系，做纪律化不换色相。
- **参考分工**（对标谁，别抄错对象）：作品库 / 内容列表 → **YouTube Studio**（媒体行 + 状态列 + 数据列 + 行悬停操作）；配方陈列 → **HeyGen / Synthesia**；发布排期 → **Buffer**；排版工艺（字阶 / 发丝线 / 去盒子）→ **Stripe**（只当工艺参考，不抄它的对象模型）。

## 3. 反馈模式

- toast：提交成功、任务完成/失败、设置已保存、已复制。持续 4s，可手动关闭。
- InlineError：紧贴出错的表单/面板，标题 + 后端原文。
- 禁用按钮必须解释：按钮下方 `text-xs text-muted-foreground` 一行原因（"请先输入文案"），不允许裸灰按钮。
- 破坏性操作：AlertDialog，标题动词开头（"删除这条记录？"），确认按钮 destructive variant。

## 4. 文案规则（面向用户的文本）

- 禁用词：真实、mock、provider、workflow、pipeline、runtime、entry、task_id、Streamlit、迁移。
- 主按钮动词开头：开始生成 / 生成审核草稿 / 发布。
- 技术信息（ID、路径、stage 原文）一律收进「技术详情」折叠区（shared/TechDetails），默认收起。
- 标点：中文全角，中英文之间留半角空格。

## 4.5 专家模式边界

workflow / provider / runtime 级别的选项（画面 workflow、TTS 模式、TTS workflow、模板默认生成配置编辑）只在专家模式（设置页开关，`lib/expertMode.ts`）下渲染。新增此类字段时必须用 `useExpertMode()` 包住，不允许默认暴露。

## 5. 可访问性底线

- 图标按钮必须 `aria-label`；当前导航项 `aria-current="page"`。
- Dialog/Sheet 必须有 Title；焦点由 radix 管理，不手写 tabindex。
- 状态不只靠颜色：StatusBadge 带文字。
