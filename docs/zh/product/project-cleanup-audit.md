# 项目清理审计

更新时间：2026-07-04

## 结论

本轮适合做轻清理，不适合做大规模删代码或目录重构。根因是 Streamlit 迁移 gate 还没有关闭：Action Transfer 的 RunningHub workflow/runtime 真实 E2E 仍未通过，Buffer 真实发布仍按用户边界由人工确认。因此 `web/`、旧 Streamlit pipeline、legacy API 和对照脚本仍有保留价值。

## 已处理

| 类型 | 处理 | 依据 |
| --- | --- | --- |
| 过时文档 | 更新根 README 和 quick start，把 React 控制台标为新的产品入口，把 Streamlit 标为 legacy/debug | 当前 React 已通过 FastAPI task 接口覆盖生成、历史、设置、批量、文案审核和特殊 pipeline 主入口 |
| 过时 demo 说明 | 更新 `apps/production-template-demo/README.md`，删除“不调用真实后端”的旧说法 | 该工作区现在调用真实 generation/history/settings/resources/publish/batch/script-review API |
| 运行产物 | 清理项目目录内的 `__pycache__`、`.pytest_cache`、`.ruff_cache`、`.DS_Store` | 这些不是源码，也不应进入提交 |
| ignore 规则 | 增加 `.playwright-cli/` | Playwright CLI 运行目录是本地调试产物 |

## 确认保留

| 区域 | 是否删除 | 原因 |
| --- | --- | --- |
| `web/` Streamlit UI | 暂不删除 | 迁移完成前仍是 legacy/debug 和回归对照入口 |
| `web/utils/batch_manager.py` | 暂不删除 | 仍被 Streamlit `output_preview.py` 调用，且有测试覆盖 |
| `api/routers/video.py` | 暂不删除 | 旧 API 仍被挂载，可能被 legacy 调用或外部脚本使用 |
| `pixelle_video/pipelines/custom.py` | 暂不删除 | 仍属于 core pipeline 能力和文档示例范围，未证明无外部依赖 |
| React workspace 大组件 | 暂不拆分 | `ProductionStudio.tsx`、`BatchWorkspace.tsx` 等虽然偏大，但均有主入口引用；拆分属于后续重构，不是安全清理 |
| `scripts/verify_streamlit_migration.py` | 暂不拆分 | 文件较大，但它是当前迁移 gate 的唯一机器可读验收入口 |

## 已发现但不立即处理

| 优先级 | 项 | 建议 |
| --- | --- | --- |
| P1 | Action Transfer 真实 E2E 未通过 | 先修 RunningHub `af_scail` workflow/runtime，再考虑下线相关 legacy 对照 |
| P1 | Buffer 真实发布未跑 | 用户确认后执行真实发布验收；未确认前不自动发帖 |
| P2 | 根文档和 docs 仍保留大量 Streamlit 使用说明 | Streamlit 未下线前只标注 legacy，不删除说明 |
| P2 | `ProductionStudio.tsx`、`BatchWorkspace.tsx`、`HistoryWorkspace.tsx` 文件较大 | 等迁移 gate 稳定后按产品 surface 拆分 hooks、forms、task status 和 artifact preview |
| P2 | `scripts/verify_streamlit_migration.py` 过大 | 后续拆成 `capability_matrix`、`api_checks`、`browser_smoke`、`real_e2e`、`publish_checks` 模块 |
| P3 | 文档体系存在历史 PRD、技术方案、迁移矩阵并列 | 先保留，后续增加产品文档索引，明确“当前事实源”与“历史设计稿” |

## 后续清理门槛

只有满足以下条件，才建议进入结构性清理：

1. Action Transfer 真实 E2E 通过。
2. Buffer 真实发布由用户完成验收，或明确从下线 gate 中剥离。
3. `streamlit_replacement_gate` 通过，或文档明确 Streamlit 下线范围。
4. React 入口能覆盖日常生成、历史、发布、设置、批量、文案审核和特殊 pipeline 的真实流程。

满足这些条件后，才考虑删除或归档 Streamlit 页面、旧 direct API、旧 batch manager 和旧文档流程。
