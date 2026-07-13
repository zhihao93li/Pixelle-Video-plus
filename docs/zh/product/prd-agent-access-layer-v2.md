# PRD v2.5 · Agent 接入层：认证边界 + 用例级 API + MCP Server + Codex 配图迁移 + 旧世界安全退役

> **执行文档（无历史上下文亦可使用）。** 经五轮对抗审查定稿。v2.5 在 v2.4 基础上补齐一个运行时能力边界：首批内容用例只能安全构造 `script/scenes` 输入；需要任意本机素材的配方必须在 capabilities 中明确标为不可由 Agent 生产，不能只因配方 enabled 就虚假宣称可用。
> 冲突处理：本文与代码冲突以代码为准并记录；需产品决策的分叉停下列选项。禁止顺手重构无关代码。
> 验证：后端 `uv run pytest tests/ -q`；前端（涉及处）`cd apps/console && npm run typecheck && npm run lint && npm run test:p1`，动页面跑相关 `npm run test:e2e`。每 WP 独立 commit，commit 前全绿。

## 实施结果（2026-07-13）

- WP-0～7 已落到当前工作树：本机监听、Agent Token、凭证脱敏读写、`access_scope=agent`、持久化用例操作、内容用例 API、实时 capabilities、React 共用入口、`agent_plugin` MCP、根 `AGENTS.md`、旧 Ops 退役与归档脚本均已完成。
- Codex 已在本机 `~/.codex/config.toml` 注册 `mcp_servers.pixelle`；新任务启动后加载。MCP stdio 的 initialize → list_tools → get_capabilities 已通过真实子进程测试。
- `data/ops.db` 已经 `--dry-run → --apply → --verify` 迁入 `data/archive/legacy-ops/20260713T075055Z/`，原位无旧数据库；`agent_plugin` 已替代旧 `codex_plugin`，运行时代码不再依赖 `ops/`。
- 自动验证：Python `311 passed`；React typecheck、lint、58 项 P1 测试与 production build 通过；相关 E2E 功能断言通过。全量视觉基线仍有与本改动无关的旧页面快照漂移，未以本任务名义批量覆盖。
- 真实验收：“猫为什么喜欢纸箱”按 3 镜完成 manifest → 无 Token 人工通道确认 → 上传图片 → TTS/字幕/合成；首片与替换单镜后的重产都成功，旧/新 task 与 MP4 同时保留。最终 MP4 为 H.264 1080×1920 + AAC，约 18.98 秒；`storyboard.json` 对应 3 份图片、3 段音频和 3 条字幕，质量检查通过。
- 当前环境没有 Docker CLI，因此 Dockerfile 与 Windows 打包清单已有自动测试，但镜像构建尚未实跑。此项是发布前验证缺口，不把它标成已通过。

## 0. 背景与实施前事实基线

pixlle：单人运营的 AI 内容工厂。后端 FastAPI（`api/`，业务 `pixelle_video/`），前端 `apps/console`（React hash 路由，FastAPI 同源托管）。实体：**项目**（`data/projects.json`）；**内容条目**（`data/content-items/` 每条一个 JSON 文件，状态机见 `pixelle_video/content/models.py`：idea/drafting/draft_ready/pending_review/confirmed/producing/produced/scheduled/published/measured/archived，非法迁移 400）；**配方**（ProductionTemplate：DraftingSpec + 生产参数 + `allowed_user_params` 白名单 + `access_scope`，产物三态 video/image_set/text）；**任务/批次**（`data/generation-tasks|batches/`）。配置解析：模板内置默认 < 配方持久化覆盖 < 本次合法 input（白名单**静默丢弃**非法参数）；项目层提供默认配方与语言/音色。

**必读**：`api/routers/content_items.py`、`generation.py`、`projects.py`、`settings.py`、`api/dependencies.py`、`api/config.py`、`pixelle_video/content/models.py` 与 `store.py`、`pixelle_video/content/projects.py`（`_read_ops_seed` 直读 ops.db）、`pixelle_video/generation/templates.py`（`access_scope` 与 codex 模板）、`pixelle_video/pipelines/codex_scene_video.py`（**CodexSceneSpec = 分镜合同事实源**）、`apps/console/src/lib/contentDrafting.ts`、`produceContent.ts`（要下沉的编排事实源）、`apps/console/src/components/SettingsWorkspace.tsx`（分区整体回提——凭证合同必须读写一体改的原因）、`docs/zh/product/current-product.md`。

