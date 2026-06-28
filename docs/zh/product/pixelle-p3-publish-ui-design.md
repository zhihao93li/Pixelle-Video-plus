# Pixelle P3 发布准备 UI 设计说明

版本：v0.1
日期：2026-06-28
状态：P3-A UI 设计基准稿
关联 PRD：`docs/zh/product/pixelle-p3-publish-module-prd.md`
关联技术方案：`docs/zh/product/pixelle-p3-publish-module-technical-architecture.md`
关联 P1 UI：`docs/zh/product/pixelle-p1-ui-information-architecture.md`
关联 demo：`docs/zh/product/pixelle-p3-publish-ui-demo.html`

## 1. 设计结论

P3-A 的 UI 结论是：

```text
底层 Publish Module 独立；
前端先嵌入 Ops 第 5 步；
不新增左侧 Publish 顶级导航。
```

原因：

1. P3-A 只做发布准备包、一键复制、资产交付和手动证据登记。
2. 当前用户心智仍然是 6 步运营闭环，到第 5 步才需要发布准备。
3. 独立 Publish 页面会过早增加导航、列表、空态和跨页面上下文成本。
4. 底层模块独立即可保证长期边界，UI 不必第一版独立。
5. 未来多平台、多内容类型、assisted/API 发布复杂后，再抽独立 Publish 页面。

## 2. 采用的设计方向

采用“方案 1：发布包工作台”为 P3-A 主框架。

吸收项：

1. 方案 1 的 Ops 第 5 步内嵌发布包工作台。
2. 方案 2 的多平台包扩展能力，先以轻量平台切换或 package 列表预留。
3. 方案 3 的状态文案原则：复制不等于发布，证据才推进闭环。

不采用：

1. 不采用方案 3 的独立左侧 `Publish` 导航。
2. 不采用方案 3 的独立发布流水线页面作为 P3-A 首屏。
3. 不把发布准备包做成新的全局 dashboard。

## 3. 信息架构

P3-A 顶层导航保持 P1-A 结构：

```text
Ops
Projects
Create
History
Settings
Help
```

不新增：

```text
Publish
Publishing
Assets
Distribution
```

P3-A 发布准备入口只出现在：

```text
Ops -> 当前轮次 -> 第 5 步：发布准备与证据
```

如果当前实验已经通过 asset check，且没有真实发布证据，第 5 步展示 Publish Module 面板。

## 4. Ops 第 5 步结构

P3-A 第 5 步命名建议从：

```text
发布并记录证据
```

调整为：

```text
发布准备与证据
```

该名称同时覆盖两件事：

1. 发布前准备包。
2. 手动发布后的证据登记。

### 4.1 左侧轮次地图

左侧仍然只做定位：

```text
5 发布准备与证据
```

状态示例：

| 状态 | 左侧文案 |
|---|---|
| asset check 未通过 | 阻塞 |
| 没有 package | 待准备 |
| package 已生成但无证据 | 待发布 |
| evidence 已登记但未 apply | 待确认 |
| publish record 已写入 | 完成 |
| mock evidence | Mock |

左侧不展示完整标题、正文、标签、文件路径或证据详情。

### 4.2 中间工作面

中间工作面展示 `PublishPackage`，不是 Ops 临时拼字段。

推荐结构：

```text
发布准备与证据

第 5 步动线
  1 复制发布包
  2 手动发布
  3 登记真实证据

当前发布包
  平台 / 平台账号 / 内容类型 / package 状态

资产交付
  视频预览
  文件名 / 时长 / asset hash 摘要
  [预览视频] [打开文件位置] [复制文件路径]

发布字段
  标题 [复制]
  正文 [复制]
  标签 [复制]
  完整发布包 [复制完整发布包]

发布 checklist
  账号已确认
  资产已检查
  标题已准备
  正文已准备
  标签已准备
  封面待确认

登记真实发布证据
  URL
  Post ID
  截图
  发布时间
```

登记真实发布证据是第 5 步的主路径动作，必须放在中间工作面，位置应紧跟发布字段和资产交付之后。右侧 Inspector 只能提示“缺真实证据会阻塞观测”，不能把登记表单藏在右侧底部。

中间工作面不展示：

1. 浏览器自动化按钮。
2. 上传到平台按钮。
3. 自动发布按钮。
4. 平台登录态。
5. cookie、secret、浏览器指纹。
6. 完整事件日志。

### 4.3 条件式 Inspector

