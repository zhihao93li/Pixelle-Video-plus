# Pixelle 视频生成 Pipeline 模块 PRD

版本：v0.1
日期：2026-06-29
状态：讨论稿
适用范围：Pixelle 视频生成模块、Pipeline 扩展、Ops/Codex/API 调用边界
目标读者：产品、后端、前端、Codex/自动化执行者
配套技术方案：`docs/zh/product/pixelle-video-generation-pipeline-technical-architecture.md`

## 1. 一句话目标

把 Pixelle 的视频生成能力整理成一个独立、可扩展、可被 UI、Ops、Codex 和 API 共同调用的模块；以后新增一种视频生成方式时，只需要新增并注册一个 pipeline，而不是同时修改多套 UI、API 和运营状态逻辑。

## 2. 背景和问题

当前 Pixelle 已经有视频生成核心、Streamlit 生成工作台、FastAPI 视频接口、Ops 状态机和 Codex 插件工具，但它们对“视频生成”的理解还没有完全统一。

现状可以概括为：

1. Streamlit 生成页可以直接调用 `pixelle_video.generate_video(...)`。
2. FastAPI 有 `/api/video/generate/sync` 和 `/api/video/generate/async`。
3. Ops/Codex 有生成草稿、审批、请求生成、查询生成状态和 asset check。
4. `pixelle_video` 内部已有 `standard`、`custom`、`asset_based` 等 pipeline 雏形。
5. 未来还会新增小红书短视频、商品种草、素材混剪、数字人口播、图生视频、动作迁移等更多生成方式。

如果不先定义 pipeline 标准，后续每新增一种生成方式都可能出现：

1. UI 能用但 API 不能用。
2. API 能生成但 Ops 不能追踪。
3. Ops 有状态但没有真实任务结果。
4. 同一个字段在不同入口名字不同。
5. 失败原因、进度、资产记录无法统一。
6. 底层 RunningHub workflow 被误当作产品级 pipeline。

本 PRD 的目标是先统一产品定义和阶段目标，再进入技术实现。

## 3. 核心定义

### 3.1 Pipeline

Pipeline 是一种完整的视频生产方式。

它不是 UI 页面，不是模板，也不是 RunningHub/ComfyUI workflow。Pipeline 负责把某类输入变成可交付的视频资产。

示例：

1. 小红书字幕短视频 pipeline。
2. 商品种草视频 pipeline。
3. 素材混剪 pipeline。
4. 数字人口播 pipeline。
5. 图生视频 pipeline。
6. 动作迁移 pipeline。

每个 pipeline 必须说明：

1. 它适合什么场景。
2. 它支持哪些入口。
3. 每个入口需要哪些输入。
4. 每个入口从哪个阶段开始。
5. 内部会执行哪些阶段。
6. 最终会输出什么。
7. 依赖哪些底层能力。

### 3.2 Entry

Entry 是 pipeline 的入口类型，决定 pipeline 从哪一步开始。

不要求所有 pipeline 都支持所有入口。每个 pipeline 必须明确声明自己支持哪些入口。

固定入口类型如下：

| Entry | 含义 | 示例 |
|---|---|---|
| `topic` | 给选题或想法，pipeline 自己生成文案 | “母猫配完还叫是不是没配上？” |
| `script` | 给完整文案，pipeline 做视频化 | 已审核口播稿或字幕稿 |
| `scenes` | 给分镜/字幕列表，pipeline 直接进入配音、画面和合成 | 逐镜头字幕数组 |
| `assets` | 给图片、视频、商品素材，pipeline 组织素材并包装成片 | 商品图、素材视频、卖点 |
| `audio` | 给现成音频，pipeline 做画面或合成 | 已录好的口播音频 |
| `video` | 给已有视频，pipeline 做二次加工 | 加字幕、改比例、包装、剪辑 |

### 3.3 Stage

Stage 是 pipeline 内部的生产步骤。

常见 stage 包括：

1. 理解输入。
2. 生成或接收文案。
3. 拆分分镜。
4. 生成配音。
5. 生成画面。
6. 素材处理。
7. 合成视频。
8. 保存资产。
9. 返回结果。

不是每个 pipeline 都必须执行所有 stage。入口越靠后，跳过的 stage 越多。

### 3.4 文案生成

文案生成可以是 pipeline 的内部阶段，但必须是可选阶段。

原则：

1. 如果入口是 `topic`，pipeline 可以自己生成文案。
2. 如果入口是 `script`，pipeline 不应该重写已确认文案。
3. 如果入口是 `scenes`，pipeline 应该尊重用户给出的分镜/字幕。
4. 文案生成、分镜拆分和最终生成之间必须允许人工审核或外部系统接入。

## 4. 产品边界

### 4.1 Pipeline 不负责什么

Pipeline 不负责：

1. 推荐下一条内容。
2. 判断哪个选题更值得做。
3. 运营项目、账号、周期和实验管理。
4. 发布证据记录。
5. 指标回收。
6. 复盘和项目记忆写入。
7. 保存用户的运营事实。

这些属于 Pixelle Ops 或 Codex 方法论层。

