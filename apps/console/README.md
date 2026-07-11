# Pixelle Console

Pixelle 的正式 React 控制台。页面只消费 FastAPI 和前端 ViewModel，不在视图层解释后端内部状态或补造业务结果。

## 开发

先在仓库根目录启动 API：

```bash
uv run uvicorn api.app:app --host 127.0.0.1 --port 8000
```

再启动控制台：

```bash
cd apps/console
npm install
npm run dev
```

## 验证

```bash
npm run typecheck
npm run lint
npm run test:p1
npm run build
npm run test:e2e
```

## 代码边界

- `src/lib/router.ts` 是正式路由、标题、项目作用域和页面布局的唯一来源。
- `src/components/AppShell.tsx` 只负责全局导航、项目切换、主题与页面壳层。
- `src/components/shared` 存放跨页面产品组件。
- `src/components/ui` 存放基础 UI 原语。
- 页面通过 `src/lib` 中的 API、适配器和 ViewModel 访问业务数据。
- 视觉与交互规则以 [DESIGN.md](DESIGN.md) 为准。
