# PRD · 长文生产线（纯文字产物，交 Opus 实施）

> 执行对象：实施模型。方向已用户批准（2026-07-07）；遵循 DESIGN.md（§2.5 容器四禁令、弹层白名单不得新增）与既有守则（判空 `||` 禁 `??`、effect isLoading 依赖坑、面向用户文案无内部 key）。
> 直接参照上一条产线的实现模式：`prd-image-post-and-hyperframes.md` 与其落地代码（`pipelines/image_post.py`、`artifact_type` 分支、`ImageSetView`、图文线板块）——长文线是它的更薄版本。

## 1. 背景与定位

用户诉求："再加一个长文生产线，只产生文字内容。"即：同一份确认稿（或其分镜大纲），扩写成结构化长文（公众号/知乎/小红书长文皆可用的 markdown），产物纯文本。这是继视频、图集之后的第三种产物形态，管线为 LLM-only——无配图、无 TTS、无合成，是全系统最薄的管线。

**关键架构决策（已定，不重开）**：长文写作 Prompt 不进内容侧 Prompt 库（那是"起草怎么写"，归项目），而是作为**配方的多行文本参数** `long_form_prompt`——长文风格是这条配方的资产，克隆配方即复制风格，符合"配方=可固化资产"哲学。为此产线零件编辑器需支持多行文本参数（本 PRD 唯一的通用能力升级）。

## 2. 目标与非目标

**目标（验收口径）**

1. 看板确认稿选「长文」模板出片 → 每个已确认语言产出一篇结构化 markdown 长文；产物在内容详情页/作品库以文章形态展示，可复制全文、可下载 .md。
2. 长文 Prompt 与目标字数在配方详情页作为零件就地可编辑（Prompt 为多行编辑器）；克隆骨架即得自己的长文风格配方。
3. 与视频/图集共存：同一条内容三种产物形态并存于产物区，互不覆盖。
4. 前端三件套全绿 + 后端 py_compile/测试；`npm run build` 与真实生成一篇长文由用户本地验证。

**非目标**

- 平台自动发布（公众号/知乎 API）——产物复制/下载后手动发布。
- 富文本编辑器/markdown 预览渲染——本期正文以等宽纯文本展示 + 复制/下载即可（预览渲染列开放项）。
- 长文的独立起草流程——复用现有起草/确认，长文是确认稿的**下游扩写**。

## 3. WP-A · 后端

### 3.1 管线 `pixelle_video/pipelines/long_form.py`

LLM-only（参照 `image_post.py` 结构再做减法）：

1. 输入：`script`（确认稿，看板出片时为分镜行 join；也接受整段）、`title`、`language`（沿用现有 per-variant 提交，每语言一个任务）。
2. Prompt 组装：`long_form_prompt` 参数做占位替换——`{script}`（必需）、`{title}`、`{language}`、`{word_count}`；缺 `{script}` 在参数校验层拦截（见 3.3）。
3. LLM 调用：复用 `_call_llm_retrying_empty`（web/utils/script_review.py 的既有重试助手，空响应 3 次退避）；模型取参数 `llm_model`，为空回落系统默认（现有 LLM service 默认链）。
4. 产物：markdown 写入任务目录（`article.md`），`GenerationResult.artifact_type="text"`，全文同时存入 result 的文本承载字段（沿用 image_post 存 caption 的同一机制，执行者对齐）；`primary_video=None`。

manifest 注册（`defaults.py` 照抄 `_image_post_manifest` 模式，id=`long_form`）+ 可执行管线注册。

### 3.2 `artifact_type` 扩 `"text"`

`Literal["video","image_set","text"]`。消费端已按 artifact_type 分支（上一轮完成），本轮为 text 补分支：ops asset-ref（text：path/word_count/caption）、Streamlit 遗留读取器（不支持则安全跳过并注释）、前端展示（WP-B）。旧数据兼容规则不变（无字段=video）。

### 3.3 参数与骨架

