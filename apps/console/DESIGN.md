---
version: alpha
name: Pixelle Console
description: Pixelle 本地 AI 内容生产控制台的设计系统。面向需要持续发起、确认、监控和管理内容生产的创作者，强调清晰、可信、克制和高效率。
colors:
  primary: "oklch(0.48 0.11 180)"
  on-primary: "oklch(0.99 0.004 180)"
  background: "oklch(0.995 0.004 220)"
  foreground: "oklch(0.17 0.01 235)"
  surface: "oklch(1 0 0)"
  on-surface: "oklch(0.17 0.01 235)"
  surface-subtle: "oklch(0.965 0.006 225)"
  on-surface-subtle: "oklch(0.48 0.018 235)"
  accent: "oklch(0.95 0.018 180)"
  on-accent: "oklch(0.22 0.04 180)"
  border: "oklch(0.91 0.008 230)"
  focus: "oklch(0.58 0.09 180)"
  success: "oklch(0.44 0.12 155)"
  on-success: "oklch(0.99 0.004 155)"
  warning: "oklch(0.5 0.12 75)"
  on-warning: "oklch(0.99 0.004 75)"
  info: "oklch(0.5 0.13 235)"
  on-info: "oklch(0.99 0.004 235)"
  danger: "oklch(0.52 0.2 27)"
  on-danger: "oklch(0.99 0.004 27)"
  dark-primary: "oklch(0.72 0.12 180)"
  dark-on-primary: "oklch(0.17 0.035 180)"
  dark-background: "oklch(0.15 0.012 225)"
  dark-foreground: "oklch(0.95 0.006 220)"
  dark-surface: "oklch(0.19 0.012 225)"
  dark-surface-subtle: "oklch(0.225 0.01 225)"
  dark-on-surface-subtle: "oklch(0.7 0.018 220)"
  dark-border: "oklch(0.95 0.006 220 / 13%)"
  dark-focus: "oklch(0.72 0.1 180)"
  dark-success: "oklch(0.72 0.13 155)"
  dark-warning: "oklch(0.78 0.13 80)"
  dark-info: "oklch(0.72 0.12 235)"
  dark-danger: "oklch(0.7 0.19 27)"
typography:
  page-title:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: 18px
    fontWeight: 500
    lineHeight: 1.55
    letterSpacing: -0.01em
  section-title:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: -0.005em
  body:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
  body-strong:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
  control:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1
  body-small:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  caption-strong:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: 6px
  md: 8px
  lg: 10px
  xl: 14px
  2xl: 18px
  full: 9999px
spacing:
  hairline: 1px
  micro: 2px
  xxs: 4px
  xs: 6px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  2xl: 24px
  3xl: 32px
  4xl: 40px
  page-mobile: 16px
  page-desktop: 24px
