# 起草配置显式化与多项目就绪 · 设计文档

日期：2026-07-05
触发问题：工作台「选题→草稿」的 Prompt 与模型无处设置，实际生效的是隐式规则（Prompt 模板列表第一个 + 全局默认模型），导致 Bazi 命名的 Prompt 被默默用于宠物内容；且该规则在多项目下必然崩坏。

## 一、问题定性

这不是一个"加个下拉"的 UI 缺口，而是**配置模型不对称**：生产侧已有完整三层（设置管接入 / 模板管默认 / 表单管这一次），内容侧（选题→文案）只有表单层（审核页可逐项选），默认层完全缺失——于是被"列表第一个"这种实现细节顶班。产品级危害：

1. **不可预期**：往 `data/prompt_templates/script/` 放一个新文件就会改变全站默认起草行为（排序变了）。
2. **不可扩展**：多项目时不同项目需要不同的内容策略（Prompt/语言/模型），无处安放。
3. **不可审计**：draft set 虽记录了实际用的模板名，但用户从未做过这个选择。

## 二、设计：对称配置模型

引入**起草配方（DraftingProfile）**，与生产模板对称（见图）。统一原则推广为：**设置管接入，配方管默认，表单管这一次**——内容侧与生产侧同构。

### 起草配方数据结构

```
DraftingProfile {
  profile_id: str            # uuid hex
  name: str                  # "PetWoods 宠物口播"
  script_template_name: str  # 引用 prompt 模板（现有 load_prompt_templates 体系）
  split_template_name: str
  script_model: str | ""     # 空 = 用设置页 LLM 默认模型
  split_model: str | ""
  languages: [str]           # 默认语言组合
  language_script_models: {lang: model}   # 每语言模型映射（沿用现有能力）
  created_at / updated_at
}
```

存储 `data/drafting-profiles.json`（沿用 overrides/custom-templates 的 tmp+replace 模式）。**项目默认**：ops 项目设置增加 `default_drafting_profile_id`（与已有 `default_production_template_id` 并列）。

### 解析链（消灭隐式规则）

`createScriptReviewDraftSet` 的模板/模型解析改为：

```
请求显式传参 > 项目默认起草配方 > 安全内置默认
```

安全内置默认固定为 **"Short Oral Script" + "Copy-Safe Scene Split" + 设置页默认模型**——不再取"列表第一个"，自定义 Prompt 文件的存在与排序不再影响任何默认行为。

### UI 落点

| 位置 | 内容 |
| --- | --- |
| 设置 → 系统设置 →「起草配方」区（新增，与「项目默认模板」相邻） | 配方列表：新建/编辑/删除；每条配方编辑 Prompt 下拉（读现有模板 API）、脚本/分镜模型、默认语言 chips；标记项目默认 |
| 添加内容弹层（工作台入料口） | 「起草配方」下拉，默认选中项目默认；99% 情况不用动 |
| 条目抽屉「生成草稿」 | 使用项目默认配方（单卡场景不加下拉，保持轻） |
| 审核页第一步 | 保持现状（逐项覆盖 = 表单层），但初始值改为从项目默认配方带入 |

### 多项目路线（本设计的延长线，不在本期）

项目实体已在 ops 层存在，两侧默认（起草配方 + 生产模板）都挂项目之后，多项目只差最后一步：**导航栏项目切换器** + 看板/内容库按项目过滤（ContentItem 已有 project 字段）。届时"换一个项目"= 换一套内容策略 + 一套生产配方，零散配置无需迁移。

## 三、实施包

| 包 | 内容 | 层 |
| --- | --- | --- |
| D1 | DraftingProfile 存储 + CRUD API（`/drafting-profiles`）+ 项目默认字段；`createScriptReviewDraftSet` 接 `profile_id` 并实现解析链；安全内置默认替换"列表第一个"；pytest | 后端 |
| D2 | 设置页「起草配方」管理区 | 前端 |
| D3 | 添加内容弹层配方下拉 + 抽屉/看板起草走项目默认；`contentDrafting.ts` 传 profile_id | 前端 |
| D4 | 审核页第一步初始值从项目默认配方带入 | 前端 |

**验收口径**（与生产侧同构）：在设置里把项目默认起草配方的 Prompt 换掉 → 工作台多选起草、单卡起草、审核页（不做覆盖时）的下一次起草全部使用新 Prompt；`data/prompt_templates/` 目录里增删文件不改变任何默认行为。

## 四、立即处置项（不等实施包）

当前默认命中的 `bazi_storyboard_oral_script.md` 建议人工检查内容：若已是通用宠物口播 Prompt，改名为 `petwoods_oral_script.md`（名实一致）；若仍是八字内容，说明近期草稿质量是靠模型自行发挥兜底的，更应尽快落 D1。