- `OVERRIDABLE_PARAMS` 加：`long_form_prompt: str`（校验：非空时必须含 `{script}` 占位，否则 400「长文提示词缺少 {script} 占位符，确认稿将无法注入」）、`word_count: int`（校验 200–20000）、`llm_model: str`。
- 骨架 `pipeline_long_form_base_v1`「长文」：
  - description「确认稿 → 扩写成结构化长文（markdown），适合公众号 / 知乎 / 小红书长文」
  - pipeline_id=`long_form`, entry=`script`, product_entry=`generate`, required_capabilities=`["llm","persistence"]`
  - allowed_user_params=`["title","long_form_prompt","word_count","llm_model"]`
  - fixed_params：`mode: "fixed"`、`word_count: 1800`、`long_form_prompt` 内置一份中性默认（要求：markdown 结构化——开头钩子、小标题分节、结尾行动号召；忠于 `{script}` 的事实与观点，语言为 `{language}`，目标 `{word_count}` 字左右；**不带品牌词**）。

### 3.4 测试

`tests/long_form_test.py`：Prompt 占位替换/缺 {script} 校验/word_count 边界、LLM mock 生成与产物落盘、artifact_type=text 序列化兼容、模板与 manifest 注册断言；更新硬编码管线清单的既有测试（上轮 image_post 同款位置）。

## 4. WP-B · 前端

1. **零件编辑器多行文本升级**（通用能力）：`pipelineParts.ts` 加 `PART_LONG_TEXT_KEYS = new Set(["long_form_prompt", "prompt_prefix", "image_prompt_visual_context", "image_prompt_generation_rules"])`（顺手把生图三个长文本参数一并升级）；`RecipeDetailPage.renderEditor` 对这些 key 用 `Textarea`（`min-h-40 font-mono text-xs`），编辑行占满整行（图文线已有 col-span 先例）。`PART_KEY_LABELS` 加 `long_form_prompt: "长文提示词"`、`word_count: "目标字数"`、`llm_model: "写作模型"`；`PART_EDIT_HINTS` 加 long_form_prompt 占位符说明（{script}/{title}/{language}/{word_count}）。
2. **快速生产页**：`FAMILIES` 加「长文线」板块（tagline「确认稿 → 结构化长文（纯文字）」，newSources=长文骨架）；`PIPELINE_PARTS.long_form`：写稿（项目起草配置，跳项目）/ 长文改写（long_form_prompt，可换）/ 字数（word_count，可换）/ 写作模型（llm_model，可换）。
3. **文本产物视图**：新共享组件 `TextArticleView`（标题 + 等宽正文滚动区 `max-h-96 overflow-y-auto whitespace-pre-wrap` + 字数统计 + 「复制全文」（navigator.clipboard + toast）+「下载 .md」）。接入内容详情页产物区、作品库（列表用「长文」徽标 + 首行摘要，详情用 TextArticleView）、生成页结果区——全部按 `artifact_type==="text"` 分支，模式与 ImageSetView 接入完全一致。
4. **非视频模板判定推广**：审核页 `isImagePostTemplate` 重构为 `isNonVideoTemplate`（pipeline_id ∈ {image_post, long_form}）——音色区隐藏、canSubmit 音色豁免、提交按钮文案（图文帖/长文/视频）三处共用；发布衔接按钮对 text 产物文案「复制长文去发布」。
5. `generationApi.ts` 类型 + `generationApi.test.ts` 断言同步。

## 5. 文档同步

`architecture-map.md`：Pipeline 行 7→8 条（+long_form）；概念词典无新概念（长文 Prompt 是模板参数，不是新实体——勿在词典里新增行，只在生产模板行的例子里提及）。

## 6. 开放项（遇到再问，不要自行发挥）

- markdown 预览渲染（front-end 渲染库引入）——先纯文本，用户要求再加。
- 长文的多平台变体（同稿出公众号版+知乎版）——未来用多配方（不同 long_form_prompt）解决，不做产品功能。
- 公众号/知乎自动发布——发布集成统一处理。
- 起草配置是否需要"长文模式"（起草即长文、跳过分镜）——本期不做，长文是确认稿下游。

## 7. 验收清单

- [ ] 看板确认稿 → 选「长文」出片 → 产物区看到文章（每确认语言一篇），可复制/下载 .md
- [ ] 配方详情页：长文提示词多行编辑、字数/模型可换，缺 {script} 占位保存被拦且提示可执行
- [ ] 克隆长文骨架 → 改 Prompt → 两个配方产出风格不同（克隆即复制风格）
- [ ] 同一条内容视频/图集/长文三种产物并存；旧数据展示零回归
- [ ] 审核页选长文模板：音色区隐藏、可提交、按钮文案为"长文"
- [ ] 前端三件套 + 后端测试全绿；`npm run build` 与真实生成本地验证
