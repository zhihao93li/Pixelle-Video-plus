# Pixelle P3 发布模块 PRD

版本：v0.1
日期：2026-06-27
状态：P3 需求基准稿
适用范围：P2 cheat-on-content 主路径稳定后，设计独立发布模块
目标读者：产品、后端、前端、Codex/插件执行者
相关文档：

- `docs/zh/product/pixelle-main-rebuild-prd.md`
- `docs/zh/product/pixelle-main-rebuild-technical-architecture.md`
- `docs/zh/product/pixelle-p2-cheat-on-content-prd.md`
- `docs/zh/product/pixelle-p3-publish-module-technical-architecture.md`
- `docs/zh/product/pixelle-p3-publish-ui-design.md`

## 1. 一句话目标

P3 要把发布能力做成 Pixelle 的独立模块。第一版先不触碰平台发布页，只负责把已审核内容整理成不同平台、不同内容类型可直接使用的发布准备包，支持一键复制、资产交付和手动发布证据回写。

P3 的目标不是“自动点击发布按钮”，第一版也不是“自动上传和填表”，而是：

```text
把已审核内容安全、准确、可复用地准备成平台发布包，并在用户手动发布后留下可验证证据。
```

## 2. 背景和问题

P0/P1/P2 已经把选题、预测、草稿、审核、生成和 asset check 串起来。当前真实状态已经能停在 `record_publish`，说明系统知道“下一步该发布”。

但现在发布仍然缺少独立模块：

1. Ops 只能登记发布证据，不能生成稳定、可复制、可复用的平台发布包。
2. 旧视频生成模块里有 Buffer/COS 等发布相关能力，但它们服务的是生成任务，不是运营闭环。
3. 小红书、抖音、YouTube 等平台能力不同，不能把某个平台的发布方式写死进 Ops。
4. 浏览器录制发布有风控风险，第一版不应该接触平台页面。
5. 同一条内容可能分发到多个平台账号，需要每个平台有独立证据、状态和失败处理。

所以 P3 要先定义一个独立发布模块，再由 Ops 主流程调用它。

## 3. 模块定位

发布模块独立于 Ops、Video 和 cheat-on-content。

```text
cheat-on-content：做选题、评分、预测、复盘方法论
Ops Loop：决定当前闭环状态，选择内容、项目、平台账号
Video Module：生成视频或图文资产
Publish Module：准备平台发布包，记录发布证据；后续可扩展为辅助或自动发布
Metrics/Retro：发布后观测数据并复盘
```

发布模块不做：

1. 不做选题。
2. 不改预测。
3. 不改已批准文案。
4. 不生成视频。
5. 不判断内容是否值得发。
6. 不做表现复盘。

发布模块第一版只回答：

```text
这个内容发到这个平台账号时，需要哪些字段和资产？用户手动发布后，是否留下了可验证证据？
```

## 4. 设计原则

### 4.1 发布包是模块边界

Ops 不能直接把零散字段丢给发布 adapter。进入发布模块前，必须先生成 `PublishPackage`。

`PublishPackage` 是“要发什么”的冻结契约，包含：

1. 发哪个项目的内容。
2. 发到哪个平台账号。
3. 发什么资产。
4. 用什么标题、正文、标签、封面。
5. 来源于哪个 approved draft 和 content item。
6. 当前包的 hash。

发布模块只能使用 `PublishPackage` 里的内容，不能临时改文案、换视频、换账号或补写运营判断。

### 4.2 发布证据不是发布意图

以下都不等于已发布：

1. 创建了发布包。
2. 打开了发布页面。
3. 上传了视频。
4. 填好了表单。
5. 自动化流程执行完成。
6. 用户说“我发了”但没有链接、post id、截图或平台响应。

已发布必须有 `PublishEvidence`，并且被 Ops 校验后才能生成 `PublishRecord`。

### 4.3 第一版只做发布准备，不接触平台页面

第一版优先级：

1. 生成平台发布包。
2. 按平台和内容类型渲染标题、正文、标签、封面建议、资产清单和发布 checklist。
3. 支持一键复制单字段或完整发布包。
4. 支持打开、下载或定位待发布资产。
5. 用户手动发布后，登记发布证据。

