# Pixelle 高保真方案全站推广审计

## 结论

不应把高保真 Demo 的“双栏分镜画布”复制到所有页面，但应将它的产品外壳、信息层级、语义色、控件密度与渐进式设置收敛为唯一设计系统。编辑中需同步观察结果的页面用 split canvas；列表、设置和线性流程保留各自最合适的信息结构。

## 页面优先级

### P0：首批

1. 唯一全局壳层：`AppShell`
2. 正式生成页：`/create/generate/:templateId`
3. 快速生产：`/create`
4. 作品库：`/library`
5. 工作台：`/board`

### P1：主链路联动

1. 任务中心：`/tasks`
2. 内容详情：`/board/item/:itemId`
3. 配方详情：`/create/recipes/:templateId`
4. 设置：`/settings`
5. 项目详情：`/settings/projects/:projectId`

### P2：继承新壳后再重排

1. 特殊视频流：`/create/special/:mode`
2. 多语言审核：`/create/script-review`
3. 模板状态与帮助

## 目标设计语言

- 冷白画布、极浅蓝灰侧栏，teal 只用于主动作、激活态与链接。
- 一屏只保留一个实心主按钮。
- 页面靠留白、字阶与发丝线组织，独立可交互对象才使用边框面板。
- 常用任务在主画布直接完成；风格用摘要行 + Sheet；低频技术参数收进高级设置或专家模式。
- 页题 `20–24px`，区题 `14–16px`，正文 `14px`，辅助 `12px`；面板圆角 `10px`。
- 编辑型工作台用流体宽度；详情与设置页保留限宽。
- 生成前、生成中、生成后保持同一布局，右栏在“预估 → 进度 → 成品”间切换。

## 必须收敛的共享层

1. `AppShellV2`：唯一侧栏、68px 上下文页头、项目选择、移动底栏和页级主动作插槽。
2. `PageFrame`：统一 `narrow / standard / wide / fluid-workspace` 宽度、gutter 与响应式。
3. `PageHeader / ObjectHeader`：消除壳层与详情页重复 `h1`。
4. `WorkspacePanel / WorkspaceSplitPane`：统一编辑 + 预览工作台。
5. `SettingsSummaryRow`：统一“竖版 · 音色 · 风格 / 调整”的简洁入口。
6. `AsyncState / EmptyState / InlineAlert`：统一 loading、empty、error、success 及读屏播报。
7. 增加 `success / warning / info` 语义 token，修正深色主题的 teal 映射。

## 之前代码需要变化的不只是样式

1. 将 Demo 并入正式 `ProductionStudio`，验收后删除 `/demo/studio`、重复导航、重复 localStorage key 和 `react_hifi_demo` 提交来源。
2. 保留正式页已有的 script / topic / assets / image-set / text / batch / cancel / result / quality / publish 能力，只替换视图与交互编排。
3. Demo 的三张猫图只是视觉样例。正式版应使用“文本分镜预估 + 配方示例帧”，或增加 storyboard preflight API；不能对任意文案继续显示固定猫图。
4. 项目作用域需要贯穿任务、作品库、统计和发布；当前工作台按项目过滤，作品库与任务列表仍偏全局。
5. 生成、ContentItem 与发布状态应由后端领域动作串起来，不再依赖前端多次请求手工回写。
6. 服务重启后的进行中任务需有 `unavailable / expired / recovered` 状态，避免 localStorage 残留“永远生成中”。
7. 把 `generationApi.ts` 拆成 generation / content / projects / library / publishing / settings / resources，并优先由 OpenAPI 生成或验证 TS contract。
8. 用 route manifest 统一 path、title、nav、layout、project scope 与 lazy loading，替代 `App.tsx` 长条件链。
9. 导航改为真实链接；作品库筛选、排序、分页与设置 tab 写入 URL。
10. 更新自动验收：当前 browser smoke 仍依赖已退役模板/旧入口，高保真路由也未进入自动测试。
11. Streamlit 不做新视觉改版；继续作为 legacy/debug，先把 FastAPI 对 `web.utils` 的反向依赖移到 `pixelle_video`，迁移 gate 通过后再下线。

## 可访问性与 Web 约束

- 正式移动端导航当前在顶部水平挤压，已出现页题竖排和导航裁切；应采用新方案的顶部任务栏 + 底部主导航，并处理 safe area。
- 全站增加 skip link 与统一 `main` 锚点。
- 导航用链接而不是 `button + navigate()`。
- 图标按钮保持 `aria-label`，表单控件有 label/name/autocomplete，异步状态用 `role=status/alert` 与 `aria-live`。
- 限制 `transition-all`，只动画 color / opacity / transform，并支持 `prefers-reduced-motion`。
- Slider 共享组件需支持将可访问名称传入 Thumb。

## 当前流程截图与健康度

1. `01-selected-demo.png`：选定设计基准，健康。
2. `02-workbench.png`：看板结构完整，空状态和响应式较弱。
3. `03-create-gallery.png`：能力齐全，主按钮过多、卡片同质。
4. `04-tasks.png`：功能可用，信息过薄，建议降为活动中心。
5. `05-library.png`：双栏基础正确，成品预览焦点不足。
6. `06-settings.png`：能力完整，技术设置与项目设置层级混杂。
7. `07-current-generation.png`：能力完整，参数先行，主动作过深，是首要改造目标。
8. `08-recipe-detail.png`：可用，技术字段与重复“更换”噪声较大。
9. `09-project-detail.png`：基本可用，存在多个保存点和技术 ID 感知负担。
10. `10-script-review.png`：线性流程正确，需去除迁移/技术文案并继承新壳。
11. `11-special-pipeline.png`：可用，与正式生成页共享布局的潜力较高。
12. `12-content-detail.png`：基本可用，项目作用域、产物状态与技术 ID 需要治理。
13. `13-mobile-current-generation.png`：不健康，页题竖排、导航挤压、主动作深。
14. `14-mobile-selected-demo.png`：移动端基准，健康。

## 证据边界

本次使用当前本地服务、当前项目数据和当前代码截图。未触发真实生成、发布、删除或设置保存；截图可以支持视觉、布局与部分语义审计，不等于完整 WCAG 合规证明。
