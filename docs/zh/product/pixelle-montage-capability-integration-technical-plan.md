# Pixelle OpenMontage 能力融入技术方案

版本：v0.1
日期：2026-06-30
状态：讨论稿
关联 PRD：`docs/zh/product/pixelle-montage-capability-integration-prd.md`
适用范围：`pixelle_video`、`pixelle_video.generation`、`pixelle_video.pipelines`、`api`、`ops`、`codex_plugin`、Streamlit/Ops UI

## 1. 技术目标

在不重写 Pixelle 现有生成架构的前提下，补齐 OpenMontage 中对 Pixelle 最有价值的四个技术层：

```text
Asset Layer
Edit Plan Layer
Compose Runtime Layer
Quality Review Layer
```

目标不是把 OpenMontage agent-first 架构迁进 Pixelle，而是保留 Pixelle 现有控制面：

```text
Ops/Codex/UI/API
  -> Generation Service
  -> Pixelle Pipeline
  -> 服务层工具能力
  -> 资产、质检、历史、Ops 回写
```

## 2. 架构判断

### 2.1 当前 Pixelle 控制面

Pixelle 当前控制面是产品服务式：

```text
用户/Ops/API/Streamlit
  -> GenerationService
  -> PipelineRegistry
  -> Pipeline class
  -> LLM/TTS/Media/Frame/Video/Persistence
```

这条主线应保留。

### 2.2 OpenMontage 控制面

OpenMontage 控制面是 agent-first：

```text
agent 读 pipeline manifest
  -> 读 stage skill
  -> 选择工具
  -> 写 checkpoint
  -> 做 self-review
  -> 等待人审
```

这套机制适合单条复杂视频制作，但不适合作为 Pixelle 日常运营生成的底层控制面。

### 2.3 推荐集成方式

推荐方式：

```text
保留 Pixelle 控制面
引入 OpenMontage 能力层
通过生产模板固定每一步设置
```

不要做：

```text
每次生成都让 agent 动态选择 provider/runtime
每次生成都临时生成制作方案
每次生成都走完整 OpenMontage checkpoint 流程
```

## 3. 技术分层

### 3.1 Pipeline Layer

已有职责：

1. 声明 pipeline 能力。
2. 支持 entry。
3. 执行具体视频生产流程。
4. 返回 generation result。

保留现有方向，不大规模重构。

短期只允许小步增强：

1. 接收生产模板编译后的固定参数。
2. 输出更多中间产物。
3. 在合成后触发质量检查。

### 3.2 Production Template Layer

新增层。

职责：

1. 把某个 pipeline 的常用配置固化。
2. 绑定项目/账号/内容形态。
3. 固定 provider、workflow、模板、合成方式和质检策略。
4. 编译为 `GenerationRequest`。

示例：

```text
PetWoods 小红书日常短视频 v1
  base_pipeline: standard
  entry: script
  tts: fish_audio 固定 voice
  media: runninghub 固定 workflow
  compose: html_ffmpeg
  quality_review: basic
```

关键原则：

1. 生产模板不是新的 Python pipeline class。
2. 生产模板是 pipeline 的固定配置实例。
3. 只有执行逻辑改变时，才新增真正 pipeline class。

### 3.3 Asset Layer

新增或增强层。

职责：

1. 记录视频使用的所有素材。
2. 记录素材来源、用途、路径、类型和状态。
3. 支持后续真实素材、stock 素材和用户素材。

建议资产类型：

| 类型 | 示例 |
|---|---|
| narration_audio | TTS 输出 |
| generated_image | AI 生成图片 |
| generated_video | AI 生成视频 |
| source_image | 用户上传图片 |
| source_video | 用户上传视频 |
| stock_video | stock/archive 视频 |
| subtitle | 字幕文件 |
| bgm | 背景音乐 |
| final_video | 最终视频 |

短期实现原则：

1. 不要求一次性设计复杂资产库。
2. 先随生成任务保存 `asset_manifest`。
3. 后续再抽象为跨任务素材库。

### 3.4 Edit Plan Layer

新增层。

职责：

1. 在合成前明确镜头顺序。
2. 明确每个镜头的素材、字幕、音频、时长、转场和合成参数。
3. 为 HyperFrames/Remotion/FFmpeg 提供统一输入。

短期建议：

1. 先从现有 storyboard 派生简化版 `edit_decisions`。
2. 不要求第一版支持复杂剪辑。
3. 先覆盖标准短视频和素材驱动视频。

### 3.5 Compose Runtime Layer

新增抽象层。

职责：

1. 把合成方式从 pipeline 主逻辑中分离出来。
2. 支持多种合成 runtime。
3. 让生产模板绑定合成方式。

