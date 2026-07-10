# PRD · 多项目（品牌级项目实体 + 全局切换器）

> 执行对象：实施模型。产品决策已定稿，不要重开讨论；实现细节遵循本文与 `apps/production-template-demo/DESIGN.md`。
> 配套阅读：`prd-content-workbench.md`（工作台）、`drafting-config-design.md`（起草配方）、`product-definition-and-unification-spec.md`（三层配置模型）。

## 1. 背景与问题

操作者同时运营多个内容项目（不同品牌 + 同品牌多平台/多语言），但控制台目前是单项目假设：

- `ContentItem.project` 字段存在但写死 `"PetWoods"`（`pixelle_video/content/models.py:69`），看板/审核/作品库无项目维度。
- 默认生产模板解析两处硬编码 `registry.default_template_id(project="PetWoods", channel="xiaohongshu")`（`api/routers/generation.py:224` 与 `:844`）。
- ops.db 已有 `operating_projects` 表（PetWoods×小红书一行，含 `generation_settings_json` 默认模板）与 `channel_accounts` 表，但粒度是"品牌×渠道"，且只被 ops 遗留脚本和设置页 `ProjectDefaultsSection` 使用。
- 起草配方（drafting profiles）刚上线，全局一份默认，无项目归属——多项目下批量起草必然混用配方。

不解决的代价：项目一多，就会重演"宠物内容用八字 Prompt"事故，且每个入口都要人肉记住该选什么。

## 2. 目标与非目标

**目标（验收口径）**

1. 切换到项目 B 后：看板只看到 B 的条目；添加内容默认入 B、用 B 的语言；起草用 B 的默认配方；出片默认 B 的模板与音色；发布表单预选 B 的平台。
2. 新建一个项目全程零代码，≤5 分钟从建项目跑通第一条草稿。
3. 存量数据无损：现有条目/草稿集/批次全部归入迁移生成的 PetWoods 项目，旧接口不带 project 参数时行为不变。
4. 每次起草/出片在 draft_settings / batch metadata 里留 project_id，可审计误用。

**非目标（不做，防止 scope 膨胀）**

- 多用户/权限——单操作者产品。
- 每项目独立发布凭据（Buffer 多账号）——需改造 PublishManager，P2。
- 跨项目统计报表、看板"全部项目"总览——用户已拍板单切换器，P2。
- ops.db 双写/同步——console 的 projects.json 是唯一真源，ops 表保持只读遗留。

## 3. 已定产品决策（不重开讨论）

1. **粒度 = 品牌级**：一个项目 = 一个品牌/内容线，发布渠道挂在项目下面；不是 ops 的"品牌×渠道"。
2. **主交互 = 全局项目切换器**：侧边栏常驻，选定后整站作用域生效，localStorage 记住。
3. **项目管四类默认**：默认起草配方、默认生产模板、语言集 + 每语言 TTS 音色、发布平台预选。
4. **概念分工**：**配方管"怎么写"（Prompt+模型），项目管"给谁写、怎么产、往哪发"（语言/音色/模板/渠道）**。因此：语言的真源从配方迁到项目——配方模型的 `languages`/`language_script_models` 字段保留（API 兼容），但 UI 上不再作为语言默认来源（见 WP5）。
5. **归档而非删除**：项目只可归档（切换器隐藏、数据保留、设置页可恢复）；默认项目与最后一个 active 项目不可归档。

## 4. 概念模型与配置解析链

```python
class Project(BaseModel):
    project_id: str                                # uuid4().hex
    name: str
    description: str = ""
    status: Literal["active", "archived"] = "active"
    default_drafting_profile_id: str | None = None
    default_production_template_id: str | None = None
    languages: list[str] = ["Chinese"]
    tts_voice_by_language: dict[str, str] = {}     # {"Chinese": "fish reference_id", ...}
    publish_platforms: list[str] = []              # PublishManager 平台 key
    created_at: str
    updated_at: str
```

存储 `data/projects.json`：`{"default_project_id": str|None, "projects": {id: {...}}}`。实现模式**照抄** `pixelle_video/content/drafting_profiles.py`（pydantic + tmp+os.replace + threading.Lock + 可 monkeypatch 的 `_projects_path()`）。

