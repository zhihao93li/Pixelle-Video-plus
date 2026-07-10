# PRD · 骨架模板化：每条管线一张基础模板，内置预设全部退役

> 执行对象：实施模型。产品决策已定稿；实现遵循本文与 `apps/production-template-demo/DESIGN.md`。
> 配套阅读：`architecture-map.md`（概念分层，必读 §2/§4）、`prd-content-workbench.md` 第 10 节（全局守则，全部适用）。

## 1. 背景与决策

用户拍板：**"只给我留 pipeline，模板我以后自己加。模板的概念没有问题。"**

现状（已核对代码与数据）：11 个内置模板中 6 个是 ops 时代固化的 PetWoods 预设（品牌进配方名，概念错位）；30 个历史批次中 `petwoods_xhs_static_subtitle_v1` 用了 17 次（用户真主力）、daily 2 次、topic_to_video 1 次，其余 PetWoods 模板零使用。用户已具备克隆模板 + 模板默认配置的零代码衍生能力。

目标形态：**内置只保留每类管线的中性"骨架模板"，参数变体全部由用户克隆衍生**。

## 2. 目标与非目标

**目标（验收口径）**

1. 新建视频页只剩说人话的卡片：5 张骨架 + 2 张流程入口卡（≤8 张），平铺陈列，每张卡先说"产出什么成品"，输入要求降级为标签；每张卡可看「产线零件」清单（当前零件 + 哪些可换 + 直达更换入口）。
2. 用户主力不断档：`static_subtitle` 的参数自动迁成用户的第一个自定义模板，项目默认自动指过去，下次出片行为不变。
3. 克隆骨架 → 改默认配置 → 出片，全程零代码；换 `workflow_key` 即可零代码接入新的单 workflow 玩法。
4. 历史批次/作品库/任务中心的旧模板引用不受影响（退役≠删除）。

**非目标**

- 删除任何模板注册代码或历史数据（退役 = `enabled=False`，可随时恢复）。
- 动 pipeline 层代码（6 条注册不变；custom 管线保持休眠，不上架）。
- 自定义模板的完整编辑器（本期仍是克隆+默认配置的组合，够用）。

## 3. 目标模板清单

**新增 2 张骨架**（注册在 `templates.py`，参数取现有模板中性化）：

| id | display_name | pipeline / entry | 参数来源 |
|---|---|---|---|
| `pipeline_standard_base_v1` | 图文口播视频 | standard / script | 取 `petwoods_xhs_daily_v1` 的 fixed_params 与 allowed_user_params；**审查 fixed_params 中含品牌语义的值**（prompt_prefix、image_prompt_visual_context 等含 "PetWoods/宠物" 字样的 → 置空或通用化），技术默认保留（split_mode=paragraph、html_ffmpeg、tts 默认音色等） |
| `pipeline_asset_based_base_v1` | 素材增强视频 | asset_based / assets | 取 `petwoods_xhs_asset_enhanced_v1` 同样中性化 |

**保留 3 张既有中性模板作为骨架**（改描述，不改 id）：`pixelle_i2v_basic_v1`（图片生成视频）、`pixelle_action_transfer_basic_v1`（动作迁移视频）、`pixelle_digital_human_basic_v1`（数字人视频）。描述统一补一句"这是 XX 管线的基础模板，可克隆后调整默认参数"。

**退役 6 张**（`templates.py` 中 `enabled=False`，migration_notes 注明退役原因与替代品）：全部 `petwoods_xhs_*`。

**流程入口占位 2 张**不动（script_review / batch，维持缓拆结论）。

## 4. 工作包总览

| WP | 内容 | 依赖 |
|---|---|---|
| WP-1 | 后端：骨架注册 + 退役 + workflow_key 白名单 + enabled 覆盖开关 + 主力迁移 | 无 |
| WP-2 | 设置页：模板启用/停用 toggle + pipeline 归属展示 | WP-1 |
| WP-3 | 新建视频页重组 + 全站模板列表只展示 enabled | WP-1 |