候选 runtime：

| Runtime | 用途 | 阶段 |
|---|---|---|
| html_ffmpeg | 当前默认稳定模板合成 | P0/P1 保留 |
| hyperframes | 强动效、品牌包装、kinetic typography | P2 试点 |
| remotion | 结构化场景、图表、组件化视频 | P2/P3 试点 |
| ffmpeg_only | 真实素材剪辑、裁剪、拼接 | P3 |

规则：

1. 日常模板默认继续使用 `html_ffmpeg`。
2. 新 runtime 只绑定到试点模板。
3. runtime 不可用时返回明确错误。
4. 不做静默 runtime swap。

### 3.6 Quality Review Layer

新增层。

职责：

1. 生成完成后检查成片是否真实可用。
2. 阻止明显坏视频进入发布流程。
3. 将质量结果写入 history/Ops。

基础检查：

1. `file_exists`
2. `ffprobe_playable`
3. `video_duration_range`
4. `audio_present`
5. `file_size_range`
6. `black_frame_sample`

扩展检查：

1. 字幕存在。
2. 音量过低/过高。
3. 首尾黑屏。
4. 分辨率符合平台要求。
5. 帧率合理。

## 4. 阶段性技术方案

### Phase 1：质量检查和素材清单

目标：

```text
不改 pipeline 执行逻辑，只在生成完成后增加可追踪和可验证能力。
```

改动范围：

1. 新增生成结果质量检查服务。
2. 从现有 storyboard/result 中生成基础 `asset_manifest`。
3. 将检查结果保存到任务 metadata。
4. Ops asset check 使用质量检查结果。

不做：

1. 不接 HyperFrames/Remotion。
2. 不改 TTS/media provider。
3. 不改现有 UI 主流程。

验收：

1. `standard` 生成后有质量检查结果。
2. 黑屏、无声、文件不存在不能被标记为可发布。
3. 成品 metadata 中能看到主要素材清单。

风险：

1. ffprobe/抽帧依赖环境问题。
2. 旧任务没有完整素材记录。

处理：

1. 新任务强制记录。
2. 旧任务允许显示“历史任务缺少完整 asset_manifest”。

### Phase 2：生产模板层

目标：

```text
让常用生成设置固化成可复用模板。
```

改动范围：

1. 新增生产模板 schema。
2. 新增生产模板 registry。
3. 支持项目/账号默认模板。
4. 生产模板编译为现有 `GenerationRequest`。

模板字段建议：

```yaml
id: petwoods_xhs_daily_v1
name: PetWoods 小红书日常短视频 v1
base_pipeline: standard
entry: script
fixed_params:
  frame_template: 1080x1920/petwoods_default.html
  tts_inference_mode: fish
  tts_voice: petwoods_default_voice
  media_workflow: runninghub/video_wan2.1_fusionx.json
  bgm_mode: loop
compose:
  runtime: html_ffmpeg
quality_review:
  profile: basic
```

不做：

1. 不让用户每次选择 provider。
2. 不为每个模板新增 pipeline class。

验收：

1. 可以列出可用生产模板。
2. 可以用模板发起生成。
3. 模板固定参数能覆盖默认生成参数。
4. 必需配置缺失时明确失败。

### Phase 3：Compose Runtime 抽象和单点试点

目标：

```text
让合成方式可扩展，但不影响默认生成链路。
```

改动范围：

1. 增加 compose runtime 抽象。
2. 将现有 HTML+FFmpeg 封装为 `html_ffmpeg` runtime。
3. 选择 HyperFrames 或 Remotion 做一个 runtime adapter。
4. 只绑定到一个高质量生产模板。

选择建议：

| 方向 | 优先 runtime |
|---|---|
| 小红书强动效、视觉包装 | HyperFrames |
| 结构化解释、数据卡片、组件复用 | Remotion |

不做：

1. 不全局替换现有合成方式。
2. 不要求所有 pipeline 立即兼容新 runtime。
3. 不做静默 fallback。

验收：

1. 默认日常模板仍可稳定生成。
2. 试点模板能用新 runtime 生成成片。
3. 新 runtime 失败时，任务显示明确失败层。
4. 试点成片进入同一套质量检查。

### Phase 4：轻量真实素材 montage

目标：

```text
支持真实素材风格视频的第一版生产能力。
```

改动范围：

1. 增加素材 sourcing 能力。
2. 支持用户素材和少量 stock/source 素材。
3. 增加 `ffmpeg_only` 或 runtime 兼容 montage 拼接。
4. 生成 asset_manifest 和 edit_decisions。

不做：

