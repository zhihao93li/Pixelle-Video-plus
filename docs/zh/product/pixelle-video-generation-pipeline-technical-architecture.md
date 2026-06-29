# Pixelle 视频生成 Pipeline 模块技术架构方案

版本：v0.1
日期：2026-06-29
状态：讨论稿
关联 PRD：`docs/zh/product/pixelle-video-generation-pipeline-prd.md`
适用范围：`pixelle_video`、`api/routers/video.py`、`ops`、`codex_plugin`、`ops-web`、Streamlit 生成工作台

## 1. 架构目标

本方案服务一个目标：

```text
把视频生成能力从 UI、Ops 和底层 workflow 中抽出来，形成独立、可注册、可调用、可追踪的 Generation 模块。
```

目标不是立刻拆成多个部署服务，也不是重写现有生成引擎，而是先建立稳定边界：

1. Pipeline 是产品级视频生产方式。
2. Generation Service 管生成任务生命周期。
3. Pipeline Registry 管 pipeline 能力发现。
4. Ops 只记录运营业务状态。
5. UI 只负责选择 pipeline、填写输入和展示结果。
6. RunningHub/ComfyUI workflow 只作为 pipeline 内部依赖。

### 1.1 工程执行原则

实现每个阶段前，先确认该阶段的真实目标和最小完成条件。

对 Generation 模块来说，真实完成不是“代码路径走到最后”，而是：

1. 请求能被正确校验。
2. Pipeline 能按 manifest 声明执行。
3. 真实生成依赖被调用。
4. 资产被真实写入持久化位置。
5. 调用方能读取统一状态、进度、结果和错误。

工程上禁止把以下路径当成修复：

1. fallback。
2. placeholder。
3. skipped step。
4. swallowed error。
5. degraded path。
6. mock result。

这些路径可以作为临时降级能力存在，但必须满足三个条件：

1. 名称、状态或返回值明确标记为临时降级。
2. 不把核心流程伪装成成功。
3. 不影响调用方判断真实生成是否完成。

排查失败时，必须先定位失败层，再决定改哪里。

失败层分类：

| 失败层 | 例子 |
|---|---|
| input | entry 不支持、字段缺失、字段类型不对 |
| config | 输出目录、模型名、模板配置缺失 |
| credentials | API key、token、服务账号不可用 |
| network | 外部生成服务不可达或超时 |
| API contract | RunningHub、TTS、LLM、内部 API 返回结构变化 |
| permissions | 文件写入、读取、发布权限不足 |
| persistence | 任务、资产、结果没有可靠保存 |
| runtime | ffmpeg、浏览器渲染、依赖包运行失败 |
| product assumption | 把底层 workflow 误认为产品级 pipeline |

验证标准：

1. P0/P1 可以通过 manifest 和 registry 测试验证。
2. P2 之后必须验证真实 task 状态、真实 progress、真实 result 和真实 error。
3. P3 之后必须验证 Ops 读取到的不是假 asset，也不是仅“已请求”的状态。
4. P4 之后必须通过至少一个 UI 入口完成提交、查询、展示结果或展示失败原因。
5. 不允许只靠单元测试说明生成链路完成；涉及真实生成的阶段必须做端到端或接近端到端验证。

决策标准：

1. 优先解决根因，不围绕失败继续堆补偿逻辑。
2. 保持实现复杂度只服务于正确性、稳定性和可维护性。
3. 当简单方案能稳定满足目标时，优先选择简单方案。
4. 不为了格式纯度、流程纯度或局部一致性保留对产品无价值的复杂度。
5. 如果某个机制反复阻碍可用结果，应重新讨论机制本身。

## 2. 当前架构判断

### 2.1 Ops 后端

当前 Ops 后端是 Python 实现，不是 TypeScript 后端。

相关文件：

```text
ops/service.py
ops/store.py
ops/models.py
api/routers/ops.py
codex_plugin/server.py
```

它的技术形态是：

```text
业务状态机 + SQLite/本地存储 + FastAPI 查询入口 + Codex MCP 工具入口
```

