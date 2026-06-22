# Pixelle P1 UI Implementation Plan

> **For agentic workers:** 按本计划实施时，先完成 API 和状态模型，再实现 UI。每个任务都必须有对应测试或可重复 smoke 验证。不要把 Codex 运营动作搬进 UI。

**Goal:** 交付 P1 运营状态和配置 UI，让用户能查看 Pixelle Ops 状态、管理平台账号配置、检查内容资产和证据链。  
**Architecture:** Pixelle Ops 仍是真相源；API 提供只读查询和有限配置写入；UI 只负责展示、选择、配置平台账号和复制 Codex 下一步提示。  
**Tech Stack:** Python、FastAPI、Streamlit、SQLite、pytest、ruff。

---

## 1. 执行边界

P1 分三阶段：

1. API 和服务层补齐。
2. Streamlit UI 最小实现。
3. 体验验收和设计调整。

P1 不进入：

1. React 重写。
2. 真实 OAuth。
3. 小红书自动发布。
4. 平台自动取数。
5. UI 内生成视频。
6. UI 内锁预测或复盘。

## 2. 文件结构

预计新增：

```text
web/pages/5_📊_Ops.py
web/pages/6_🧭_Projects.py
web/components/ops_dashboard.py
web/components/ops_projects.py
web/utils/ops_api.py
tests/test_ops_ui_helpers.py
```

预计修改：

```text
api/routers/ops.py
api/schemas/ops.py
ops/service.py
ops/store.py
web/app.py
web/i18n/locales/zh_CN.json
web/i18n/locales/en_US.json
tests/test_ops_api.py
tests/test_ops_service.py
tests/test_ops_store.py
```

不应修改：

```text
codex_plugin/server.py
pixelle_video/
web/pipelines/
```

除非 P1 实施过程中发现 API contract 必须同步暴露给插件；否则不要动 Codex 插件。

## 3. 任务分解

### Task 1：补齐项目列表 API

目标：UI 可以读取项目和平台账号列表。

**Files:**

```text
Modify: api/routers/ops.py
Modify: api/schemas/ops.py
Test: tests/test_ops_api.py
```

步骤：

1. 在 `tests/test_ops_api.py` 添加失败测试：`GET /api/ops/projects` 返回项目数组，每个项目包含 `channel_accounts`。
2. 运行：

```bash
uv run pytest tests/test_ops_api.py::test_ops_api_lists_projects_with_channel_accounts -q
```

预期失败：路由不存在或返回 404。

3. 在 `api/routers/ops.py` 增加：

```text
GET /api/ops/projects
```

调用 `OpsService().list_projects()`。

4. 在 `api/schemas/ops.py` 增加 `OpsProjectsResponse`。
5. 重跑测试，预期通过。

### Task 2：补齐平台账号配置写 API

目标：UI 可以为项目添加平台账号。

**Files:**

```text
Modify: api/routers/ops.py
Modify: api/schemas/ops.py
Test: tests/test_ops_api.py
```

步骤：

1. 添加测试：`POST /api/ops/projects/{project_id}/channel-accounts` 可以创建账号。
2. 测试 payload：

```json
{
  "platform": "xiaohongshu",
  "account_name": "PetWoods 宠物森友会",
  "account_handle": "petwoods",
  "external_account_id": "xhs-petwoods",
  "status": "configured",
  "credential_ref": {
    "provider": "manual",
    "key": "petwoods/xhs"
  }
}
```

3. 写入时 source 固定为：

```json
{
  "kind": "ui",
  "surface": "p1_ops_ui",
  "confirmed_by_user": true
}
```

4. 路由只调用 `OpsService().create_channel_account()`。
5. 不新增发布、指标、复盘写 API。

### Task 3：补齐平台账号编辑 API

目标：用户可以修改账号显示名、handle、状态和 credential reference。

**Files:**

```text
Modify: ops/store.py
Modify: ops/service.py
Modify: api/routers/ops.py
Modify: api/schemas/ops.py
Test: tests/test_ops_store.py
Test: tests/test_ops_service.py
Test: tests/test_ops_api.py
```

步骤：

1. 在 store 测试里写失败测试：`update_channel_account()` 只更新允许字段。
2. 允许字段：

```text
platform
account_name
account_handle
external_account_id
status
credential_ref
```

3. 禁止字段：

```text
id
project_id
created_at
source_json
```

4. service 层验证账号存在，不存在返回 `channel_account_not_found`。
5. API 增加：

```text
PATCH /api/ops/channel-accounts/{channel_account_id}
```

6. 测试 API 不允许跨项目改写。

### Task 4：实现 UI 数据客户端

目标：Streamlit 页面可以复用 API 查询和错误格式化。

**Files:**

```text
Create: web/utils/ops_api.py
Test: tests/test_ops_ui_helpers.py
```

功能：

```python
def get_current_ops(project_id: str | None = None, channel_account_id: str | None = None) -> dict:
    ...

def list_ops_projects() -> dict:
    ...

def create_channel_account(project_id: str, payload: dict) -> dict:
    ...

def update_channel_account(channel_account_id: str, payload: dict) -> dict:
    ...
```

实现原则：

1. 如果 Streamlit 和 API 同进程难以调用 HTTP，优先直接调用 `OpsService`。
2. 不在 UI helper 中写 SQLite。
3. 错误统一转成用户可读 message。

