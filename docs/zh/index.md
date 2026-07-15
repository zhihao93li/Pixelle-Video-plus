# Pixelle

Pixelle 是面向单人内容运营的 AI 内容生产工作台。它在同一个项目作用域中连接内容台账、人工确认、生产任务、作品和发布，支持视频、图集和长文。

## 产品入口

- **工作台**：按“待你处理、进行中、异常、已产出”管理生产任务。
- **快速生产**：使用普通、素材或专用模板提交单条和批量任务。
- **任务**：查看一次生产运行、子任务、取消、失败和重试。
- **作品库**：预览视频、图集和长文，并进入发布流程。
- **设置**：管理项目、AI、语音、生成引擎、存储和模板。

## 快速开始

1. [安装后端与控制台](getting-started/installation.md)。
2. [配置项目和生产服务](getting-started/configuration.md)。
3. [启动服务并生成作品](getting-started/quick-start.md)。

正式控制台运行在 `http://127.0.0.1:5173`，FastAPI 文档默认运行在 `http://127.0.0.1:8000/docs`。

## 设计与工程边界

- 产品与数据所有权见[当前产品合同](product/current-product.md)。
- HTTP 合同见 [API 概览](reference/api-overview.md)。
- 系统分层见[架构设计](development/architecture.md)。

项目采用 Apache License 2.0。
