# Pixelle P1 UI 方案与信息架构

版本：v0.1  
日期：2026-06-22  
状态：方案设计草案  
关联 PRD：`docs/zh/product/pixelle-p1-ui-prd.md`  
关联计划：`docs/zh/product/pixelle-p1-ui-implementation-plan.md`

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

P1 最小导航：

```text
Ops
Projects
Assets
Settings
```

如果继续使用现有 Streamlit 多页结构，可映射为：

```text
Create      现有内容生成工作台，暂不改为运营入口
History     现有生成历史，保留
Ops         新增，运营状态总览
Projects    新增，项目和平台账号配置
Settings    现有设置页，增加 Integrations 区域或链接
Help        保留
```

## 4. 页面结构

### 4.1 Ops Overview

目的：回答“现在 Pixelle 运营到哪一步？”

首屏布局：

```text
顶部：项目选择 / 平台账号选择 / 刷新状态

左侧主区域：
  当前项目
  当前周期
  当前实验
  下一步动作

右侧辅助区域：
  生成资产预览
  发布证据状态
  指标状态

下方：
  操作时间线
```

核心模块：

1. Context Bar
2. Current Loop Card
3. Next Action Panel
4. Asset Preview
5. Evidence Summary
6. Event Timeline

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

P1 写入范围：

1. 新增平台账号。
2. 编辑平台账号。
3. 设置账号状态。
4. 保存 credential reference。
5. 保存 Buffer channel id。

P1 不做：

1. 删除项目。
2. 删除历史内容实验。
3. 直接创建内容实验。
4. 直接发布内容。

### 4.3 Experiment Detail

目的：查看一条内容实验完整证据链。

入口：

1. Ops Overview 当前实验点击进入。
2. Assets 列表点击进入。
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

### 4.4 Assets

目的：查看生成资产，而不是管理运营。

P1 可以先做轻量列表：

1. 内容标题。
2. 所属项目。
3. 所属实验。
4. 类型。
5. 状态。
6. 文件路径或 URL。
7. 文件大小。
8. 时长。
9. asset check 状态。

点击进入 Experiment Detail。

### 4.5 Settings / Integrations

目的：管理外部服务配置入口。

P1 最小内容：

1. Buffer 配置状态。
2. COS 配置状态。
3. 平台账号 credential reference 说明。
4. 不支持自动授权的平台提示。

如果现有 Settings 已经管理 Buffer/COS，P1 不重复造一套，只在 Projects 的平台账号里保存映射关系。

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
-> 复制 Codex 提示
-> 回 Codex 继续下一步
```

### 6.4 查看生成资产

```text
打开 Assets
-> 看到已生成视频
-> 点击进入实验详情
-> 播放或打开视频
-> 查看 asset check 和发布状态
```

## 7. 页面数据依赖

### Ops Overview

依赖：

```text
GET /api/ops/current
GET /api/ops/projects
```

### Projects

依赖：

```text
GET /api/ops/projects
GET /api/ops/projects/{project_id}
GET /api/ops/projects/{project_id}/channel-accounts
POST /api/ops/projects/{project_id}/channel-accounts
PATCH /api/ops/channel-accounts/{channel_account_id}
```

### Experiment Detail

依赖：

```text
GET /api/ops/experiments/{experiment_id}
```

### Assets

P1 可先复用项目/实验视图生成列表；如果需要再补：

```text
GET /api/ops/content-items
```

不作为 P1 第一批必需 API。

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

如果继续 Streamlit，这些可以先是 Python render 函数；如果后续迁移 React，再拆为前端组件。

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

进入视觉方案前，需要确认：

1. P1 先用 Streamlit 落地，还是先做 React 原型？
2. 是否沿用现有 Pixelle-Video 的视觉风格，还是做更偏运营工具的新视觉？
3. P1 第一版是否只做 `Ops` 和 `Projects` 两页？

建议默认：

```text
先用 Streamlit 做 Ops + Projects 两页，验证信息架构和真实数据流；视觉保持克制工具型。等信息结构跑顺，再决定是否 React 化。
```