"当前项目"是**前端状态**（localStorage），API 调用全部显式传 project_id；服务端 `default_project_id` 仅作为请求未传时的兜底（旧客户端兼容）。

**解析链全景（改后）** ——每条链自上而下取第一个命中：

| 配置 | 解析链 |
|---|---|
| 起草配方 | 显式 `drafting_profile_id` > 项目默认配方 > 全局默认配方（drafting-profiles.json 的 default）> 安全内置（SAFE_DEFAULT_PROMPT_TEMPLATES） |
| 起草语言 | 表单显式 > 项目 `languages` > `["Chinese"]` |
| 生产模板 | 表单显式选择 > 项目 `default_production_template_id` > registry 内置默认 |
| TTS 音色（每语言） | 表单显式 > 项目 `tts_voice_by_language` > 设置页全局 fish reference_id（现状仅中文）> 空 |
| 发布平台 | 表单显式 > 项目 `publish_platforms` > 现状（不预选） |

## 5. 代码地图（本次涉及）

后端：
- 新增 `pixelle_video/content/projects.py`（模型+存储+迁移）、`api/routers/projects.py`（注册进 `api/routers/__init__.py` 与 `api/app.py`）
- 改 `api/routers/content_items.py`（列表过滤/创建打标）、`api/routers/generation.py`（两处硬编码、起草解析链插项目层、draft-sets 过滤、批次 metadata）
- 只读参考：`ops/store.py`（operating_projects 表结构）、`data/ops.db`
- 不动：`api/routers/generation_settings.py`（留给 ops 脚本，console 不再调用）

前端（`apps/production-template-demo/src/`）：
- 新增 `lib/currentProject.ts`（仿 `lib/expertMode.ts`：localStorage + CustomEvent + hook）、`components/ProjectsPanel.tsx`（设置页管理区）
- 改 `components/AppShell.tsx`（切换器）、`WorkbenchBoard.tsx`、`AddContentDialog.tsx`、`ScriptReviewWorkspace.tsx`、`ContentItemDrawer.tsx`、`shared/ProductionSubmitPanel.tsx`、`HistoryWorkspace.tsx`（发布预选）、`SettingsWorkspace.tsx`（挂 ProjectsPanel、删 ProjectDefaultsSection）、`DraftingProfilesPanel.tsx`（移除语言区块）、`lib/generationApi.ts`、`lib/contentDrafting.ts`
- 验证命令：后端 `uv run pytest tests/ -q`；前端 `npm run typecheck && npm run lint && npm run test:p1`，交付前 `npm run build`

## 6. 工作包总览与顺序

| WP | 内容 | 依赖 |
|---|---|---|
| WP1 | 后端项目实体 + 迁移 | 无 |
| WP2 | 数据打标与过滤（content items / draft sets / batches） | WP1 |
| WP3 | 解析链接通（配方/模板/语言/音色按项目） | WP1 |
| WP4 | 前端全局切换器 + 各页作用域 | WP2、WP3 |
| WP5 | 设置页项目管理区 + 清理 | WP4 |

## 7. WP1 · 后端项目实体与迁移

`pixelle_video/content/projects.py`：`list_projects() / get_project(id) / get_default_project() / create_project(..., copy_from_project_id=None) / update_project / archive_project / restore_project / set_default_project / ensure_migrated()`。

约束（在 API 层返回 400，错误信息中文、给出下一步）：
- `default_drafting_profile_id` 必须存在于配方库；`default_production_template_id` 必须在 registry 且 enabled。
- 归档默认项目 → 400「先把默认项目转移到其他项目」；归档最后一个 active 项目 → 400。
- `create_project` 带 `copy_from_project_id` 时复制四类默认值（不复制名称/描述）。首个项目自动设为默认。

