# Pixelle 从 main 重做 PRD

版本：v1.1
日期：2026-06-24
状态：重做基准稿，已补充 P2 cheat-on-content 集成方向
适用范围：从 `main` 新开干净分支后的产品重建
目标读者：产品、后端、前端、Codex/自动化执行者
配套技术方案：`docs/zh/product/pixelle-main-rebuild-technical-architecture.md`
配套实施计划：`docs/zh/product/pixelle-main-rebuild-implementation-plan.md`
P1 UI PRD：`docs/zh/product/pixelle-p1-ui-prd.md`
P1 UI 信息架构：`docs/zh/product/pixelle-p1-ui-information-architecture.md`
P1 UI 实施计划：`docs/zh/product/pixelle-p1-ui-implementation-plan.md`
P2 cheat-on-content 集成 PRD：`docs/zh/product/pixelle-p2-cheat-on-content-prd.md`

## 1. 一句话目标

Pixelle 要成为 Codex 插件化的个人内容运营闭环系统：用户通过 Codex 调用 Pixelle 插件完成运营动作，Pixelle Ops 负责决定、校准、发布、度量和复盘的状态与证据；内容产生只作为执行层，把被选中的内容实验变成可发布、可验证、可复盘的内容资产；Pixelle UI 只作为状态、证据和资产展示面板。

## 2. 为什么要从 main 重做

当前大分支已经混入了过多不同阶段的产物：前端实验、Media Core 工作台、PRD 草稿、audit 截图、demo HTML、协议修复、迁移脚本和大量测试一起进入同一个分支。它可以作为素材库，但不能作为产品主线。

重做的目的不是推翻之前所有判断，而是把真正符合最终诉求的能力从大分支里抽出来，用更小的产品模型重新落地。

本次重做必须避免三个错误：

1. 不再把“功能素材库”当成“可合并产品分支”。
2. 不再为了兼容所有旧入口而增加更多补丁式规则。
3. 不再让内容生成、媒体工作台、后台页面和文档产物反过来定义产品。

## 3. 最终用户和使用场景

目标用户是一个个人创作者或小团队运营者。用户不是来管理一套复杂营销后台，而是每天回答：

```text
现在最值得做哪条内容？
为什么做它？
我发布前的判断是什么？
内容是否已经真实发布？
结果怎么样？
下一轮应该学到什么？
```

Pixelle 的默认对象不是 Campaign、页面、任务或媒体文件，而是一个持续运营的项目。

Pixelle 的默认操作场所也不是 UI，而是 Codex 对话。用户在 Codex 里讨论、判断、确认和发起动作；Codex 通过 Pixelle 插件工具调用 Pixelle Ops；Pixelle 保存状态、校验证据、触发生成，并把结果展示出来。

P1 已经把 Ops UI 做成状态和配置面板。P2 的主线不是继续扩 UI，而是把 `cheat-on-content` 作为 Codex 方法论层接入 Pixelle：Pixelle 负责产品事实，cheat workspace 负责 rubric、候选、预测、persona、复盘和写作 pattern 等方法论文件，两者通过只读摘要和受控 writeback draft 协作。

示例：

```text
PetWoods 小红书增长项目
  -> 本周清洁内容验证周期
      -> 候选内容实验 A/B/C
      -> 锁定预测
      -> 生成脚本/视频/发布包
      -> 发布确认
      -> 数据回收
      -> 单条复盘
      -> 写入项目记忆
      -> 下一轮内容选择
```

## 4. 产品核心

Pixelle 只有两个核心功能。

### 4.1 运营闭环

运营闭环是主系统。它负责：

1. 定义运营项目。
2. 开启一个运营周期。
3. 选择内容实验。
4. 在结果出现前锁定假设或预测。
5. 触发内容生产。
6. 确认真实发布。
7. 采集或录入表现数据。
8. 复盘预测和实际差异。
9. 把被接受的学习写入项目记忆。

运营闭环的价值不是“状态完整”，而是让用户的判断持续变准。

### 4.2 内容产生

内容产生是执行层。它负责：

1. 生成脚本、标题、caption、图片、视频、音频或发布包。
2. 把生成结果绑定到一个内容实验。
3. 暴露生成失败、配置缺失和素材缺失。
4. 让用户审核并决定是否进入发布准备。

内容产生不能独立成为主产品。没有运营项目、运营周期和内容实验的生成，只能是 sandbox，不得进入默认运营主线。

