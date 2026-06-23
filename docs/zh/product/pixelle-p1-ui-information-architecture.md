# Pixelle P1 UI 方案与信息架构

版本：v0.3
日期：2026-06-23
状态：P1-A demo 锁版稿
关联 PRD：`docs/zh/product/pixelle-p1-ui-prd.md`
关联计划：`docs/zh/product/pixelle-p1-ui-implementation-plan.md`
关联 demo：`docs/zh/product/pixelle-p1-ops-loop-demo.html`

## 1. 设计定位

Pixelle P1 UI 是运营状态和配置工作台。

它不承担“做内容”的主流程，也不承担“决定下一条内容”的主流程。用户真正做判断、确认、生成和复盘仍然在 Codex 里完成。UI 的价值是让这些动作的结果变得可见、可查、可配置。

## 2. 信息架构原则

### 2.1 项目是第一层

UI 的第一层不是平台、不是视频、不是任务，而是项目。

原因：

1. 一个项目可以有多个平台账号。
2. 同一条内容可以发到多个平台。
3. 运营记忆属于项目，不属于单个平台。
4. Codex 的上下文选择也以项目为主。

### 2.2 平台账号是项目下的配置

平台账号不是项目，也不是内容实验。

用户语言：

```text
PetWoods 项目
  -> 小红书 / PetWoods 宠物森友会
  -> 抖音 / PetWoods
  -> YouTube / PetWoods Official
```

### 2.3 内容实验是状态主线

内容实验承载一条内容从预测、生成、发布、指标到复盘的证据链。

UI 不需要复杂任务中心，只需要把这条证据链展示清楚。

## 3. 顶层导航

P1-A 顶层导航固定为：

```text
Ops
Projects
Create
History
Settings
Help
```

导航顺序必须表达产品主次：

1. `Ops` 是独立 Ops 前端默认页。
2. `Projects` 是配置入口。
3. `Create` 跳转到旧 Streamlit 视频生成工作台 / sandbox。
4. `History` 跳转到旧 Streamlit 生成历史。
5. `Settings` 跳转到旧 Streamlit 配置入口。
6. `Help` 后续保留。

P1-A 不新增顶层 `Assets`。生成资产先在 `Ops` 中作为当前实验资产展示，旧生成历史仍通过 `History` 查看。P1-A 也不新增顶层 `Experiment Detail`，详情先折叠在 `Ops` 页面内。

## 3.1 P1-A 当前设计基准

当前 UI demo 已作为 P1-A 的设计基准：

```text
docs/zh/product/pixelle-p1-ops-loop-demo.html
```

该 demo 锁定的是信息结构和交互逻辑，不锁定具体 CSS、静态假数据或实现技术。独立 Ops 前端实现时必须复用以下产品结构：

1. 左侧只做轮次和步骤定位。
2. 中间工作面展示选中步骤的核心业务对象。
3. Inspector 只展示判断辅助信息，并嵌入中间工作面。
4. 底部证据区默认折叠，只做审计追溯。
5. 历史轮次不另开详情页，直接复用同一闭环框架。
6. 每个步骤展示的字段必须按“用户此刻是否需要看、是否需要在这里看”裁剪。

验收时以“点击左侧步骤后，工作面和 Inspector 是否真的改变”为第一优先级；只改变底部证据区视为不合格。

`ops-web` 是 P1-A 的 Ops UI 实现位置；Streamlit 的 `web/app.py` 只保留视频生成工具导航。

P1-A 还必须覆盖以下边缘状态：

1. 多项目：不默认选最近项目，必须提示选择项目。
2. 多平台账号：不默认选最近账号，必须提示选择平台账号。
3. 无周期：展示“还没有运营轮次”，下一步是创建周期。
4. 无实验：展示“当前轮次还没有内容实验”，下一步是创建实验。
5. 生成完成但未资产检查：当前步骤停在“生成并检查资产 / 检查生成资产”，不能显示可发布。
6. mock 发布：必须显式显示 Mock，不能与真实发布证据混用。

## 4. 页面结构

### 4.1 Ops

目的：回答“现在 Pixelle 运营到哪一步？”

首屏布局采用四层结构，但视觉上只保留“左侧地图 + 中间工作面”两列。Inspector 是中间工作面里的条件式判断区，不是固定右栏。

