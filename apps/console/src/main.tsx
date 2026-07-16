import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { ToastProvider } from "@/components/ui/toast.tsx"
import { TaskCenterProvider } from "@/lib/taskCenter.tsx"

const ASSET_RELOAD_KEY = "pixelle:asset-reload-at"

// Vite 在页面仍开着、服务端已经换成新构建时会触发这个事件。
// 自动刷新一次以获取新的入口文件；短时间内再次失败则交给页面错误提示，避免刷新循环。
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault()
  const lastReloadAt = Number(sessionStorage.getItem(ASSET_RELOAD_KEY) ?? 0)
  if (Date.now() - lastReloadAt < 15_000) return
  sessionStorage.setItem(ASSET_RELOAD_KEY, String(Date.now()))
  window.location.reload()
})

window.setTimeout(() => sessionStorage.removeItem(ASSET_RELOAD_KEY), 15_000)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="pixelle-theme">
      <ToastProvider>
        <TaskCenterProvider>
          <App />
        </TaskCenterProvider>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>
)
