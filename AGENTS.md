# Pixelle Agent Guide

Pixelle 是本机运行的 AI 内容工厂：Agent 负责提出内容和提交素材，Pixelle 负责持久化、人工确认、生成、发布证据与指标闭环。

## 事实源

- 内容条目、状态和分镜合同：`pixelle_video/content/models.py`
- 实时能力：启动 API 后读取 `GET /api/agent/capabilities`
- 用例接口：FastAPI 自动文档 `http://127.0.0.1:8000/docs`
- 产品现状：`docs/zh/product/current-product.md`
- MCP 接入：`agent_plugin/README.md`

不要复制一份容易过期的配方、管线或状态清单；运行时以 capabilities 和 API 返回为准。

## 稳定规则

1. 先调用 `get_capabilities`，再选择配方和产物类型。
2. 所有写操作都使用稳定的 `request_id`。一次逻辑调用及其网络重试必须复用同一个 ID；内容不同却复用 ID 会得到 409。
3. 配方只接受 `allowed_user_params` 中的覆盖项，其他参数会被静默丢弃。不要假设任意参数会透传。
4. `confirm` 是人工闸门。Agent Token 调确认接口必定 403；应停止并请用户在 React 控制台确认。
5. Agent 配图视频严格分两阶段：先提交纯文案分镜和图片提示词，等人确认；确认后才生成并上传图片。不要先花费图片生成资源。
6. `codex_scene_video` 不设默认分镜数。根据文案转折、画面变化和节奏提出 1–20 个分镜，并在生图前让用户确认。
7. 生成结果可能是 `video`、`image_set` 或 `text`。`primary_video` 允许为空；读取完整 artifacts，不要只盯 MP4。
8. 图集与长文没有自动发布实现时，发布接口应明确失败，不能伪装成功。
9. Agent 认证读取顺序：`PIXELLE_AGENT_TOKEN` → `PIXELLE_AGENT_TOKEN_FILE` → `data/agent-token`。Token 只用于本机可信自动化；Pixelle 默认仅监听 `127.0.0.1`。
10. 不在消息、日志或提交中输出 Token、API Key、图片绝对路径或服务端堆栈。
11. 只对 capabilities 中 `agent_producible=true` 的配方调用 `produce_item`。需要任意素材路径的 I2V、动作迁移、数字人和素材型配方首批仍从 React 快速生成发起，不能把文案伪装成素材输入。

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
2. `add_topics`，保存返回的 `item_id`
3. 普通内容用 `draft_items` 并轮询 `get_operation`
4. 用户在控制台确认
5. `produce_item`，再用 `get_task` 读取最终 artifacts
6. 真实发布后 `mark_published`，必须带平台、时间和证据
7. 只有已发布内容才能用 `record_metrics` 写正式指标；测试数据必须 `mock=true` 且带 `mock_label`

Agent 配图视频把第 3–5 步替换为：

1. `submit_scene_manifest` 提交 1–20 个纯文案分镜
2. 用户在控制台确认完整分镜
3. Agent 生成图片后用 `upload_scene_images` 按 `scene_id` 上传
4. 图片齐全后 `produce_item(recipe_id="codex_image_story_v1")`
5. 换单镜时仅在 `produced` 状态使用 `replace=true` 上传，再次生产；旧任务和旧视频保留

任何步骤失败时先根据错误层级定位 input / config / credentials / network / API contract / permissions / persistence / runtime；不要通过跳过确认、伪造产物或吞掉异常让流程看起来成功。