```text
顶部：项目选择 / 平台账号选择 / 当前运营轮 / 正在查看轮 / 刷新状态

左侧：轮次地图
  轮次列表
  当前选中轮次的 6 步闭环
  每一步完成 / 缺失 / Mock 状态

中间：选中步骤的详情主体
  展示该步骤真正的业务对象
  例如预测卡、草稿正文、审核结果、视频资产、发布证据、指标快照、复盘结论

中间内嵌 Inspector：选中步骤的判断辅助
  通过标准
  缺失证据
  阻塞的下一步
  对后续轮次或项目记忆的影响
  没有判断价值时隐藏或折叠

底部：原始证据和追溯
  事件日志
  长文本原文
  payload 摘要
  历史版本
```

核心模块：

1. Context Bar
2. Cycle Rail
3. Step Loop Map
4. Step Detail Workspace
5. Conditional Step Inspector
6. Evidence Drawer / Event Timeline

P1-A 低保真线框：

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Pixelle Ops                         Codex 主路径        [刷新]       │
│ 在 Codex 里问：使用 @pixelle-ops，下一步做什么？ [复制兜底上下文]      │
├─────────────────────────────────────────────────────────────────────┤
│ PetWoods · 小红书短视频测试  当前运营轮 R5  正在查看 R5  平台 小红书 │
├───────────────┬─────────────────────────────────────────────────────┤
│ 轮次地图      │ 选中步骤详情主体                                    │
│ R5 当前       │ 《母猫配完后多久能看出怀孕？》                      │
│ R4 历史 Mock  │ 当前选中：内容资产                                   │
│ R3 历史       │ final.mp4 / 71.9s / asset passed                    │
│               │ 视频预览                                            │
│ 1 预测 ✓      │                                                     │
│ 2 草稿 ✓      │  条件式 Inspector                                   │
│ 3 审核 ✓      │  通过标准 / 缺失证据 / 阻塞下一步 / 对后续影响       │
│ 4 资产 ✓      │                                                     │
│ 5 发布 缺失   │  下一步行动                                         │
│ 6 复盘 缺失   │                                                     │
├───────────────┴─────────────────────────────────────────────────────┤
│ 原始证据抽屉：当前步骤原文 / 事件日志 / payload 摘要 / 历史版本     │
└─────────────────────────────────────────────────────────────────────┘
```

#### Ops 区域职责

| 区域 | 职责 | 用户问题 | P1-A 呈现 |
| --- | --- | --- | --- |
| 左侧轮次地图 | 定位 | 我现在看哪一轮？这一轮走到哪一步？ | 轮次列表 + 6 步闭环状态 |
| 中间详情主体 | 查看对象 | 我点的这一步，到底有什么实际内容？ | 该步骤的核心对象和摘要详情 |
| 条件式 Inspector | 做判断 | 这一步能不能过？缺什么？影响什么？ | 标准、风险、阻塞、下一步影响；没有判断价值时隐藏或折叠 |
| 底部证据区 | 追溯 | 原始记录在哪里？长文本在哪里？ | 事件、payload、原文、历史版本 |

详情主体和 Inspector 必须随着左侧闭环步骤切换。只更新底部证据区是不合格交互。

#### Ops 步骤内容矩阵

| 左侧选中步骤 | 详情主体展示什么 | 条件式 Inspector 展示什么 | 底部证据区展示什么 |
| --- | --- | --- | --- |
| 1. 复盘与选题判断 | 本轮选题、预测假设、预期指标、预测风险、引用的上一轮结论摘要。例：为什么这轮做“母猫配完后多久能看出怀孕”。 | 选题是否有依据、是否重复上一轮、预测是否已锁定、缺少哪些历史数据或外部依据、是否允许进入草稿。 | 完整预测日志、被引用的上一轮复盘原文、候选题列表、rubric/项目记忆片段。 |
| 2. 生成/提交内容草稿 | 当前草稿正文或屏幕字幕稿、草稿版本、是否只包含可审核文本。 | 草稿是否干净、是否混入视频目标/标题/正文/标签、是否需要返回修改、是否允许提交审核。 | 完整草稿、版本差异、草稿提交事件、生成 draft payload。 |
| 3. 人工审核定稿 | 审核结果、审核时间、审核人/来源、通过或退回原因。 | 审核是否通过、未通过时阻塞什么、是否允许进入生成、是否存在 Codex 自改文案风险。 | 审核记录、用户确认文本、approve/reject 事件、审核意见原文。 |
| 4. 生成并检查资产 | 视频资产、封面/素材、文件路径、时长、asset check、预览。 | 资产是否存在、是否可播放、时长是否异常、素材是否完整、是否允许进入发布审核。 | generation_requested/completed 事件、asset check 输出、文件路径、ffprobe 摘要。 |
| 5. 发布并记录证据 | 发布证据字段：平台链接、post id、Buffer id、发布时间；如果是 mock，显示 mock 证据。 | 是否真实发布、mock 是否被明确标记、缺哪些字段、是否阻塞指标观测和复盘。 | PublishRecord、mock publish 事件、平台响应、发布说明或失败记录。 |
| 6. 观测数据并复盘沉淀 | 指标快照、观测窗口、复盘结论、写回项目记忆的内容。 | 指标是否真实、是否足够复盘、预测是否命中、哪些结论影响下一轮、是否允许闭环收口。 | metrics 记录、retro 原文、memory 写入事件、评论或指标来源摘要。 |

#### Ops 工作面字段审计

每个步骤只保留“用户此刻做判断必须看的字段”。不因为版式统一而强行展示同一组字段。

| 步骤 | 工作面必须展示 | Inspector 必须展示 | 不应在这里展示 |
| --- | --- | --- | --- |
| 1. 复盘与选题判断 | 本轮题目、引用的上一轮复盘/项目记忆、预测假设、预测是否锁定 | 依据是否足够、是否重复、是否允许进入草稿 | 视频文件、时长、发布链接、平台指标、完整事件日志 |
| 2. 生成/提交内容草稿 | 待审草稿正文或摘要、草稿版本、草稿是否干净 | 是否混入视频目标/标题/正文/标签、是否允许提交审核 | 资产状态、发布字段、指标、复盘结论 |
| 3. 人工审核定稿 | 审核结论、审核来源、审核时间、确认版本或退回原因 | 是否通过、未通过阻塞什么、是否允许进入生成 | 完整草稿重复展示、视频时长、发布字段、指标 |
| 4. 生成并检查资产 | 视频文件、预览、时长、pipeline、asset check | 资产是否可用、是否能进入发布审核、是否存在素材或时长风险 | 发布链接、post id、观测指标、复盘结论 |
| 5. 发布并记录证据 | 平台 URL、post id、Buffer id、发布时间、mock 标记 | 发布是否真实、缺哪些证据、是否阻塞观测和复盘 | 视频时长、pipeline、完整草稿、预测假设、通用闭环进度 |
| 6. 观测数据并复盘沉淀 | 指标快照、观测窗口、复盘结论、写回项目记忆内容 | 指标是否可信、预测是否命中、是否允许收口并影响下一轮 | 视频预览、人工审核定稿细节、发布表单字段、全量事件流 |
| 底部证据抽屉 | 当前步骤原始记录、payload 摘要、长文本原文、必要事件片段 | 不承担判断职责 | 不提供第二套步骤导航，不替代工作面详情 |

#### 关键交互规则

1. 点击左侧某一轮时，整页切换到该轮；当前运营轮仍在顶部保留。
2. 点击左侧某一步时，详情主体、Inspector 和底部证据区必须同时切换。
3. 详情主体必须展示真实业务对象，而不是抽象说明。
4. Inspector 必须展示标准、风险、阻塞和影响；如果没有这些信息，Inspector 应隐藏或折叠。
5. 底部证据区只做追溯，不承载首要详情，也不提供另一套步骤导航。
6. mock 数据在左侧、详情主体、Inspector、底部都必须显式标记，不得用“已真实发布”“表现完成”等文案。

多项目空态：

```text
请选择项目
当前有多个运营项目。Pixelle 不会默认沿用最近项目继续运营。
[项目选择下拉]
```

多平台账号空态：

```text
请选择平台账号
该项目下有多个分发账号。发布、指标和复盘证据必须归属到明确账号。
[平台账号选择下拉]
```

#### Context Bar

显示：

1. 当前项目。
2. 当前平台账号。
3. 当前协议状态。
4. 当前数据更新时间。

多项目时：

```text
需要选择项目
```

多账号时：

```text
需要选择平台账号
```

#### Next Action Panel

展示用户语言版下一步。

例：

```text
下一步：登记发布证据
这条内容已经生成并通过资产检查。如果已真实发布，请回到 Codex 提供小红书链接、post id、Buffer id 或平台响应。
```

如果是 mock 收口：

```text
当前为 mock 收口
这些数据不能用于真实表现校准。
```

#### Event Timeline

按时间顺序展示：

1. prediction_locked
2. generation_drafted
3. generation_draft_approved
4. generation_requested
5. generation_completed
6. asset_checked
7. publish_recorded
8. metrics_recorded
9. retro_written
10. memory_written

每条记录显示：

1. 时间。
2. 用户可见动作名。
3. 来源：Codex / UI / system。
4. 关键 payload 摘要。
5. mock 标识。

### 4.2 Projects

目的：管理项目和平台账号配置。

布局：

```text
左侧：项目列表
右侧上：项目详情
右侧中：平台账号列表
右侧下：账号绑定/编辑表单
```

P1-A 写入范围：

1. 新增平台账号。
2. P1-B 支持编辑已有平台账号配置。
2. 设置账号初始状态。
3. 保存 credential reference。
4. 保存 Buffer channel id。

平台账号编辑从 P1-B 开始支持，只编辑账号元数据和 credential reference，不写运营事实。

P1 不做：

1. 删除项目。
2. 删除历史内容实验。
3. 直接创建内容实验。
4. 直接发布内容。

P1-A 低保真线框：

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Projects                                                            │
├──────────────────────┬──────────────────────────────────────────────┤
│ 项目列表             │ 项目详情                                     │
│ > PetWoods           │ 名称 PetWoods 小红书短视频测试               │
│   其他项目           │ 产品 PetWoods                                │
│                      │ 主渠道 xiaohongshu                           │
├──────────────────────┴──────────────────────────────────────────────┤
│ 平台账号                                                            │
│ 小红书 / PetWoods 宠物森友会     configured     credential: ref...  │
│ 抖音 / PetWoods                    needs_auth     credential: -       │
├─────────────────────────────────────────────────────────────────────┤
│ 新增平台账号                                                        │
│ 平台 [xiaohongshu v]  账号名称 [                 ]  handle [       ] │
│ 外部账号 id [             ]  状态 [configured v]                    │
│ credential ref provider [manual]  key [pixelle/petwoods/xhs]        │
│ Buffer channel id [              ]                                  │
│ [保存平台账号]                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.3 Create

目的：保留旧视频生成工作台，明确它是 Video 模块的 sandbox。

P1-A 只做轻量定位：

1. 页面标题继续表达“Create Video”。
2. 增加一行说明：这是视频生成工作台，运营实验请从 Codex 发起，并在 Ops 查看状态。
3. 保留 pipeline selector 和现有生成能力。
4. 不把这里的手工生成自动写成运营事实。

### 4.4 History

目的：保留旧生成历史，避免把生成历史误认为运营证据链。

P1-A 只做轻量定位：

1. 保留已有生成任务和发布包查看能力。
2. 如果页面存在发布能力，文案上必须区分“生成历史发布工具”和“Ops 证据链”。
3. 不把 history 里的任务直接展示成已完成运营闭环。

### 4.5 Settings / Integrations

目的：管理全局系统能力配置入口。

P1 最小内容：

1. LLM 配置状态。
2. RunningHub / ComfyUI 配置状态。
3. Fish Audio / TTS 配置状态。
4. COS 配置状态。
5. Buffer 配置状态。
6. 平台账号 credential reference 说明。
7. 不支持自动授权的平台提示。

`ops-web` 内的 `Settings / Integrations` 只做脱敏状态页和高级配置入口；如果用户需要编辑明文 key、Secret 或高级参数，仍跳到旧 Streamlit `Settings`。Ops UI 不返回、不展示、不保存明文 secret。

P1-A 低保真线框：

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Settings / Integrations                                             │
│ 全局系统能力配置。Ops 和 Video 共用这些能力。                       │
├───────────────────────────────┬─────────────────────────────────────┤
│ 生成能力                      │ 发布与存储                          │
│ LLM            configured     │ COS             configured           │
│ RunningHub     needs_auth     │ Buffer          configured           │
│ ComfyUI        disabled       │ Credential ref  只保存引用，不存密钥 │
│ Fish Audio     configured     │                                     │
└───────────────────────────────┴─────────────────────────────────────┘
```

