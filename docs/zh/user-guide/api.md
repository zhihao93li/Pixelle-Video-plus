# API 使用

正式产品能力通过 FastAPI 提供。启动服务后，交互式合同位于 `http://127.0.0.1:8000/docs`。

## 基本流程

1. 读取项目：`GET /api/projects`。
2. 读取可用配方：`GET /api/generation/templates?project=<project_id>`。
3. 通过配方提交单条任务或批次。
4. 轮询正式生成任务或批次状态。
5. 从任务结果读取产物，再进入作品和发布接口。

所有生成请求都必须携带真实项目身份，并经过生产配方编译。不要从客户端直接拼接内部 pipeline 参数。

## 状态处理

任务终态包括 `completed`、`failed`、`cancelled` 和 `interrupted`。服务重启会保留终态，并把未完成任务标记为 `interrupted`。客户端必须显示后端返回的错误，不得自行推断成功或反向修改内容生命周期。

完整路径和请求示例见 [API 概览](../reference/api-overview.md)。