它主要负责：

1. 项目、平台账号、周期和实验。
2. 预测锁定。
3. 生成草稿和审批。
4. 发布证据。
5. 指标快照。
6. 复盘和项目记忆。
7. writeback draft 校验和 apply。

### 2.2 视频生成后端

当前视频生成后端也是 Python 实现。

相关文件：

```text
pixelle_video/service.py
pixelle_video/pipelines/
pixelle_video/services/tts_service.py
pixelle_video/services/media.py
pixelle_video/services/video.py
api/routers/video.py
api/tasks/
```

它的技术形态是：

```text
生成核心服务 + pipeline 实例 + LLM/TTS/Media/FFmpeg 能力 + 本地输出文件 + FastAPI 任务接口
```

它主要负责：

1. 调 LLM。
2. 调 TTS。
3. 调图片/视频生成。
4. 渲染 HTML frame。
5. FFmpeg 合成。
6. 保存输出文件。
7. 返回视频路径、时长、文件大小等结果。

### 2.3 当前主要问题

Ops 和视频生成不是语言不一致，而是职责边界和调用契约还不稳定。

当前存在的分叉：

1. Streamlit UI 直接调用 `pixelle_video.generate_video(...)`。
2. FastAPI 视频接口自己拼接生成参数。
3. Ops/Codex 有自己的生成状态机，但还没有统一绑定真实 generation task。
4. Pipeline 只有可调用对象，还缺 manifest、entry、schema、能力依赖和统一结果定义。
5. API 任务系统有基础 task，但没有完整接入 pipeline progress callback。

未来应该补上的中间层是：

```text
Generation Service
```

它连接 Ops/UI/API/Codex 和实际 pipeline。

## 3. 目标架构

目标调用链：

```text
Streamlit UI
React Ops UI
Codex Plugin
External API
  -> Generation Service
  -> Pipeline Registry
  -> Selected Pipeline
  -> LLM / TTS / Media / Video / Persistence
  -> Generation Result
```

Ops 调用链：

```text
Ops Service
  -> create generation task
  -> store generation_task_id on experiment event
  -> query generation status
  -> create ContentItem from completed result
  -> run asset check
```

模块职责：

| 模块 | 职责 | 不负责 |
|---|---|---|
| `ops` | 运营状态、业务规则、证据链 | 具体怎么生成视频 |
| `pixelle_video.generation` | 任务、进度、结果、错误、pipeline 调度 | 运营实验业务规则 |
| `pixelle_video.pipelines` | 具体视频生产方式 | UI 页面和运营状态 |
| `api/routers/generation.py` | 统一 HTTP 生成接口 | pipeline 内部逻辑 |
| `codex_plugin` | Codex 工具入口 | 直接写生成内部状态 |
| `ops-web` / Streamlit | 选择、填写、展示 | 保存生成业务真相 |

## 4. 核心概念和技术定义

### 4.1 PipelineManifest

每个 pipeline 都必须提供 manifest。

建议字段：

```python
class PipelineManifest(BaseModel):
    id: str
    name: str
    description: str
    category: str
    entries: list[PipelineEntrySpec]
    stages: list[PipelineStageSpec]
    outputs: list[PipelineOutputSpec]
    required_capabilities: list[str]
    default_entry: str | None = None
```

示例：

```json
{
  "id": "standard",
  "name": "标准视频生成",
  "category": "general",
  "entries": ["topic", "script", "scenes"],
  "required_capabilities": ["llm", "tts", "media", "ffmpeg"]
}
```

### 4.2 PipelineEntrySpec

Entry 描述 pipeline 支持的入口和输入字段。

建议字段：

```python
class PipelineEntrySpec(BaseModel):
    id: Literal["topic", "script", "scenes", "assets", "audio", "video"]
    name: str
    description: str
    required_fields: list[InputFieldSpec]
    optional_fields: list[InputFieldSpec]
    start_stage: str
    skipped_stages: list[str] = []
```

示例：

