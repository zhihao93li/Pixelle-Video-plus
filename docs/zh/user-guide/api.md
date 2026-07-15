# API 使用

正式产品能力通过 FastAPI 提供。启动服务后，交互式合同位于 `http://127.0.0.1:8000/docs`。

## 基本流程

1. 读取项目：`GET /api/projects`。
2. 读取可用模板：`GET /api/generation/templates?project=<project_id>`。
3. 用 `POST /api/production-tasks` 提交单条生产，或用 `/api/generation/batches` 提交批次。
4. 轮询稳定生产任务、底层执行尝试或批次状态。
5. 从任务结果读取产物，再进入作品和发布接口。

所有正式生成请求都必须携带真实项目身份、Pipeline、模板和稳定 `request_id`，并经过生产模板编译。旧的直接生成写接口已删除，不再是 API 合同的一部分。

## 状态处理

任务终态包括 `completed`、`failed`、`cancelled` 和 `interrupted`。服务重启会保留终态，并把未完成任务标记为 `interrupted`。客户端必须显示后端返回的错误，不得自行推断成功或反向修改内容生命周期。

完整路径和请求示例见 [API 概览](../reference/api-overview.md)。