components:
  app-canvas:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
  app-canvas-dark:
    backgroundColor: "{colors.dark-background}"
    textColor: "{colors.dark-foreground}"
    typography: "{typography.body}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  panel-dark:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-foreground}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.control}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: 10px
  button-primary-dark:
    backgroundColor: "{colors.dark-primary}"
    textColor: "{colors.dark-on-primary}"
    typography: "{typography.control}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: 10px
  button-secondary:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.control}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: 10px
  button-tertiary:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.control}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: 10px
  button-destructive:
    backgroundColor: "color-mix(in srgb, oklch(0.52 0.2 27) 10%, oklch(0.995 0.004 220))"
    textColor: "{colors.danger}"
    typography: "{typography.control}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: 10px
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: 10px
  input-focus:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
  input-dark:
    backgroundColor: "{colors.dark-surface-subtle}"
    textColor: "{colors.dark-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: 10px
  badge-neutral:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.on-surface-subtle}"
    typography: "{typography.caption-strong}"
    rounded: "{rounded.full}"
    height: 20px
    padding: 8px
  badge-success:
    backgroundColor: "color-mix(in srgb, oklch(0.44 0.12 155) 10%, oklch(1 0 0))"
    textColor: "{colors.success}"
    typography: "{typography.caption-strong}"
    rounded: "{rounded.full}"
    height: 20px
    padding: 8px
  badge-warning:
    backgroundColor: "color-mix(in srgb, oklch(0.5 0.12 75) 10%, oklch(1 0 0))"
    textColor: "{colors.warning}"
    typography: "{typography.caption-strong}"
    rounded: "{rounded.full}"
    height: 20px
    padding: 8px
  badge-info:
    backgroundColor: "color-mix(in srgb, oklch(0.5 0.13 235) 10%, oklch(1 0 0))"
    textColor: "{colors.info}"
    typography: "{typography.caption-strong}"
    rounded: "{rounded.full}"
    height: 20px
    padding: 8px
  badge-danger:
    backgroundColor: "color-mix(in srgb, oklch(0.52 0.2 27) 10%, oklch(1 0 0))"
    textColor: "{colors.danger}"
    typography: "{typography.caption-strong}"
    rounded: "{rounded.full}"
    height: 20px
    padding: 8px
  alert-success:
    backgroundColor: "color-mix(in srgb, oklch(0.44 0.12 155) 10%, oklch(1 0 0))"
    textColor: "{colors.success}"
    typography: "{typography.body-small}"
    rounded: "{rounded.lg}"
    padding: 10px
  alert-warning:
    backgroundColor: "color-mix(in srgb, oklch(0.5 0.12 75) 10%, oklch(1 0 0))"
    textColor: "{colors.warning}"
    typography: "{typography.body-small}"
    rounded: "{rounded.lg}"
    padding: 10px
  alert-info:
    backgroundColor: "color-mix(in srgb, oklch(0.5 0.13 235) 10%, oklch(1 0 0))"
    textColor: "{colors.info}"
    typography: "{typography.body-small}"
    rounded: "{rounded.lg}"
    padding: 10px
  alert-danger:
    backgroundColor: "color-mix(in srgb, oklch(0.52 0.2 27) 10%, oklch(1 0 0))"
    textColor: "{colors.danger}"
    typography: "{typography.body-small}"
    rounded: "{rounded.lg}"
    padding: 10px
  menu:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "{spacing.sm}"
  menu-item-focus:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
  navigation-item:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    height: 36px
    padding: "{spacing.md}"
  navigation-item-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    height: 36px
    padding: "{spacing.md}"
  title:
    textColor: "{colors.foreground}"
    typography: "{typography.page-title}"
  section-heading:
    textColor: "{colors.foreground}"
    typography: "{typography.section-title}"
  field-label:
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
  field-description:
    textColor: "{colors.on-surface-subtle}"
    typography: "{typography.body-small}"
  metadata:
    textColor: "{colors.on-surface-subtle}"
    typography: "{typography.caption}"
  compact-control:
    rounded: "{rounded.md}"
    height: 28px
    padding: "{spacing.sm}"
  micro-control:
    rounded: "{rounded.sm}"
    height: 24px
    padding: "{spacing.xs}"
  floating-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.xl}"
    padding: "{spacing.xl}"
  modal:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.2xl}"
    padding: "{spacing.2xl}"
  semantic-dark:
    backgroundColor: "{colors.dark-surface-subtle}"
    textColor: "{colors.dark-on-surface-subtle}"
    rounded: "{rounded.lg}"
  semantic-dark-success:
    textColor: "{colors.dark-success}"
  semantic-dark-warning:
    textColor: "{colors.dark-warning}"
  semantic-dark-info:
    textColor: "{colors.dark-info}"
  semantic-dark-danger:
    textColor: "{colors.dark-danger}"
  focus-dark:
    textColor: "{colors.dark-focus}"
  focus-light:
    textColor: "{colors.focus}"
  border-light:
    textColor: "{colors.border}"
  border-dark:
    textColor: "{colors.dark-border}"
  inverse-success:
    backgroundColor: "{colors.success}"
    textColor: "{colors.on-success}"
  inverse-warning:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.on-warning}"
  inverse-info:
    backgroundColor: "{colors.info}"
    textColor: "{colors.on-info}"
  inverse-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-danger}"
---

# Pixelle Console Design System

## Overview

Pixelle 是本机运行的 AI 内容生产工具。控制台服务于需要频繁发起生产、检查中间结果、处理异常并管理成品的创作者。界面应该像一张安静、可靠的工作桌：用户一眼知道现在在哪里、系统正在做什么、下一步由谁处理，而不是被装饰、术语或层层设置打断。