## 5. WP-1 · 后端

### 5.1 注册表改造
按 §3 执行。位置 `pixelle_video/generation/templates.py`（daily 在 227 行起，参数结构照抄现有）。

### 5.2 workflow_key 纳入覆盖白名单
- `template_overrides.py` 的 `OVERRIDABLE_PARAMS` 加 `"workflow_key"`；三张 workflow 直跑骨架的 `allowed_user_params` 也加。
- PUT 默认配置时校验：`workflow_key` 值必须对应 `data/workflows/` 下存在的文件（相对路径，如 `runninghub/i2v_LTX2.json`），否则 400 并列出可用文件名。

### 5.3 模板启用/停用（用户侧开关）
- 存储：复用 `data/production-template-overrides.json`，每模板顶层加可选 `"enabled": bool`（与 `overrides` 平级；注意别混入参数 overrides）。
- 合并：`build_default_production_template_registry()` 构建时，override 里 `enabled=False` 的模板强制置 disabled（内置与自定义均适用）；`enabled=True` 可重新启用被用户停用的模板，但**不能**启用代码里退役的 6 张 PetWeoods——代码 enabled=False 优先（防止诈尸）。
- API：`PUT /generation/templates/{id}/enabled {enabled: bool}`（新端点或并入现有 generation-config PUT，实施者选简单的）。校验：停用时若有项目 `default_production_template_id` 指向它 → 400「项目「X」正在用它作默认模板，请先换默认」。

### 5.4 主力迁移（幂等，挂进 `projects.ensure_migrated()` 尾部）
1. 若自定义模板存储（`custom_templates.py`，dict 按 template_id 键）中不存在 id `migrated_static_subtitle_v1`：以 `petwoods_xhs_static_subtitle_v1` 的当前**生效参数**（fixed_params + 其模板默认配置 overrides 合并结果）创建之，display_name「静态字幕快出」，is_custom=True，pipeline/entry/白名单照抄源模板。
2. 重指项目默认（含 archived）：`default_production_template_id` 指向退役模板的 → static_subtitle 系 → `migrated_static_subtitle_v1`；其余 standard 系 → `pipeline_standard_base_v1`；asset 系 → `pipeline_asset_based_base_v1`。已指向非退役模板的不动。
3. 幂等：id 判重 + 只重指"当前指向退役模板"的项目。

### 5.5 测试
`tests/` 新增/更新：骨架注册与品牌词审查（fixed_params 序列化后不含 "petwoods/PetWoods"）、workflow_key 校验（合法/不存在文件 400）、enabled 覆盖合并（用户停用/重启用/退役不可诈尸）、停用被项目默认引用 400、迁移幂等 + 项目默认重指、`compile_request` 对退役模板报错信息可读。已有断言中引用退役模板 display_name 的更新之。

## 6. WP-2 · 设置页模板面板

- `TemplateStatusPanel.tsx`：每张卡加启用/停用开关（Switch 或按钮；停用走 AlertDialog 确认）；被项目默认引用时停用按钮 disabled 并说明原因（DESIGN.md：禁用必须给原因）。退役模板归入折叠的「已退役」分组（只读，标注替代品）。
- 卡片加所属管线 chip（standard/素材/直跑，用 display 文案「标准线 / 素材线 / Workflow 直跑」）。
- 骨架卡上放主 CTA「克隆为我的模板」（现有克隆流程）。

## 7. WP-3 · 新建视频页：成品导向陈列 + 产线零件透明化

> 用户原话（设计基准）："我要的信息就是：走这条路能作出什么样的成品？然后接下来一步是，走这条路里面有哪些 provider？哪些可以替换？我自己换。"
> 因此**废弃按输入分组**（"我有文案/我有素材"仍是系统视角）。骨架化后卡片总数 ≤8，摊平陈列，不分组。

### 7.1 卡片：先回答"产出什么"