### 4.6 Experiment Detail（P1-B 候选）

目的：查看一条内容实验完整证据链。

入口：

1. Ops Overview 当前实验点击进入。
2. History 或后续资产列表点击进入。
3. Timeline 中点击实验 id。

内容：

1. 实验标题和假设。
2. 当前阶段。
3. 预测内容。
4. 生成草稿摘要。
5. 视频资产。
6. asset check。
7. 发布证据。
8. 指标快照。
9. 复盘。
10. memory。

关键设计：

1. 正式数据和 mock 数据必须视觉区分。
2. 发布证据缺失时，不显示“已发布”。
3. 可以复制“继续此实验的 Codex 提示”。

P1-A 不实现独立 Experiment Detail 页面。

## 5. 状态和视觉语言

### 5.1 阶段状态

| stage | 颜色倾向 | 用户文案 |
| --- | --- | --- |
| `draft` | gray | 草稿 |
| `prediction_locked` | blue | 已锁定预测 |
| `generation_requested` | amber | 生成中 |
| `generation_completed` | green | 已生成 |
| `generation_failed` | red | 生成失败 |
| `published` | green | 已登记发布 |
| `metrics_recorded` | purple | 已记录指标 |
| `retro_written` | slate | 已复盘 |
| `done` | green | 已收口 |