第一版不打开平台发布页，不上传视频，不填写平台表单，不点击发布按钮。

### 4.4 自动化后置

浏览器辅助、官方 API 和全自动发布都是后续能力。

后续优先级：

1. 有官方 API 且风控低的平台，可以优先做官方 API adapter。
2. 无稳定 API 的平台，可以在发布包流程跑顺后再做浏览器辅助。
3. 小红书、抖音等高风控平台即使做浏览器辅助，也默认停在发布按钮前让用户确认。
4. 全自动发布必须最后做，并且显式开启。

### 4.5 同一内容多平台分发必须分开记录

同一个 `ContentItem` 可以发布到多个平台账号，但每个平台账号必须有独立 `PublishPackage` 和 `PublishEvidence`。后续如果接入辅助或自动发布，每个平台账号还需要独立 `PublishAttempt`。

原因：

1. 平台标题、正文、标签、封面要求不同。
2. 发布时间不同。
3. post id 和 URL 不同。
4. 失败原因不同。
5. 后续指标和复盘需要按平台分开。

## 5. P3 范围

### 5.1 P3-A 必须做

1. `PublishPackage` 模型。
2. `PublishEvidence` 模型。
3. 平台发布字段渲染：小红书、YouTube、抖音等平台可以有不同字段。
4. 内容类型渲染：视频、图文可以有不同资产和文案结构。
5. 一键复制：标题、正文、标签、完整发布包。
6. 资产交付：预览、打开文件位置、复制文件路径或下载入口。
7. 发布 checklist：账号、资产、标题、正文、标签、封面、合规提醒。
8. 手动发布证据登记：URL、post id、截图、发布时间、备注。
9. 发布前校验：资产、账号、平台、包 hash、asset check。
10. 发布证据校验：URL/post id/API response/截图/账号一致性。
11. Codex 插件工具。
12. UI 展示发布包、复制入口、资产入口、checklist 和发布证据。
13. P3-A smoke 和回归测试。

### 5.2 P3 后续再做

1. `PublishAttempt` 模型。
2. 浏览器辅助发布模式 `assisted`。
3. 小红书 browser adapter。
4. 官方 API adapter。
5. 自动发布模式 `automatic`。
6. 发布过程截图、浏览器日志和上传回执。
7. 发布重试、取消和执行态恢复。

### 5.3 第一版不做

1. 不打开平台发布页。
2. 不上传视频或图片到平台。
3. 不自动填写平台表单。
4. 不点击发布按钮。
5. 不默认全自动发布。
6. 不绕过验证码、人机校验或平台风控。
7. 不做多账号批量连续发布。
8. 不做移动端 App 自动发布。
9. 不做无头浏览器优先发布。
10. 不把录制动作直接当成发布模块。
11. 不把“复制过发布包”当成发布成功。
12. 不做自动指标回收。
13. 不做自动复盘。
14. 不把 UI 变成发布主入口。

## 6. 核心对象

### 6.1 PublishPackage

`PublishPackage` 是不可变发布准备包。

建议字段：

```text
id
project_id
cycle_id
experiment_id
content_item_id
channel_account_id
platform

content_type: video / image_text
asset_paths
cover_path
title
body
tags
platform_fields
copy_blocks
checklist

approved_draft_id
approved_text_hash
asset_hash
package_hash

status: draft / ready / locked / evidence_recorded / cancelled
created_by
created_at
locked_at
```

关键规则：

1. `ready` 后才能进入人工发布准备。
2. `locked` 后不能修改正文、资产、账号。
3. 如果要改，必须新建 package。
4. `package_hash` 用于人工发布后证据比对。
5. `copy_blocks` 是 UI/Codex 的复制来源，不能由 UI 临时拼接。
6. `checklist` 是平台发布前检查项，不代表系统已经发布。

### 6.2 PublishAttempt

`PublishAttempt` 是一次发布执行尝试。P3-A 不需要正式启用；只有接入 assisted、official API 或 automatic 时才需要。

建议字段：

