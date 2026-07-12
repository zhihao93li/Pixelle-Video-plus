# 安装

## 环境要求

- Python 3.11+
- Node.js 20.19+ 或 22.12+
- `uv`
- FFmpeg 与 FFprobe
- macOS、Linux 或 Windows

只有使用本地 ComfyUI 时才需要对应 GPU 和模型环境。

## 安装源码依赖

```bash
git clone https://github.com/zhihao93li/Pixelle-Video-plus.git
cd Pixelle-Video-plus
uv sync --extra dev
cd apps/console
npm install
```

复制示例配置：

```bash
cp config.example.yaml config.yaml
```

密钥和服务地址也可以在控制台的「设置」中填写。

## 验证安装

在仓库根目录运行：

```bash
uv run python -c "from api.app import app; print(app.title)"
uv run ffmpeg -version
```

在 `apps/console` 运行：

```bash
npm run typecheck
npm run build
```

完成后继续阅读[快速开始](quick-start.md)。

## 可选运行面

`web/app.py` 是冻结中的 legacy Streamlit 工具面，只用于迁移期排查。Windows
整合包和正式产品入口均使用 React 控制台；完成兼容验收后将删除旧工具面。
