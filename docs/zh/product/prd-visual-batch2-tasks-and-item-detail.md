# PRD · 视觉批次二：任务页 + 内容详情页套 §2.7 工艺（交实施模型执行）

> 执行对象：实施模型。属 DESIGN.md §2.7「排版工艺」逐页施工的第二批（第一批=作品库，已验收）。
> **必读**：DESIGN.md §2.6/§2.7；`prd-library-maturity-and-visual-tokens.md` 附录 A 像素对照表——本批所有共享模式（行列表、区题、速览定义行、StatusBadge、间距节奏）**直接沿用该表，不再重复定义，也不得自行发挥**。
> 遵循既有守则：判空 `||` 禁 `??`；effect 依赖不放 isLoading/busy；渲染期 initKey 模式**不动**（内容详情页已有，只改皮不碰逻辑）；产物形态走 `lib/artifactKind.ts`；弹层白名单 7 项不得新增（出片 Sheet、发布动线、AlertDialog 全保留）。
> 验证：前端 `npm run typecheck && npm run lint && npm run test:p1`；纯前端，后端零改动。实施完成 ≠ 验收：用户截图（任务页全景、内容详情页视频态+长文态）交审核方对照。

## 1. 背景与范围

作品库已按 §2.7 改造验收，本批把同族手法搬到内容消费侧剩下两页：**任务页**（旧图标徽标、Card 套盒、空态盒）与**内容详情页**（右栏 6 个边框区块 + Fact 盒）。只改皮和信息层级，**所有数据流、轮询、编辑逻辑、动线零变动**。

## 2. 目标与非目标

**目标（验收口径）**

1. 任务页：页内头裸数字统计；任务行列表化（去每行边框盒）；新版 StatusBadge；无视频时代文案。
2. 内容详情页：右栏零 Fact 盒、区块用区题+发丝线分隔；状态徽标语义色；缺值不渲染。
3. 旧版 `feedback.tsx` 的 StatusBadge 全站归零并删除（全站状态徽标唯一来源 = `shared/StatusBadge.tsx`）。
4. 两页所有既有功能（取消任务、批次重试、逐语言编辑、出片、发布跃迁、数据回填、事件流）零回归。

**非目标**

- 生成页/出片面板（批次三）、快速生产/看板（批次四）、设置/审核/特殊生成（批次五）。
- `Fact` 组件本批不删（ProductionStudio/TemplateStatusPanel 还在用，批次三、五迁移后再删）；本批只把内容详情页的 1 处 Fact 迁走。
- 任何布局结构重排（两页骨架不变：任务页单栏、内容详情页左编辑右档案）。

## 3. WP-A · StatusBadge 收敛

1. `shared/StatusBadge.tsx` 扩展：新增 `ContentStatusBadge({ status })`，映射内容条目状态（用 `lib/contentItemMeta.ts` 现有 `statusLabel` 的中文）：`producing`→黄「生产中」、`published`/`measured`→绿、`archived`→中性、失败类→红、其余（idea/drafting/pending_review/produced/scheduled）→中性。色彩类名照第一批 StatusBadge 的四色（缺省回落 secondary+原文）。
2. 迁移旧版引用：TaskCenterWorkspace（随 WP-B 重构自然替换）、ProductionStudio 的 1 处（`<StatusBadge status={task.status} />` 处只换 import，样式随新版，其余不动——这是批次三前的唯一例外，因为要删旧件）。
3. 删除 `feedback.tsx` 中的旧 StatusBadge 与其 STATUS_CONFIG、失去引用的 icon import；grep 确认零残留。

## 4. WP-B · 任务页（TaskCenterWorkspace）