**实施前硬约束（现已按 WP 顺序处理）**：①`api/dependencies.py`、`generation_settings.py`、Dockerfile、打包清单仍依赖 `ops/`——删除必须放最后；②`projects.py:_read_ops_seed()` 经 sqlite3 **不经 import** 直读 `data/ops.db`；③内容存储单文件 JSON，只有单文件原子替换，无跨实体事务；④API 默认 `0.0.0.0`、CORS 宽松、`/settings/config` 回传凭证明文、设置页按分区整体回提。

## WP-0 · 网络与认证边界（最先做）

1. **默认只监听本机**：`api/config.py` host 默认改 `127.0.0.1`；监听局域网需显式配置，且启动日志必须警告「普通用户接口无登录认证，局域网内任何设备可操作」。CORS 收紧到同源/显式列表——**CORS 只管浏览器，不当认证用**。
2. **Agent Token**：API 启动时 `data/agent-token` 不存在则以临时文件 + 原子发布创建（并发启动也只接受一个最终文件），权限 `0600`，随机 ≥32 字节。Agent 请求带 `X-Pixelle-Agent-Token`。
3. **actor 由后端认定**：用例接口不接受请求体 `actor`——合法 token → `agent`，否则 `user`。**带 token 调 `/confirm` → 403**（确认是人的动作）。请求体保留 `client_name / agent_session_id / request_id / source` 自述溯源字段。
4. **agent 配方权限**：`access_scope="agent"` 配方的生产路径要求 token 认证，否则 403。
5. **access_scope 后端迁移 `codex` → `agent`**（WP-0 的权限判断与 WP-4 前端迁移的地基，缺它两者悬空）：
   - 枚举改 `Literal["public", "agent"]`：`pixelle_video/generation/schemas.py:78` 与 `templates.py:79` 两处；加载/反序列化读到旧值 `"codex"` 一律归一为 `"agent"`（validator 层做，持久化兼容测试覆盖）。
   - 权限判断 `service.py:128` 一带 `surface` 检查同步；入参 `surface="codex"` 过渡期兼容（内部转 `agent`）。
   - API 输出：`generation.py:247` 一带响应字段改 `agent_templates`，过渡期**双写**保留废弃字段 `codex_templates`（值相同，注释标 deprecated）。
   - 模板 ID（`codex_scene_video`、`codex_image_story_v1`）**不改**，避免历史记录失效。
   - **React 类型与 access_scope 判断同时在本 WP 改完**：先读 `agent_templates`、兼容 `codex_templates`，`agent` 与旧 `codex` 都按 Agent 专属展示；后端/前端/持久化兼容测试同步更新。不得把前端兼容拖到后续 WP，避免中间 commit 错误暴露 Agent 配方。
6. **凭证读写合同一体改**（只做响应脱敏会让掩码被写回，见 SettingsWorkspace 分区回提）：
   - GET `/settings/config`：密钥字段一律返回空串 + 伴生 `*_configured: bool`（LLM/RunningHub/Buffer/COS/Fish 等全部，以 settings.py 实际字段清点）。
   - PUT：密钥字段**缺省或空串 = 保留原值**；提交非空 = 更换；清除必须用显式 `clear_api_key` 类字段。
   - **React 设置页适配并入本 WP 同一 commit**（密钥输入"已配置"占位态、只提交重填值、清除按钮）——安全响应合同与前端保存语义必须原子上线，不得留跨 WP 的不完整中间态。
7. 诚实定位（写注释）：这是单机产品的运营纪律边界，不是完整认证体系；远程访问需求出现时再建登录，本版不做。

## WP-1 · 持久化用例操作记录

新存储 `data/content-flow-operations/`（单文件 JSON 风格）：

```
{ operation_id, request_id, request_hash, operation, item_id, prior_status,
  phase: accepted|external_completed|item_updated|task_created|linked,
  status: running|completed|failed, draft_set_id?, batch_id?, task_ids: [],
  result?, error?, created_at, updated_at }
```

