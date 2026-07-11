# Pixelle Console 设计与实现合同

本文件描述当前正式控制台。实现、测试和评审以这里与实际类型合同为准，不保留阶段记录、迁移清单或旧页面约束。

## 1. 产品原则

- 一个 AppShell、五项主导航：工作台、快速生产、任务、作品库、设置。
- 项目是内容、生成和作品的作用域；项目读取失败不能伪装成空项目。
- 生成、任务和发布状态必须来自真实 API；禁止静默 fallback、假成功和吞错。
- 普通用户只看到产品概念。provider、workflow、runtime 和内部 key 只在专家模式或技术详情中出现。
- 同一能力只有一个正式入口和一个共享组件来源，不保留 Demo 副本。

## 2. 页面布局

路由布局只在 `src/lib/router.ts` 定义，页面组件不得再传自己的宽度档位。`AppShell` 把布局写入 `data-layout`，`PageFrame` 统一读取 `--page-content-width`。

| 布局 | 最大内容宽度 | 用途 |
| --- | --- | --- |
| `workspace` | 不设上限 | 生成编辑器等连续工作区 |
| `wide` | 1920px | 看板、选择库、任务和作品主从视图 |
| `standard` | 1440px | 设置与对象详情 |
| `narrow` | 1040px | 线性审核和长阅读流程 |

有限宽页面必须居中，不能在超宽屏只留下单侧大块空白。页头与页面主体必须共享同一宽度和水平基线。

正式路由：

| 路由 | 布局 | 项目作用域 |
| --- | --- | --- |
| `/board` | `wide` | 是 |
| `/board/item/:itemId` | `standard` | 是 |
| `/create` | `wide` | 是 |
| `/create/generate/:templateId` | `workspace` | 是 |
| `/create/recipes/:templateId` | `standard` | 是 |
| `/create/special/:mode/:templateId?` | `workspace` | 是 |
| `/create/script-review` | `narrow` | 是 |
| `/tasks` | `wide` | 是 |
| `/library` | `wide` | 是 |
| `/settings` | `standard` | 否 |
| `/settings/projects/:projectId` | `standard` | 是 |

未知路由显示 404。设置分区、作品库筛选、分页和选中项必须进入 URL。

## 3. 生成工作区

- 桌面采用 split-canvas：左侧输入与设置，右侧在预估、任务和结果之间原位切换。
- 右侧轨使用 `minmax(420px, min(42%, 720px))`；左侧吸收其余宽度。
- 普通生成与专用生成共用 `workspace` 页面合同，不设置 1600px 上限。
- 核心输入和常用设置常驻；低频设置进入 Sheet；技术参数只在专家模式显示。
- 主画布不复制完整设置表单。
- 单条、批量、取消、重试、质量检查、三种产物和发布入口必须保留。

## 4. 视觉系统

- 颜色只使用 `index.css` 中的语义 token：background、surface、text、border、primary、success、warning、danger、info。
- 浅色与深色保持同一品牌色相和状态语义。
- 默认圆角 `rounded-lg`，内嵌小元素可用 `rounded-md`；不使用任意圆角值。
- 页面间距 `gap-5`，表单字段 `gap-4`，字段内部 `gap-1.5`。
- 主要层级依靠字阶、留白和发丝线，不用多层卡片套盒子。
- 一屏只保留一个主要实心动作；主色用于主要动作、链接和激活态。
- 动效仅用于 color、opacity 和 transform，时长 120–180ms，并尊重 `prefers-reduced-motion`。

## 5. 组件规则

| 场景 | 唯一实现 |
| --- | --- |
| 页面壳层 | `PageFrame`、`WorkspaceHeader`、`WorkspacePanel` |
| 下拉选择 | `ui/select` |
| 字段结构 | `ui/field` + `ui/input` / `ui/textarea` |
| 少量互斥项 | `ui/toggle-group` |
| 文件上传 | `FileDropzone` |
| 范围设置 | `ui/slider` |
| 破坏性确认 | `ui/alert-dialog` |
| 操作通知 | `ui/toast` |
| 区域错误 | `InlineError` / `AsyncState` |
| 运行状态 | `StatusBadge`、`SingleTaskPanel`、`BatchTaskPanel` |
| 产物 | `ArtifactPreview` |
| 发布 | `PublishComposer` |

禁止原生 `select`、`window.confirm`、页面私有状态色、重复错误组件和 `transition-all`。

弹层只处理短时、单一、上下文相关的任务。超过两个分区、含长文本编辑或需要持续回访的内容必须使用页面。禁止弹层套弹层，破坏性 AlertDialog 除外。

## 6. 数据与状态合同

前端页面消费 ViewModel，不直接解释后端 raw status 或 pipeline key。

- `ProjectScopeState`: `loading | empty | error | ready`
- `RunState`: `idle | uploading | submitting | queued | running | completed | failed | cancelling | cancelled | interrupted`
- `GenerationDraft<T>`: `defaults + overrides + dirtyKeys`
- `ArtifactViewModel`: `video | image_set | text`
- `ProductionRunViewModel`: 运行主体、总体进度、子任务和动作能力
- `PublishAttemptViewModel`: 平台、排期、发布、失败和重试状态

生成设置只有三层：项目默认 → 配方生效默认 → 本次覆盖。只有真正修改过的键进入 `overrides` 和 `dirtyKeys`。恢复默认是删除覆盖；显式清空继承值使用 `null`。

状态适配必须保留 `known | unknown` 区分。未知状态显示“状态待同步”，不能推断为运行中、终态或可取消。

## 7. 反馈与文案

- loading、empty、error、stale、ready 必须是独立状态。
- 错误出现在触发动作附近，并提供明确恢复动作。
- 成功和后台完成使用 Toast；表单校验和局部失败使用 InlineError。
- 禁用主要动作必须说明原因。
- 用户文案不暴露 task id、路径、stage、provider、workflow 或 runtime。
- 产物文案必须按 video、image_set、text 分支，非视频产物不能出现“时长”“成片”“生成视频”等词。

## 8. 可访问性与响应式

- 图标按钮必须有 `aria-label`，当前导航使用 `aria-current="page"`。
- Dialog 和 Sheet 必须有可访问标题，焦点交给 Radix 管理。
- 路由切换后焦点回到主要内容；保留 skip link。
- 状态不能只靠颜色表达。
- 桌面侧栏宽 224px；窄屏使用顶部项目栏和底部五项导航。
- Sheet 在小屏全宽，底部动作使用 safe-area token，主要触控目标至少 44px。
- 200% 缩放不能丢失内容、项目切换和主要动作。

## 9. 完成标准

```bash
npm run typecheck
npm run lint
npm run test:p1
npm run build
npm run test:e2e
```

正式路由必须通过加载、空、错误、过期和成功状态回归。Axe 不得出现 serious 或 critical 问题。测试截图只保留在 Playwright 基线目录，不提交人工审查过程图或临时报告。
