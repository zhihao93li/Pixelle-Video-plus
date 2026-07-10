# PRD · 作品库成熟化改造 + 视觉 token 第一批（交实施模型执行）

> 执行对象：实施模型。方向、mockup、参考分工均已用户批准（2026-07-08）。
> 参考分工（已定，写进 DESIGN.md）：**作品库/内容列表对标 YouTube Studio**（媒体行+状态列+数据列+行悬停操作）；**配方陈列对标 HeyGen/Synthesia**（已实现，不动）；**发布排期对标 Buffer**；**Stripe 只当排版工艺参考**（字阶/发丝线/去盒子），不抄它的对象模型。
> 主色决定（已定）：**保留现有绿系**，做纪律化——不换色相，只收敛用法。
> 遵循既有守则：判空 `||` 禁 `??`；effect 依赖不放 isLoading/busy；渲染期 initKey；面向用户文案禁内部 key（`fixed`/`local` 这类参数生值也算，见 WP-C.5）；产物形态走 `lib/artifactKind.ts`；弹层白名单 7 项不得新增。
> 验证：前端 `npm run typecheck && npm run lint && npm run test:p1`；纯前端 + 文档，后端零改动。

## 1. 背景

作品库是用户点名"最难受的一页"：满屏盒子套盒子（右栏 11 个边框盒）、卡片网格装列表数据（大缩略图卡多数是灰占位）、84 个"已完成"徽标零信息量、"未返回"占位、`fixed`/`local`/英文 status 裸奔、数据回填后在列表不可见。**双栏主从骨架保留**（点行右栏即预览是核心动线，用户明确要求不引入二级页跳转），改的是皮和密度。

## 2. 目标与非目标

**目标（验收口径）**

1. 作品库一屏信息密度翻倍：左栏紧凑行列表（一屏 ≥12 行），失败条目红字直接可见，已回填数据的条目在列表行显示赞/藏/评摘要。
2. 右栏详情零边框盒：速览定义行 + 分区标题 + 发丝线，中文化所有值，缺值不渲染占位。
3. 状态徽标全站组件化：中文 + 色彩语义统一（本批接入作品库与批次卡，其余页面后续批次）。
4. 预览/发布/下载/删除动线零回归；深链 `?task=` 零回归。

**非目标**

- 二级详情页（双栏保留，明确不做）。
- 悬停自动播放视频（本期缩略图静态，行悬停只浮出操作按钮）。
- 换主色/全站重刷（其余页面的字阶与去盒子在后续批次逐页套用）。
- 后端改动、新增弹层。

## 3. WP-A · 全局地基（先做）

### 3.1 状态徽标组件 `components/shared/StatusBadge.tsx`

`StatusBadge({ status })`：任务/批次状态 → 中文 + 语义色。映射表（缺省回落 secondary+原文，防新状态裸奔）：

- `completed` → 「已完成」淡绿（`bg-emerald-500/10 text-emerald-700 dark:text-emerald-400` 风格，用现有 token 实现）
- `failed` / `partial_failed` → 「失败」/「部分失败」淡红
- `processing` / `running` → 「生成中」淡黄
- `pending` / `queued` → 「排队中」中性
- `cancelled` → 「已取消」中性

替换两处现存裸奔：`BatchStatusCard.tsx` 的 `BatchStatusBadge`（删掉，用共享件）、HistoryWorkspace 列表与详情的状态显示。

### 3.2 字阶与盒子纪律（写进 DESIGN.md，本批只在作品库执行）

DESIGN.md 新增 §2.7「排版工艺（Stripe 尺度）」：

- **字阶四档**：页题 18px/500、区题 14px/500、正文 13px、辅助 11-12px muted。禁止一页只有 xl 和 xs 两档。
- **盒子降级**：区块用「区题 + 发丝线 + 留白」分隔；边框盒只留给独立可交互对象（可点卡片、输入控件）；禁止盒中盒超过两层；纯展示的元数据用定义列表（label muted 11px 上、值 13px 下），不装盒。
- **状态色语义**：绿=完成、红=失败、黄=进行、灰=中性/排队，全站唯一映射（即 StatusBadge）。
- **主色纪律**：一屏至多一个实心主按钮；主色仅用于主动作/激活态/链接，禁止装饰性使用。
- **参考分工表**：作品库→YouTube Studio；配方陈列→HeyGen/Synthesia；发布→Buffer；排版工艺→Stripe。

