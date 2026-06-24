# Pixelle P1 UI PRD

版本：v0.3
日期：2026-06-23
状态：P1-A demo 锁版稿
前置状态：P0 Codex-first mock 收口已跑通
关联文档：

1. `docs/zh/product/pixelle-main-rebuild-prd.md`
2. `docs/zh/product/pixelle-main-rebuild-technical-architecture.md`
3. `docs/zh/product/pixelle-main-rebuild-implementation-plan.md`
4. `docs/zh/product/pixelle-p1-ui-implementation-plan.md`
5. `docs/zh/product/pixelle-p1-ui-information-architecture.md`
6. `docs/zh/product/pixelle-p1-ops-loop-demo.html`
7. `docs/zh/product/pixelle-p2-cheat-on-content-prd.md`

## 1. 一句话目标

P1 UI 要把 Pixelle 从“只能在 Codex 里操作、靠命令检查状态”推进到“Codex 负责运营动作，Pixelle UI 负责项目/账号配置、状态检查、证据查看和资产管理”的可用产品界面；P1-A 用独立 Ops 前端验证信息架构和真实数据流，现有 Streamlit 视频生成前端先保持工具台定位。

## 2. 背景

P0 已经证明：

1. Codex 可以通过 `pixelle-ops` 插件完成运营闭环。
2. 生成链路可以经过文案审核、pipeline 选择、异步生成和资产检查。
3. P0 mock 收口可以登记 mock 发布、mock 指标、mock 复盘和 memory，并停在 `next_action: done`。
4. 多项目和多平台账号不能默认混用最近上下文，必须显式选择。

P1 不应该推翻这个方向。P1 的核心不是把运营流程搬到 UI，而是让 UI 成为用户理解、配置和检查 Pixelle 状态的稳定界面。

P1 不承担 cheat-on-content 深度集成。P2 才开始展示 cheat workspace 的健康、rubric 摘要、persona 摘要、候选池摘要、来源引用和 writeback draft 状态；展示边界以 `docs/zh/product/pixelle-p2-cheat-on-content-prd.md` 为准。

P1-A 默认采用独立 Ops 前端：

1. `ops-web` 承载 `Ops / Projects`，作为运营状态与配置控制台。
2. 旧 Streamlit `Create` 保留为视频生成工作台 / sandbox，不再承担运营首页。
3. 旧 Streamlit `History` 保留为生成历史，不等于运营证据链。
4. 旧 Streamlit `Settings` 保留为生成服务配置入口；Ops 前端只链接过去，不把 Settings 塞进 Ops。
5. 部署时 `ops-web` 可以构建为静态文件，由 FastAPI 挂载到 `/ops`；开发阶段可用 Vite 单独运行。

## 3. 产品原则

### 3.1 Codex 仍是运营入口

以下动作仍默认由 Codex 发起：

1. 选题推荐。
2. 内容实验创建。
3. 预测锁定。
4. 文案审核链。
5. 视频生成。
6. 发布证据登记。
7. 指标登记。
8. 复盘和 memory 写入。

UI 可以展示这些动作的结果、阻断原因和下一步提示，但不能在 P1 里复刻一套完整运营后台。

### 3.2 UI 可以做配置写入

P1 允许 UI 写入的范围只有配置类对象：

1. 平台账号元数据。
2. 账号绑定状态。
3. credential reference。
4. Buffer channel 映射或外部账号 id。

这些写入必须带 `source.kind = "ui"`，并写入 Pixelle Ops 的统一状态库。UI 不直接改 SQLite，不直接改生成目录，不直接改 cheat workspace。

### 3.3 UI 不伪造运营事实

P1 UI 不能直接把内容改成已发布、已完成复盘或表现良好。

以下仍必须通过 Pixelle Ops 规则：

1. 发布必须有 PublishRecord 或 mock evidence。
2. 指标必须关联已发布内容。
3. 正式 retro 必须有预测、发布证据和指标。
4. mock 数据必须显式标记 mock。

### 3.4 旧视频生成 UI 与新 Ops UI 的关系

现有 Pixelle-Video UI 是内容生成模块的人工工作台。P1 不删除它，也不把它改造成运营首页。

关系如下：