### 4.3 两者关系

关系是层级关系，不是并列关系。

```text
运营闭环
  决定要验证什么
  锁定判断
  触发内容产生
  回收发布和数据证据
  形成下一轮学习

内容产生
  只执行被选中的实验
  只产生可追踪资产
  只通过运营闭环进入发布和复盘
```

## 5. 产品非目标

P0 不做：

1. 不做通用营销 CRM。
2. 不做多用户、多团队、权限系统。
3. 不做完整 SaaS 后台。
4. 不做通用 AI 视频编辑器。
5. 不做所有平台的一键自动发布。
6. 不做复杂 BI 和归因分析。
7. 不把 Media Core 工作台设为默认主产品。
8. 不把 Codex 输出直接当作已确认产品状态。
9. 不把 audit 截图、demo HTML、实验 PRD、生成样例放进主线分支。
10. 不一次性迁移当前大分支的所有功能。
11. 不把 Pixelle UI 做成运营后台入口。
12. 不要求用户通过 UI 表单完成运营闭环。

## 6. 概念模型

P0 使用以下产品模型：

```text
OperatingProject
  -> ChannelAccount
  -> OperationCycle
      -> ContentExperiment
          -> ContentItem
          -> MediaAsset
          -> PublishRecord
          -> MetricsSnapshot
          -> ContentRetro
  -> ProjectMemoryEvent
```

### 6.1 OperatingProject

运营项目是产品根对象。

它表示一个长期运营对象，通常是一个品牌、业务、IP 或账号矩阵。项目不是一次活动，也不是单个平台账号。它持有长期目标、项目记忆和默认内容方向。

没有 OperatingProject 的对象可以存在于迁移区或 sandbox，但不得出现在默认主流程。

### 6.1.1 ChannelAccount

平台账号是项目下的分发渠道，例如小红书 PetWoods、抖音 PetWoods、YouTube PetWoods。

一个项目可以有多个平台账号。同一条内容可以发到多个平台账号，但这不是多个项目，也不是多个内容实验；它会形成多条 PublishRecord。

### 6.2 OperationCycle

运营周期是一轮有边界的运营尝试。

P0 可以继续使用现有 `Campaign` 作为存储承载，但产品语言必须使用 OperationCycle 的语义。用户不应该被迫理解传统 Campaign 后台。

一个周期必须属于一个 OperatingProject。

### 6.3 ContentExperiment

内容实验是校准容器。

它必须回答：

1. 这条内容为什么值得做？
2. 结果出现前的判断是什么？
3. 判断是在什么时候锁定的？
4. 它生成了什么内容资产？
5. 它是否真实发布？
6. 实际表现如何？
7. 学到了什么？

主流程中的内容生成必须绑定到 ContentExperiment。

### 6.4 ContentItem

ContentItem 是可发布内容单元。它不是闭环本身。

它可以有脚本、标题、caption、状态和媒体资产，但它的运营意义来自所属的 ContentExperiment。

### 6.5 PublishRecord

PublishRecord 是发布证据，不是发布意图。

以下不等于已发布：

1. 生成了发布包。
2. 已排期。
3. 用户写了备注。
4. 任务执行成功。
5. Codex 说已经发布。

已发布必须有外部证据，例如平台 URL、平台 post id、Buffer post id、明确 sent_at 或等价平台响应。

### 6.6 MetricsSnapshot

MetricsSnapshot 是表现数据快照。

没有发布证据的内容不能进入正式表现复盘。可以做 observation，但必须显式标记为 observation，不得伪装成盲预测复盘。

### 6.7 ProjectMemoryEvent

项目记忆只保存被接受的学习，不保存所有过程日志。

记忆应该回答：

```text
以后再做这个项目时，哪些判断要被默认参考？
```

## 7. P0 用户流程

P0 只交付一条 Codex-first 的竖切闭环。

默认流程是：

```text
用户在 Codex 里运营
  -> Codex 使用 cheat-on-content 方法论工作
  -> Codex 调用 Pixelle 插件工具
  -> Pixelle Ops 校验并保存产品状态
  -> pixelle_video 执行内容生成
  -> Pixelle UI 只读展示状态、证据和资产
```

UI 可以展示下一步和阻断原因，但不作为主操作入口。

### 7.1 创建或选择运营项目

用户在 Codex 中创建或选择正在运营的项目。

