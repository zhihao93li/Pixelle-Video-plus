# Pixelle UI Refresh 设计 QA

日期：2026-07-10
范围：全部正式 React 路由，不含 Streamlit。

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
- 响应式：1440、1024、768、390、320 五档宽度，浅深两个主题均无页面级横向溢出。
- 交互与状态：真实链接导航、路由焦点恢复、skip link、移动端 sticky CTA、dirty 离开保护、AlertDialog 确认、Toast 反馈。
- 帮助内容：安全渲染标题、列表、代码、链接、strong/em、Markdown 图片和经 URL 白名单校验的 raw `<img>`，无 `dangerouslySetInnerHTML`。

## 自动验证证据

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run test:p1`：39/39 通过。
- `npm run build`：通过；路由分包后主 chunk 259.77 kB，无 500 kB 警告。
- `npm run test:e2e`：57/57 通过。
- 视觉回归：31/31 通过（21 个桌面浅色正式场景、9 个关键移动深色场景、1 个同尺寸设计对照场景）。
- Axe：桌面浅色与移动深色主路由无 serious/critical 问题。
- Streamlit 迁移验证：44/44 通过。
- 真实浏览器：正式生成、三类 Special、Script Review、Settings/Help 实际路由无横向溢出，每页只有一个 H1；Help 实际返回内容渲染 2 张图片、27 个 strong 和 2 个 em。

## 工程合同边界

ENG-01 至 ENG-05 仍是后端/持久化合同轨，不在 UI 层制造 reconcile、静默 fallback 或假成功。对应页面已使用同形 fixture 覆盖设计与视觉回归；真实链路的最终业务验收仍以合同落地为前提。

final result: passed