| 模块 | P1 可见入口 | 定位 | P1-A 是否改造 |
| --- | --- | --- | --- |
| Ops | `ops-web` / `/ops` | 运营状态、证据链、资产、下一步提示 | 新增独立前端 |
| Projects | `ops-web` / `/ops` | 项目和平台账号配置 | 新增独立前端内页面 |
| Settings / Integrations | `ops-web` / `/ops` + Streamlit `Settings` | 全局能力状态、脱敏配置概览、高级配置入口 | 新增只读状态页，编辑仍走旧 Settings |
| Video | Streamlit `Create` | 视频生成工作台 / sandbox | 保留，不改造成运营首页 |
| Video History | `History` | 生成历史和已有生成包 | 保留，不作为运营证据链 |

关键边界：

1. 用户在 Codex 里做运营判断和动作。
2. 用户在独立 `ops-web` 里看运营状态和证据。
3. 用户在独立 `ops-web` 的 `Projects` 里配置项目下的平台账号。
4. 用户在 Streamlit `Create` 里可以手工试生成，但手工生成不会自动进入运营闭环。
5. 用户在独立 `ops-web` 的 `Settings / Integrations` 里查看 LLM、RunningHub、ComfyUI、Fish Audio、COS、Buffer 的脱敏配置状态。
6. 用户需要编辑明文 key 或高级参数时，仍跳到 Streamlit `Settings`；Ops UI 不展示、不保存明文 secret。

### 3.5 Ops 页面信息职责

Ops 页面采用“地图 / 详情主体 / 条件式 Inspector / 原始证据”四层职责，避免把同一状态重复展示成三栏信息墙。

| 区域 | 产品职责 | 展示内容 | 不展示什么 |
| --- | --- | --- | --- |
| 左侧 | 地图 | 轮次列表、当前选中轮次、该轮 6 步闭环、每一步完成 / 缺失 / Mock 状态 | 不展示长文本详情，不展示完整草稿、完整复盘或事件日志 |
| 中间 | 选中步骤的详情主体 | 当前选中步骤真正要查看的对象，例如预测卡、草稿正文、审核结果、视频资产、发布证据、指标快照、复盘结论 | 不重复解释左侧“这是第几步”，不只写抽象说明 |
| Inspector | 条件式判断辅助 | 该步骤能否通过、通过标准、缺什么证据、阻塞什么下一步、对后续轮次有什么影响 | 不作为固定右栏，不重复中间详情，不放完整原文 |
| 底部 | 原始证据与审计追溯 | 原始事件、长文本版本、日志、payload 摘要、历史记录 | 不承担主要详情，不作为用户第一眼判断入口 |

关键原则：

1. 用户点击左侧闭环步骤时，详情主体、Inspector 和底部证据必须同步变化。
2. 详情主体必须比左侧多出“真实对象详情”，否则详情主体没有存在价值。
3. Inspector 必须比详情主体多出“判断标准 / 风险 / 阻塞 / 影响”，否则 Inspector 应该隐藏或折叠。
4. 底部只能用于展开和追溯，不能把主要详情下沉到底部。
5. mock、缺失、真实完成必须在左侧状态、详情主体、Inspector 和底部证据中保持一致。
6. 底部证据区不能提供另一套步骤导航；当前步骤只由左侧闭环地图决定。

工作面字段裁剪规则：

1. 工作面只展示当前步骤做判断必须看的字段；跨步骤状态归左侧闭环地图。
2. 不在每个步骤重复展示“当前环节 / 证据状态 / 查看模式 / 闭环进度”等通用字段。
3. 视频时长、pipeline、asset check 只在“生成并检查资产”步骤展示。
4. 平台链接、post id、Buffer id 只在“发布并记录证据”步骤展示。
5. 浏览、评论、收藏、完播、观测窗口只在“观测数据并复盘沉淀”步骤展示。
6. 底部证据区只展示当前步骤原始记录，不作为第二套导航或第二个详情页。

### 3.6 P1-A demo 锁版约束

P1-A UI 方向以 `docs/zh/product/pixelle-p1-ops-loop-demo.html` 为当前设计基准。该 demo 是信息架构和交互验收物，不是产品状态真相源，也不是后续实现必须逐行复制的前端代码。

锁定点：