设计目标按优先级排列：

1. **清晰。** 可操作内容、只读信息、状态标签和说明文字必须一眼可区分。
2. **可信。** 页面只展示真实能力、真实状态和真实数据来源。没有接入的 Provider、不可用的动作和未知状态不得包装成已支持。
3. **高效。** 常用路径短，主要动作稳定，复杂配置按任务需要逐步展开。
4. **克制。** 通过字阶、留白、对齐和细边框建立层级，避免彩色大块、重阴影和多层卡片。
5. **可恢复。** 加载、空、失败、过期、进行中和完成是不同状态；失败附近必须提供可执行的恢复动作。

### Product personality

- **专业，但不是企业后台腔。** 文案直接、具体，不使用“赋能”“智能化”等空泛表述。
- **紧凑，但不拥挤。** 桌面端适合连续工作；移动端保留 44px 触控目标和安全区。
- **平静，但不含糊。** 中性色构成主体，绿色品牌色只强化主要动作和当前选择；状态色只表达状态。
- **面向创作者，而不是面向实现者。** 默认说“图片生成服务”“声音”“画面模板”，Provider、workflow、runtime、内部路径只在确有必要的专家区域出现。

### Sources of truth

- 本文件是视觉语言、组件语义、布局和交互表现的规范。
- `src/index.css` 是运行时颜色、圆角、动效和页面宽度 token 的代码事实源；YAML token 必须与之同步。
- `src/components/ui` 与 `src/components/shared` 是组件事实源；业务页面不得私建同义组件。
- `src/lib/router.ts` 是路由布局和项目作用域的事实源。
- API、Pipeline、Provider、模型、权限和状态能力不由本文件发明，必须来自各自的运行时事实源。

规范描述的是应保持的产品体验。若当前实现与本文件不一致，应把差异当作待修复问题，不得用文档把现状合理化。

## Colors

Pixelle 使用接近白色的冷中性画布、纯白内容表面、深墨色文字和低饱和青绿色品牌色。浅色与深色模式保留相同语义，不通过换品牌色制造两套产品。

### Palette roles

| 角色 | 浅色 token | 用途 |
| --- | --- | --- |
| 画布 | `background` | AppShell、页面底色、连续工作区 |
| 主要文字 | `foreground` | 标题、正文、字段值、重要图标 |
| 内容表面 | `surface` | 卡片、弹层、浮动菜单、Sheet |
| 次级表面 | `surface-subtle` | 选中前悬停、弱分组、占位区域 |
| 次级文字 | `on-surface-subtle` | 说明、元数据、占位文字 |
| 品牌与主动作 | `primary` | 每个动作区域的主要按钮、当前导航、关键链接 |
| 轻强调 | `accent` | 菜单焦点、轻量选中、局部强调背景 |
| 分隔 | `border` | 卡片、输入框、区域分隔线 |
| 键盘焦点 | `focus` | focus ring 和焦点边框 |

### Semantic colors

- `success`：动作已完成、产物可用、发布成功。
- `warning`：正在处理、等待条件、需要注意但尚未失败。
- `info`：已排期、同步信息、不会阻断流程的说明。
- `danger`：失败、无效输入、破坏性动作和不可逆风险。
- 中性灰：未开始、排队、取消、未知或不带价值判断的状态。

状态色必须同时配合文字、图标或明确位置，不能只用颜色传达含义。状态颜色不得被拿来装饰普通卡片，也不得把品牌绿当作“成功”的替代色。

### Dark mode

深色模式使用深蓝灰画布和略亮的内容表面，而不是纯黑。品牌色和状态色提高亮度以维持可读性。组件结构、间距、层级和语义必须与浅色模式一致。

### Contrast and use limits

- 普通文字与背景至少满足 WCAG AA 的 4.5:1；大字和非文本控件至少 3:1。
- `on-primary` 只用于 `primary` 背景；不要在浅色画布直接使用。
- 次级文字只用于辅助信息，不能承载错误原因、关键数值或主要操作名称。
- 一个视觉区域通常只出现一个实心品牌色按钮。并列动作使用 outline、ghost 或 link 层级。
- 禁止页面私有色值、按页面另造“差不多的绿色”，以及用透明度把不可读文字伪装成次级信息。