### 4.2 Pipeline 负责什么

Pipeline 负责：

1. 根据入口输入执行视频生产。
2. 校验生成所需参数。
3. 报告生产进度。
4. 产出视频资产和相关中间结果。
5. 暴露失败原因。
6. 返回统一结果，供 UI、Ops、Codex、API 和发布模块使用。

### 4.3 Ops 与 Pipeline 的关系

Ops 管“为什么生成、为哪个实验生成、生成后进入哪个运营步骤”。

Pipeline 管“怎么生成、生成到哪里、成功失败原因是什么”。

关系如下：

```text
Ops / Codex / UI / API
  -> 发起生成请求
  -> Generation Service
  -> Pipeline
  -> 视频资产和生成结果
  -> Ops 记录实验结果和下一步动作
```

## 5. 最终目标

最终目标是建立一个独立的视频生成模块，满足以下条件：

1. Pipeline 可以独立定义、独立维护、独立测试。
2. 新增 pipeline 不需要大面积改 UI、Ops、Codex 和 API。
3. 所有调用方通过统一生成服务调用 pipeline。
4. 每个生成任务都有统一的任务状态、进度、结果和错误结构。
5. 生成结果可以被 Ops 绑定到内容实验，也可以被普通 UI/API 单独使用。
6. 底层 RunningHub/ComfyUI workflow 只作为 pipeline 使用的工具，不直接成为产品入口。

### 5.1 产品验收原则

后续所有阶段都必须先从真实目标出发，再判断最小完成条件。

对视频生成模块来说，真实目标不是“接口返回成功”，而是调用方能拿到可用、可追踪、可解释的视频生产结果。

最小完成条件：

1. 输入被正确理解和校验。
2. 必要配置、凭证、权限和外部服务可用。
3. Pipeline 按声明的 entry 和 stage 执行。
4. 真实资产被生成、保存，并能被调用方读取。
5. 进度、结果和失败原因按统一结构返回。
6. Ops 或其他调用方不会把“已请求生成”误认为“已生成完成”。

以下情况不能算完成：

1. 用占位视频、占位 asset、mock 结果冒充真实生成成功。
2. 跳过核心步骤后仍返回 success。
3. 吞掉错误，只返回宽泛的失败文案。
4. 把 fallback、degraded path、temporary workaround 当成正式修复。
5. 只验证单个函数返回，而没有验证调用方真正需要的结果。

如果短期必须保留 fallback 或临时绕行，必须明确标记为临时降级，并让系统状态保持诚实：真实生成失败就应该是失败，不能被包装成成功。

实现判断标准：

1. 优先解决根因，不优先堆补丁。
2. 先识别失败层：输入、配置、凭证、网络、API 契约、权限、持久化、运行时或产品假设。
3. 选择能稳定满足目标的最简单方案。
4. 不为了格式、流程或局部一致性保留无实际价值的复杂度。
5. 如果某个机制反复阻碍真实目标，要重新讨论该机制，而不是继续在周围加补偿逻辑。

## 6. 阶段规划

### P0：Pipeline 标准定义

优先级：最高

目标：

1. 定义 pipeline、entry、stage、result、artifact 的统一概念。
2. 定义 pipeline 标准说明格式。
3. 用新格式描述现有 `standard`、`custom`、`asset_based`。

验收标准：

1. 有一份明确的 pipeline 定义文档。
2. 每个 pipeline 都能说明支持哪些 entry。
3. 每个 entry 都能说明需要哪些输入字段。
4. 现有 3 个 pipeline 能被标准格式描述。
5. 团队后续讨论 pipeline 时不再混淆 UI 页面、模板和底层 workflow。

### P1：Pipeline Registry

优先级：最高

目标：

1. 建立 pipeline 注册表。
2. 让系统可以查询所有 pipeline。
3. 让系统可以查询某个 pipeline 支持的 entry、参数和能力依赖。

验收标准：

1. 可以列出所有已注册 pipeline。
2. 可以按 pipeline id 查询 manifest。
3. 可以知道每个 pipeline 支持哪些 entry。
4. 可以知道每个 entry 需要哪些字段。
5. 新增 pipeline 的主要工作集中在 pipeline 自己目录和注册文件。

### P2：Generation Service

优先级：高

目标：

1. 建立统一生成服务。
2. 所有生成请求都变成统一的 `GenerationRequest`。
3. 所有生成结果都变成统一的 `GenerationResult`。
4. 所有生成过程都有统一任务状态、进度和错误结构。

验收标准：

1. 可以提交生成任务并获得 `generation_task_id`。
2. 可以查询任务状态。
3. 可以查询生成进度。
4. 可以获得最终视频结果。
5. 失败时可以获得结构化失败原因。
6. 至少一个现有 UI 或 API 入口走统一 Generation Service。

### P3：Ops/Codex 接入真实生成任务

优先级：高

目标：

1. Ops 请求生成时创建真实 generation task。
2. Ops 记录 `generation_task_id`。
3. Ops 根据真实任务状态更新实验生成状态。
4. asset check 使用真实生成结果。