### Task 5：实现 Ops Overview 页面

目标：用户能看当前状态和下一步。

**Files:**

```text
Create: web/pages/5_📊_Ops.py
Create: web/components/ops_dashboard.py
Modify: web/app.py
Test: tests/test_ops_ui_helpers.py
```

页面模块：

1. 项目选择。
2. 平台账号选择。
3. 当前周期。
4. 当前实验。
5. 下一步动作。
6. 内容资产预览。
7. 发布/指标/复盘摘要。
8. 事件时间线。
9. 复制 Codex 提示。

验收：

1. 单项目时直接展示状态。
2. 多项目时显示选择项目。
3. 多账号时显示选择平台账号。
4. `record_publish` 显示“回 Codex 登记发布证据”。
5. `done` 显示“当前闭环已收口”。

### Task 6：实现 Projects 页面

目标：用户能管理项目下的平台账号配置。

**Files:**

```text
Create: web/pages/6_🧭_Projects.py
Create: web/components/ops_projects.py
Modify: web/app.py
Test: tests/test_ops_ui_helpers.py
```

页面模块：

1. 项目列表。
2. 项目详情。
3. 平台账号列表。
4. 新增平台账号表单。
5. 编辑平台账号表单。
6. credential reference 帮助说明。

验收：

1. 能新增小红书账号。
2. 能编辑账号状态。
3. 不显示明文 token 输入框。
4. 不提供发布按钮。

### Task 7：状态和文案映射

目标：UI 不暴露内部工具名。

**Files:**

```text
Create or Modify: web/components/ops_dashboard.py
Create or Modify: web/components/ops_projects.py
Modify: web/i18n/locales/zh_CN.json
Modify: web/i18n/locales/en_US.json
Test: tests/test_ops_ui_helpers.py
```

映射：

```text
select_project -> 先选择项目
select_channel_account -> 先选择平台账号
lock_prediction -> 在 Codex 里锁定预测
submit_generation_draft -> 在 Codex 里提交生成草稿
approve_generation_draft -> 审核并批准文案
request_generation -> 在 Codex 里生成内容
check_generation_status -> 检查生成状态
check_generation_asset -> 检查生成资产
record_publish -> 登记发布证据
record_metrics -> 登记指标
write_retro -> 写复盘
done -> 当前闭环已收口
```

mock 规则：

1. mock publish 显示 `Mock 发布证据`。
2. mock metrics 显示 `Mock 指标`。
3. 不显示“真实发布成功”。

### Task 8：P1 UI smoke

目标：用真实本地 ops.db 或临时 DB 跑一个可重复验收。

**Files:**

```text
Create: scripts/p1_ui_smoke.py
Test: scripts/p1_ui_smoke.py
```

smoke 做：

1. 创建临时 ops DB。
2. 创建项目。
3. 创建平台账号。
4. 创建周期、实验、mock 完整链路。
5. 调用 UI helper 读取当前状态。
6. 断言下一步显示 `done`。
7. 断言 mock 标识保留。

命令：

```bash
uv run python scripts/p1_ui_smoke.py
```

预期：

```json
{
  "status": "ok",
  "current_next_action": {
    "kind": "done"
  }
}
```

### Task 9：设计 QA 和回归测试

目标：确认 P1 没有破坏 P0。

命令：

```bash
uv run pytest tests/test_ops_store.py tests/test_ops_service.py tests/test_ops_api.py tests/test_codex_plugin.py -q
uv run python scripts/p0_codex_smoke.py
uv run python scripts/p1_ui_smoke.py
uv run ruff check ops api web tests scripts
```

验收：

1. P0 smoke 仍到 `done`。
2. P1 smoke 到 `done`。
3. Codex 插件协议仍是 `p0.9.20260622`。
4. UI 没有新增运营写入口。

## 4. 推荐执行顺序

第一批只做：

1. Task 1：项目列表 API。
2. Task 2：新增平台账号 API。
3. Task 4：UI 数据客户端。
4. Task 5：Ops Overview。

第二批再做：

1. Task 3：编辑平台账号 API。
2. Task 6：Projects 页面。
3. Task 7：文案映射。
4. Task 8：P1 smoke。
5. Task 9：QA。

原因：

1. 先让 UI 读到真实状态。
2. 再补平台账号配置。
3. 最后做体验细节。

## 5. 前端实现前置条件

进入前端实现前必须确认：

1. P1 PRD 已确认。
2. 信息架构已确认。
3. 页面范围确认为 `Ops + Projects` 优先。
4. 技术路线确认为 Streamlit 先行，或另行确认 React 原型。

默认建议：

```text
先用 Streamlit 做 P1，保留现有 Pixelle-Video 工作台；P1 目标是验证信息架构和真实数据流，不做视觉重写。
```

## 6. 计划自查

覆盖检查：

1. 项目/平台账号模型：Task 1、2、3、6。
2. Codex-first 边界：Task 5、7、9。
3. 发布和 metrics 展示：Task 5、7、8。
4. mock 与真实证据区分：Task 7、8。
5. P0 不回退：Task 9。

不做项检查：

1. 没有 UI 生成入口。
2. 没有 UI 发布入口。
3. 没有 UI metrics/retro 写入口。
4. 没有 React 重写。
5. 没有 OAuth 承诺。