```json
{
  "id": "script",
  "name": "完整文案入口",
  "required_fields": ["script"],
  "optional_fields": ["title", "tts_voice", "frame_template"],
  "start_stage": "split_scenes",
  "skipped_stages": ["generate_script"]
}
```

### 4.3 GenerationRequest

统一生成请求。

建议字段：

```python
class GenerationRequest(BaseModel):
    pipeline_id: str
    entry: str
    input: dict[str, Any]
    params: dict[str, Any] = {}
    metadata: dict[str, Any] = {}
    idempotency_key: str | None = None
```

说明：

1. `pipeline_id` 决定使用哪个 pipeline。
2. `entry` 决定从哪个入口进入 pipeline。
3. `input` 是入口输入，例如 topic、script、scenes、assets。
4. `params` 是生成参数，例如模板、TTS、BGM、画面风格。
5. `metadata` 可以带 Ops 的 experiment_id，但生成模块只当 opaque metadata。
6. `idempotency_key` 用于避免重复提交。

### 4.4 GenerationTask

统一任务状态。

建议字段：

```python
class GenerationTask(BaseModel):
    task_id: str
    pipeline_id: str
    entry: str
    status: Literal["pending", "running", "completed", "failed", "cancelled"]
    progress: GenerationProgress
    request: GenerationRequest
    result: GenerationResult | None = None
    error: GenerationError | None = None
    created_at: datetime
    updated_at: datetime
```

### 4.5 GenerationProgress

统一进度结构。

建议字段：

```python
class GenerationProgress(BaseModel):
    stage: str
    percentage: float
    message: str
    current: int | None = None
    total: int | None = None
    detail: dict[str, Any] = {}
```

要求：

1. Pipeline 内部仍可使用 `ProgressEvent`。
2. Generation Service 负责把 `ProgressEvent` 转成统一 progress。
3. API、UI、Ops 只读取统一 progress。

### 4.6 GenerationResult

统一生成结果。

建议字段：

```python
class GenerationResult(BaseModel):
    task_id: str
    pipeline_id: str
    entry: str
    status: Literal["completed"]
    artifacts: list[GenerationArtifact]
    primary_video: GenerationArtifact
    duration: float | None = None
    file_size: int | None = None
    storyboard_path: str | None = None
    metadata: dict[str, Any] = {}
```

### 4.7 GenerationArtifact

统一资产引用。

建议字段：

```python
class GenerationArtifact(BaseModel):
    kind: Literal["video", "audio", "image", "storyboard", "subtitle", "metadata"]
    path: str
    url: str | None = None
    media_type: str | None = None
    role: str | None = None
    metadata: dict[str, Any] = {}
```

## 5. 建议目录结构

新增或逐步迁移为：

```text
pixelle_video/
  generation/
    __init__.py
    schemas.py
    registry.py
    service.py
    tasks.py
    progress.py
    errors.py
    artifacts.py

  pipelines/
    base.py
    standard.py
    custom.py
    asset_based.py
```

后续 pipeline 变多后，可以进一步按目录拆：

```text
pixelle_video/pipelines/
  standard/
    pipeline.py
    manifest.py
    schema.py

  xhs_short_video/
    pipeline.py
    manifest.py
    schema.py

  digital_human/
    pipeline.py
    manifest.py
    schema.py
```

短期不强制移动现有 pipeline 文件，避免一次性重构过大。

## 6. API 设计

建议新增统一 generation API，不急着删除旧 `/api/video/*`。

```text
GET  /api/generation/pipelines
GET  /api/generation/pipelines/{pipeline_id}
POST /api/generation/tasks
GET  /api/generation/tasks/{task_id}
GET  /api/generation/tasks/{task_id}/result
DELETE /api/generation/tasks/{task_id}
```

旧接口保留为兼容层：

```text
POST /api/video/generate/async
  -> 转换为 GenerationRequest
  -> 调用 Generation Service
```

验收重点：

1. 新 API 能表达 pipeline 和 entry。
2. 新 API 能返回统一 task。
3. 旧 API 不再重复实现生成参数拼接逻辑。

