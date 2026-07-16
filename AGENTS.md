# Pixelle Agent Guide

Pixelle 是本机运行的 AI 内容工厂：Agent 负责提出内容和提交素材，Pixelle 负责持久化、人工确认、生成、发布证据与指标闭环。

## 事实源

- 内容条目、状态和分镜合同：`pixelle_video/content/models.py`
- 实时能力：启动 API 后读取 `GET /api/agent/capabilities`
- 用例接口：FastAPI 自动文档 `http://127.0.0.1:8000/docs`
- 产品现状：`docs/zh/product/current-product.md`
- MCP 接入：`agent_plugin/README.md`

不要复制一份容易过期的模板、管线或状态清单；运行时以 capabilities 和 API 返回为准。

## 能力真实性

- 前端、API 和文档必须如实反映 Pixelle 当前真实能力，不能为了凑交互而制造并不存在的抽象。
- 模型名称或品牌分类不等于 Provider。只有具备独立配置、凭据、调用路径和可验证响应的接入，才能作为 Provider 展示。
- 不得用名称猜测、静态映射、硬编码分组或占位数据冒充动态能力发现。Provider、模型、模板和管线目录必须来自各自的运行时事实源。
- 底层只有一个接入时就展示一个接入；需要多 Provider 交互时先建设真实 Provider 合同，再开放级联选择。
- 能力缺口必须明确报告。不得在展示层包装成“已经支持”，也不得用 fallback 掩盖尚未完成的核心能力。

## 稳定规则

1. 先调用 `get_capabilities`，再选择模板和产物类型。
2. 所有写操作都使用稳定的 `request_id`。一次逻辑调用及其网络重试必须复用同一个 ID；内容不同却复用 ID 会得到 409。
3. 模板只接受 `allowed_user_params ∩ Pipeline stages.setting_keys` 中的本次覆盖。未知输入或未授权覆盖会明确拒绝，不会静默透传。
4. `confirm` 是人工闸门，可以在 React 或受支持的 Agent 对话中完成。Agent 只有在展示 `get_pending_review` 返回的完整待确认对象、获得用户明确确认后，才能传入精确的 `review_id`、`content_version` 和 `explicit_user_confirmation=true`；模糊态度不能视为确认。
5. Agent 配图视频严格分两阶段：先提交纯文案分镜和图片提示词，等人确认；确认后才生成并上传图片。不要先花费图片生成资源。
6. `codex_scene_video` 不设默认分镜数和人为数量上限。根据文案转折、画面变化和节奏决定分镜，并在生图前让用户确认。
7. 生成结果可能是 `video`、`image_set` 或 `text`。`primary_video` 允许为空；读取完整 artifacts，不要只盯 MP4。
8. 图集与长文没有自动发布实现时，发布接口应明确失败，不能伪装成功。
9. Agent 认证读取顺序：`PIXELLE_AGENT_TOKEN` → `PIXELLE_AGENT_TOKEN_FILE` → `data/agent-token`。Token 只用于本机可信自动化；Pixelle 默认仅监听 `127.0.0.1`。
10. 不在消息、日志或提交中输出 Token、API Key、图片绝对路径或服务端堆栈。
11. 只对 capabilities 中 `agent_producible=true` 的模板调用 `start_production`。需要任意素材路径的 I2V、动作迁移、数字人和素材型模板首批仍从 React 快速生产发起，不能把文案伪装成素材输入。
12. 一条 Pipeline 只有一种输入和一条固定路线，不传 `entry / start_stage / skipped_stages`。`add_topics`、`draft_items` 和 `produce_item` 不再是正式生产入口。
13. 正式生产先建或绑定内容台账，再建立稳定 `production_task_id`。后续的人工确认、generation task、Provider job、失败重试和 artifacts 都关联这张任务卡。

## MCP 注册

```json
{
  "mcpServers": {
    "pixelle": {
      "command": "uv",
      "args": ["run", "python", "-m", "agent_plugin.server"],
      "cwd": "/absolute/path/to/pixlle",
      "env": {
        "PIXELLE_API_BASE": "http://127.0.0.1:8000/api"
      }
    }
  }
}
```

## 标准闭环

1. `get_capabilities`
2. 用户明确要求制作后，调用 `start_production(project_id, pipeline_id, recipe_id, input)` 一次性建立完整路线
3. 用 `list_production_tasks` 读取同一生产任务的当前站点
4. 需要确认时，用 `get_pending_review` 读取唯一待确认对象，展示完整 payload；用户明确确认后，带原样 `review_id` 和 `version` 调用 `confirm_pending_item`
5. 用户要修改时，用 `edit_pending_review` 直接保存，或用 `regenerate_pending_review` 重写/局部重做/整套重做；任何修改后都重新读取最新 `review_id` 和 `version` 再确认
6. 确认后原生产任务自动继续；用 `get_task` 读取底层最终 artifacts
7. 真实发布后 `mark_published`，必须带平台、时间和证据
8. 只有已发布内容才能用 `record_metrics` 写正式指标；测试数据必须 `mock=true` 且带 `mock_label`

Agent 配图视频把第 3–5 步替换为：

1. 用 `start_production` 提交纯文案分镜和图片提示词，建立稳定生产任务
2. 用户在 React 或 Agent 对话中确认完整分镜
3. Agent 生成图片后用 `upload_scene_images` 按 `scene_id` 上传
4. 图片齐全后 Pixelle 自动继续合成，不再调用第二次生产
5. 换单镜时仅在 `produced` 状态使用 `replace=true` 上传；Pixelle 自动生成新版本，旧图片和旧视频保留

任何步骤失败时先根据错误层级定位 input / config / credentials / network / API contract / permissions / persistence / runtime；不要通过跳过确认、伪造产物或吞掉异常让流程看起来成功。