## 4. WP-B · 作品库左栏 + 顶部（HistoryWorkspace）

1. **顶部一行**：统计裸数字（全部/完成/失败，失败>0 时红色；去掉三个统计盒）+ 搜索框 + 「形态」Select（全部/视频/图集/长文，按 `result.artifact_type` 过滤，旧数据缺省视频）+ 「状态」Select + 排序 Select。删除「筛选与排序」折叠盒（现有筛选项平移进这一行；放不下的丢进排序 Select 旁的次级 Popover——只读筛选属 Popover 合法用法，不算新增白名单弹层，在 DESIGN.md §2.5 白名单行备注一句）。
2. **行列表替换卡片网格**：每行 = 缩略图 32×44（视频/图集用现有缩略图，长文用文档 icon 位）+ 标题（13px/500，单行截断）+ 元行（12px muted：形态 · 时长/页数/字数 · 日期）。失败行元行红字带简因。选中态 `bg-muted`，键盘上下可导航（onKeyDown 上下键换选中，可选加分项）。
3. **数据摘要**：`listContentItems({ limit: 500 })` 建 task_id→metrics 映射（失败静默）；有回填数据的行元行追加「赞 x · 藏 x · 评 x」。找不到关联条目（直跑/批量旁路产物）不显示，无占位。
4. **行悬停操作**：hover 浮出两个 icon 按钮（下载、发布——仅视频形态显示发布，非视频复用"下载/复制"动作），点击不改变选中。
5. 分页/加载更多沿用现状机制。

## 5. WP-C · 作品库右栏详情去盒子

1. **标题行**：标题（18px/500）+ StatusBadge + 右侧操作组——「发布」唯一实心主按钮（非视频形态换「下载图集/复制全文」实心）、「下载」outline、「⋯」菜单收纳删除（删除确认 AlertDialog 保留）。
2. **速览定义行**（发丝线下方一行 flex-wrap 定义列表，全部缺值不渲染）：创建时间、完成时间、时长/页数/字数（按形态）、文件大小、声音（中文音色名）、配方（display_name，模板还在时链到 `/create/recipes/:id`，已删则纯文本）。删除现有全部 Fact 盒。
3. **主体两栏**：左 = 产物区（视频 9:16 播放器 / ImageSetView / TextArticleView，宽约 180-220px，形态分支沿用现状组件）；右 = 输入文案（13px，超 6 行截断 + 「展开全文」inline 切换）。
4. **Storyboard 紧凑行**：每镜 = 帧缩略 24×36 + 文案首行截断 + 「配图提示词」inline 展开/收起（12px muted 全文，不进弹层）。删除现在的灰盒堆叠与英文提示词大段直出。
5. **值中文化映射**（放 `lib/format.ts` 或就地常量）：`fixed`→「固定文案」、`ai`→「AI 起草」、`local`→「本地」、`comfyui`→「ComfyUI」、`fish`→「Fish Audio」；音色显示中文名（现有 languages/音色映射可查则用，查不到显示原值）。任何"未返回"占位删除——缺值不渲染该项。
6. **发布区**：现有发布 Sheet 动线与发布记录展示保留（白名单项），仅样式随本页去盒子（发布记录用行列表不用盒）。

## 6. WP-D · 文档同步

- DESIGN.md：§2.7 新增（见 WP-A.2）、§2.5 白名单行补筛选 Popover 备注。
- `product-definition-and-unification-spec.md` §十 头部追加实施记录。
- `architecture-map.md` 无概念变化，不动。

## 7. 开放项（遇到再问，不要自行发挥）

- 其余页面（任务/设置/快速生产/详情页）逐页套用 §2.7——后续批次，本批不碰。
- 悬停播放预览、列表虚拟滚动（>500 条再说）。
- 概览首页（"今天生产了什么"）——独立方向，另立 PRD。