Inspector 不重复发布字段，只展示判断辅助。

推荐内容：

```text
当前是否可以人工发布？
  可以 / 不可以

阻塞项
  asset check 未通过
  平台账号缺失
  package 未锁定
  copy block 缺必填字段

证据状态
  真实证据缺失
  mock 证据存在
  已登记真实 URL

下一步
  复制完整发布包
  手动去平台发布
  在中间工作面登记 URL 或 post id
```

Inspector 必须明确：

```text
复制发布包不等于已发布。
```

### 4.4 底部证据区

底部只做追溯：

1. PublishPackage payload/hash 摘要。
2. publish_recorded 事件。
3. evidence payload 摘要。
4. mock 标记。

P3-A 当前 package 由 Publish Module 只读渲染，不写 package_created/package_locked 事件。后续启用 `publish_packages` 持久化表后，底部证据区再追加 package_created、package_locked、publish_evidence_recorded 事件。

底部不承担复制和发布包主详情。

## 5. 多平台扩展

P3-A 默认先展示当前平台包。

如果同一 content item 存在多个 `PublishPackage`，中间工作面顶部增加轻量切换：

```text
小红书视频
小红书图文
YouTube Shorts
抖音视频
```

或在 package 多于 3 个时使用列表：

```text
平台账号 | 内容类型 | package 状态 | 证据状态 | 操作
```

选中某个 package 后，仍复用同一工作面展示复制块、资产交付、checklist 和证据登记。

P3-A 不需要独立多平台矩阵页。

## 6. 与底层模块的关系

UI 可以嵌在 Ops，但底层不能嵌进 Ops。

UI 数据来源：

```text
Ops 第 5 步
  -> PublishService 查询 package/evidence
  -> PlatformPayloadRenderer 提供 copy_blocks/checklist
  -> ManualEvidenceRecorder 校验证据
  -> OpsService apply evidence
```

禁止：

1. UI 自己拼完整发布包。
2. UI 直接写 SQLite。
3. UI 绕过 PublishService 登记证据。
4. UI 把复制动作写成发布事件。
5. UI 把 mock evidence 显示成真实发布。

## 7. 页面状态

### 7.1 无 package

展示：

```text
当前内容已通过资产检查，可以创建发布准备包。
[创建小红书视频发布包]
```

如果平台账号不明确，先提示选择平台账号。

### 7.2 Package ready

展示复制块、资产交付、checklist。

主操作：

```text
复制完整发布包
```

次操作：

```text
复制标题
复制正文
复制标签
打开文件位置
复制文件路径
```

### 7.3 Package ready but evidence missing

展示明确状态：

```text
发布包已准备，尚未登记真实发布证据。
```

不显示“已发布”。

### 7.4 Evidence recorded

展示：

```text
已登记发布证据，等待进入观测。
```

必须区分真实证据和 mock 证据。

### 7.5 Mock evidence

展示：

```text
Mock 证据只能证明流程跑通，不能当成真实发布。
```

Mock 状态在左侧、工作面、Inspector、底部证据区都必须一致。

## 8. 设计验收

P3-A UI 验收标准：

1. 左侧没有新增 `Publish` 顶级导航。
2. 第 5 步进入后能看到 `PublishPackage`。
3. 工作面按 `复制发布包 -> 手动发布 -> 登记真实证据` 展示连续动线。
4. 主操作是 `复制发布包` 和 `登记真实证据`，不是 `自动发布`。
5. 单字段复制、资产交付和真实证据登记都在中间工作面可见。
6. 右侧 Inspector 只展示阻塞判断，不承载登记表单。
7. 登记真实证据成功后，下一步进入观测数据与复盘。
8. 资产交付入口可见。
9. checklist 可见。
10. 证据登记入口可见，但低于复制和资产交付。
11. 页面明确说明“复制不等于发布”。
12. 没有任何自动上传、自动填表、自动发布入口。
13. 多平台 package 能在同一工作面切换，不需要新顶层页面。
14. UI 只消费 Publish Module 输出，不自己拼 package。

## 9. 未来抽独立 Publish 页的条件

满足以下任意两项，再考虑新增左侧 `Publish`：

1. 一个 content item 经常同时有 3 个以上平台 package。
2. 发布包需要批量管理或排队。
3. assisted/API 发布 attempt 成为常用能力。
4. 发布证据需要跨项目检索。
5. 用户需要从发布模块反查所有待发布内容。

在此之前，P3-A 保持嵌入 Ops 第 5 步。