## 7. Ops 集成方式

Ops 不应该直接知道 pipeline 内部阶段。

Ops 只需要记录：

```text
experiment_id
generation_task_id
pipeline_id
entry
approved_draft_id
generation_request_snapshot
generation_result_snapshot
```

建议流程：

```text
submit_generation_draft
  -> Ops 保存草稿

approve_generation_draft
  -> Ops 保存审批事件

request_generation
  -> Ops 构造 GenerationRequest
  -> Generation Service 创建 task
  -> Ops 保存 generation_task_id

get_generation_status
  -> Ops 查询 Generation Service task
  -> 返回业务状态 + 生成状态

complete_generation
  -> Generation task completed
  -> Ops 创建 ContentItem
  -> Ops 进入 check_generation_asset
```

关键原则：

1. Ops 管业务阶段。
2. Generation 管生产阶段。
3. 生成失败必须保持为真实失败，不允许 Ops 用占位资产冒充成功。

## 8. UI 集成方式

### 8.1 Streamlit

短期目标：

1. 保持现有生成页面形态。
2. 把直接调用 `pixelle_video.generate_video(...)` 改成调用 Generation Service。
3. 通过 task status 更新进度。
4. 通过 GenerationResult 展示视频。

验收标准：

1. 一个 Streamlit 生成入口不再直接调用 core。
2. 失败展示来自 GenerationError。
3. 结果展示来自 GenerationResult。

### 8.2 ops-web

中期目标：

1. 从 `/api/generation/pipelines` 读取 pipeline。
2. 根据 entry spec 渲染输入表单。
3. 提交 GenerationRequest。
4. 展示任务状态和结果。

验收标准：

1. 用户能在 React UI 看到 pipeline 列表。
2. 用户能选择 pipeline 和 entry。
3. React UI 不需要写死每个 pipeline 的字段。

## 9. 阶段技术重点和验收标准

### P0：Pipeline 标准定义

技术重点：

1. 明确产品级 pipeline 与底层 workflow 的区别。
2. 定义 manifest、entry、stage、artifact、result。
3. 定义文案生成作为可选 stage。

涉及文件：

```text
docs/zh/product/pixelle-video-generation-pipeline-prd.md
docs/zh/product/pixelle-video-generation-pipeline-technical-architecture.md
```

验收标准：

1. 文档中能描述现有 `standard`、`custom`、`asset_based`。
2. 文档中能描述未来新增 pipeline 的最小要求。
3. 团队可以用同一套词讨论 pipeline。

### P1：Pipeline Registry

技术重点：

1. 新增 `pixelle_video/generation/registry.py`。
2. 新增 `pixelle_video/generation/schemas.py`。
3. 给现有 pipeline 补 manifest。
4. 让 `PixelleVideoCore` 从 registry 注册 pipeline。

验收标准：

1. 单元测试可以列出所有 pipeline。
2. 单元测试可以查询 `standard` 的 entry。
3. 单元测试可以拒绝重复 pipeline id。
4. API 能返回 pipeline manifest。

### P2：Generation Service

技术重点：

1. 新增 `pixelle_video/generation/service.py`。
2. 封装任务创建、执行、进度更新、结果转换和错误转换。
3. 将现有 `api/tasks` 能力接入 generation task。
4. 补齐当前视频 API 缺失字段，例如 `split_mode`。

验收标准：

1. `GenerationService.submit(request)` 返回 task。
2. `GenerationService.get_task(task_id)` 返回状态。
3. Pipeline progress callback 能更新 task progress。
4. 生成成功返回 `GenerationResult`。
5. 生成失败返回 `GenerationError`。

### P3：Ops/Codex 接入

技术重点：

1. 给 Ops generation requested event 增加 `generation_task_id`。
2. `request_generation` 调用 Generation Service，而不是直接跑 pipeline。
3. `get_generation_status` 合并 Ops 状态和真实 task 状态。
4. `check_generation_asset` 使用 GenerationResult。

验收标准：