1. `Ops` 页面默认采用“左侧轮次闭环 + 中间工作面”的主框架。
2. 中间工作面承载当前步骤的真实业务对象，不再出现解释 UI 用途的说明文案。
3. Inspector 嵌入中间工作面，只在有判断价值时展示标准、风险、缺口、阻塞和影响。
4. 原始证据区默认折叠，只用于追溯事件、payload、原文和历史版本。
5. 点击左侧任意轮次或步骤时，工作面、Inspector 和证据区必须同步变化。
6. 历史轮次复用同一套闭环框架展示，并明确说明对当前轮的影响。
7. `Mock`、缺失、真实完成必须在左侧、工作面、Inspector 和证据区保持一致。

禁止点：

1. 不把所有字段平铺成 dashboard。
2. 不让底部证据区承担主要详情职责。
3. 不在每个步骤重复展示通用字段。
4. 不把中间工作面和 Inspector 做成重复信息。
5. 不把 demo 文件或截图当成运营证据。

## 4. 用户

P1 目标用户仍是个人创作者或小团队运营者。

用户不会把 Pixelle 当成大型营销后台，而是需要回答：

1. 我现在有几个项目？
2. 每个项目绑定了哪些平台账号？
3. 当前项目/账号运行到哪一步？
4. 哪条内容已经生成了什么资产？
5. 发布证据、指标和复盘是否完整？
6. 为什么 Codex 下一步会要求我选择项目或平台账号？
7. 配置缺什么，导致闭环不能继续？

## 5. P1 范围

### 5.1 P1 做

P1 做一套“运营状态与配置 UI”：

1. 项目列表和项目概览。
2. 项目下的平台账号管理。
3. 当前周期和当前实验展示。
4. 内容资产预览。
5. 事件时间线。
6. 发布证据和 mock 标识展示。
7. 指标快照和 mock 标识展示。
8. 下一步动作和阻断原因展示。
9. Codex 自然语言主路径提示。
10. 复制兜底上下文。
11. 基础空状态和错误状态。

### 5.2 P1 不做

P1 不做：

1. 不在 UI 里生成选题。
2. 不在 UI 里锁定预测。
3. 不在 UI 里审核文案。
4. 不在 UI 里触发视频生成。
5. 不在 UI 里真实发布小红书。
6. 不在 UI 里自动回收平台数据。
7. 不做多用户、权限、团队协作。
8. 不做复杂 BI。
9. 不做完整 OAuth 平台矩阵。
10. 不把现有 Streamlit 内容生成页改成运营后台。

## 6. 信息模型

P1 UI 使用 P0 已定模型：

```text
Project
  -> ChannelAccount
  -> OperationCycle
      -> ContentExperiment
          -> ContentItem
          -> OpsEvent
```

用户界面中的命名：

| 技术对象 | 用户可见名称 | P1 UI 说明 |
| --- | --- | --- |
| `OperatingProject` | 项目 | 品牌、业务、IP 或账号矩阵 |
| `ChannelAccount` | 平台账号 | 小红书、抖音、YouTube 等分发账号 |
| `OperationCycle` | 周期 | 一轮运营验证 |
| `ContentExperiment` | 内容实验 | 一条内容判断链 |
| `ContentItem` | 内容资产 | 脚本、视频、图片或发布包 |
| `OpsEvent` | 操作记录 | 预测、生成、发布、指标、复盘、memory |
| `next_action` | 下一步 | Codex 应该继续做什么 |

## 7. 核心用户流程

### 7.1 查看当前状态

用户打开 Pixelle UI，默认看到：

1. 当前项目。
2. 当前平台账号。
3. 当前周期。
4. 当前实验。
5. 最新内容资产。
6. 下一步动作。
7. 最近操作记录。

验收标准：

1. 如果只有一个项目和一个平台账号，UI 可以直接展示当前状态。
2. 如果有多个项目，UI 明确提示“需要选择项目”。
3. 如果同一项目有多个平台账号，UI 明确提示“需要选择平台账号”。
4. UI 不默认使用最近项目继续显示误导性状态。

### 7.2 管理平台账号

用户可以在 UI 里为项目添加平台账号；P1-B 起支持编辑已配置的平台账号元数据。

字段：