### 5.2 证据类型

真实证据：

1. platform_url。
2. platform_post_id。
3. buffer_post_id。
4. platform_response。

mock 证据：

1. `mock: true`
2. `mock_label`

视觉规则：

1. mock 使用明确的 `Mock` 标签。
2. mock 不用“成功发布”文案。
3. mock 不出现在真实表现统计里。

## 6. 用户路径

### 6.1 查看 P0 收口结果

```text
打开 Ops
-> 看到当前项目 PetWoods
-> 看到当前实验
-> 看到 stage / next_action
-> 展开 Timeline
-> 确认 mock publish / mock metrics / retro / memory
```

### 6.2 为项目绑定一个小红书账号

```text
打开 Projects
-> 选择 PetWoods
-> 点击添加平台账号
-> 选择 xiaohongshu
-> 输入账号名称和 handle
-> 保存
-> 回到 Ops
-> 选择该平台账号
```

### 6.3 多平台账号时继续运营

```text
打开 Ops
-> UI 显示需要选择平台账号
-> 用户选择小红书账号
-> UI 显示当前上下文
-> 回 Codex 直接问 @pixelle-ops 下一步做什么
-> 如新对话定位不清，再复制兜底上下文
```

### 6.4 查看生成资产

```text
打开 Ops
-> 在当前实验中看到已生成视频
-> 查看 asset check、发布状态和 mock 标识
-> 如需看更早生成任务，打开 History
-> History 只表示生成历史，不表示运营证据链
```