如果没有项目，Codex 引导用户补齐：

1. 项目名称。
2. 产品或主题。
3. 渠道。
4. 平台账号。
5. 长期目标。

验收标准：

1. 没有真实项目时，不显示伪造的主流程。
2. sandbox、demo、orphan 对象不进入默认主流程。
3. 用户可以在 Codex 和 UI 中清楚看到当前运营项目是什么。
4. UI 不提供绕过 Codex/Ops 的独立创建入口。

### 7.2 开启运营周期

用户在 Codex 中为项目开启一个周期。

周期需要：

1. 周期目标。
2. 想验证的问题。
3. 主要指标。
4. 复盘窗口。

验收标准：

1. 周期必须属于真实 OperatingProject。
2. 周期可以没有复杂计划表，但必须有验证目标。
3. 默认下一步基于当前周期生成。
4. UI 只展示当前周期和阻断状态，不承担周期规划入口。

### 7.3 选择内容实验

用户通过 Codex 手动描述候选内容，或让 Codex 基于项目状态提议候选。

候选进入主流程前必须形成 ContentExperiment。

验收标准：

1. 候选内容和内容实验可追踪。
2. Codex 提议只是 draft，用户确认后才进入产品状态。
3. 每个进入生成的内容都有 experiment id。
4. UI 只展示候选、draft 状态和确认结果，不提供独立候选池编辑器。

### 7.4 锁定预测

在生成或发布前，用户在 Codex 中完成结果前判断，Codex 按 cheat-on-content 协议起草预测。

预测可以简单，但必须明确：

1. 预测内容。
2. 预测桶或预期表现。
3. 锁定时间。
4. 置信度或依据。

验收标准：

1. 如果已有发布证据、metrics 或复盘数据，则不能再伪装成 blind prediction。
2. 结果后补写只能标为 observation 或低置信度。
3. 内容生成前必须存在有效的 locked prediction。
4. UI 可以展示预测是否锁定，但不能作为事后补写 blind prediction 的入口。

### 7.5 内容产生

内容产生包括脚本、素材、视频、音频、图片和发布包。

P0 只要求 Codex 能从一个已锁定预测的 ContentExperiment 触发内容生成任务，并把结果绑定回该实验。

验收标准：

1. 没有 OperatingProject 时不能进入主生成。
2. 没有 ContentExperiment 时不能进入主生成。
3. 没有 locked prediction 时不能进入主生成。
4. 生成 job payload 必须包含 operation context。
5. 生成失败必须真实显示，不允许用 fallback 假装成功。
6. UI 只展示生成进度、失败原因和资产预览。

### 7.6 发布确认

发布确认是闭环分界点。

P0 支持 Codex 入口下的两种方式：

1. 手动发布后，用户在 Codex 中录入平台 URL 或平台 id。
2. 自动发布或 Buffer 发布后，系统保存平台响应。

验收标准：

1. 不能直接把 ContentItem 写成 `published`。
2. `confirmation_note` 不算发布证据。
3. `published_at` 和 `platform_url` 不能通过通用内容编辑入口直写。
4. 状态进入 `published` 必须通过发布确认入口。
5. 已发布状态必须有可检查的 PublishRecord。
6. UI 只展示发布证据，不提供直接改发布状态的表单。

### 7.7 数据回收

用户通过 Codex 录入、导入或确认指标。

P0 不要求自动拉取所有平台数据，但必须保证数据和已发布内容关联。

验收标准：

1. 没有发布证据的内容不能进入正式 metrics 复盘。
2. 指标必须属于具体 ContentItem。
3. 指标录入后，内容可以进入 measured。
4. UI 只展示指标快照和来源。

### 7.8 单条复盘和学习写入

复盘比较预测和实际结果，形成学习。

验收标准：

1. 正式 retro 必须有预测、发布证据和 metrics。
2. 没有预测只能写 observation。
3. observation 不能污染预测校准。
4. 学习写入 ProjectMemoryEvent 前必须可追溯到内容和证据。

## 8. 默认界面要求

P0 不做运营后台。Pixelle UI 的定位是只读展示面板，用来让用户检查 Codex 运营动作的结果。

UI 的默认原则：

1. 不作为运营入口。
2. 不承载候选生成、预测、复盘和记忆写入的主流程。
3. 不提供绕过 Pixelle Ops 的状态修改表单。
4. 不复制 Codex/cheat-on-content 的方法论。
5. 只展示状态、证据、资产、阻断原因和审计记录。