1. 平台：`xiaohongshu`、`douyin`、`youtube`、`tiktok`、`instagram`、`x`、`other`。
2. 账号名称。
3. 账号 handle。
4. 外部账号 id。
5. 绑定状态：`configured`、`connected`、`needs_auth`、`disabled`。
6. credential reference。
7. Buffer channel id，可选。
8. 备注，可选。

验收标准：

1. UI 写入后 `pixelle_list_projects` 能看到同一个平台账号。
2. UI 不保存明文平台密码或明文 token。
3. credential reference 只能是引用，不是秘密原文。
4. 创建或编辑平台账号不会改变内容实验状态。

P1-A 的验收以新增账号为准；P1-B 的验收补充编辑平台账号，且同样不能改变内容实验状态。

### 7.3 查看内容实验和资产

用户可以查看某个内容实验的：

1. 标题。
2. 假设。
3. 当前阶段。
4. 内容资产。
5. 视频文件路径、大小、时长。
6. asset check 结果。
7. 发布证据。
8. 指标快照。
9. 复盘和 memory。

验收标准：

1. 视频资产可预览或可打开。
2. asset check 失败时 UI 展示失败项。
3. mock 发布和真实发布视觉上必须区分。
4. 没有真实发布证据时，UI 不显示“已真实发布”。
5. `generation_completed` 只表示生成流程产出过资产，不等于内容可发布；只有 `asset_checked` 通过后，UI 和服务层才允许进入 `record_publish`。

### 7.4 查看下一步

用户可以从 UI 看到 Pixelle Ops 返回的 `next_action`。

UI 需要把技术动作翻译为用户语言：

| next_action.kind | UI 文案 |
| --- | --- |
| `select_project` | 先选择项目 |
| `select_channel_account` | 先选择平台账号 |
| `lock_prediction` | 下一步：在 Codex 里锁定预测 |
| `submit_generation_draft` | 下一步：在 Codex 里提交生成草稿 |
| `approve_generation_draft` | 下一步：审核并批准文案 |
| `request_generation` | 下一步：生成内容 |
| `check_generation_status` | 下一步：检查生成状态 |
| `check_generation_asset` | 下一步：检查生成资产 |
| `record_publish` | 下一步：登记发布证据 |
| `record_metrics` | 下一步：登记指标 |
| `write_retro` | 下一步：写复盘 |
| `done` | 当前闭环已收口 |

验收标准：

1. UI 不暴露不必要的内部工具名。
2. UI 明确提示主路径是直接在 Codex 里用自然语言问 `@pixelle-ops`，不是复制长指令。
3. UI 可以提供“复制兜底上下文”，但必须是弱入口，用于新对话、多项目、多账号或历史轮次定位不清时。
4. 兜底上下文必须带上当前选中的 `project_id`、`channel_account_id`、`cycle_id` 和 `experiment_id`。
5. 如果项目、平台账号、轮次或实验不完整，兜底上下文必须要求 Codex 先向用户确认，不能自动切换到最近项目或最近账号。
6. UI 顶部的“选中上下文”必须和兜底上下文一致；用户查看历史轮次时，顶部展示的是选中轮次，不是全局最新轮次。
7. 技术 ID 不常驻主视觉，只在“兜底上下文 ID”折叠区或复制内容里出现。

## 8. 页面范围

P1-A 独立 Ops 前端顶层导航固定为：

```text
Ops / Projects / Create / History / Settings / Help
```

页面定位：

1. `Ops`：独立前端默认页，展示运营状态、证据链、资产和下一步提示。
2. `Projects`：项目和平台账号配置。
3. `Create`：跳转到旧 Streamlit 视频生成工作台 / sandbox，不是运营首页。
4. `History`：跳转到旧 Streamlit 生成历史，不等于运营证据链。
5. `Settings / Integrations`：在 `ops-web` 展示全局能力脱敏状态，并提供旧 Streamlit 配置入口。
6. `Help`：后续可保留现有帮助入口。

P1-A 不新增顶层 `Assets` 或 `Experiment Detail` 页面。实验详情和资产先折叠在 `Ops` 中展示；如果 P1-A 使用中证明需要独立页面，再进入 P1-B。

P1-A 不再把 Ops 嵌进 Streamlit。Streamlit 只保留视频生成工具台；Ops UI 放在 `ops-web/`，通过 API 读取 Pixelle Ops 状态。

