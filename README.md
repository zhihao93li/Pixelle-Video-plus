# Pixelle

Pixelle 是面向单人内容运营的 AI 内容生产工作台。它把选题、文案、生成、任务跟踪、作品管理和发布放在同一个项目作用域内，当前支持视频、图集和长文三种产物。

## 主要能力

- 项目与内容生命周期管理
- 普通视频、素材视频、图集、长文和批量生成
- 图生视频、动作迁移和数字人专用生成
- 多语言草稿审核与统一生产提交
- 任务进度、失败恢复和逐项重试
- 作品预览、发布准备与发布状态
- 项目、AI、语音、生成引擎、存储和配方设置

## 代码结构

| 目录 | 职责 |
| --- | --- |
| `apps/console` | React + Vite 正式控制台 |
| `api` | FastAPI 路由、请求合同和任务入口 |
| `pixelle_video` | 内容生成、生产模板、管线和媒体服务 |
| `ops` | 运营项目与状态持久化 |
| `codex_plugin` | Codex 操作接口 |
| `web` | 冻结中的 legacy Streamlit 界面，等待兼容验收后删除 |
| `tests` | Python 单元与集成测试 |

产品与架构边界见 [当前产品合同](docs/zh/product/current-product.md)，控制台设计与实现规范见 [DESIGN.md](apps/console/DESIGN.md)。

## 本地启动

需要 Python 3.11+、Node.js 20.19+ 或 22.12+、FFmpeg 和 `uv`。

安装后端依赖：

```bash
uv sync --extra dev
```

启动 API：

```bash
uv run uvicorn api.app:app --host 127.0.0.1 --port 8000
```

另开终端启动控制台：

```bash
cd apps/console
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。API 文档默认位于 `http://127.0.0.1:8000/docs`。

也可以构建控制台后以单进程方式启动正式产品：

```bash
./start_web.sh
```

`web/app.py` 只保留为迁移期 legacy 工具，不再承接新功能，也不应与 React
控制台同时修改配置。

## 验证

后端：

```bash
uv run pytest
uv run ruff check .
```

控制台：

```bash
cd apps/console
npm run typecheck
npm run lint
npm run test:p1
npm run build
npm run test:e2e
```

## 配置与文档

- 从 `config.example.yaml` 创建本地 `config.yaml`。
- 用户文档位于 `docs/zh` 和 `docs/en`。
- Windows 打包说明位于 `packaging/windows/README.md`。

## License

Apache License 2.0，详见 [LICENSE](LICENSE)。