1. 不做完整 CLIP corpus。
2. 不做大型素材库管理。
3. 不做复杂多源版权治理。

验收：

1. 可用固定模板生成真实素材风格短视频。
2. 素材来源写入 asset_manifest。
3. 成片通过质量检查。

### Phase 5：新生产方式评估和扩展

目标：

```text
基于真实需求决定是否新增重型生产方式。
```

候选：

1. Talking-head editor。
2. Clip factory。
3. Localization dub。
4. Screen demo。
5. Avatar spokesperson。
6. Character animation。

进入标准：

1. 有明确用户需求。
2. 和内容运营主线一致。
3. 可以复用生产模板、asset_manifest、edit_decisions、quality_review。
4. 维护成本可控。

## 5. 与现有模块关系

### 5.1 与 `standard`

`standard` 不需要重写。

短期增强方式：

1. 生成后产出 asset_manifest。
2. 从 storyboard 产出基础 edit_decisions。
3. 使用默认 compose runtime。
4. 完成后运行 quality_review。

### 5.2 与 `asset_based`

`asset_based` 是接近 OpenMontage `hybrid` 的基础。

短期增强方式：

1. 强化用户素材记录。
2. 明确素材匹配结果。
3. 记录 source/support asset 关系。
4. 后续可接入轻量 montage。

### 5.3 与 Ops

Ops 不负责具体生成实现。

Ops 需要新增或读取：

1. 生产模板 ID。
2. generation task ID。
3. asset_manifest 摘要。
4. quality_review 状态。
5. 最终视频是否可发布。

Ops 状态判断必须区分：

```text
generation_requested
generation_completed
asset_checked
quality_failed
ready_for_publish
```

### 5.4 与 UI

UI 不应该暴露底层 provider 选择。

UI 应暴露：

1. 生产模板选择。
2. 模板说明。
3. 预计时长/质量/成本区间。
4. 生成进度。
5. 质量检查结果。
6. 失败原因。

## 6. 数据对象建议

### 6.1 ProductionTemplate

```text
id
name
description
project_scope
channel_scope
base_pipeline
entry
fixed_params
compose.runtime
quality_review.profile
status
version
```

### 6.2 AssetManifest

```text
task_id
assets[]
  id
  kind
  role
  source
  path
  url
  duration
  metadata
```

### 6.3 EditDecisions

```text
task_id
runtime
timeline[]
  scene_id
  start
  duration
  visual_asset_id
  audio_asset_id
  subtitle
  transition
  metadata
```

### 6.4 QualityReview

```text
task_id
status: passed | failed | warning
checks[]
  id
  status
  message
  evidence
summary
```

## 7. 技术优先级

| 优先级 | 能力 | 理由 |
|---|---|---|
| P0 | quality_review | 防止坏视频进入发布 |
| P0 | asset_manifest | 后续所有能力的资产基础 |
| P1 | production_template | 固定常用能力，降低用户复杂度 |
| P1 | edit_decisions 简化版 | 为多 runtime 和 montage 做准备 |
| P2 | compose_runtime 抽象 | 接 HyperFrames/Remotion 的前提 |
| P2 | HyperFrames/Remotion 单点试点 | 提升高质量模板表现 |
| P3 | 轻量 sourcing/montage | 扩充视频类型 |
| P4 | talking-head/clip-factory 等 | 等需求验证 |

## 8. 工程约束

1. 不做大规模重构。
2. 不破坏现有 `standard` 和 `asset_based`。
3. 新能力必须可关闭或只绑定特定模板。
4. 不允许静默 fallback 把失败伪装成成功。
5. 每阶段都必须有可独立验收的用户价值。
6. OpenMontage AGPLv3 代码不能直接复制进 Pixelle；只学习架构和能力思想，具体实现由 Pixelle 自己完成。

## 9. 推荐实施顺序

```text
1. 生成后质量检查
2. 基础 asset_manifest
3. 生产模板 registry
4. 简化 edit_decisions
5. compose_runtime 抽象
6. HyperFrames 或 Remotion 单点试点
7. 轻量真实素材 montage
8. 新生产方式评估
```

## 10. 最终技术结论

技术上应采用：

```text
保留 Pixelle 控制面
增强 Pixelle 生成中间层
逐步扩展合成 runtime 和素材来源
```

不是：

```text
迁移 OpenMontage agent-first 制作架构
重写 Pixelle pipeline 系统
把所有 OpenMontage pipeline 一次性纳入
```

最小可行路线是：

```text
quality_review + asset_manifest + production_template
```

这三项完成后，Pixelle 才有稳定基础去接 HyperFrames/Remotion 和真实素材 montage。
