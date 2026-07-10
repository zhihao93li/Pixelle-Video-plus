# PRD · 小红书图文帖管线 + HyperFrame 动效合成解锁（交 Opus 实施）

> 执行对象：实施模型。方向已用户批准（2026-07-07）；实现遵循本文与 `apps/production-template-demo/DESIGN.md`（§2.5 容器四禁令、弹层白名单不得新增）。
> 全局守则同 `prd-content-workbench.md` 第 10 节；历史教训（判空用 `||` 禁 `??`、effect 的 isLoading 依赖坑）继续有效。

## 1. 背景

两个诉求：① 第一条非视频产线——小红书图文帖（图文流量成本低于视频，同一份确认稿可出视频也可出图集）；② 用户想要"合成方式为 HyperFrame 的标准线"——核实后发现 hyperframes 引擎已实现（`pixelle_video/generation/compose_runtime.py`），只是 `compose_runtime` 被刻意排除在覆盖白名单外（`template_overrides.py` 顶部注释 "compose_runtime is never overridable from the API"），导致用户无法零代码自建动效配方。

**已核实的复用基础**：`frame_processor.py` 的 `_compose_frame_html`（~364 行）已具备"每镜内容 + frame_template → HTML 渲染"能力；`GenerationResult`（`generation/schemas.py:124`）已有 `artifacts: list[GenerationArtifact]`；确认稿出片时 script 即分镜行拼接（split_mode=line），行=页的映射天然成立。

## 2. 目标与非目标

**目标（验收口径）**

1. 看板上一条已确认内容，选「小红书图文帖」模板出片 → 产出 封面 + 每分镜行一页 的图集（PNG）+ 发布文案，产物在内容详情页/作品库以图集形态展示并可打包下载。
2. 同一确认稿既可出视频也可出图文（选模板即选产物形态），状态机/溯源/任务中心行为与视频完全一致。
3. `compose_runtime` 解锁后：用户在快速生产页克隆标准骨架 → 产线里把「合成」换成动效合成 → 即得 HyperFrame 配方，全程零代码。
4. 验证：后端 `uv run pytest tests/ -q`（沙箱不可用则 py_compile + 用户本地跑）；前端三件套全绿 + `npm run build` 本地。

**非目标**

- 小红书 API 自动发布图文（本期产物下载 → 手动发布；发布集成列开放项）。
- 图文排版模板的精致化迭代（本期一套简洁默认版式，后续用户可通过 frame_template 换）。
- 图文帖的独立起草流程——复用现有起草/确认，不新增内容侧概念。

## 3. WP-A · 后端：`image_post` 管线与产物模型

### 3.1 新管线 `pixelle_video/pipelines/image_post.py`

标准线的减法（参照 `standard.py` 结构，无 TTS、无视频合成）：

1. **分页**：复用现有 split 逻辑；`split_mode=line` 时每行一页（确认稿主路径）。页数上限校验：正文页 ≤ 17（小红书 18 图上限含封面），超限报错给出可执行提示。
2. **封面**：用 `title` 渲染封面页（frame_template 的 cover 变体，见 3.3）。
3. **每页配图**：复用 `_step_generate_media`（media_workflow / source / prompt 三件套全部沿用）。
4. **每页排版渲染**：复用 `_compose_frame_html` 思路，页文本 + 配图 + frame_template → PNG（尺寸默认 1080×1440，小红书 3:4）。
5. **产物**：图集 artifacts + 发布文案（caption = 全文，存文本 artifact 或 result 字段，执行者按现有 artifact 机制选简单的）。

注册 manifest（`generation/defaults.py` 照抄现有 `_standard_manifest` 模式，pipeline_id=`image_post`）。

### 3.2 产物模型扩展（向后兼容铁律）

- `GenerationResult` 加 `artifact_type: Literal["video","image_set"] = "video"`；`primary_video` 改 Optional（旧数据/视频路径不变）；图集时 images 进 `artifacts`（每张标注 index），可选 `cover` 引用。
- 所有读取 `primary_video` 的地方（作品库、内容详情页产物区、发布衔接、history）按 artifact_type 分支；**旧数据无字段 → 按 video 处理**。
- 新增打包下载端点或复用文件下载：`GET /generation/tasks/{id}/image-set.zip`（执行者可选实现为前端逐张下载，若 zip 端点超 30 行以简单为准——二选一，PRD 不强制）。

### 3.3 排版模板文件

新建 `1080x1440/image_post_default.html` 与 `1080x1440/image_post_cover.html`（目录与现有 `1080x1920/image_default.html` 同级，结构参照它）：简洁版式——大字页文本 + 配图 + 页码角标；封面 = 大标题 + 配图。不追求华丽，出得来、可读、可换。

### 3.4 骨架模板注册（`templates.py`）