## Typography

全站使用 **Geist Variable**。它提供紧凑、清晰、偏工具型的气质，并能在中英文、数字、路径和模型名称混排时保持稳定。没有品牌展示需求时，不引入第二字体。

### Hierarchy

| 层级 | Token | 典型用途 |
| --- | --- | --- |
| 页面标题 | `page-title` | AppShell 页名、工作区标题 |
| 区块标题 | `section-title` | 面板标题、设置分组、卡片主标题 |
| 正文 | `body` | 普通说明、表单值、列表正文 |
| 强调正文 | `body-strong` | 列表主项、重要数值、导航标签 |
| 字段标签 | `label` | 输入项名称、必须阅读的短标签 |
| 控件文字 | `control` | 按钮、切换、菜单动作 |
| 小正文 | `body-small` | 辅助说明、紧凑列表、错误详情 |
| 元数据 | `caption` | 时间、来源、数量、次级状态 |
| 强调元数据 | `caption-strong` | Badge、状态标签、紧凑分类 |

### Writing and hierarchy rules

- 页面只保留一个可访问的一级标题。工作区内部从二级标题开始。
- 标题使用中等字重和略紧字距，不使用全粗体制造层级。
- 正文、说明、标签依靠字号、颜色和间距区分，不依靠全大写、斜体或随机颜色。
- 数值统计使用等宽数字特性；技术路径、ID 和日志仅在专家详情中使用等宽字体。
- 按钮使用动宾短语，如“开始制作”“保存模板”“重新读取”；避免“确定”“提交”等脱离上下文的词。
- 标签是名词，说明文字回答“这是什么或会影响什么”，按钮回答“我可以做什么”。三者不得使用相同外观。
- 中文段落行宽以 40–60 个汉字为宜；说明文字一般不超过 3 行，长解释转入帮助页或详情区。

## Layout

Pixelle 以 4px 为基础节奏，允许 2px 微调和 6px 的紧凑字段间距。页面结构先通过对齐和空间分组，再通过边框或背景分组。

### Spacing rhythm

- 图标与短标签：4–6px。
- 同一字段内部：6–8px。
- 同一小组中的控件：8–12px。
- 表单字段之间：16px。
- 页面区块之间：20px。
- 页面水平边距：移动端 16px，桌面端 24px。
- 24px 以上间距只用于明显的新章节，不用于补救不清楚的层级。

禁止在同一页面随意混用 10px、14px、18px 等近似间距。需要新的间距 token 时，先证明现有比例无法表达该关系。

### App shell

- 桌面端 `lg` 及以上使用 224px 左侧栏，顶部品牌区高 68px。
- 桌面主导航为垂直列表；当前项使用品牌底色，普通项使用文字与 hover 表面。
- 窄屏使用顶部项目栏和底部主导航，必须计入系统 safe area。
- 路由切换后焦点回到主要内容，保留“跳到主要内容”链接。
- 主导航数量必须来自真实路由清单，布局不得写死一个与实际数量不符的列数。

### Page widths

| 布局 | 最大宽度 | 用途 |
| --- | ---: | --- |
| `narrow` | 65rem / 1040px | 长阅读、线性确认 |
| `standard` | 90rem / 1440px | 设置、对象详情 |
| `wide` | 120rem / 1920px | 看板、选择库、主从列表 |
| `workspace` | 不限宽 | 生成编辑器和连续画布 |

有限宽页面必须居中。页头与主体共享同一水平基线。宽屏不能只把内容贴在左侧，移动端不能通过横向滚动隐藏主要动作。

### Page composition

页面通常由以下层级组成：

1. AppShell 页面标题。
2. `WorkspaceHeader`：当前任务标题、简短说明和最多一组页面级动作。
3. 主内容：一个连续工作区，或少量同级 `WorkspacePanel` / `Card`。
4. 就近反馈：字段错误、区域失败、空状态、运行进度。
5. 移动端必要时使用底部粘性主要动作，但不能遮挡内容。

不要把每个文字段落、每组字段和每个统计数字都装进独立卡片。没有独立边界、独立操作或独立生命周期的内容不需要卡片。

### Production workspaces

