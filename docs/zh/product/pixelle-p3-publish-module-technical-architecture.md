# Pixelle P3 发布模块技术架构

版本：v0.1
日期：2026-06-27
状态：P3 技术方案基准稿
关联 PRD：`docs/zh/product/pixelle-p3-publish-module-prd.md`
相关文档：

- `docs/zh/product/pixelle-main-rebuild-technical-architecture.md`
- `docs/zh/product/pixelle-p2-cheat-on-content-prd.md`
- `docs/zh/product/pixelle-p1-ui-prd.md`
- `docs/zh/product/pixelle-p3-publish-ui-design.md`

## 1. 技术目标

发布模块只服务一个目标：

```text
用统一、可验证、可替换的接口，把已审核内容渲染成平台发布准备包，并在用户手动发布后记录发布证据。
```

技术上要解决四件事：

1. 发布输入稳定：所有发布都从 `PublishPackage` 开始。
2. 平台字段稳定：不同平台、不同内容类型由 renderer 生成复制块和 checklist。
3. 发布结果可验证：用户手动发布后必须产生 `PublishEvidence`。
4. 后续执行能力可替换：平台执行差异封装在 adapter 里，不污染 Ops 主流程。

## 2. 模块边界

### 2.1 依赖方向

```text
Codex Plugin / API / UI
  -> OpsService
      -> PublishService
          -> PlatformPayloadRenderer
          -> ManualEvidenceRecorder
          -> Future PublishAdapter
              -> Official API / Browser Automation
      -> Ops publish evidence apply
```

规则：

1. Ops 可以调用 PublishService。
2. PublishService 不直接改 Ops 闭环状态。
3. PlatformPayloadRenderer 不知道预测、复盘、cheat workspace。
4. Future PublishAdapter 不知道预测、复盘、cheat workspace。
5. PublishEvidence 通过 Ops 校验后，才变成 Ops 的 `publish_recorded` 事实事件。
6. UI 不直接调用平台 adapter，不直接写数据库。

### 2.2 和现有模块的关系

| 模块 | 职责 | 发布模块如何使用 |
|---|---|---|
| `ops` | 产品事实、闭环状态、证据校验 | 创建 package 前读取当前 content item 和 asset check；证据通过后写 publish event |
| `pixelle_video` | 内容生成和媒体资产 | 只提供已生成资产，不参与发布状态判断 |
| `cheat-on-content` | 选题、预测、复盘方法论 | 可提供发布标题/正文草稿，但不能直接改 package |
| `ops-web` | 状态展示和复制辅助 | 展示 package、复制块、资产入口、evidence，不执行平台发布 |
| 旧 `PublishManager` | 旧生成任务发布/Buffer/COS 能力 | 可被包装成 adapter，但不作为新模块状态源 |

## 3. 建议目录

P3 新增独立模块，建议命名为 `publishing/`，避免和旧 `pixelle_video.services.publish_manager` 混淆。

```text
publishing/
  __init__.py
  models.py
  service.py
  store.py
  policies.py
  errors.py
  package_builder.py
  renderers.py
  evidence.py
  adapters/
    __init__.py
    base.py
    xiaohongshu_browser_assisted.py
    buffer_api.py
    youtube_api.py
  browser/
    session.py
    screenshots.py
    selectors.py
  tests/
    fixtures.py
```

第一版也可以先不拆这么细，但必须保留同样的边界：

1. package 构建。
2. 平台字段渲染。
3. copy blocks 和 checklist。
4. evidence 校验。
5. Ops apply。

`adapters/` 是后续 assisted、API 和 automatic 的扩展位置，P3-A 不需要实现平台执行 adapter。

## 4. 数据模型

### 4.1 publish_packages

发布包是发布模块的输入事实。

建议字段：