```text
id
package_id
adapter
mode: assisted / api / automatic
status
started_at
updated_at
finished_at
error_code
error_message
risk_flags
operator_user
```

状态：

```text
requested
validating
uploading
form_filled
waiting_user_confirm_publish
submitted
evidence_captured
verified
failed
cancelled
```

### 6.3 PublishEvidence

`PublishEvidence` 是平台侧发布证据。

建议字段：

```text
id
attempt_id
package_id
platform
channel_account_id
content_item_id

platform_post_id
post_url
published_at
platform_response
screenshot_path
final_title
final_body
final_tags
account_identity
asset_hash
package_hash
operator_confirmed
evidence_source: manual / browser / api / mock
verified_at
```

有效证据至少满足一项：

1. 平台 URL。
2. 平台 post id。
3. 官方 API 成功响应。
4. Buffer post id 和 sent 状态。
5. 明确 mock evidence，且只能用于 dry-run。

### 6.4 PublishAdapter

`PublishAdapter` 是后续平台执行器。P3-A 不运行平台执行 adapter，只运行发布包 renderer 和手动证据登记。

第一批 renderer / adapter：

| Adapter | 方式 | 适用平台 | P3 默认 |
|---|---|---|---|
| `platform_payload_renderer` | 渲染复制字段和 checklist | 所有平台 | 必做 |
| `manual_evidence` | 用户发布后登记 | 所有平台 | 必做 |
| `xiaohongshu_browser_assisted` | 浏览器辅助，停在发布前 | 小红书 | 后置 |
| `youtube_api` | 官方 API | YouTube | 可后置 |
| `buffer_api` | Buffer API | Buffer 支持的平台 | 可复用旧能力 |

## 7. 内容类型

P3 发布模块至少要支持两类内容：

| 内容类型 | 必填资产 | 必填文本 | 说明 |
|---|---|---|---|
| `video` | video asset | title/body/tags 可按平台要求选择 | 当前主路径 |
| `image_text` | image assets | title/body/tags | 后续图文笔记 |

内容类型不是平台类型。一个平台 adapter 需要声明自己支持哪些内容类型。

## 8. 发布模式

### 8.1 prepare

系统只准备发布包，不触碰平台。

流程：

```text
create package
validate package
render platform payload
copy title/body/tags/package
open or download asset
用户人工发布
record evidence
verify evidence
Ops 生成 PublishRecord
```

### 8.2 manual evidence

用户已经手动发布，系统只记录证据。

流程：

```text
select package or content item
record URL/post id/screenshot/published_at
verify evidence
Ops 生成 PublishRecord
```

### 8.3 assisted

系统辅助填写和上传，但不默认点击最终发布。P3-A 不做，后续再做。

未来流程：

```text
create package
validate package
request assisted publish
adapter 打开发布页
adapter 上传资产并填表
adapter 保存发布前截图
attempt 进入 waiting_user_confirm_publish
用户人工确认发布
用户登记链接或 adapter 读取结果
verify evidence
Ops 生成 PublishRecord
```

### 8.4 automatic

系统自动提交发布。

P3-A 不做。未来必须显式开启，并满足：

1. 平台 API 或 adapter 稳定。
2. 账号身份确认。
3. 上传完成确认。
4. 发布前截图保存。
5. 无验证码或异常提示。
6. 包 hash、资产 hash、账号 hash 一致。
7. 有幂等保护，避免重复发。
8. 有失败回滚或人工介入状态。

## 9. Codex 使用场景

### 场景 A：当前内容待发布

用户说：

```text
用 @pixelle-ops 查看当前状态
```

系统返回：

```text
当前实验已生成并通过 asset check。
下一步：创建发布准备包，或登记已经手动发布的证据。
```

如果没有发布包，建议：

```text
是否为当前视频创建小红书发布准备包？
```

### 场景 B：创建发布准备包

用户说：

```text
给这条视频准备小红书发布包
```

系统必须：

1. 读取当前 content item 和平台账号。
2. 校验 asset check 已通过。
3. 生成小红书视频发布字段。
4. 返回标题、正文、标签、资产、封面建议和 checklist。
5. 提供单字段复制和完整发布包复制。
6. 不打开小红书页面，不上传，不填表。

