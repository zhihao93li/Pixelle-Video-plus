# Pixelle UI Refresh 设计 QA

日期：2026-07-11
范围：UI Refresh Phase 0–2（合同冻结、Foundation / Shell、正式桌面 surface 收口），不含 Streamlit，也不代替生成、持久化与发布工程合同验收。

## 阶段门口径

- Phase 0–2 的阶段门只要求桌面端正式路由可达、单一壳层、浅深主题、核心键盘交互和 serious / critical Axe 检查通过。
- 390 / 320 布局、移动端 sticky CTA、底部导航与 safe-area 仍保留回归，但从本次起降为非阻断项，不作为 Phase 0–2 完成条件。
- 本文中的“通过”仅表示上述范围，不表示全产品上线就绪。

## 对照基准

- 视觉基准：`public/demo/selected-split-canvas-reference.png`（1487 × 1058）。
- 正式实现：`tests/e2e/visual.spec.ts-snapshots/reference-viewport-generation-editing-darwin.png`（1487 × 1058）。
- 同尺寸并排对照：`design-qa-artifacts/ui-refresh/formal-reference-comparison.png`。

正式页保留了参考方案的侧栏、页头主动作、左编辑/右预览、设置摘要和低频设置折叠层级。下列差异是正式产品合同导致的有意差异：

- 主导航为五项真实路由，不保留 Demo 的重复壳层。
- 页头增加真实配方、产物类型和预估信息。
- 正式预览不带入 Demo 猫图；未选用业务素材时以真实分镜文本表达。

## 可见质量检查

- 字体与层级：Geist 变量字体、单一 H1、统一标题/辅助文本比例。
- 布局与间距：正式生成页为 split-canvas，主输入扩大，高级设置默认收起；全站使用同一壳层和间距节奏。
- 颜色与表面：浅色/深色语义 token 覆盖 surface、text、border、brand 与全部状态色。
- 图像与产物：正式组件通过 `ArtifactPreview` 区分 video、image_set、text；固定猫图已删除。
- 图标：全部使用 Lucide 同一线性图标族，没有手写 SVG 业务图标。
- 桌面响应式：1440 与 1024 宽度在浅深主题下无页面级横向溢出；768、390、320 继续作为非阻断回归。
- 交互与状态：真实链接导航、路由焦点恢复、skip link、dirty 离开保护、AlertDialog 确认、Toast 反馈；移动端 sticky CTA 属补充回归。
- 状态语义：未知后端状态显示「状态待同步」，不再误判为 interrupted / idle，也不推断可取消或可发布。
- 项目边界：切换项目会整体重建项目作用域页面；生成草稿使用项目级 localStorage key，旧项目任务、结果、批次和素材不会串入新项目。
- 帮助内容：安全渲染标题、列表、代码、链接、strong/em、Markdown 图片和经 URL 白名单校验的 raw `<img>`，无 `dangerouslySetInnerHTML`。

## 自动验证证据

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run test:p1`：51/51 通过，包含 effective defaults、dirty overrides、嵌套参数比较与单任务 ViewModel。
- `npm run build`：通过；路由分包后主 chunk 262.10 kB，无 500 kB 警告。
- E2E 主套件共 9 个 spec；本文不固定记录易随新断言增长而过期的全量用例数。
- 本轮定向复核：`accessibility.spec.ts` + `interaction.spec.ts` 9/9 通过。
- 视觉回归：37 份基线（24 个桌面浅色正式 surface、9 个关键移动深色 surface、1 个同尺寸设计对照场景、3 个关键状态/安全区场景）。
- 响应式回归：全部正式 surface 仍覆盖 1440、1024、768、390、320 五档宽度与浅/深主题；其中移动档为非阻断证据。
- Axe：桌面浅色与桌面深色的全部正式 surface 无 serious / critical 问题。
- 真实浏览器：正式生成、任务和作品库已对接本地真实 API 数据；生成页 1 个 H1、0px 横向溢出，非默认配方下拉同时具有可见值与 accessible name；无效配方链接显示明确错误且不渲染伪编辑区。

## 交互闭环证据

- 标准生成：editing → submitting → completed → result，以及 failed、cancelled、submit error、result-fetch error 与就地重试。
- 配方来源：standard / asset / long-form 均从配方生效默认初始化；single / batch 只提交 dirty override，恢复默认删除 override，显式清空使用 `null` 合同。
- 右侧任务轨：idle 显示预估，submitting/queued/running 显示单一任务状态，completed 切为统一 `ArtifactPreview` 结果；批量提交后在右栏显示共享批任务面板。
- 未知状态：不暴露取消操作、不阻断新提交，原始状态只留在专家技术信息中。
- 批量：single / batch 切换、解析预览、确认 Dialog、partial failure、单项重试和完成回写。
- 素材生成：真实 File 输入 → uploading/submitting → completed result。
- 三类产物：video / image_set / text 均覆盖专属预览与下载/发布操作。
- 键盘与历史：首次 Tab 进入 skip link、桌面路由切换后焦点回到主内容、Dialog 焦点恢复、Settings 与作品库前进/后退、项目 dirty 离开拦截。
- 非阻断补充：320px 超长项目名、5000 字输入/长文、34px safe-area 与 200% reflow 近似仍保留回归。

## 工程合同边界

ENG-01 至 ENG-05 属于后端/持久化合同轨。本 Phase 0–2 UI QA **不对它们作“全部已落地”或“全部未落地”的总体判定**，也不在 UI 层制造 reconcile、静默 fallback 或假成功。Fixture 只证明页面对合同形状的呈现能力；每项 ENG 的真实链路状态应在对应工程验收中单独记录。

## 结论

Phase 0–2 桌面 UI 阶段门：**通过**。该结论不是全产品 final pass，不包含移动端阶段门或 ENG-01 至 ENG-05 的真实链路结论。