- 桌面生成页采用 split-canvas：左侧输入和设置，右侧原位显示预估、任务或结果。
- 右侧轨保持足以预览竖屏内容的宽度，左侧吸收剩余空间；窄屏改为单列。
- 本次设置按生产阶段完整分组。同一阶段的字段不能一部分常驻、一部分散落在“展开全部”中。
- “快速设置”是完整设置的精简视图，不是另一套表单。展开后仍使用相同字段、相同顺序、相同来源标记和相同保存语义。
- 模板页用于长期默认，生成页用于单次覆盖；可以共享组件，但必须通过标题、来源说明和动作文案明确作用范围。

### Responsive behavior

- `sm` 前优先单列，表格转换为卡片或可读列表，不缩成不可点的小格。
- `lg` 前隐藏桌面侧栏，启用移动顶部栏和底部导航。
- 主从视图在窄屏变为先列表后详情，详情提供明确返回路径。
- Sheet 在小屏占满可用视口；主要按钮靠近拇指区并计入底部 safe area。
- 触控目标至少 44×44px。桌面紧凑控件可为 24–36px，但在移动布局必须提升命中区域。
- 200% 缩放下内容、项目切换、错误恢复和主要动作仍可访问。

## Elevation & Depth

Pixelle 是低海拔界面。主要层级来自表面色差、1px 边框、粘性位置和留白，不用层层阴影模拟“高级感”。

### Elevation levels

| 层级 | 表现 | 用途 |
| --- | --- | --- |
| 0 画布 | `background`，无阴影 | 页面基础、连续工作区 |
| 1 表面 | `surface` + 1px `border` | Card、WorkspacePanel、输入区域 |
| 2 浮层 | `surface` + 细 ring + `shadow-md` | Select、Popover、搜索下拉 |
| 3 模态 | 遮罩 + `surface` + `shadow-lg` | Dialog、Sheet、破坏性确认 |
| 粘性动作 | 半透明表面 + blur + 细边框 | 移动底部动作、保存条 |

### Rules

- 静态卡片默认没有阴影。hover 可以轻微改变边框或使用 `shadow-sm`，但不能漂浮超过 2px。
- 菜单、Popover 和 Dialog 必须明显位于内容之上；它们可以使用阴影，因为遮挡关系真实存在。
- 不用渐变、发光、玻璃高光或大面积模糊装饰普通业务界面。
- 粘性区域必须有边界或背景，不得让文字直接压在滚动内容上。
- 嵌套表面优先使用分隔线或弱背景；避免“白卡片里再套三层白卡片”。

## Shapes

形状语言是克制的圆角矩形。默认圆角 10px 足够友好，又不会让生产工具显得像消费娱乐应用。

### Radius scale

| Token | 尺寸 | 用途 |
| --- | ---: | --- |
| `sm` | 6px | 极小控件、菜单项 |
| `md` | 8px | 紧凑按钮、内部选项 |
| `lg` | 10px | 默认按钮、输入、卡片、Alert |
| `xl` | 14px | 浮动动作区、强调容器 |
| `2xl` | 18px | 大型模态或展示容器，谨慎使用 |
| `full` | 9999px | Badge、状态胶囊、圆形图标按钮 |

### Borders and dividers

- 卡片、输入和静态区域使用 1px 语义边框。
- 分隔线用于同一表面内的章节，不额外增加背景。
- 虚线只表达“可放入、可上传、尚未创建”的区域，不用于普通卡片装饰。
- 焦点边框和 3px 半透明 focus ring 同时出现，确保深浅背景可见。
- 禁止以粗描边标识普通选中态；使用品牌色、轻背景和图标组合。

### Icons and media

- 全站使用 Lucide，默认 16px；导航主图标 20px，小型元数据图标 12–14px。
- 图标只辅助文字，不替代陌生动作的名称。只有通用且上下文明确的图标动作可省略文字，并必须有 `aria-label` 和 Tooltip。
- 图片和视频预览遵循产物真实宽高比。缩略图使用同一圆角并裁切，正文预览不得为了整齐强制裁掉内容。
- 不手绘新 SVG 模仿 Lucide，不混用多套线宽和填充风格。

## Components

组件遵循 shadcn/Radix 的可访问交互语义，并由 `src/components/ui` 和 `src/components/shared` 统一提供。业务页面组合组件，不重新实现焦点、键盘、弹层定位或状态颜色。