- 语义：多步用例不是原子事务，是**带持久化检查点的可恢复操作记录**。每越过一个不可逆边界（外部结果返回、任务创建、条目关联）先写 phase/ID 再继续；生成任务的 idempotency_key 与 operation.request_id 绑定。启动时对遗留 `running` 按已落盘事实协调：
  - `draft`：条目已有与本 operation 匹配的 variants/draft_set 且已在 pending_review → 补记 completed，**不得退回**；仍停 drafting 且无产物 → failed 并退回 idea。
  - `produce`：已有 task_ids → 恢复/补齐条目关联，不重提；未创建任务 → failed 并恢复 `prior_status`（首产 confirmed、重产 produced）。任务最终失败也恢复 prior_status。
- **幂等**：所有写用例都要求 request_id；同 `request_id`+同 `request_hash` → 返回既有结果；同 id 异 hash → 409。**React/MCP 一次逻辑调用（含网络重试）复用同一 request_id**——在调用层生成一次，禁止每次 HTTP 尝试新建。服务端对 request_id 建唯一索引/锁，两个并发同 id 只能有一个执行者。
- 查询：`GET /agent/operations/{operation_id}`。

## WP-2 · 用例级接口（新路由 `api/routers/content_flows.py`）

React 与 MCP 共同消费；actor 由 WP-0 认定；事件写入含全组溯源字段。

| 接口 | 语义 | 强制校验 |
|---|---|---|
| `POST /content-items/topics` | Agent/React 共用的选题创建用例；替代 MCP 直调旧 CRUD，actor 由 token 认定，created 事件和 source 与真实身份一致 | titles 非空；request_id 必填；source 不作为身份依据 |
| `POST /content-items/{id}/draft` | **异步**：校验后 `202 + operation_id`，后台执行 contentDrafting.ts 下沉版；失败**后端**退回 idea | 仅 idea |
| `POST /content-items/{id}/confirm` | 下沉控制台确认序列；**一次确认 ContentVariant 与 SceneManifest**（manifest 文案与提示词随之锁定） | 仅 draft_ready / pending_review（显式枚举，不用状态排序）；带 token → 403 |
| `PUT /content-items/{id}/scene-manifest` | **Agent Token 必须**。第一阶段（纯文案）：保存 `scenes[{scene_id, order, narration, image_prompt, duration?}]`，不含图片。**manifest 即草稿**：idea 条目提交合法 manifest 后，后端同步合成 ContentVariant（`script`=narration 拼接、`narrations`=各镜 narration、标题沿用条目标题）并沿合法边推进状态 idea→drafting→draft_ready→pending_review——Codex 分镜本身就是待审草稿，**不再调 pixelle LLM 重写** | 仅 idea/draft_ready/pending_review 可写；**drafting → 409（等待正在运行的起草结束）**；confirm 后锁定；已有普通草稿且 narrations 不一致 → 409，需显式 `overwrite_draft: true` 才覆盖 |
| `POST /content-items/{id}/scene-images` | **Agent Token 必须**。第二阶段（生图后上传）：按 `scene_id` 上传图片，`replace: true` 可替换单镜；服务端存素材并返回 `asset_id`，manifest 记 asset_id——**不接受调用方任意 image_path**（MCP 可读本机文件后上传字节，API 只接字节/asset_id） | 仅 confirmed/produced；**producing → 409**，scheduled/published/measured → 400；manifest 必须已确认 |
| `POST /content-items/{id}/produce` | 下沉 produceContent.ts（分镜按行、幂等、task_ids 追加）；codex_scene_video 从已确认 manifest + 齐全图片构造 scenes（字段合同=CodexSceneSpec）。**首产/重产分型**：首次生产自 confirmed；换图重产自 produced（现有状态表已允许 `produced→producing→produced`，补语义测试即可），新任务 ID 追加、旧任务旧片保留；重产失败恢复 produced（旧片仍有效），operation 记失败 | 首产仅 confirmed；重产仅 produced；scheduled/published/measured → 400；agent 配方需 token；**图片不齐 → 400 列出缺失 scene_id** |
| `POST /content-items/{id}/mark-published` | produced→(scheduled→)published；追加进 **`publications[]` 数组**（多平台不互相覆盖）：`{publication_id, platform, published_at, evidence_type: url\|platform_post_id\|buffer_id\|manual, evidence_value, actor, request_id}` | platform+published_at 必填，evidence 至少一项 |
| `POST /content-items/{id}/metrics` | 正式指标+推进 measured；`mock:true` 只写 `automation.mock_metrics`（带 mock_label），不动正式 metrics 不推状态 | 正式指标仅 published/measured；建议带 publication_id |

