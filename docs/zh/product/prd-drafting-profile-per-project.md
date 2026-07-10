# PRD · 配方与项目 1:1 绑定（起草配置项目私有化）

> 执行对象：实施模型。产品决策已定稿；实现遵循本文与 `apps/production-template-demo/DESIGN.md`。
> 本文取代 `drafting-config-design.md` 中"配方是全局库"的设定；`prd-config-at-point-of-use.md` 已上线的组件按第 7 节调整。

## 1. 背景与决策

用户拍板：**配方与项目一对一绑定死，不再出现多对多**。理由：全局配方库带来"改项目 A 的配方会不会影响 B"的心智负担；单操作者场景下共享收益不抵疑虑成本。"暂时绑定死"——实现上保留 DraftingProfile 存储实体（内部实现细节），但对用户彻底隐藏"配方"作为独立概念：**UI 上只有"项目的起草配置"**。

现状（已核对 data/）：仅 PetWoods 一个项目，`drafting-profiles.json` 尚不存在，自定义 Prompt 仅两个八字文件——迁移负担极小，但迁移逻辑仍须幂等、可处理理论上的共享情况。

## 2. 目标与非目标

**目标（验收口径）**

1. 修改项目 A 的起草配置（含 Prompt 正文），对项目 B 的下次起草零影响。
2. 新建项目开箱即有可用起草配置（自动创建；「从现有项目复制」= 克隆内容，绝不共享引用）。
3. 设置页不再有独立"起草配方"区块；起草配置在项目编辑器内一站式完成（含 Prompt 正文编辑）。
4. 迁移幂等，旧数据（草稿集溯源字段、既有配方文件）不丢不坏。

**非目标**

- 删除 DraftingProfile 存储实体或改动 `draft_settings` 溯源字段结构（保持可回退到库模型）。
- Prompt 文件库项目私有化——Prompt 文件保持全局（内置必须共享），跨项目副作用用 copy-on-write 规则消除（见 3.3）。
- 后端 `drafting_profile_id` 显式传参能力下线（API 保留，前端不再传）。

## 3. 模型与规则

### 3.1 所有权

- `DraftingProfile` 增加 `project_id: str = ""` 字段（所有者项目）。
- 一个项目有且只有一个配方。`profiles.json` 的 `default_profile_id` 废弃：字段保留（兼容旧文件），代码不再读写。
- 新增 `get_profile_for_project(project_id) -> DraftingProfile`：返回该项目配方；**缺失时自动补建**（内容取安全内置默认），幂等自愈。这是解析链与前端读取的唯一入口。
- 项目归档时配方保留不动；配方不可单独删除。

### 3.2 解析链（简化后）

| 配置 | 解析链 |
|---|---|
| 起草 Prompt/模型 | 显式 `drafting_profile_id`（API 兼容保留）> **项目配方** > 安全内置（SAFE_DEFAULT_PROMPT_TEMPLATES） |

`generation.py` 的 create_script_review_draft_set：删掉"全局默认配方"层（`get_default_profile()` 调用移除，函数本身保留），项目层改用 `get_profile_for_project(resolved_project_id)`。

### 3.3 Prompt copy-on-write（消除跨项目副作用）

Prompt 文件库保持全局。在项目编辑器里编辑 Prompt 正文时：

- 内置 Prompt → 走现有"复制为自定义"流程，副本命名 `<项目名> · <原名>`，本项目配方引用改指副本。
- 自定义 Prompt 且**同时被其他项目的配方引用** → 保存时不改原文件，自动另存副本（同上命名），更新本项目配方引用，toast：「已为本项目创建副本，不影响其他项目」。
- 自定义 Prompt 仅本项目引用 → 直接保存原文件。

引用判定在前端本地算：`listDraftingProfiles()`（返回已含 project_id）中 `script_template_name`/`split_template_name` 命中该 Prompt 名且 project_id ≠ 当前项目。不新增后端接口。

## 4. 迁移（幂等，追加进 `projects.ensure_migrated()` 尾部）

对每个项目（含 archived），按 created_at 序：

1. `default_drafting_profile_id` 指向存在的配方且该配方尚未被占用（`project_id` 为空或等于本项目）→ 写入 `project_id = 本项目`。
2. 指向的配方已被前面的项目占用（理论共享情形）→ **克隆**一份新配方（新 id，`project_id = 本项目`），更新项目引用。
3. 为空/空串/指向不存在的配方 → 新建配方（内容优先取旧全局默认配方的值，否则安全内置），更新项目引用。

孤儿配方（迁移后无任何项目引用）保留在文件里，不展示不删除。`project.default_drafting_profile_id` 字段继续作为"项目→配方"的指针使用（含义从"默认选择"变为"所属配方"，字段名不改，避免无谓迁移）。

## 5. 后端改动（WP-1）