- `CreateGallery.tsx` 删除 `GROUPS` 分组机制，模板卡平铺（骨架卡 + 用户自定义模板卡 + 两张流程卡在最后）。
- 每张卡的信息层级重排：
  1. **成品描述**（主体，大字）：说清产出物形态，如「60 秒竖版口播视频 · 每个分镜一张 AI 配图 · 带字幕配音」「静态画面 + 字幕配音，适合快速批量」「你的照片/视频 → AI 组织成完整短片」。骨架模板的成品描述写进 `templates.py` 的 description 字段（新增或复用现有字段，实施者查 ProductionTemplate 模型）。
  2. **输入 chip**（次要标签）：「需要：文案」「需要：选题」「需要：图片素材」——原分组信息降级为标签。
  3. **产线零件预览**（小字一行）：如「写稿 deepseek · 配音 Fish · 画面 AI 生图 · 本机合成」，取自 7.2 的零件清单前几项。
- 流程卡（多语言审核出片、批量生产）保留「流程」Badge，成品描述同样重写（如「一批选题 → 多语言过稿 → 各出一条视频」）。

### 7.2 产线零件视图（点卡片上「看产线」或模板详情入口）

新增 `components/shared/PipelinePartsSheet.tsx`（只读 Sheet）：把模板按管线步骤渲染成零件清单，每个零件标注**当前值 + 是否可换**：

| 步骤 | 当前零件（示例） | 可换性判定 |
|---|---|---|
| 写稿 | deepseek-v4-flash（项目起草配置） | 可换 → 链到项目编辑器 |
| 分镜 | 按段落切 / 按行直出 | 可换（split_mode 在白名单） |
| 配音 | Fish Audio · 音色 X | 可换（tts_* 在白名单） |
| 每镜画面 | workflow：t2i_xxx.json | 可换（media_workflow/workflow_key 在白名单） |
| 合成 | html_ffmpeg | 可换（compose_runtime 在白名单） |
| 算力 | 本机 ComfyUI / RunningHub | 可换（source 在白名单） |

- 数据来源：现有 `GET /templates/{id}/generation-config`（`effective_params` + `overridable_keys`），管线步骤顺序按 pipeline_id 写死一张映射表（standard/asset_based/直跑 各一份，前端常量即可，不新增后端）。
- 「可换」零件点击 → 跳该模板默认配置编辑（settingsLink template 深链）；不可换步骤显示灰色锁并注明「产线固定步骤」。
- 值的展示用人话映射（selfhost→本机 ComfyUI，html_ffmpeg→标准合成），不出现内部 key。

### 7.3 全站列表与断言

- 全站模板下拉（ProductionSubmitPanel、项目编辑器默认模板 Select、模板默认配置入口）只列 enabled=true；退役模板即使被历史数据引用也不出现在任何选择器。
- 更新 `lib/generationApi.ts` 类型与 `tests/generationApi.test.ts` 相关断言。

**P1（本期可不做，留 backlog）**：卡片配成品缩略图——取该模板最近一次成功任务的视频缩略图（作品库已有缩略图能力），无历史时显示描述文字即可。

## 8. 全局守则

同 `prd-content-workbench.md` 第 10 节。补充：

1. 退役模板的历史引用必须继续可显示（作品库模板名来自 task metadata，不依赖注册表 enabled）。
2. 迁移幂等、不删数据；"指向不存在/退役模板"一律重指骨架而不是报错。
3. 判空项目默认字段用真值判断（`||`），禁止 `??`。
4. 面向用户文案禁止出现 pipeline_id/enabled 等内部字样；管线名用「标准线/素材线/Workflow 直跑」。

## 9. 开放项（遇到再问，不要自行发挥）

- 退役模板上的历史批次**重试**会被 compile_request 拒绝（模板 disabled）——本期接受，报错信息引导"从工作台重新出片"；不要为此加特殊分支。
- custom 管线不上架不注册模板；用户未来要自定义编排时再议。
- 骨架模板的品牌词审查若发现某参数值去品牌化后语义不完整（如视觉风格 prompt），置空并在 migration_notes 记录，让用户在克隆里自己填——不要替用户编造风格。