1. **页内头**（沿用库页附录 A 的统计样式）：`进行中 x · 已完成 x · 失败 x` 裸数字（从当前任务列表就地统计；失败>0 红），右侧保留「打开作品库」按钮（outline sm）。去掉「任务」Card 的 CardHeader/CardDescription 结构——页面顶部就是统计行+按钮，下接发丝线。
2. **任务行列表**：每行去边框盒，改 `flex items-center gap-3 py-2.5 border-b last:border-0`：新版 StatusBadge + 名称（13px/500 截断，fallback 文案「视频生成任务」→「生成任务」）+ 提交时间（12px muted）+ 右侧操作（完成→「查看与发布」ghost sm；进行中→「取消」ghost sm）。进行中行的进度信息若现有则以 12px muted 行内显示。
3. **空状态**：去边框盒，改纯文字（13px muted）+ 快速生产按钮，垂直留白 `py-10` 居左。
4. **批次区**：外层 Card 降级为「区题（批次）+ 发丝线」区块；行与展开（BatchStatusCard bare）保持现状；批次行内英文 batch_id 的 `font-mono text-xs` 保留（排障信息，合法）。批次区在上、任务区在下的顺序不变。
5. 轮询/追踪逻辑（useBatchPolling、taskCenter）零改动。

## 5. WP-C · 内容详情页（ContentItemDetailPage）右栏

左栏（语言 tab、标题/口播/分镜编辑、出片入口）**不动**。右栏改造：

1. **容器**：右栏外层去掉逐区块 `rounded-lg border bg-background p-3` 盒，改为一个无边框列，区块间 `border-b pb-4 mb-4`（最后区块无线）；每区顶部区题 `text-sm font-medium`。
2. **状态区**：区题「状态」→ ContentStatusBadge + 现有跃迁按钮组（按钮样式不变）；生产中的 15s 轮询提示行保留（12px muted）。
3. **溯源/速览**：Fact 盒与零散元数据合并为速览定义行（附录 A 样式）：项目、创建时间、语言数、溯源（draftSetProvenance 一句话）、关联任务数——全部缺值不渲染。
4. **产物区**：形态分支组件（video/ImageSetView/TextArticleView）不动，仅外层盒退壳；`id="product-artifacts"` 锚点保留（发布指引依赖它）。
5. **发布区**：非视频手动指引/视频去发布的分支逻辑不动，仅退壳；「标记已发布」按钮组不动。
6. **数据区**：赞/藏/评三输入 + 备注布局不动，仅退壳与区题化。
7. **动态区**（事件流）：每条事件改行式 `py-2 border-b last:border-0`：事件文案 13px + actor/时间 12px muted；失败事件文案 `text-destructive`。展开/收起逻辑不动。
8. 全页扫一遍：无「未返回」类占位、无英文状态/内部 key 裸奔（`ACTOR_LABELS`/`eventTypeLabel` 已有中文映射，沿用）。

## 6. WP-D · 文档同步

- `product-definition-and-unification-spec.md` §十 头部追加实施记录（注明批次二完成、旧 StatusBadge 已删、Fact 迁移进度 1/3 页）。
- DESIGN.md 无新规则，不动（§2.7 首行"逐页套用"后可加一句进度注：作品库 ✓ 任务 ✓ 内容详情 ✓）。

## 7. 开放项（遇到再问）

- 任务页统计是否含「批次」维度——本批不做，数字只算任务。
- Fact 组件的最终删除（等批次三/五）。

## 8. 验收清单

- [ ] 任务页：裸数字统计（失败红）、任务行无边框盒、新徽标、空态无盒、批次区题化；取消/重试/查看与发布全通
- [ ] 内容详情页右栏：零 Fact 盒零边框区块盒（AlertDialog/输入控件/产物播放器除外）、速览缺值不渲染、事件行式、失败红字
- [ ] ContentStatusBadge 色彩语义正确（生产中黄/已发布绿/失败红/其余中性）
- [ ] `feedback.tsx` 旧 StatusBadge 删除、grep 零引用；ProductionStudio 该处显示正常
- [ ] 左栏编辑、出片 Sheet、发布跃迁、数据回填、15s 轮询、深链全部零回归
- [ ] 前端三件套全绿；用户截图三张交审核