```text
id TEXT PRIMARY KEY
project_id TEXT NOT NULL
cycle_id TEXT NOT NULL
experiment_id TEXT NOT NULL
content_item_id TEXT NOT NULL
channel_account_id TEXT NOT NULL
platform TEXT NOT NULL
content_type TEXT NOT NULL
asset_paths_json TEXT NOT NULL
cover_path TEXT
title TEXT
body TEXT
tags_json TEXT NOT NULL
platform_fields_json TEXT NOT NULL
copy_blocks_json TEXT NOT NULL
checklist_json TEXT NOT NULL
approved_draft_id TEXT
approved_text_hash TEXT
asset_hash TEXT NOT NULL
package_hash TEXT NOT NULL
status TEXT NOT NULL
created_by_json TEXT NOT NULL
created_at TEXT NOT NULL
locked_at TEXT
cancelled_at TEXT
```

约束：

1. `content_item_id + channel_account_id + package_hash` 应该唯一，避免重复创建相同 package。
2. `status` 只能是 `draft / ready / locked / evidence_recorded / cancelled`。
3. `locked` 后不能更新正文、资产、账号、平台字段。
4. `copy_blocks_json` 是 UI/Codex 复制内容的唯一来源。
5. `checklist_json` 只用于人工发布前核对，不代表已经发布。

### 4.2 publish_attempts

发布尝试记录执行状态。P3-A 不需要正式启用；只有接入 assisted、official API 或 automatic 时才需要。

```text
id TEXT PRIMARY KEY
package_id TEXT NOT NULL
adapter TEXT NOT NULL
mode TEXT NOT NULL
status TEXT NOT NULL
risk_flags_json TEXT NOT NULL
started_at TEXT
updated_at TEXT NOT NULL
finished_at TEXT
error_code TEXT
error_message TEXT
operator_user TEXT
adapter_state_json TEXT NOT NULL
```

约束：

1. 一个 package 可以有多个 attempt。
2. 同一 package 同一时间只能有一个 running attempt。
3. `mode = automatic` 必须有显式 capability 和 policy 开关。
4. 创建或复制发布包不创建 attempt。

### 4.3 publish_artifacts

发布过程产物，例如截图、日志、上传结果。

```text
id TEXT PRIMARY KEY
attempt_id TEXT NOT NULL
kind TEXT NOT NULL
path TEXT
url TEXT
metadata_json TEXT NOT NULL
created_at TEXT NOT NULL
```

常见 kind：

```text
pre_publish_screenshot
post_publish_screenshot
upload_receipt
browser_log
api_response
error_screenshot
```

### 4.4 publish_evidence

发布证据是发布模块的输出。

```text
id TEXT PRIMARY KEY
attempt_id TEXT
package_id TEXT NOT NULL
platform TEXT NOT NULL
channel_account_id TEXT NOT NULL
content_item_id TEXT NOT NULL
platform_post_id TEXT
post_url TEXT
published_at TEXT
platform_response_json TEXT NOT NULL
screenshot_path TEXT
final_title TEXT
final_body TEXT
final_tags_json TEXT NOT NULL
account_identity_json TEXT NOT NULL
asset_hash TEXT
package_hash TEXT NOT NULL
operator_confirmed INTEGER NOT NULL
evidence_source TEXT NOT NULL
verified_at TEXT
verification_json TEXT NOT NULL
created_at TEXT NOT NULL
```

关键点：

1. `publish_evidence` 是模块输出。
2. Ops 仍然需要把证据校验后写成 `publish_recorded` 事件。
3. 不能只因为 `publish_evidence` 行存在就认为 Ops 闭环已发布。
4. `evidence_source = manual` 是 P3-A 主路径。

## 5. 状态机

### 5.1 Package 状态

```text
draft
  -> ready
  -> locked
  -> evidence_recorded
  -> cancelled
```

规则：

1. `draft`：允许补字段。
2. `ready`：校验通过，可锁定。
3. `locked`：发布准备包已冻结，可以复制使用，不可修改核心内容。
4. `evidence_recorded`：已经有发布证据进入校验或已应用。
5. `cancelled`：不再允许作为发布依据。

### 5.2 Attempt 状态

P3-A 不启用 attempt 状态机。后续 assisted、official API 或 automatic 启用时再使用：

```text
requested
  -> validating
  -> uploading
  -> form_filled
  -> waiting_user_confirm_publish
  -> submitted
  -> evidence_captured
  -> verified

任意执行态
  -> failed
  -> cancelled
```

关键状态：