### 6.5 调整全局生成配置

```text
打开 Settings
-> 看到 Settings / Integrations
-> 检查 LLM、RunningHub、ComfyUI、Fish Audio、COS、Buffer 状态
-> 配置生成模块需要的 key 或服务参数
-> 回到 Create 做手工生成测试，或回到 Ops 查看运营状态
```

### 6.6 使用旧 Create 工作台

```text
打开 Create
-> 选择 generation pipeline
-> 做手工视频生成测试
-> 该结果只属于 Video sandbox
-> 需要进入运营闭环时，仍回到 Codex 发起运营实验
```

## 7. 页面数据依赖

### Ops

依赖：

```text
GET /api/ops/current
GET /api/ops/projects
GET /api/ops/projects/{project_id}/cycles
```

`GET /api/ops/projects/{project_id}/cycles` 是 P1-A 为历史轮次轨道新增的只读 query。它返回项目下的周期、实验、事件、资产和每条实验的 `next_action`，使历史轮次可以复用 `Ops` 同一套闭环框架展示。

### Projects

依赖：

```text
GET /api/ops/projects
POST /api/ops/projects/{project_id}/channel-accounts
PATCH /api/ops/channel-accounts/{channel_account_id}
```

### Settings / Integrations

依赖：

```text
GET /api/ops/integrations
```