- `pixelle_video/content/drafting_profiles.py`：加 `project_id` 字段、`get_profile_for_project()`（含自愈补建 + 线程锁内写回项目指针需回调 projects 模块——注意避免循环导入：补建后由调用方（projects.ensure_migrated / API 层）更新项目指针，或延用"配方 project_id 为准、项目指针懒同步"的单向策略：**以 profile.project_id 为唯一真源，`get_profile_for_project` 直接按 project_id 查找**，项目的 default_drafting_profile_id 仅迁移期用后即弃，不再读）。
  - 决策：**以 `profile.project_id` 反向索引为真源**。查找 = 遍历 profiles 找 project_id 匹配；找不到则补建。项目模型字段保留但退役。
- `api/routers/drafting.py`：`POST /profiles` 增加必填 `project_id`，且该项目已有配方时返回 400「每个项目只有一份起草配置」；`DELETE /profiles/{id}` 一律 400「起草配置随项目存在，不能单独删除」；`PUT /profiles/default` 下线（前端已无调用后删除路由）；`GET /profiles` 响应带 `project_id`。
- `api/routers/projects.py`：`create_project` 成功后自动建配方（`copy_from_project_id` 时克隆源项目配方内容）；响应不变。
- 测试更新/新增（`tests/drafting_profiles_test.py`、`tests/projects_test.py`）：1:1 约束、自愈补建、克隆不共享、迁移三分支幂等、解析链走项目配方。

## 6. 设置页合并（WP-2）

- 从 `DraftingProfilesPanel.tsx` 抽取 Prompt 编辑 Sheet 为 `components/shared/PromptEditorSheet.tsx`（保留：正文编辑、字符数、`{topic}`/`{language}` 占位说明、缺 `{topic}` 警告、内置只读+复制为自定义；新增：3.3 的 copy-on-write 判定与命名，props 传入当前项目 id/名与全量 profiles）。
- `ProjectsPanel.tsx` 项目编辑 Sheet 增加「起草配置」分区：口播 Prompt Select + Eye（PromptPeekSheet）+「编辑正文」（PromptEditorSheet）、分镜 Prompt 同、口播/分镜模型 Input（placeholder「留空用设置页默认模型」）。保存 = `PUT /drafting/profiles/{id}`（配方字段）+ `PUT /projects/{id}`（其余字段）顺序调用，任一失败给 InlineError 不静默。
- 新建项目 Sheet 不加起草分区：自动建配方后，toast 引导「起草配置已就绪，可在编辑项目里调整」。
- **删除** `DraftingProfilesPanel.tsx` 及其在 SettingsWorkspace 的挂载；其 Prompt 编辑能力已由 PromptEditorSheet 承接。
- `lib/settingsLinks.ts`：删除 `drafting-profiles` target（TS 编译错误会暴露全部引用点），引用一律改 `{kind:"projects"}`。
- `SourceChip`：`profile` 语义并入 `project`（type 收窄为 `"project" | "builtin" | "override"`，文案「项目默认」）。

## 7. 入口简化（WP-3）

- **AddContentDialog**：删配方下拉与 profileId 状态；改为一行说明 `起草配置：口播「X」` + SourceChip(project) + Eye（查看该 Prompt）；数据从 `listDraftingProfiles()` 按当前项目过滤。`generateDraftsForItems` 调用不再传 `profileId`。
- **WorkbenchBoard**：删动作栏配方 Select 与懒加载逻辑；起草直接走后端项目解析（只传 projectId）。溯源靠抽屉与审核页已有展示。
- **ScriptReviewWorkspace**：第一步初始化与来源说明行改用当前项目的配方（`listDraftingProfiles()` 按 project_id 过滤）；文案改为 `默认值来自项目「X」的起草配置`（链到 projects 锚点）；「部分字段已修改」比较基准同步换成项目配方。
- `lib/contentDrafting.ts`：`options.profileId` 参数删除（后端显式层保留，但前端无调用方）。
- 更新 `tests/generationApi.test.ts` 相关断言（draft-set create body 的 `drafting_profile_id` 恒为 null）。

## 8. 全局守则

同 `prd-content-workbench.md` 第 10 节。补充：

1. 迁移与自愈必须幂等；任何"找不到配方"场景一律补建而不是报错给用户。
2. 面向用户文案统一叫「起草配置」，不再出现「配方」二字（含 toast、空态、aria-label）。
3. 判空 `default_drafting_profile_id`/`default_production_template_id` 一律真值判断（`||`），禁止 `??`（历史教训：清空默认发空串）。
4. 每 WP 全绿：后端 `uv run pytest tests/ -q`；前端 `npm run typecheck && npm run lint && npm run test:p1`；交付前 `npm run build`。

## 9. 开放项（遇到再问，不要自行发挥）

- 孤儿配方（含现存两个八字 Prompt 文件）不做清理 UI，留待 ops 清理。
- 每语言模型覆盖（`language_script_models`）编辑 UI 本期不做进项目编辑器（字段保留，API 可改）；有需要时用户会提。
- 若未来要恢复配方共享（多对多），路径：去掉 1:1 校验 + 恢复选择器——存储层未破坏，成本可控。