1. `waiting_user_confirm_publish` 是 assisted 模式的正常停点。
2. `submitted` 不等于 `verified`。
3. `verified` 后还要由 Ops 写 `publish_recorded`，才进入观测。

### 5.3 Ops next_action 映射

| Ops 条件 | next_action |
|---|---|
| asset check 未通过 | `check_generation_asset` |
| asset check 通过但无 package | `create_publish_package` |
| package ready/locked 但无 evidence | `manual_publish_from_package` |
| evidence 存在但未 apply | `record_publish` |
| Ops publish event 存在 | `record_metrics` |

后续 assisted/API 启用后再增加：

| Ops 条件 | next_action |
|---|---|
| package locked 且用户请求辅助发布 | `request_publish` |
| assisted attempt 等待用户确认 | `confirm_publish_in_platform` |
| attempt failed | `retry_or_cancel_publish` |

P3 需要把当前单一 `record_publish` 拆成更细的发布模块状态，但不能破坏旧 P0/P1 smoke。兼容方式是：

1. 没有发布模块表时，仍显示 `record_publish`。
2. P3 开启后，显示更具体 next action。
3. 最终 publish evidence apply 仍兼容现有 `pixelle_record_publish`。

## 6. Service 接口

### 6.1 Python service

建议接口：

```python
class PublishService:
    def create_package(
        self,
        *,
        content_item_id: str,
        channel_account_id: str,
        platform_payload: dict,
        source: dict,
    ) -> dict: ...

    def validate_package(self, package_id: str) -> dict: ...

    def lock_package(self, package_id: str, source: dict) -> dict: ...

    def render_package(self, package_id: str) -> dict: ...

    def get_copy_blocks(self, package_id: str) -> dict: ...

    def get_asset_handoff(self, package_id: str) -> dict: ...

    def record_evidence(
        self,
        *,
        package_id: str,
        evidence: dict,
        source: dict,
    ) -> dict: ...

    def verify_evidence(self, evidence_id: str) -> dict: ...
```

后续 assisted/API/automatic 再补：

```python
async def request_publish(...): ...
def get_attempt(...): ...
def cancel_attempt(...): ...
```

### 6.2 OpsService 集成点

OpsService 只做编排和证据 apply：

```python
class OpsService:
    def create_publish_package(...): ...
    def get_publish_package_copy_blocks(...): ...
    def record_publish_evidence(...): ...
    def apply_publish_evidence_to_ops(...): ...
```

OpsService 校验：

1. 当前 content item 必须存在。
2. 当前 content item 必须有通过的 `asset_checked`。
3. package 的 `content_item_id` 必须等于当前要发布的 item。
4. package 的 channel account 必须属于当前 project。
5. 证据通过校验后，才写 `publish_recorded`。

## 7. Codex Plugin 工具

P3 建议新增工具：

```text
pixelle_create_publish_package
pixelle_validate_publish_package
pixelle_lock_publish_package
pixelle_get_publish_package
pixelle_get_publish_copy_blocks
pixelle_get_publish_asset_handoff
pixelle_record_publish_evidence
```

工具边界：

1. `pixelle_create_publish_package` 只创建发布准备包，不触发平台发布。
2. `pixelle_get_publish_copy_blocks` 返回可复制字段，不临时拼接文案。
3. `pixelle_get_publish_asset_handoff` 返回资产预览、下载或本地路径。
4. `pixelle_record_publish_evidence` 可以记录手动发布证据。
5. `pixelle_get_current` 应展示 package/evidence 摘要。

后续 assisted/API/automatic 再新增：

```text
pixelle_request_publish
pixelle_get_publish_status
pixelle_cancel_publish_attempt
```

## 8. API 设计

UI 和调试需要查询接口，但运营主入口仍在 Codex。

### 8.1 P3-A 当前落地 API

P3-A 先提供一个只读发布包渲染接口，由独立 `publishing.PublishService` 从已审稿、当前 content item、平台账号和 asset check 生成 `PublishPackage`：

```text
GET /api/ops/experiments/{experiment_id}/publish-package?channel_account_id=...
```

该接口返回：

```text
package
copy_blocks
asset_handoff
checklist
package_hash
asset_hash
```