P2 增加一个展示边界：UI 可以展示 cheat workspace 的健康状态、摘要、已应用来源和一致性状态，但不成为 cheat workspace 浏览器，也不展示所有 markdown 原文。

P2 UI 信息披露分四档：

| 披露档位 | UI 行为 | 示例 |
|---|---|---|
| 主展示 | 当前步骤必须直接看到 | workspace health、rubric version、confidence、source hash、pending draft、conflict |
| 二级详情 | 点开后可看 | persona 摘要、benchmark 状态、candidate count、validation errors |
| 只做引用 | 不展开全文，只保存路径/hash/mtime | `predictions/*.md`、`rubric_notes.md`、`script_patterns.md` |
| 不展示 | UI 不展示，最多做健康检测 | `.cheat-cache/*`、登录态、cookie、API key、blind 污染源全文 |

### 8.1 首页

首页只回答：

```text
当前项目是什么？
当前周期是什么？
现在最该做哪一步？
为什么被阻断？
最近一次 Codex 动作是什么？
```

不展示完整后台导航作为第一心智，也不把首页做成操作台。

### 8.2 当前状态页

当前状态页根据内容阶段展示证据链。

示例：

1. 待预测：显示缺少预测，以及应回到 Codex 完成预测。
2. 可生成：显示生成前检查通过，以及 Codex 可触发生成。
3. 生成中：显示 job 状态、进度和失败原因。
4. 资产可用：显示预览、文件和来源实验。
5. 待发布确认：显示缺少发布证据。
6. 待补数据：显示缺少 metrics。
7. 可复盘：显示预测、实际和待复盘状态。

### 8.3 结果和记忆页

结果页展示证据链，而不是只展示图表。

必须显示：

1. 哪些内容已发布。
2. 哪些内容有 metrics。
3. 哪些内容可以正式复盘。
4. 哪些只是 observation。
5. 哪些学习已经写入项目记忆。
6. 哪些状态来自 Codex draft，哪些已经 apply。

## 9. Codex 边界

Codex 是运营入口，但不是状态真相。

Codex 可以：

1. 读取项目状态。
2. 提议候选内容。
3. 给内容评分。
4. 起草预测。
5. 生成复盘草稿。
6. 提议写入项目记忆。
7. 发起内容生成。
8. 登记发布证据和指标。
9. 请求 Pixelle Ops validate/apply。

Codex 不可以：

1. 绕过用户确认直接改变核心产品状态。
2. 把备注当成证据。
3. 在结果出现后伪造 blind prediction。
4. 让生成、发布、复盘看起来成功但缺少真实证据。
5. 把 UI 展示状态当作已确认产品状态。

所有 Codex 写入都必须通过 Pixelle 插件工具进入 Pixelle Ops，并保留来源、原因和审计记录。插件工具可以在内部调用本地 service 或 API，但不能直接写数据库或绕过 Pixelle Ops 规则。

## 10. 从当前大分支回收功能的规则

当前大分支只作为素材库。回收规则如下。

### 10.1 必须回收

1. OperatingProject 作为根对象的语义。
2. OperationCycle 归属真实项目的规则。
3. ContentExperiment 和 locked prediction。
4. 发布证据门。
5. retro 和 observation 的区分。
6. 生成任务绑定 operation metadata。
7. 项目记忆写入。

### 10.2 可以延后

1. 完整 marketing console 多页面。
2. Media Core 工作台。
3. 复杂 resource settings。
4. 多计划聚合队列。
5. 自动平台 readback。
6. 大量 Codex 提示词和记忆扩展。

### 10.3 必须丢弃或移出主线

1. 临时 demo 产物。
2. audit 截图。
3. 临时 HTML demo。
4. 重复 PRD 和过期实现计划。
5. 为探索生成的静态 assets。
6. 不服务 P0 竖切闭环的页面。
7. 只为绕过测试而存在的 fixture 或 helper。

## 11. 工程约束

为了避免再次失控，P0 必须遵守以下约束。

### 11.1 变更规模

P0 初始 PR 目标：

1. 生产代码新增不超过 2,000 行。
2. 测试新增不超过 1,500 行。
3. 文档新增不超过 1,000 行。
4. 不提交截图、demo HTML、audit 产物。
5. 不提交与 P0 无关的 lockfile 大改。