1. Ops 测试中能看到真实 `generation_task_id`。
2. 生成失败时 Ops 返回真实失败原因。
3. 生成完成后 ContentItem 绑定真实 video artifact。
4. asset check 不依赖手写假 asset_ref。

### P4：UI 接入

技术重点：

1. Streamlit 生成入口改为提交 generation task。
2. React UI 增加 pipeline 选择和任务状态展示。
3. UI 从 manifest 读取 entry 和字段定义。
4. UI 不再手写每个 pipeline 的完整参数逻辑。

验收标准：

1. 至少一个 UI 入口走 `/api/generation/tasks`。
2. UI 可以显示进度、成功结果和失败原因。
3. UI 可以显示 pipeline 支持的 entry。

### P5：Pipeline 扩展

技术重点：

1. 为新增 pipeline 单独建实现文件和 manifest。
2. 每个 pipeline 自带输入校验和最小测试。
3. Pipeline 内部可以复用已有 LLM/TTS/Media/Video 服务。
4. Pipeline 不 import Ops。

验收标准：

1. 新增 pipeline 后 registry 自动可见。
2. 新增 pipeline 后 API 可查询。
3. 新增 pipeline 后 UI 可显示基础信息。
4. 新增 pipeline 不修改 Ops 状态机核心逻辑。

## 10. 技术优先级

优先级排序：

1. 定义 manifest 和 entry schema。
2. 建 registry。
3. 包装现有 pipeline。
4. 建 Generation Service。
5. 接 API。
6. 接 Ops。
7. 接 UI。
8. 大规模新增 pipeline。

原因：

1. 先定义标准，可以避免新增 pipeline 继续制造分叉。
2. 先建 registry，可以让所有调用方从同一个地方发现 pipeline。
3. 先建 Generation Service，可以让任务、进度、结果和错误统一。
4. UI 重构应在服务边界稳定后再做。

## 11. 迁移策略

迁移采用兼容式，不做一次性替换。

### 阶段 1

保留现有 `pixelle_video.generate_video(...)`。

新增 registry 和 manifest。

### 阶段 2

新增 Generation Service。

现有 API 和 Streamlit 可以继续工作。

### 阶段 3

让 `/api/video/generate/async` 变成兼容层。

内部转换到 Generation Service。

### 阶段 4

让 Ops 请求生成时创建真实 generation task。

### 阶段 5

逐步把 Streamlit 和 React UI 接到统一 API。

## 12. 分支与合并策略

P0/P1 建议独立于当前 Ops/发布准备分支实现。

推荐分支：

```text
codex/pixelle-generation-pipeline-foundation
```

起点：

```text
plus/main
```

不要从当前 `codex/pixelle-codex-first-ops-p0` 继续叠加 P0/P1。该分支已经承担 Ops、ops-web 和发布准备方向，继续叠加 pipeline foundation 会让生成模块底座和运营产品线耦合过早。

### 12.1 推荐合并顺序

```text
plus/main
  -> codex/pixelle-generation-pipeline-foundation
      -> merge back to plus/main
          -> Ops 分支 rebase/merge plus/main
              -> Ops 分支接入真实 generation task
```

执行顺序：

1. 从 `plus/main` 新开 `codex/pixelle-generation-pipeline-foundation`。
2. 在 foundation 分支只实现 P0/P1。
3. 先把 foundation 合回 `plus/main`。
4. 当前 Ops/P3 分支再同步 `plus/main`。
5. Ops/P3 分支基于新的 Generation foundation 做接入。

### 12.2 P0/P1 分支允许修改的范围

允许修改：

```text
pixelle_video/generation/
pixelle_video/pipelines/
pixelle_video/service.py
api/routers/generation.py
api/routers/__init__.py
api/app.py
api/schemas/
tests/
docs/zh/product/
```

其中 `pixelle_video/service.py` 只允许做 pipeline 注册表接入，不应重写 core 生命周期。

不建议修改：

```text
ops/
codex_plugin/
ops-web/
publishing/
api/routers/ops.py
```

如果 P0/P1 需要这些模块配合，说明范围已经越界，应推迟到 P3 或单独分支。