**迁移 `ensure_migrated()`**（幂等，在 projects router 的每个入口和 content_items 列表入口调用一次即可，模式同 registry 每请求重建的轻量做法；已迁移则 no-op）：
1. `projects.json` 已有项目 → 跳过。
2. 建项目：从 `data/ops.db` 的 `operating_projects` 第一行取 `name`/`description`/`generation_settings_json.default_production_template_id`（用 sqlite3 只读，表/库缺失时回退：name="PetWoods"，模板取 `registry.default_template_id(project="PetWoods", channel="xiaohongshu")`）；`default_drafting_profile_id` = 当前全局默认配方 id（若有）；`languages` = 全局默认配方的 languages 或 `["Chinese"]`；设为默认项目。
3. 遍历 content-items store：`project` 字段值不是任何 project_id 的（如 `"PetWoods"`）→ 改写为默认项目 id。幂等：值已是合法 id 则跳过。

API `api/routers/projects.py`（prefix `/projects`）：
- `GET /projects` → `{default_project_id, projects: [...]}`（含 archived）
- `POST /projects`、`PUT /projects/default`（**注意路由顺序：default 在 {id} 之前**，教训来自 drafting.py）、`PUT /projects/{id}`、`POST /projects/{id}/archive`、`POST /projects/{id}/restore`

测试 `tests/projects_test.py`（isolated fixture monkeypatch `_projects_path` + `get_data_path`）：CRUD、复制默认值、默认改派、归档约束、迁移幂等（含 ops.db 缺失分支）、content-items 改写。

**验收**：
- [ ] 迁移后 `GET /projects` 返回 PetWoods 项目且为默认；重复调用不产生第二个项目
- [ ] 存量 content-items 的 project 字段全部变为该项目 id
- [ ] 归档默认项目返回 400 且信息可执行

## 8. WP2 · 数据打标与过滤

- `GET /content-items` 加 `?project=` 过滤（**无参数返回全部**，兼容旧调用方）；创建接口请求体加可选 `project_id`，缺省用默认项目。
- `create_script_review_draft_set` 请求加可选 `project_id`（缺省默认项目），写入 `draft_settings.project_id`；`GET /script-review/draft-sets` 加 `?project=` 过滤，**旧草稿集无 project_id 视为默认项目**（读取端兜底，不回填数据）。
- 三个出片入口（生成页/批量/审核提交）：batch/task `metadata.project_id`。前端提交组件从当前项目取值传入。
- `lib/generationApi.ts`：相应请求类型加 `projectId`；更新 `tests/generationApi.test.ts` 的 body 断言（教训：上两轮都因新增字段挂过断言，这次主动改）。

**验收**：
- [ ] 两个项目各建条目后，`?project=` 只返回本项目条目；无参返回全部
- [ ] 新草稿集 draft_settings 含 project_id；旧草稿集在默认项目下可见
- [ ] 三个入口出的 batch metadata 均含 project_id

## 9. WP3 · 解析链接通（后端为主）

- 起草配方解析链插入项目层（`generation.py` 现有 explicit > profile > safe-builtin 的链，在 profile 层拆成"显式指定配方 > 请求 project_id 对应项目的默认配方 > 全局默认配方"）。draft_settings 已记录配方名/模型，无需新增字段。
- 两处硬编码默认模板（`generation.py:224`、`:844`）改为：请求带 project_id 时取项目 `default_production_template_id`，无效/缺省回退 registry 内置默认。抽一个 `_default_template_for_project(project_id: str | None)` 复用。
- 测试：项目默认配方生效（显式传参仍最高优先）、项目默认模板生效、项目字段无效时回退不崩。

**验收**：
- [ ] 项目 A/B 配不同默认配方与模板，各自起草/出片走各自默认；显式传参覆盖项目默认
- [ ] 不传 project_id 的旧请求行为与迁移前一致

## 10. WP4 · 前端切换器与作用域

`lib/currentProject.ts`：模块级缓存 + localStorage（key `pixlle.currentProjectId`）+ CustomEvent，导出 `useCurrentProject()` → `{projectId, project, projects, setProjectId, refresh}`。启动拉 `GET /projects`；localStorage 值失效（归档/不存在）→ 回落 default_project_id 并写回。