如果必须超过，必须先写清楚为什么无法拆分。

### 11.2 分支策略

从 `main` 新开干净分支。

禁止直接合并当前大分支。只能 cherry-pick 或手工提取明确需要的文件片段。

每个提交必须对应一个产品不变量或一个用户可验证动作。

### 11.3 测试策略

测试保护不变量，而不是复制所有接口细节。

P0 最少测试：

1. 没有真实 OperatingProject 不进主流程。
2. 没有 locked prediction 不能主生成。
3. confirmation_note 不算发布证据。
4. direct content write 不能进入 confirmed publish 状态。
5. 没有预测的复盘只能 observation。
6. CLI/API/Plugin 至少各有一条不能绕过主协议的测试。
7. UI 不能调用 Pixelle Codex Plugin 写工具或直接写产品状态。

## 12. 成功标准

P0 完成后，用户可以完成一条真实闭环：

1. 在 Codex 中创建运营项目。
2. 在 Codex 中创建运营周期。
3. 在 Codex 中创建或确认一个内容实验。
4. 在 Codex 中锁定预测。
5. 通过 Codex 发起内容生成。
6. 在 Codex 中确认发布证据。
7. 在 Codex 中录入表现数据。
8. 在 Codex 中完成复盘。
9. 在 Codex 中确认写入项目记忆。
10. 在 Pixelle UI 中查看状态、证据、资产、复盘和记忆。

系统同时满足：

1. 不会把生成成功误报为发布成功。
2. 不会把人工备注误报为发布证据。
3. 不会把事后观察误报为盲预测。
4. 不会让 sandbox/demo/orphan 数据进入默认主流程。
5. 不会要求用户理解一整个营销后台才能继续下一步。

## 13. 明确的验收场景

### 场景 A：新项目第一轮

用户创建 PetWoods 项目，绑定小红书 PetWoods 平台账号，开启“清洁内容验证”周期，选择一条内容实验，锁定预测，生成视频，人工发布后录入小红书链接，三天后录入数据并复盘。

验收：

1. 每一步都有唯一下一步。
2. 每一步缺证据时显示 blocked。
3. 最终 ProjectMemoryEvent 包含学习和来源内容。

### 场景 B：Codex 提议但不直接写入

Codex 根据项目状态提议 5 条内容候选和预测草稿。

验收：

1. 候选默认是 draft。
2. 用户确认后才进入 ContentExperiment。
3. Codex run 和 apply 记录可追踪。

### 场景 C：错误发布状态被阻止

用户或 API 尝试直接把内容写成 `published`。

验收：

1. 请求被拒绝。
2. 错误说明必须走发布确认入口。
3. 数据库不产生伪发布状态。

### 场景 D：生成不能脱离实验

用户尝试对一个 approved ContentItem 直接生成视频，但它没有 locked prediction。

验收：

1. preflight blocked。
2. 不创建生成 job。
3. 用户被引导先锁定预测。

### 场景 E：事后数据只能 observation

一个内容已经发布并有 metrics，但没有结果前预测。

验收：

1. 正式 retro 被拒绝。
2. 用户可以选择 observation-only。
3. observation 学习不会污染 blind prediction 校准。

## 14. 开放问题

1. P0 UI 的只读展示范围到哪里为止：只做当前状态页，还是同时做资产预览和证据链结果页？
2. OperationCycle 是否继续用 Campaign 命名存储，还是新建独立模型？
3. ContentExperiment 是否必须一开始就是独立表，还是可以先由现有内容字段承载一部分？
4. 发布证据是否允许 legacy `ContentItem.platform_url` 临时迁移为 PublishRecord？
5. 项目记忆是否只写结构化事件，还是同时写 cheat workspace 文件？
   结论：P2 采用主从分层。Pixelle 写结构化 ProjectMemoryEvent，并保存 cheat source 引用；是否同步写回 cheat workspace 只能通过 cheat 协议产生新的 draft，不能自动覆盖文件。

## 15. 本 PRD 的硬边界

如果某个功能不能清楚回答下面任一问题，它不进 P0：

```text
它服务运营闭环的哪一步？
它是否让内容产生更可验证？
它是否需要真实证据？
它是否能减少用户下一步判断成本？
它是否会让主分支明显膨胀？
```

P0 的目标不是做多，而是把 Pixelle 的核心闭环做窄、做真、做稳定。