UI 只能消费这些字段，不再自己拼标题、正文、标签、完整发布包或资产交付信息。

P3-A 继续复用现有 Ops service 的 `record_publish` 能力，把真实发布证据接入 Ops 第 5 步：

```text
POST /api/ops/experiments/{experiment_id}/publish-evidence
```

请求必须包含：

```text
content_item_id
channel_account_id
package_id
package_hash
asset_hash
platform_url 或 platform_post_id 或 buffer_post_id
```

服务端写入 `publish_recorded` 事件，`source.kind = "ui"`，`source.surface = "p3_ops_publish_ui"`，并把下一步推进为 `record_metrics`。

P3-A 不做平台自动发布，不打开平台页面，不伪造平台返回。P3-A 暂不落 `publish_packages` 持久化表；后续需要批量管理、多平台队列或幂等去重时，再把当前只读 package renderer 升级为持久化 PublishService。

### 8.2 后续完整 Publish Module API

后续如果把 PublishPackage 独立持久化，再新增：

```text
GET /api/ops/publish/packages
GET /api/ops/publish/packages/{package_id}
GET /api/ops/publish/packages/{package_id}/copy-blocks
GET /api/ops/publish/packages/{package_id}/asset-handoff
GET /api/ops/publish/evidence/{evidence_id}
```

写接口保留创建准备包和手动证据：

```text
POST /api/ops/publish/packages
POST /api/ops/publish/evidence
```

浏览器 assisted 发布不进入 P3-A API。后续即使增加，也不建议先放 UI 主入口，可以由 Codex 工具触发，UI 只展示状态。

## 9. Renderer 和 Adapter 合约

### 9.1 PlatformPayloadRenderer

```python
class PlatformPayloadRenderer(Protocol):
    name: str

    def capabilities(self) -> dict: ...

    def render(self, package_input: dict) -> dict: ...
```

`render` 必须返回：

```text
platform_fields
copy_blocks
checklist
asset_handoff
```

示例 copy blocks：

```text
title
body
hashtags
full_package_markdown
asset_path
```

### 9.2 manual evidence recorder

manual evidence recorder 不触碰平台。

职责：

1. 生成人工发布说明。
2. 记录用户提供的 URL/post id/截图。
3. 校验证据字段完整性。

### 9.3 Future PublishAdapter

后续 assisted、official API 或 automatic 再启用平台执行 adapter：

```python
class PublishAdapter(Protocol):
    name: str

    def capabilities(self) -> dict: ...

    async def prepare(self, package: dict, attempt: dict) -> dict: ...

    async def submit(self, package: dict, attempt: dict) -> dict: ...

    async def collect_evidence(self, package: dict, attempt: dict) -> dict: ...
```

`prepare` 可以返回：

```text
status = waiting_user_confirm_publish
```

表示系统已经完成辅助操作，正在等待用户人工确认。

### 9.4 xiaohongshu_browser_assisted adapter

职责：

1. 使用用户真实浏览器登录态。
2. 打开小红书发布页。
3. 上传视频或图片。
4. 填标题、正文、标签。
5. 检查页面账号。
6. 检查上传完成。
7. 截图保存。
8. 停在发布按钮前。

禁止：

1. 不绕验证码。
2. 不自动点击最终发布。
3. 不隐藏浏览器。
4. 不在账号不一致时继续。
5. 不在上传未完成时继续。

Codex record skill 的位置：

```text
record skill -> 采集人工发布流程 -> 沉淀 selector 和步骤 -> xiaohongshu_browser_assisted adapter
```

record skill 是采集和辅助实现工具，不是发布模块接口。

### 9.5 official API adapter

适用于 YouTube、Buffer 或其他官方 API 平台。

要求：

1. API 响应必须包含 post id 或等价资源 id。
2. 错误必须保留原始 code/message。
3. 支持幂等 key。
4. 不能把 upload success 当作 publish success。

## 10. 风控策略

### 10.1 Policy 输入

发布前 policy 检查：

```text
platform
channel_account_id
content_type
asset_hash
package_hash
renderer_capability
```

### 10.2 阻断规则

直接阻断：