## 附录 A · 像素级对照表（照抄，不要自行发挥间距与字号）

| 区域 | 实现 |
|---|---|
| 页内头容器 | `flex flex-wrap items-baseline gap-x-8 gap-y-2 pb-3 border-b` |
| 统计项 | label `text-xs text-muted-foreground`；数字 `text-xl font-medium tabular-nums`，失败>0 加 `text-destructive` |
| 筛选行 | `mt-4 flex flex-wrap items-center gap-2`；搜索 `h-8 max-w-[240px]`；Select trigger `h-8 w-auto text-sm` |
| 左栏行 | 外层 `group flex cursor-pointer gap-2.5 rounded-md px-2 py-2`，选中 `bg-muted`，hover `hover:bg-muted/50`；缩略图 `h-11 w-8 shrink-0 rounded object-cover`；标题 `truncate text-[13px] font-medium`；元行 `truncate text-xs text-muted-foreground`（失败行 `text-destructive`） |
| 行悬停操作 | `opacity-0 group-hover:opacity-100` 的 `size-7` icon Button（ghost） |
| 右栏标题 | `text-lg font-medium`；操作组 `flex gap-2`，发布 `size="sm"` 唯一 default variant，其余 outline/ghost |
| 速览定义行 | `mt-3 flex flex-wrap gap-x-6 gap-y-2 border-b pb-3`；item：label `text-[11px] text-muted-foreground`，值 `mt-0.5 text-[13px]` |
| 区题 | `text-sm font-medium`，计数后缀 `font-normal text-muted-foreground`；区块间距统一 `mt-5` |
| StatusBadge | `rounded-full px-2.5 py-0.5 text-xs font-medium`；完成 `bg-emerald-500/10 text-emerald-600 dark:text-emerald-400`；失败 `bg-destructive/10 text-destructive`；进行 `bg-amber-500/10 text-amber-600 dark:text-amber-400`；中性 `bg-muted text-muted-foreground` |
| Storyboard 行 | `flex gap-2.5 border-b py-2 last:border-0`；帧图 `h-9 w-6 rounded-sm object-cover`；文案 `truncate text-[13px]`；提示词展开 `text-xs leading-5 text-muted-foreground` |
| 输入文案 | `text-[13px] leading-6 text-muted-foreground`，收起时 `line-clamp-6`，「展开全文」`text-xs text-primary` |

**删除清单（右栏逐一核对）**：所有 `rounded-lg border bg-muted/30 p-3` 类包装盒；右栏中除「产物播放器容器、输入控件、AlertDialog」外不得残留任何 border 盒。左栏删除卡片网格与三个统计盒。

## 附录 B · 视觉验收流程（实施完成 ≠ 验收通过）

三件套全绿只是底线。实施后用户本地起前端，截三张图：①列表全景（含失败行与数据摘要行）②视频详情 ③长文详情，交回审核方对照本 PRD 与批准 mockup 逐区块核对，预期一轮微调清单后收敛。间距/字号与附录 A 不符即为缺陷，不接受"效果差不多"。

## 8. 验收清单

- [ ] 作品库顶部：裸数字统计 + 搜索/形态/状态/排序一行；无折叠筛选盒
- [ ] 左栏一屏 ≥12 行；失败行红字；已回填条目显示赞/藏/评；行悬停浮出下载/发布
- [ ] 右栏无边框 Fact 盒；速览行缺值不渲染；无「未返回」、无 `fixed`/`local`/英文 status 裸奔
- [ ] Storyboard 紧凑行 + 提示词 inline 展开；输入文案截断展开
- [ ] 三种形态（视频/图集/长文）详情均正常；发布/下载/删除/深链 `?task=` 零回归
- [ ] StatusBadge 接入作品库 + 批次卡，映射表含缺省回落
- [ ] DESIGN.md §2.7 + 参考分工表；spec 实施记录
- [ ] 前端三件套全绿；`npm run build` 留用户本地