### 场景 C：手动发布登记

用户说：

```text
我已经发布到小红书，这是链接：...
```

系统必须：

1. 读取当前 package 或要求选择 content item/platform account。
2. 校验链接或 post id。
3. 记录 `PublishEvidence`。
4. 让 Ops 写入 `PublishRecord`。
5. 进入观测阶段。

### 场景 D：同一内容多平台分发

用户说：

```text
这条视频准备小红书和 YouTube 发布包
```

系统应该创建两个 package：

```text
package A: content_item -> xiaohongshu account
package B: content_item -> youtube channel
```

两者共享 content item 和 asset hash，但各自有不同标题、正文、标签、封面建议、复制块和证据。

### 场景 E：辅助发布请求

用户说：

```text
帮我自动打开小红书并填好
```

P3-A 系统必须回答：

```text
当前版本只准备发布包和复制内容，不触碰平台页面。可以先生成发布包，手动发布后再登记证据。
```

## 10. UI 展示要求

P3-A 不新增左侧 `Publish` 顶级导航，也不新建独立发布页面。发布准备先嵌入 Ops 第 5 步。

当前 P3-A 已有独立 `publishing.PublishService` 负责渲染只读 `PublishPackage`、copy blocks、asset handoff 和 checklist；真实证据仍通过 Ops service 写入 `publish_recorded`。完整 `publish_packages` 持久化表、独立 `/api/ops/publish/*` 列表接口和全局发布中心放到后续发布模块深化阶段。

推荐把 Ops 第 5 步从“发布并记录证据”调整为：

```text
发布准备与证据
```

原因是第 5 步同时覆盖发布前的准备包和发布后的证据登记，但闭环仍然属于同一个运营步骤。

发布步骤中展示：

1. 当前 `PublishPackage` 工作台。
2. 平台账号。
3. 内容类型。
4. 平台发布字段。
5. 标题、正文、标签和完整发布包的一键复制入口。
6. 资产预览、下载或打开路径入口。
7. 发布 checklist。
8. 手动发布证据登记入口。
9. mock 标记。
10. package hash 和 asset hash 摘要。

UI 不展示：

1. 完整 cookie。
2. secret。
3. 浏览器指纹。
4. 平台登录态。
5. 自动化内部脚本细节。
6. 平台自动化入口。
7. 独立 Publish 顶级导航。

UI 约束：

1. UI 可以嵌在 Ops 第 5 步，但不能自己拼 `PublishPackage`。
2. UI 只能消费 Publish Module 输出的 package、copy blocks、checklist 和 evidence 状态。
3. 复制动作不能生成 `PublishEvidence`。
4. 只有用户登记真实 URL、post id、平台返回结果或明确 mock 证据后，才进入证据记录。
5. 多平台发布包先在同一工作面内切换或列表展示，不在 P3-A 新建全局发布中心。

详细设计见 `docs/zh/product/pixelle-p3-publish-ui-design.md`。

## 11. 风控边界

P3 必须把风控作为产品规则，而不是实现细节。

硬规则：

1. 不绕过验证码。
2. 不绕过人机校验。
3. 不默认无头浏览器。
4. 不默认全自动点击最终发布。
5. 不多账号高频切换。
6. 不连续批量发布。
7. 不在账号不一致时继续。
8. 不在上传未完成时继续。
9. 不在 package hash 不一致时继续。
10. 不在内容被平台拦截时标记成功。
11. 不把“脚本执行完成”当作发布成功。
12. 不把 mock evidence 当作真实发布。
13. 不把“复制过发布包”当作发布成功。

## 12. 验收标准

### 12.1 P3-A 发布准备包