验收标准：

1. 内容实验可以绑定真实生成任务。
2. 生成完成后可以创建对应 `ContentItem`。
3. 生成失败后 Ops 能显示真实失败层和错误原因。
4. asset check 能读取真实视频路径和相关资产。
5. Ops 不再把“生成已请求”误当成“生成已完成”。

### P4：UI 接入统一生成能力

优先级：中

目标：

1. UI 从 registry 读取 pipeline 列表。
2. UI 根据 pipeline entry 渲染输入。
3. UI 提交统一生成请求。
4. UI 展示统一任务状态和结果。

验收标准：

1. 至少一个 UI 不再直接调用 `pixelle_video.generate_video(...)`。
2. 用户可以选择 pipeline。
3. 用户可以选择 pipeline 支持的 entry。
4. UI 能展示任务进度、成功结果和失败原因。
5. UI 不需要理解底层 RunningHub workflow 细节。

### P5：规模化新增 Pipeline

优先级：中高

目标：

1. 在标准底座上新增多种视频生产方式。
2. 每个 pipeline 独立维护。
3. 通过统一 registry 和 Generation Service 被各模块调用。

验收标准：

1. 新增 pipeline 不需要大面积修改旧 pipeline。
2. 新增 pipeline 不需要单独改 Ops 状态机。
3. 新增 pipeline 可以被 API 查询和调用。
4. 新增 pipeline 的参数、入口和输出都能被标准 manifest 描述。
5. 每个 pipeline 都有最小自动化测试。

## 7. 阶段优先级

优先顺序：

1. P0：Pipeline 标准定义。
2. P1：Pipeline Registry。
3. P2：Generation Service。
4. P3：Ops/Codex 接入真实生成任务。
5. P4：UI 接入统一生成能力。
6. P5：规模化新增 Pipeline。

说明：

1. 如果马上大面积增加 pipeline，必须先完成 P0 和 P1。
2. 如果 pipeline 要被 Ops/Codex/发布链路使用，必须完成 P2 和 P3。
3. UI 重构不是第一优先级，应该在服务边界稳定后再做。

## 8. 实施分支策略

P0/P1 建议从 `plus/main` 新开独立分支实现：

```text
codex/pixelle-generation-pipeline-foundation
```

不建议直接叠在当前 Ops/发布准备分支上实现。

原因：

1. P0/P1 属于视频生成模块底座，应该独立维护。
2. 当前 Ops 分支已经包含运营状态、ops-web 和发布准备能力，继续叠加会扩大合并和 review 范围。
3. Pipeline foundation 应该先合入 `plus/main`，再让 Ops 分支接入它。
4. 这样后续新增 pipeline 可以主要修改生成模块，而不是牵动 Ops/P3 发布链路。

推荐分支关系：

```text
plus/main
  -> codex/pixelle-generation-pipeline-foundation   # P0/P1
      -> codex/pixelle-generation-service           # P2
          -> Ops 分支接入真实 generation task        # P3
```

合并顺序建议：

1. 从 `plus/main` 创建 `codex/pixelle-generation-pipeline-foundation`。
2. 在该分支完成 P0/P1。
3. 将 P0/P1 合回 `plus/main`。
4. 当前 Ops/P3 分支再 rebase 或 merge `plus/main`。
5. 在 Ops 分支继续做真实 generation task 接入。

预计合并冲突范围较小，主要可能集中在：

1. `api/app.py`：新增 generation router 与已有 ops router 注册。
2. `api/routers/__init__.py`：新增 router export。
3. `api/schemas/__init__.py`：新增 schema export。
4. `pixelle_video/service.py`：pipeline 注册方式从手写 dict 迁移到 registry。
5. `docs/zh/product/`：新增文档文件，一般不会产生复杂冲突。

P0/P1 分支必须避免顺手修改 Ops、发布、UI 大流程。只要保持边界，后续合并成本可控。

## 9. 非目标

本阶段不做：

1. 不重写整个视频生成引擎。
2. 不一次性迁移所有 Streamlit 页面。
3. 不把 Ops 和视频生成模块合并成一个大服务。
4. 不把 RunningHub workflow 直接暴露为产品级 pipeline。
5. 不要求所有 pipeline 都支持 `topic` 入口。
6. 不要求所有 pipeline 都能自动写文案。
7. 不做复杂权限、多租户和云端队列。

## 10. 产品验收总标准

本模块阶段性完成时，应该能回答以下问题：

1. 现在有哪些 pipeline？
2. 每个 pipeline 适合什么场景？
3. 每个 pipeline 支持哪些入口？
4. 每个入口需要哪些输入？
5. 每个 pipeline 会执行哪些阶段？
6. 每个 pipeline 输出哪些资产？
7. 任何调用方如何提交生成任务？
8. 如何查询任务进度？
9. 如何获得最终视频结果？
10. 如何定位失败原因？
11. Ops 如何把生成结果绑定到内容实验？
12. 新增 pipeline 时需要改哪些地方？

如果这些问题都有稳定答案，说明 pipeline 模块进入可扩展状态。