1. package 未锁定。
2. asset check 未通过。
3. channel account 不属于 project。
4. package hash 和当前 package 不一致。
5. renderer 不支持平台或内容类型。
6. copy blocks 缺少平台必填字段。
7. package 指向的资产不存在。

后续 assisted/API/automatic 再增加：

1. mode 为 automatic 但未显式开启。
2. 当前存在 running attempt。
3. 账号校验失败。
4. 出现验证码或人机校验。

### 10.3 降级规则

可以降级：

1. 平台专用 renderer 不完整 -> 返回通用复制包，并标记缺失字段。
2. 无法读取 post url -> 要求用户手动登记。
3. 无法自动截图 -> 要求用户上传截图或手动确认，但不能标记自动证据完整。
4. 后续官方 API 不可用 -> manual。
5. 后续 browser assisted 遇到验证码 -> waiting_user_manual_intervention。

降级必须在状态里可见，不能让主流程看起来已经自动成功。

## 11. 幂等和重复发布

幂等规则：

1. 同一 content item、channel account、package hash 只能有一个有效 package。
2. 同一 platform post id 只能生成一个 evidence。
3. 同一 post url 只能生成一个 evidence。
4. 创建或复制 package 不改变发布状态。
5. 已经有真实 publish evidence 的 package 不能再次登记为新的真实发布。

后续 assisted/API/automatic 再增加：

1. 同一 package 同一 adapter 的 running attempt 只能有一个。
2. 已经有真实 publish evidence 的 package 不能再次自动发布。
3. 允许 retry，但 retry 必须创建新 attempt，保留旧 attempt。

重复发布处理：

```text
existing true evidence
  -> block new automatic/assisted publish
  -> allow user create new package only after explicit confirmation
```

## 12. Asset 和文本校验

发布前必须校验：

1. content item 存在。
2. asset file 存在或可访问。
3. asset hash 和 package hash 一致。
4. package text 来源于已审核发布字段。
5. package 不能使用 generation draft 之外的临时正文，除非有单独发布文案审核记录。
6. 平台字段符合 renderer 限制。
7. copy blocks 来自 package，不由 UI 临时拼接。

注意：

`generation_drafted.payload.text` 是视频生成唯一正文来源，但发布标题、正文、标签可以是发布包字段。发布包字段也必须可追溯，不能在 adapter 内临时生成。

## 13. UI 集成

P3-A UI 集成策略：

```text
底层 Publish Module 独立；
前端先嵌入 Ops 第 5 步；
不新增左侧 Publish 顶级导航。
```

UI 可以嵌在 Ops，但底层不能嵌进 Ops。Ops 第 5 步只消费 PublishService 输出，不在前端临时组装发布包。

Ops UI 发布步骤展示：

1. 当前 `PublishPackage` 工作台。
2. 目标平台账号。
3. 内容类型。
4. 平台发布字段。
5. 标题、正文、标签和完整发布包的一键复制入口。
6. 资产预览、下载或打开路径入口。
7. checklist。
8. 手动 evidence 登记入口。
9. mock 标记。
10. package hash 和 asset hash 摘要。

多平台 package 在同一工作面内通过轻量切换或列表展示，不在 P3-A 新建独立发布中心。

UI 不做：

1. 不直接跑平台 adapter。
2. 不保存 secret。
3. 不展示 cookie。
4. 不绕过 Codex 主入口。
5. 不把复制动作显示成已发布。
6. 不自己拼 `copy_blocks`。
7. 不新增左侧 `Publish` 导航。

UI 数据流：

```text
Ops 第 5 步
  -> API 查询 PublishService
  -> PublishService 返回 package/copy_blocks/checklist/evidence
  -> UI 展示和复制
  -> 用户手动登记证据
  -> ManualEvidenceRecorder 校验
  -> OpsService 写 publish event
```

## 14. 测试计划

### 14.1 Unit tests

文件建议：

```text
tests/test_publish_package.py
tests/test_publish_policy.py
tests/test_publish_adapters.py
tests/test_publish_evidence.py
```

覆盖：