AppShell 侧边栏顶部（logo 下方）切换器：当前项目名 + 展开列出 active 项目 + 分隔线 + 「管理项目…」（navigate 到设置页项目区锚点）。用现有 ui/ 基件（Select 或 Popover+列表），遵循 DESIGN.md；只有一个项目时切换器仍显示（可发现性）。

作用域接线（页面对 `projectId` 变化响应式 refetch，依赖进 useEffect deps）：
- WorkbenchBoard：列表与 30s 轮询带 `?project=`；多选出片沿用当前项目默认。
- AddContentDialog：创建带 projectId；**语言默认改从当前项目取**；删除 7 月 4 日刚加的"切配方联动重置语言 chips"逻辑（语言归项目管，配方下拉保留）。
- ScriptReviewWorkspace：草稿集列表带 `?project=`；创建带 projectId；首步默认值来源改为"项目默认配方 + 项目 languages"（替换现在"全局默认配方"初始化）；第三步每语言音色预填项目 `tts_voice_by_language`。
- ProductionSubmitPanel（生成页/批量共用）：默认模板 = 项目默认 > 全局；提交 metadata 带 project_id。
- HistoryWorkspace 发布表单：platforms 预选项目 `publish_platforms`（为空维持现状）。
- 切换项目时 toast 不需要；页面数据静默刷新。

**验收**：
- [ ] 切到 B：看板/审核列表/添加对话框/提交面板/发布预选全部随之变化，无需刷新页面
- [ ] 刷新浏览器后仍停留在 B；手动清掉 localStorage 后回落默认项目

## 11. WP5 · 设置页项目管理区与清理

`components/ProjectsPanel.tsx`（模式照抄 DraftingProfilesPanel）：
- 项目卡片：名称、默认星标、chips（默认配方名/默认模板名/语言/平台数）、操作：设为默认 / 编辑 / 归档（AlertDialog；默认项目归档按钮 disabled 并说明原因）。归档项目折叠到「已归档」分组，可恢复。
- 编辑 Sheet：名称、描述、默认配方 Select（含「管理配方」跳转）、默认模板 Select、语言 chips、每语言 Fish 音色输入（复用审核第三步的控件样式）、发布平台多选（选项来自 `GET /publish/platforms` 现有接口）。
- 新建 Sheet：名称、描述、可选「从现有项目复制默认值」下拉。
- 挂载在 SettingsWorkspace 中 DraftingProfilesPanel 之前；**删除 `ProjectDefaultsSection`**（能力被吸收；`lib/generationApi.ts` 中 `listGenerationProjects`/`updateProjectGenerationSettings` 一并删除）。
- DraftingProfilesPanel：编辑器移除语言 chips 区块与卡片上的语言 chip（字段保留，不发语言字段的更新）。

**验收**：
- [ ] 零代码完成：新建项目 → 配默认配方/模板/语言/音色/平台 → 切过去 → 添加选题 → 起草成功且 draft_settings 记录该项目默认配方
- [ ] ProjectDefaultsSection 无残留引用；前端全绿

## 12. 全局守则

同 `prd-content-workbench.md` 第 10 节全部条款（compile_request 强制、专家模式边界、复用 shared 组件、`window.confirm` 禁用、每 WP 全绿 + 提交粒度）。补充两条：

1. 所有"项目"相关面向用户文案用「项目」，不出现 project_id/ops 等字样；错误信息给下一步动作。
2. 迁移代码必须幂等且不删数据；任何"值不合法"场景一律回落默认项目而不是抛错给用户。

## 13. 开放项（遇到再问，不要自行发挥）

- 作品库/任务中心按项目过滤：P1。新批次已有 metadata.project_id，旧任务归默认项目展示即可；本期不做 UI。
- 条目「移动到项目」：P1，抽屉里加操作即可，本期不做。
- 归档项目的在途任务：继续跑完，任务中心可见，不做特殊处理。
- 每项目发布凭据（Buffer 多账号）、时区默认挂项目：P2，涉及 PublishManager 改造。
- ops.db `channel_accounts`：本期不接入 console（发布侧只做平台预选）；等 P2 凭据方案一起定。
