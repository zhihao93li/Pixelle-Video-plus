# Pixelle P1-A UI Implementation Plan

版本：v0.4
日期：2026-06-23
状态：现行执行计划

## 1. 目标

P1-A 交付独立 Ops 前端，而不是在 Streamlit 里嵌入完整 Ops app。

目标结果：

1. `ops-web` 展示运营闭环、轮次轨道、步骤详情、证据抽屉和下一步。
2. `ops-web` 提供项目下平台账号配置。
3. Streamlit 继续作为视频生成工作台，默认进入 `Create`。
4. Ops 前端通过现有 `/api/ops/*` 读取状态，只允许写入平台账号配置。
5. 构建后的 `ops-web/dist` 可由 FastAPI 挂载到 `/ops`，避免生产上强制拆成两个正式产品服务。

## 2. 不做

1. 不重写视频生成前端。
2. 不把 Ops app 嵌进 Streamlit。
3. 不从 UI 触发推荐、预测、生成、发布、指标、复盘或 memory 写入。
4. 不新增顶层 Assets 或 Experiment Detail。
5. 不把 mock 发布或 mock 指标显示成真实结果。

## 3. 实施顺序

### Task 1：撤回错误的 Streamlit Ops 方向

1. 从 `web/app.py` 移除 `Ops / Projects` 默认导航。
2. 删除 Streamlit Ops 页面、Projects 页面和相关组件/helper。
3. 保留旧 `Create / History / Settings / Help`。
4. Streamlit 默认页恢复为 `Create`。

验收：

```bash
uv run python -m py_compile web/app.py
```

### Task 2：保留并验证 Ops API

保留：

```text
GET /api/ops/current
GET /api/ops/projects
GET /api/ops/projects/{project_id}/cycles
GET /api/ops/integrations
POST /api/ops/projects/{project_id}/channel-accounts
```

验收：

```bash
uv run pytest tests/test_ops_api.py -q
```

### Task 3：新增独立 Ops 前端

新增：

```text
ops-web/
  package.json
  vite.config.ts
  src/
    App.tsx
    api.ts
    opsModel.ts
    types.ts
    styles.css
```

前端职责：

1. Ops：项目、平台账号、轮次轨道、六步闭环、当前步骤工作面、Inspector、证据抽屉。
2. Projects：项目下平台账号列表、新增账号表单和 P1-B 账号编辑表单。
3. Create / History / Settings：跳转到旧 Streamlit 工具入口。

验收：

```bash
cd ops-web
npm install
npm run build
```

### Task 4：处理边缘状态

必须覆盖：

1. API 连接失败。
2. 没有项目。
3. 多项目需要选择。
4. 没有平台账号。
5. 多平台账号需要选择。
6. 没有运营轮次。
7. 轮次没有内容实验。
8. 当前步骤缺失证据。
9. mock 发布 / mock 指标必须显式标记。
10. `next_action: done` 显示闭环已收口。

### Task 5：部署形态

开发：

```text
FastAPI: http://localhost:8000
ops-web: http://localhost:5173
Streamlit video workbench: http://localhost:8501
```

构建后：

```text
FastAPI /api/ops/*
FastAPI /ops -> ops-web/dist
Streamlit 仍可作为视频工具单独运行
```

### Task 6：浏览器验收

验收路径：

1. 打开 `http://localhost:5173`。
2. 确认不是 Streamlit 页面，也没有双层导航。
3. Ops 默认展示项目、当前轮次、轮次轨道和当前步骤。
4. 点击闭环步骤，工作面、Inspector、证据抽屉同步变化。
5. 点击 Projects，能看到平台账号、新增账号表单和编辑账号表单。
6. 点击 Settings，进入 `ops-web` 的全局集成状态页；点击 Create / History，跳到旧 Streamlit 工具入口。
7. 新增或编辑平台账号保存后，当前 UI 选中刚保存的账号。
8. 无账号空态跳到 Projects；无轮次空态提示回 Codex 直接问 `@pixelle-ops`，不在 UI 写运营事实。
9. 顶部展示项目、平台账号、选中轮次、当前实验和下一步，并明确 Codex 自然语言是主路径。
10. “复制兜底上下文”是弱入口，复制内容包含当前选中的 project/account/cycle/experiment ID，并要求上下文不完整时先确认。
11. 切换历史轮次后，顶部选中轮次、工作面、证据抽屉和兜底上下文同步变化。
12. Settings / Integrations 展示 LLM、RunningHub、ComfyUI、Fish Audio、COS、Buffer 的脱敏状态；不展示任何明文 key/token/secret。

## 4. 验收命令

```bash
uv run python scripts/p1_codex_direct_entry_smoke.py
uv run python scripts/p1_ops_ui_smoke.py
uv run pytest -q
uv run ruff check api/app.py web/app.py api/routers/ops.py api/schemas/ops.py ops/service.py ops/store.py codex_plugin/server.py tests/test_ops_api.py tests/test_ops_service.py tests/test_codex_plugin.py scripts/p1_codex_direct_entry_smoke.py scripts/p1_ops_ui_smoke.py
cd ops-web && npm run build
git diff --check
```

`scripts/p1_codex_direct_entry_smoke.py` 是 Codex 自然语言主路径的合同测试，必须覆盖：

1. capability 声明 `primary_entry = codex_natural_language`。
2. UI 复制内容只能作为 `fallback_only`。
3. 多项目未选择时返回 `select_project`。
4. 选中多账号项目但未选账号时返回 `select_channel_account`。
5. 选中具体平台账号后直接返回内容闭环下一步。
6. 单账号项目自动带上该账号，不额外要求用户选择。
7. 只读状态查询不能写入运营事实。

`scripts/p1_ops_ui_smoke.py` 是 P1-A 的边缘态合同测试，必须覆盖：

1. 多项目时要求先选项目。
2. 单项目多平台账号时要求先选平台账号。
3. 无周期时提示创建周期。
4. 有周期但无实验时提示创建实验。
5. `generation_completed` 之后必须先 `asset_checked`，不能直接进入发布。
6. 本地输出视频资产必须可被 Ops UI 预览。
7. mock 发布证据必须保留 `mock: true` 和非空 `mock_label`。
8. `GET /api/ops/integrations` 必须暴露全局服务状态，且 `returns_plaintext_secrets = false`。

说明：仓库全量 ruff 仍可能被旧代码 lint debt 阻塞，不作为本阶段完成门槛；本阶段只要求改动相关文件通过。