1. 当前 `record_publish` 状态可以创建 `PublishPackage`。
2. package 绑定 project/cycle/experiment/content item/channel account。
3. package 保存 asset hash 和 approved draft hash。
4. package 能按平台和内容类型渲染发布字段。
5. 标题、正文、标签、完整发布包都能一键复制。
6. 视频或图文资产可以预览、下载或打开路径。
7. checklist 能提醒用户核对账号、资产、封面、标题、正文和标签。
8. 创建 package 不产生 publish evidence。
9. 复制 package 不产生 publish evidence。
10. 手动登记 URL/post id 后，Ops 生成真实 publish evidence。
11. 缺证据时不能进入 metrics。
12. mock evidence 明确保留 mock 标记。

### 12.2 P3-B 证据校验和幂等

1. URL/post id 去重。
2. package hash 校验。
3. asset hash 校验。
4. 同一 package 已有真实证据时，不允许重复伪造证据。
5. mock evidence 不能升级成真实发布。

### 12.3 P3-C 多平台

1. 同一 content item 可以创建多个 package。
2. 每个平台账号独立 package 和 evidence。
3. 一个平台未发布不影响另一个平台证据。
4. 指标和复盘按 publish record 关联。

### 12.4 P3-D 辅助发布

后续如果启动 assisted：

1. Adapter 能把 attempt 推进到 `waiting_user_confirm_publish`。
2. 发布前截图保存。
3. 系统不会自动点击最终发布。
4. 用户确认后才能记录真实证据。
5. 登录态异常、验证码、账号不一致时进入 blocked/failed，不伪装成功。

## 13. 分阶段实施

### P3-A：发布准备包和一键复制

目标：让当前 `record_publish` 有稳定发布准备对象承接，不接触平台页面。

产出：

1. `PublishPackage`。
2. 平台字段 renderer。
3. 一键复制块。
4. 资产预览、下载或打开路径。
5. 发布 checklist。
6. 手动 `PublishEvidence`。
7. Codex 工具。
8. API 查询。
9. Ops 第 5 步内嵌发布包工作台。

不做：

1. 不新增左侧 `Publish` 顶级导航。
2. 不新增独立发布中心。
3. 不把复制动作当成发布证据。

### P3-B：证据校验和幂等

目标：避免重复发布和错误发布。

产出：

1. URL/post id 去重。
2. package hash 校验。
3. asset hash 校验。
4. mock 和真实证据隔离。

### P3-C：多平台发布包

目标：支持同一内容准备多个平台包。

产出：

1. 小红书视频包。
2. 小红书图文包。
3. YouTube 视频包。
4. 抖音视频包。
5. 平台字段映射。

### P3-D：小红书 assisted 发布

目标：在发布包模型跑顺后，再考虑降低人工复制成本，但不承担全自动风险。

产出：

1. 小红书 browser assisted adapter。
2. 发布前截图。
3. `waiting_user_confirm_publish` 状态。
4. 风控阻断。

### P3-E：官方 API adapter

目标：支持 YouTube、Buffer 或其他有稳定 API 的平台。

产出：

1. 官方 API adapter 规范。
2. API response evidence。
3. 幂等 key。

### P3-F：可选 automatic

目标：只在低风险、可验证平台开放。

默认不启用。

## 14. 开放问题

1. 后续做 assisted 时，小红书是否使用网页发布页作为目标？
2. 发布包里的标题/正文/标签是否完全由 Codex 生成，还是允许 UI 编辑后重新审核？
3. 一键复制是只复制单字段，还是同时提供完整平台包 markdown？
4. YouTube 是否优先于抖音作为第一个官方 API adapter？
5. 是否需要 `DistributionBatch` 来组织“一条内容发多个平台”的批量视图，还是先用多个 package 足够？

## 15. 完成定义

P3 发布模块完成，不等于全自动发布完成。

完成定义：

1. 发布模块有独立 package/evidence 模型。
2. Ops 通过模块接口创建发布准备包，不直接操作平台页面。
3. 当前待发布内容可以创建 package。
4. package 能按平台和内容类型输出可复制字段。
5. 用户能从 UI/Codex 复制标题、正文、标签和完整发布包。
6. 用户能打开或下载待发布资产。
7. 手动发布证据可以回写闭环。
8. 没有证据不能推进到 metrics/retro。
9. assisted、API、automatic 都明确后置。
10. 文档、测试、Codex 工具和 UI 展示一致。
