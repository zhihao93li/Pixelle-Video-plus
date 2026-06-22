# Pixelle P1 UI PRD

版本：v0.1  
日期：2026-06-22  
状态：P1 需求草案  
前置状态：P0 Codex-first mock 收口已跑通  
关联文档：

1. `docs/zh/product/pixelle-main-rebuild-prd.md`
2. `docs/zh/product/pixelle-main-rebuild-technical-architecture.md`
3. `docs/zh/product/pixelle-main-rebuild-implementation-plan.md`
4. `docs/zh/product/pixelle-p1-ui-implementation-plan.md`
5. `docs/zh/product/pixelle-p1-ui-information-architecture.md`

## 1. 一句话目标

P1 UI 要把 Pixelle 从“只能在 Codex 里操作、靠命令检查状态”推进到“Codex 负责运营动作，Pixelle UI 负责项目/账号配置、状态检查、证据查看和资产管理”的可用产品界面。

## 2. 背景

P0 已经证明：

1. Codex 可以通过 `pixelle-ops` 插件完成运营闭环。
2. 生成链路可以经过文案审核、pipeline 选择、异步生成和资产检查。
3. P0 mock 收口可以登记 mock 发布、mock 指标、mock 复盘和 memory，并停在 `next_action: done`。
4. 多项目和多平台账号不能默认混用最近上下文，必须显式选择。

P1 不应该推翻这个方向。P1 的核心不是把运营流程搬到 UI，而是让 UI 成为用户理解、配置和检查 Pixelle 状态的稳定界面。

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
9. 从 UI 复制 Codex 下一步提示。
10. 基础空状态和错误状态。

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

用户可以在 UI 里为项目添加或编辑平台账号。

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
2. UI 提供“复制给 Codex 的下一步提示”。
3. 复制内容是用户语言，不是长工具清单。

## 8. 页面范围

P1 最小页面：

1. `Ops Overview`：总览。
2. `Projects`：项目和平台账号配置。
3. `Experiment Detail`：内容实验详情。
4. `Settings / Integrations`：外部服务和 credential reference 管理入口。

如果继续使用 Streamlit，可以先落在现有 `web/pages` 下；如果决定切 React，P1 必须先做静态原型验证，不直接替换现有 Streamlit。

## 9. API 范围

P1 需要在 P0 API 基础上补充：

只读：

```text
GET /api/ops/projects
GET /api/ops/projects/{project_id}
GET /api/ops/projects/{project_id}/channel-accounts
GET /api/ops/experiments/{experiment_id}
```

配置写入：

```text
POST /api/ops/projects/{project_id}/channel-accounts
PATCH /api/ops/channel-accounts/{channel_account_id}
```

P1 不增加以下 API：

```text
POST /api/ops/experiments
POST /api/ops/generation
POST /api/ops/publish
POST /api/ops/metrics
POST /api/ops/retro
```

这些仍由 Codex 插件控制。

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
2. 项目选择、平台账号选择、账号配置表单、状态刷新、复制 Codex 提示必须可用。
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

处理：新增独立 Ops 页面或独立入口，不改现有内容生成工作台主流程。

### 12.4 过早 React 重写

风险：为了 UI 质量重写技术栈，范围失控。

处理：P1 先用最小可验证实现；如需 React，先做原型和边界评估，再迁移。

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