```
id="pipeline_image_post_base_v1", display_name="小红书图文帖",
description="文案 → 封面 + 每段一页配图的图集，直接发小红书图文。",
pipeline_id="image_post", entry="script", product_entry="generate",
required_capabilities=["llm","media","persistence"]（无 ffmpeg/tts）,
allowed_user_params=["title","split_mode","frame_template","template_params",
  "media_workflow","media_width","media_height","prompt_prefix",
  "image_prompt_visual_context","image_prompt_generation_rules","source"],
fixed_params={"mode":"fixed","split_mode":"line",
  "frame_template":"1080x1440/image_post_default.html", ...}
```

### 3.5 测试

管线单测（分页/页数上限/产物类型，media 与渲染 mock）、模板注册断言、GenerationResult 序列化兼容（旧 payload 无 artifact_type 可读）、compile_request 走通。

## 4. WP-B · 前端：图文产物与陈列

1. **快速生产页**：`FAMILIES` 加「图文线」板块（tagline「文案 → 每段一页配图 → 图集帖」，newSources=图文骨架）；`PIPELINE_PARTS` 加 `image_post` 产线图：写稿(项目)/分页(split_mode)/每页配图(media_workflow)/排版(frame_template)——「更多可调参数」兜底自动生效。
2. **产物展示**（内容详情页产物卡 + 作品库条目）：`artifact_type==="image_set"` 时渲染缩略图网格（封面在首、点击看原图——用现有图片打开方式，不新增弹层类型）、「下载全部」按钮；作品库列表用封面做缩略 + 「图集」徽标。视频路径零改动。
3. **发布衔接**：图集产物时按钮文案「下载图集去发布」（下载后手动发小红书）；`markPublished` 等状态动作照旧。
4. **审核页第三步**：选中图文模板时隐藏每语言音色区（图文无配音）；提交管线不变。
5. `generationApi.ts` 类型同步 + `generationApi.test.ts` 断言更新。

## 5. WP-C · HyperFrame 动效合成解锁

1. **后端**：`OVERRIDABLE_PARAMS` 加 `"compose_runtime"`（枚举校验 `html_ffmpeg|hyperframes`；值为 hyperframes 时校验 `shutil.which("npx")`，缺失返回 400「动效合成需要本机 Node 环境（npx），请先安装 Node.js」）；标准线与素材线骨架的 `allowed_user_params` 加 `compose_runtime`；更新 `template_overrides.py` 顶部注释（compose_runtime 从"永不可覆盖"名单移除，capabilities 保留）。**执行者必须先读 `compose_runtime.py` 的 hyperframes 分支**，确认其对 frame_template/输入的假设，若存在与 html_ffmpeg 不兼容的前置条件，在校验里一并拦截并写明原因。
2. **前端**：`pipelineParts.ts` 标准线/素材线「合成」步骤去掉 `fixed: true`（编辑选项 `PART_EDIT_OPTIONS.compose_runtime` 已存在）；`PART_EDIT_HINTS` 加 compose_runtime 提示「动效合成（hyperframes）依赖本机 Node 环境，渲染更慢但动效更丰富」。
3. **不预置 HyperFrame 模板**——解锁后用户自建（克隆标准骨架 → 换合成零件），符合"骨架 + 用户配方"哲学。图文线的合成步骤保持固定（排版渲染非视频合成，不适用）。
4. 测试：compose_runtime 覆盖校验（合法枚举/非法值 400/npx 缺失 400）、骨架白名单断言更新。

## 6. 陈列与文档

- `architecture-map.md`：§2 词典 Pipeline 行改 7 条（+image_post）、合成运行时行"在哪改"→配方详情页；纠缠点 6（合成运行时不可见）标记已解决。
- 图文帖出片后 ContentItem 流转与视频一致（producing→produced），无需状态机改动。

## 7. 开放项（遇到再问，不要自行发挥）

- 小红书图文自动发布（API/Buffer 是否支持图集）——发布集成时统一处理。
- 图文排版美化（字体/配色/品牌元素进 template_params）——用户用起来后按需求迭代。
- 封面模板是否需要独立 frame_template 参数（本期 cover 用固定变体文件，不进白名单）。
- 图集产物的 zip 打包 vs 逐张下载——执行者选简单可靠的一种，README 里注明。

## 8. 验收清单

- [ ] 看板确认稿 → 选「小红书图文帖」出片 → 产物区看到封面+N 页图集，可下载
- [ ] 同一条内容再选视频模板出片，两种产物并存于产物区，历史不覆盖
- [ ] 快速生产页出现「图文线」板块，图文骨架可克隆、看产线可换零件
- [ ] 克隆标准骨架 → 产线换合成为动效 → 出片走 hyperframes（npx 缺失时保存被拦截且提示可执行）
- [ ] 旧视频任务/作品库展示零回归；前端三件套 + 后端测试全绿