## 9. API 范围

P1-A 需要在 P0 API 基础上补充：

复用现有：

```text
GET /api/ops/current
GET /api/ops/experiments/{experiment_id}
GET /api/ops/integrations
```

新增/补齐：

```text
GET /api/ops/projects
GET /api/ops/projects/{project_id}/cycles
POST /api/ops/projects/{project_id}/channel-accounts
PATCH /api/ops/channel-accounts/{channel_account_id}
```

`GET /api/ops/projects/{project_id}/cycles` 只读返回项目下的运营轮次、每轮内容实验、事件、内容资产和 `next_action`，用于支撑 `Ops` 左侧历史轮次轨道。它不写入运营事实，也不替代 Codex 插件。

`GET /api/ops/integrations` 只读返回全局服务配置状态。它只能返回 `configured / partial / missing`、非敏感元数据、缺失字段和 secret 是否已配置，不能返回 API Key、SecretId、SecretKey、token 或平台密码原文。

P1-A/P1-B 暂不新增：

```text
POST /api/ops/experiments
POST /api/ops/generation
POST /api/ops/publish
POST /api/ops/metrics
POST /api/ops/retro
```

这些仍由 Codex 插件控制。

UI source 规则：

1. UI 配置写入使用 `source.kind = "ui"`。
2. Codex 运营写入继续使用 `source.kind = "codex"`。
3. UI 不直接写 SQLite。
4. UI 不直接调用 Codex plugin 写工具。

## 10. 成功指标

P1 验收以产品可用性为准，不以页面数量为准。

必须达到：

1. 用户不看 SQLite，也能知道 Pixelle 当前运营状态。
2. 用户不问 Codex，也能知道当前缺什么配置。
3. 用户能在 UI 中绑定平台账号元数据。
4. Codex 和 UI 看到的是同一套项目和平台账号。
5. UI 不引导用户绕过 Codex 执行运营闭环。
6. mock 和真实证据不会混淆。
7. 多项目、多平台账号时上下文选择清楚。

## 11. 设计 Brief

P1 UI 的设计对象是一个运营状态和配置工作台，不是营销首页，也不是视频编辑器。

视觉方向：

1. 安静、克制、工具型。
2. 信息密度中等偏高。
3. 强调表格、时间线、状态徽标、资产预览和配置表单。
4. 不使用大 hero、装饰插画、营销卡片堆叠。
5. 第一屏直接展示真实工作状态。

交互等级：

1. P1 实现应是可工作界面，不是静态图。
2. 项目选择、平台账号选择、账号配置表单、状态刷新、Codex 主路径提示和复制兜底上下文必须可用。
3. 运营动作按钮不做，最多提供“去 Codex 继续”的提示。

## 12. 风险

### 12.1 UI 抢走 Codex 入口

风险：为了方便，在 UI 里不断加运营写按钮，最后形成两套状态机。

处理：P1 只允许配置写入，不允许运营事实写入。

### 12.2 账号绑定被误解为真实 OAuth

风险：用户以为“绑定小红书”就是可以自动发布和自动取数。

处理：P1 明确区分 `configured`、`connected`、`needs_auth`。没有真实授权能力的平台只能显示配置引用。

### 12.3 现有 Streamlit 页面太偏生成工具

风险：在 Home/History 上硬塞 Ops UI，导致结构混乱。

处理：新增独立 `ops-web`，不在 Streamlit 内嵌完整 Ops app，不改现有内容生成工作台主流程。

### 12.4 前端范围失控

风险：独立前端变成重写视频生成、发布、指标、复盘的全量后台。

处理：P1-A 的 React/Vite 只做 Ops 状态展示和平台账号配置；视频生成继续留在 Streamlit，运营动作继续留在 Codex。

## 13. P1 完成定义

P1 完成时，用户应该能：

1. 在 Codex 完成内容运营动作。
2. 打开 UI 看见同一项目状态。
3. 在 UI 绑定或检查项目下的平台账号。
4. 在 UI 查看内容资产、发布证据、指标、复盘和 memory。
5. 在 UI 明确知道下一步该回 Codex 做什么。

P1 不要求：

1. UI 真实发布。
2. UI 自动取数。
3. UI 生成视频。
4. UI 替代 Codex 运营对话。