**产品流程（已定，验收按此走）**：agent 提交分镜文案+提示词 → **人确认（文案锁定）** → agent 生图并按 scene_id 上传 → 图齐 → produce。先确认再花钱生图，闸门在花钱之前。

原子 PATCH/transition 保留兼容。测试 `tests/content_flows_test.py`：两阶段时序（无 token 两端点 403 / 确认前传图 400 / drafting 改 manifest 409 / producing 换图 409 / 确认后改文案 400 / 图不齐 produce 400 报缺失清单 / replace 单镜）、**manifest 即草稿链路**（idea 提交 manifest → variant 合成正确 → 状态到 pending_review → confirm 一次锁定两者；已有草稿不一致 409 与 overwrite_draft）、**重产分型**（confirmed 首产 / produced 重产 / scheduled 后拒绝 / 重产失败回 produced）、异步 draft 全链、崩溃窗口检查点协调、幂等三态与并发同 id、topics actor 溯源、publications 数组多平台、mock 隔离、token/actor/403 矩阵、access_scope 旧值归一与 `codex_templates` 双写、凭证 GET 空值+configured / PUT 缺省保留 / 显式清除。

## WP-3 · capabilities

`GET /api/agent/capabilities`（实时聚合，禁手写）：API 版本、工具面版本、产物三态、启用配方（agent 配方注明 `requires: ["scene_manifest", "client_generated_images"]`——**服务端声明要求，客户端自评估**）、需人工确认的动作、环境就绪（复用 `/settings/diagnostics`）与不可用原因、token 是否已配置。每个配方另返回 `agent_producible` 与 `unavailable_reason`：首批 `script/scenes` 为可生产；需要任意素材路径的 assets/video 专用输入仍由 React 快速生成发起，MCP 不得把文案伪装成素材。

## WP-4 · React 最小调整

1. 起草/确认/出片/发布/回填改调用例接口（前端编排删除）。
2. `access_scope` 前端兼容已随 WP-0 原子上线；本 WP 只完成产品文案与页面归类（grep `codex` 清点为准）：`CreateGallery.tsx` 等处「仅 Codex 发起」→「通过 Agent 发起」，内部稳定 ID 可保留但不得展示旧称。
3. 内容详情页：SceneManifest 分镜清单展示（文案+提示词，确认前无图属正常态；确认动作提示将锁定分镜）；图片到达后逐镜显示；事件流 actor=agent 标识；「已发布」接 publications 证据表单。
4. e2e：起草/确认/出片/发布/设置保存用例必须绿。（设置页凭证适配已随 WP-0 上线，此处仅回归。）

## WP-5 · `agent_plugin/` MCP Server

- `server.py`（FastMCP stdio）+ `client.py`（httpx，`PIXELLE_API_BASE` 默认 `http://127.0.0.1:8000/api`；token 读取顺序 **`PIXELLE_AGENT_TOKEN` → `PIXELLE_AGENT_TOKEN_FILE` → `data/agent-token`**，Docker/异机场景靠前两者）+ `README.md`（Claude Code/Codex/Cursor 注册示例，含 token 配置）。与旧 `codex_plugin/` 并存至 WP-7。
- 薄壳；request_id 见 WP-1；错误脱敏（`{code, message}` 中文，不透传堆栈/路径）；列表 ≤50、长文本 500 字截断。
- **工具面（首批锁定，新增需评审）**：`get_capabilities`（第一工具）；只读 `list_projects / list_content_items / get_content_item / list_recipes / get_task`（结果端点 `GET /generation/tasks/{id}/result`）`/ list_batches / get_batch / get_operation`；写 `add_topics / draft_items`（返回 operation_ids）`/ submit_scene_manifest`（纯文案）`/ upload_scene_images`（按 scene_id，支持 replace）`/ produce_item / mark_published / record_metrics`。`list_recipes` 必须透出 capabilities 的 `agent_producible/unavailable_reason`，不能把 React 专用素材配方列成 Agent 可生产。
- **明确不做**：confirm 类、submit_batch、配方/项目/设置修改、发布直调、删除类、裸任务提交。
- 测试：①TestClient + 临时 data 目录真实闭环（含两阶段分镜时序与 403/400 矩阵）；②**MCP stdio 冒烟**（子进程起 server：initialize → list_tools → get_capabilities）。