### Interaction taxonomy

视觉首先区分四类对象：

| 类型 | 外观 | 行为 |
| --- | --- | --- |
| 主要动作 | 实心品牌色按钮 | 推进当前任务的最重要动作 |
| 次要动作 | 有边框按钮 | 与主要动作并列但优先级较低 |
| 轻量动作 | Ghost 或文本链接，必须有 hover/focus | 局部编辑、查看、恢复默认 |
| 信息 | 普通文字、说明、Badge，无 hover 指针 | 不可点击，只解释或标记状态 |

任何可点击元素必须在静止、hover、focus 和 disabled 中至少有清楚的交互线索。任何不可点击元素不得使用按钮轮廓、下拉箭头、手型光标或 hover 底色。

### Buttons

- `default`：当前区域唯一主要动作，如“开始制作”“保存模板”。
- `outline`：取消、预览、重试、打开设置等并列动作。
- `secondary`：需要比 outline 更强、但不应与主要动作竞争的选择。
- `ghost`：图标工具、折叠开关和低风险局部操作；不得承载页面唯一推进动作。
- `link`：导航到另一个页面或帮助内容；看起来必须像链接。
- `destructive`：删除、放弃和不可逆动作；使用浅危险背景而不是大面积实心红。

默认桌面高度 32px，小号 24/28px，大号 36px。移动端业务页面把关键按钮提升到至少 44px 命中高度。按钮必须有明确文本；加载时保留宽度、显示进度并阻止重复提交。禁用时在附近说明原因，不能只降低透明度让用户猜。

### Links

- 导航使用真实链接，保留打开新窗口、复制地址和浏览器前进后退语义。
- “查看详情”“管理长期模板”“帮助”使用链接，不伪装成提交按钮。
- 纯动作不得使用无 `href` 的链接样式。
- 正文链接使用下划线或稳定的品牌色，并有明显 hover/focus。

### Badges and status

- Badge 是只读标签，默认高度 20px，使用 12px 中等字重和胶囊形状。
- Badge 不加下拉箭头、不使用手型光标、不承载点击。需要筛选或切换时使用 Button、Toggle 或 Tabs。
- 状态映射由共享 `StatusBadge` 提供。未知状态统一显示“状态待同步”，不能回显原始内部字符串，也不能猜成“进行中”。
- 状态必须用中文标签并保留语义色：绿为已完成，黄为进行或等待，红为失败，蓝为信息，灰为中性。
- “模板默认”“已自定义”“专家设置”等来源标记使用中性或信息色，不与成功状态混淆。

### Form fields

每个字段按固定顺序组成：

1. `FieldLabel`：用户能理解的名称，必要时包含必填标记。
2. 控件：Input、Textarea、Select、Slider、Switch、文件选择等。
3. `FieldDescription`：说明影响范围、格式或继承来源。
4. 校验错误：紧邻控件，描述问题和修复办法。

标签不得使用后端 key，placeholder 不得替代标签。说明文字不能藏着必读限制。输入框默认高 32px，Textarea 根据内容需求提供合理初始高度，不用巨大空白假装“专业”。只读值使用文本或定义列表，不用 disabled Input 冒充展示组件。

### Selects, comboboxes and menus

- 选项少且无需搜索时使用 Radix Select。
- 模型、模板等长列表使用共享 SearchableSelect / Combobox；搜索框固定在浮层顶部，结果区独立滚动。
- 弹层通过 Portal 渲染，宽度至少匹配触发器并受视口限制，不能被父卡片 `overflow` 裁切。
- Provider 和模型是两级真实关系：第一级来自已配置且可用的 Provider，第二级来自该 Provider 的真实模型能力。禁止按模型名称猜品牌、静态写候选或展示不存在的 Provider。
- 选项包含次级说明时必须保证主名称不被挤掉；无结果、加载失败和未配置是三种不同状态。

### Cards and panels

- `Card` 用于有独立含义、边界或操作的对象；默认 16px 内边距，小卡 12px。
- `WorkspacePanel` 用于一个主要工作区章节，标题、说明和操作位保持一致。
- 同级卡片保持同一圆角、边框和标题结构。选中卡通过边框、轻背景和标记表达，不改变尺寸造成跳动。
- 统计数字、说明段落、单个字段不自动成为卡片。
- 卡片整体可点击时内部不要再嵌套多个竞争链接；确需多动作时，卡片本身不作为链接。