1. asset check 未通过不能创建 locked package。
2. locked package 不能修改核心字段。
3. copy blocks 必须来自 package。
4. 创建或复制 package 不产生 publish evidence。
5. URL/post id 去重。
6. evidence 缺失不能写 Ops publish event。
7. mock evidence 不能伪装真实发布。
8. 后续 automatic 默认被拒。

### 14.2 Smoke tests

脚本建议：

```text
scripts/p3_publish_prepare_smoke.py
scripts/p3_publish_assisted_dry_run_smoke.py
```

P3-A smoke：

```text
current record_publish
  -> create package
  -> lock package
  -> render copy blocks
  -> verify asset handoff
  -> copy does not create evidence
  -> record manual evidence
  -> verify evidence
  -> Ops publish event
  -> next_action = record_metrics
```

后续 assisted dry-run smoke：

```text
create package
  -> request assisted publish with fake adapter
  -> status = waiting_user_confirm_publish
  -> pre_publish_screenshot exists
  -> no Ops publish event yet
```

### 14.3 Regression

必须继续通过：

```text
uv run pytest tests/test_codex_plugin.py tests/test_ops_store.py tests/test_ops_service.py tests/test_ops_api.py -q
uv run python scripts/p0_codex_smoke.py
uv run python scripts/p1_ops_ui_smoke.py
uv run python scripts/p1_codex_direct_entry_smoke.py
uv run python scripts/p2_cheat_writeback_smoke.py
uv run python scripts/p2_cheat_main_path_smoke.py
npm --prefix ops-web run build
```

## 15. 迁移策略

### 15.1 P3-A 不迁移旧 publish.json

旧 `pixelle_video` 生成任务里的 `publish.json` 可以保留为历史文件，不自动导入 P3。

原因：

1. 旧记录多是生成任务维度，不一定绑定 Ops project/cycle/experiment。
2. 自动迁移容易把发布意图误认为发布证据。
3. P3-A 第一版目标是发布准备包和手动证据闭环稳定。

### 15.2 旧 Buffer/COS 能力

旧能力可以被包装成 adapter：

```text
pixelle_video.services.publish_manager
  -> publishing.adapters.buffer_api
```

但 adapter 返回的结果仍必须进入 P3 evidence 校验，再由 Ops 写 publish event。

## 16. 实施顺序

### Step 1：模型和 store

1. 建 `publishing/`。
2. 建 package/evidence store。
3. 补最小 schema 初始化。

### Step 2：发布准备包

1. package builder 从当前 content item 创建 package。
2. renderer 生成平台字段、copy blocks 和 checklist。
3. asset handoff 返回预览、下载或打开路径信息。
4. Codex 工具。
5. API 查询。
6. Ops 第 5 步内嵌发布包工作台。
7. UI 不新增顶级 Publish 导航。

### Step 3：手动发布证据

1. manual evidence 校验。
2. Ops apply publish evidence。
3. URL/post id 去重。
4. mock 和真实证据隔离。

### Step 4：多平台发布包

1. 小红书视频 renderer。
2. 小红书图文 renderer。
3. YouTube 视频 renderer。
4. 抖音视频 renderer。

### Step 5：fake assisted adapter

1. 用 fake adapter 模拟上传和填表。
2. 产出 pre publish screenshot 占位或测试 artifact。
3. 状态停在 `waiting_user_confirm_publish`。

### Step 6：小红书 assisted adapter

1. 用 record skill 采集真实流程。
2. 抽取 selector 和步骤。
3. 转为 browser adapter。
4. 加风控阻断。

### Step 7：官方 API adapter

1. 先选 YouTube 或 Buffer。
2. 接官方 API。
3. 验证 post id 和 response。

## 17. 完成定义

技术完成定义：

1. 发布模块可独立创建、校验、锁定 package。
2. package 能渲染平台字段、copy blocks 和 checklist。
3. 资产交付信息可查询。
4. 创建或复制 package 不产生发布证据。
5. 手动证据能通过校验并写入 Ops。
6. 同一内容多平台可独立建包。
7. assisted、API、automatic 明确后置。
8. automatic 默认被 policy 拒绝。
9. 旧 P0/P1/P2 验收不回退。
10. 文档中的风控规则有对应测试或明确待实现项。