### 12.3 预计冲突点

后续和 Ops 分支合并时，预计冲突主要集中在：

1. `api/app.py`：generation router 和 ops router 都需要注册。
2. `api/routers/__init__.py`：新增 router export。
3. `api/schemas/__init__.py`：新增 schema export。
4. `pixelle_video/service.py`：pipeline 注册方式变化。
5. `docs/zh/product/`：新增文档索引或关联文档描述。

这些冲突属于可控的小冲突。只要 P0/P1 不修改 Ops 状态机、ops-web 页面和发布准备逻辑，就不会形成大范围产品逻辑冲突。

### 12.4 合并后的职责顺序

Foundation 合入 `plus/main` 后，Ops 分支再做：

1. `request_generation` 创建真实 generation task。
2. Ops event 保存 `generation_task_id`。
3. `get_generation_status` 查询 Generation Service。
4. `check_generation_asset` 使用真实 GenerationResult。

这些属于 P3，不应塞进 P0/P1 分支。

## 13. 风险和处理

### 风险 1：抽象过早过重

处理：

1. P0/P1 只做 manifest 和 registry。
2. 不要求一次性迁移所有 pipeline。
3. 不引入复杂工作流引擎。

### 风险 2：旧 UI 被迫大改

处理：

1. 旧 UI 先保留。
2. 只在 P4 逐步迁移。
3. 先用兼容 API 包住旧逻辑。

### 风险 3：Ops 和 Generation 职责混淆

处理：

1. Generation metadata 允许携带 `experiment_id`，但不解释业务含义。
2. Ops 保存业务状态，不保存生成内部步骤。
3. Generation 返回资产和错误，不写 Ops 数据库。

### 风险 4：Pipeline 输入过于自由

处理：

1. 每个 entry 必须声明 required fields。
2. Generation Service 在运行前校验 request。
3. Pipeline 内部可以做二次领域校验。

### 风险 5：Foundation 分支和 Ops 分支合并冲突

处理：

1. P0/P1 从 `plus/main` 独立开分支。
2. P0/P1 不修改 `ops/`、`ops-web/` 和 `codex_plugin/`。
3. P0/P1 只提供 registry、manifest 和只读 pipeline 查询能力。
4. 先合 foundation，再让 Ops 分支接入。

### 风险 6：临时降级掩盖真实失败

风险表现：

1. 生成失败后返回 placeholder asset。
2. 外部服务失败后吞掉错误，只返回 success。
3. Ops 把 generation requested 当成 generation completed。
4. UI 只看到“成功提交”，但没有真实视频结果。
5. mock 测试结果被误当成真实链路验收。

处理：

1. Generation Service 必须区分 requested、running、completed、failed。
2. 只有真实资产完成保存并可读取时，任务才能进入 completed。
3. fallback 或 placeholder 只能返回 degraded/failed 状态，不能返回 completed。
4. 错误必须保留失败层、原始错误摘要和可行动提示。
5. mock 流程必须在数据和文档中显式标记为 mock，不得进入真实验收标准。

## 14. 当前可立即开始的最小工作

建议最小实施包：

1. 新增 `pixelle_video/generation/schemas.py`。
2. 新增 `pixelle_video/generation/registry.py`。
3. 给 `standard`、`custom`、`asset_based` 写 manifest。
4. 增加 `/api/generation/pipelines` 只读接口。
5. 增加测试验证 registry 和 manifest。

这个最小包不改变生成执行路径，但能立刻为后续大规模 pipeline 扩展建立标准。

完成后再进入 Generation Service。

## 15. 总结

后续架构重点不是把 Ops 和视频生成合并，而是让二者通过稳定契约协作。

最终形态：

```text
Ops 管业务事实和运营状态。
Generation Service 管生成任务和生产状态。
Pipeline 管具体视频生产方式。
底层 workflow 管单个供应商动作。
UI 管选择、输入和展示。
```

只要这个边界稳定，后续新增 pipeline 就可以变成局部工作，而不是牵动整个产品。