### Navigation and tabs

- App 主导航回答“去哪里”，Tabs 回答“当前对象看哪一部分”，Toggle 回答“选择哪一种”。三者不能互换外观。
- 当前导航使用 `aria-current="page"`；当前 Tab 使用 Radix 状态和清晰的选中背景/下划线。
- 桌面和移动使用同一份导航数据。不得为了占满栅格加入空项或幽灵入口。
- 设置二级导航在窄屏可横向滚动或折叠，但当前分区始终可见。

### Feedback states

- **Loading**：保留布局骨架，说明正在读取什么；超过短暂等待再显示文字。
- **Empty**：解释为什么为空，并提供一个真实可用的下一步。没有动作时不放假按钮。
- **Error**：靠近失败区域，写清失败对象、用户可做的恢复动作；不能用空状态掩盖错误。
- **Stale**：保留已读内容，标出可能过期并允许重读。
- **Success**：后台完成和短暂确认使用 Toast；需要持续阅读的结果留在页面。
- **Progress**：显示真实阶段或真实进度。没有可靠百分比时使用不确定进度，不伪造 75%。

表单校验和局部失败使用 InlineError 或字段错误；跨页面完成使用 Toast；破坏性确认使用 AlertDialog。禁止 `window.alert`、`window.confirm` 和吞掉错误后显示成功。

### Dialogs, sheets and popovers

- Popover 只承载短时选择、搜索或上下文工具。
- Dialog 只承载单一决策或短表单；超过两个章节、需要长文本编辑或持续回访的任务使用页面。
- Sheet 用于低频本次设置、预览详情或移动端辅助面板；小屏全屏，桌面宽度适中。
- 禁止弹层套弹层，破坏性 AlertDialog 除外。
- 所有弹层有可访问标题，打开后焦点进入，关闭后焦点返回触发器。

### Production settings

AI 步骤统一显示两类设置：真实的 LLM 服务与模型，以及可选择、可直接编辑的提示词。已保存提示词进入提示词库；模板存在正文覆盖时必须显示“自定义正文 · 不跟随模板”，并提供“恢复跟随模板”。

长期模板与本次设置共享 `ProductionSettingsEditor`，但信息密度不同：

- **模板页**：面向建立长期默认，按生产阶段完整展示，包含来源、预览、恢复出厂值和保存动作。
- **生成页**：面向一次任务，先显示常用设置摘要，展开后按相同阶段完整展示所有允许覆盖的字段；修改只影响本次任务。
- 同一字段在两处必须使用同一控件、名称、说明和候选来源。差异只来自权限与作用范围，不来自两套页面各自发挥。
- 本次设置不得把同一阶段拆成内外两块。例如音色和语速都属于配音，就应在同一“配音”分组中出现。
- 分镜数量若由分镜模型根据内容决定，界面不得要求用户手填一个伪必需值；只有 Pipeline 明确允许且产品确实需要时才提供数量约束。

### Motion

- 快速反馈 120ms，普通过渡 160ms，Sheet/Dialog 180ms。
- 标准 easing 为 `cubic-bezier(0.2, 0, 0, 1)`。
- 只动画颜色、透明度、阴影和小幅 transform；不使用 `transition-all`。
- hover 位移不超过 2px，不让表格和表单元素漂浮。
- 系统请求 reduced motion 时，动画和滚动过渡降到近乎即时。

### Accessibility

- 所有功能都可用键盘完成，焦点顺序与视觉顺序一致。
- 图标按钮有 `aria-label`；Tooltip 只补充名称，不承载必须阅读的限制。
- 状态、校验和图表不能只靠颜色。
- Dialog、Sheet、Select、Tabs 等复杂交互优先使用 Radix 语义和焦点管理。
- 动态错误使用合适的 live region；不要让每次输入都高优先级朗读。
- 自动化 Axe 检查不得出现 serious 或 critical 问题，但自动化通过不等于人工键盘和缩放检查完成。

## Do's and Don'ts

### Do