返回内容只能包含：

1. 服务 `configured / partial / missing` 状态。
2. 非敏感字段，例如 model、base_url、workflow、bucket、public_base_url、已配置渠道数。
3. secret 是否已配置和来源，例如 `config.yaml` 或 `env:FISH_API_KEY`。
4. 缺失字段。
5. 高级配置入口。

禁止返回 API Key、SecretId、SecretKey、token、平台密码或 OAuth refresh token 原文。

P1-B 账号配置交互规则：

1. 新增或编辑平台账号保存成功后，UI 自动选中刚保存的账号。
2. 无平台账号时，Ops 空态只能引导进入 Projects 配置账号，不创建运营事实。
3. 无运营轮次时，Ops 空态提示用户直接在 Codex 里问 `@pixelle-ops`，不在 UI 中创建周期或实验。
4. 多平台账号且未选择时，Ops 明确要求选择账号，不默认使用最近账号。
5. 顶部固定展示项目、平台账号、选中轮次、当前实验和下一步；这是用户确认“我正在看什么”的区域，不是操作入口，不展示运营证据详情。
6. 顶部必须明确“Codex 是主入口”，给出自然语言问法，例如 `使用 @pixelle-ops，下一步做什么？`。
7. 复制只作为“兜底上下文”，必须弱化展示；复制内容包含当前选中的 `project_id`、`channel_account_id`、`cycle_id`、`experiment_id` 和下一步。
8. 缺任一关键上下文时，兜底上下文必须要求 Codex 先向用户确认。
9. 用户点击历史轮次时，中间工作面、证据抽屉、顶部选中轮次和兜底上下文必须同步切换到该轮次，不能继续引用全局最新轮次。

P1-A 不依赖：

```text
GET /api/ops/projects/{project_id}
GET /api/ops/projects/{project_id}/channel-accounts
```

这些 query 是否需要进入 P1-B，取决于 P1-A 中账号配置的真实使用反馈。

### Create

依赖：

```text
现有 pixelle_video / web.pipelines 能力
```

Create 不依赖 Ops 写 API。手工生成不会自动创建内容实验、发布证据、指标或复盘。

### History

依赖：

```text
现有生成历史和发布包读取能力
```

History 不等于 Ops 证据链。发布证据仍以 Ops event 为准。

### Settings / Integrations

依赖：

```text
现有 config manager / settings components
```

设置页写入全局服务配置，不写运营事实。

### Experiment Detail（P1-B 候选）

如果 P1-B 拆出独立实验详情页，复用：

```text
GET /api/ops/experiments/{experiment_id}
```

## 8. 组件清单

P1 建议组件：

1. `ProjectSelector`
2. `ChannelAccountSelector`
3. `NextActionPanel`
4. `StatusBadge`
5. `MockBadge`
6. `EvidenceSummary`
7. `AssetPreview`
8. `EventTimeline`
9. `ChannelAccountForm`
10. `CodexPromptCopy`

这些组件落在 `ops-web/src`，不能再作为 Streamlit render 函数实现。

## 9. 文案规则

UI 使用用户语言，不用内部工具名。

允许显示的技术 id：

1. project id。
2. channel account id。
3. experiment id。
4. content item id。
5. event id。

但默认折叠到详情里，不放主视觉层。

禁止文案：

1. “自动发布成功”，除非真实平台响应存在。
2. “数据回收完成”，除非真实 metrics 来源存在。
3. “已发布”，如果只有 mock evidence。
4. “请选择 context”，改为“请选择项目/平台账号”。

## 10. 设计下一步

已确认：

1. P1-A 用独立 `ops-web` 落地，不再把 Ops 嵌入 Streamlit。
2. `Ops` 做独立前端默认页。
3. 旧 Streamlit `Create / History / Settings` 保留为 Video 工具模块。
4. P1-A 先实现 `Ops + Projects`；`Create / History / Settings` 在 Ops 前端中只作为跳转入口。
5. 视觉保持克制工具型，当前 demo 暂定为 P1-A 实现方向，不再继续做三套视觉方向。
6. 后续实现不得新增固定右栏来重复中间工作面的信息；判断信息优先嵌入当前步骤工作面。