## WP-6 · AGENTS.md（仓库根，≤200 行）

系统一句话；实体词典引用 models.py 与 capabilities（不手抄易腐清单，细节指向 `/docs`）；稳定铁律：白名单静默丢参、request_id 幂等、confirm 是人工闸门（后端 403）、**分镜两阶段（先文案确认后生图，别反）**、三态与 primary_video 可空、图集/长文自动发布 400、token 配置；MCP 注册；端到端示例（对运行中 API 实跑后落笔，含 codex_scene_video 两阶段全流程）。

## WP-7 · 切换与退役（最后 commit，前置全绿）

前置：WP-0~6 合入、§验收 1-2 通过、已装 MCP 客户端切至 `agent_plugin.server`。

1. 解依赖：`api/dependencies.py`、`generation_settings.py` 去 ops import（活功能最小内联，死代码连 router 清，选择记录）；**处置 `projects.py:_read_ops_seed`**（确认迁移已完成后删函数，或显式跑一次再删）。
2. 归档脚本 `scripts/archive_legacy_ops.py`：`--dry-run/--apply/--verify`；preflight = 无 ops import + **无 ops.db 运行时字符串引用**（grep 源码，docs 除外）+ `agent_plugin/` 存在 + token 已生成；verify = 归档在位、原位无残留。
3. 删 `codex_plugin/`、`ops/`；**测试清理以依赖搜索为准**（已知至少涉及 ops 系测试、`generation_settings_api_test.py`、配方注册/分层测试、前端 codex 断言；禁止硬编码清单）；Dockerfile `COPY ops`→`COPY agent_plugin`，打包清单同步。
4. 全仓 grep 零残留（docs 历史除外）；pytest 全绿；uvicorn 启动 + 控制台冒烟 + Docker 构建。

## 验收（产品所有者执行）

1. WP-5 后真实闭环：agent 经 topics 用例加 2 选题（created 事件 actor=agent）→ draft_items → 轮询 operation → **人**在控制台确认 → produce；另跑 codex_scene_video 完整两阶段：agent 对 **idea 条目**直接 submit_scene_manifest（纯文案）→ 条目自动出现在待确认（variant 已由 manifest 合成，无需再调 LLM 起草）→ 人在控制台看到分镜文案+提示词并确认（一次锁定 variant+manifest）→ agent 生图 upload_scene_images → 图齐 produce → get_task；**换一张图重产**：replace 单镜 → produce（produced 状态）→ 新旧两条片并存；mark_published（带证据）→ record_metrics。事件流 actor=agent 全程可溯。
2. 越权与时序矩阵：agent 调 confirm→403；idea 条目 produce→400；确认前传图→400；确认后改文案→400；图不齐 produce→400（含缺失 scene_id）；published 后替换图→400；已有草稿时提交不一致 manifest→409；不带 token 调 agent 配方→403；设置页只改音色保存后，原 LLM key 完好（掩码写回缺陷不存在）；旧 `codex_templates` 字段过渡期仍可读。
3. WP-7 后：归档脚本三步走通、旧目录删净、Docker 构建过、控制台与 MCP 双通道操作同一条目正常。

## 边界与开放项

不做：批准事件模型、配方写工具、Skills、MCP 限额、远程访问登录体系（均后批）；也不在首批为 I2V、动作迁移、数字人和任意素材型配方新增 Agent 文件摄取合同。API 缺口在 WP-2 范围内允许补，超范围停下评审。
