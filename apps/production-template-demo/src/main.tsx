import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { ToastProvider } from "@/components/ui/toast.tsx"
import { TaskCenterProvider } from "@/lib/taskCenter.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider
      defaultTheme="light"
      storageKey="pixelle-production-demo-theme"
    >
      <ToastProvider>
        <TaskCenterProvider>
          <App />
        </TaskCenterProvider>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>
)