- 使用语义 token 和共享组件，让浅色、深色、状态与焦点行为一致。
- 先用对齐、留白和标题组织信息，确有独立边界时再使用卡片。
- 让主要动作像按钮、导航像链接、标签像标签、说明像说明。
- 在控件附近说明影响范围、继承来源和失败后的恢复办法。
- 从真实 API、Provider 配置、Pipeline manifest 和权限合同生成候选与状态。
- 保持“模板默认 → 本次覆盖”的来源可见，并允许明确恢复默认。
- 用同一字段注册和同一编辑器服务长期模板与本次微调。
- 在移动端检查 44px 触控、安全区、键盘遮挡和 200% 缩放。
- 为 loading、empty、error、stale、ready 分别设计和测试。
- 新页面先选择 `narrow`、`standard`、`wide` 或 `workspace`，再组合正式页面壳层。

### Don't

- 不要用静态模型品牌表、名称猜测或占位候选冒充 Provider 能力发现。
- 不要用 Badge 充当按钮，也不要让 Ghost Button 看起来像普通注释。
- 不要把标签、辅助说明和可点击文本做成同一颜色、字重和轮廓。
- 不要在“展开全部”后把同一生产阶段拆成两个相隔的设置区。
- 不要为相同参数在不同页面实现两套控件、两套命名或两套默认值。
- 不要用 disabled Input 展示只读信息，也不要只置灰而不解释不可用原因。
- 不要把 API 错误显示为空列表、把未知状态猜成运行中、把未实现动作显示为成功。
- 不要嵌套多层卡片、堆叠重阴影、滥用渐变或给每个区块随机圆角。
- 不要使用原生 `select`、`window.confirm`、页面私有状态色或 `transition-all`。
- 不要在普通用户界面暴露 task id、文件路径、stage key、runtime 和原始堆栈。

### Implementation guidance for agents

修改 Pixelle Console 时按以下顺序执行：

1. 确认用户任务和真实能力边界；不要先画一个底层不存在的交互。
2. 从 `src/lib/router.ts` 选择布局，从共享组件库选择交互原语。
3. 使用本文件 YAML token 对应的 `index.css` 语义变量，不复制色值到业务组件。
4. 检查静止、hover、focus、active、disabled、loading、error 和 dark mode。
5. 检查移动端触控、safe area、弹层裁切、键盘导航和 200% 缩放。
6. 补充或更新单元测试、交互测试、视觉基线和 Axe 检查。
7. 若设计需要新增 token 或组件语义，先更新本文件与代码事实源，再在业务页面使用。

### Conformance checklist

- [ ] 页面使用正式 AppShell、PageFrame、WorkspaceHeader 和 WorkspacePanel/Card。
- [ ] 可操作项、标签、状态和说明的静态外观可以区分。
- [ ] 页面只有一个明确的主要动作；破坏性动作没有抢占主层级。
- [ ] 所有字段有标签，关键限制不依赖 placeholder 或 Tooltip。
- [ ] 选项来自真实能力源，加载失败没有降级成静态候选。
- [ ] 弹层通过 Portal 渲染且不被容器裁切。
- [ ] 状态有文字，未知状态没有被推断。
- [ ] 模板与本次设置共享字段合同，来源和覆盖关系可见。
- [ ] 桌面、移动、浅色、深色和 reduced motion 均可用。
- [ ] 键盘焦点可见，Axe 无 serious / critical 问题。
- [ ] `npm run typecheck`、`npm run lint`、`npm run test:p1`、`npm run build` 和相关 E2E 通过。

### Known gaps and iteration rules

本文件建立目标规范，不声称现有界面已经全部符合。当前优先修复的已知体验差异包括：

- 部分 Ghost/Text 动作、Badge 和辅助说明的视觉区分仍不够强。
- 快速生产中的精简设置与完整本次设置仍需按生产阶段重新收口，避免同一阶段分散。
- 个别页面存在私有布局或旧交互，需要在触达时迁入共享组件，而不是继续复制。
- 移动底部导航的列数必须继续与真实导航项同步，不能保留历史固定值。

迭代时优先修共享 token、共享组件或字段合同中的根因。只有某一业务确实具有独特语义时才新增专用组件；不得以“这个页面特殊”为理由长期保留视觉分叉。
