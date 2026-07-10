import { useEffect, type ReactNode } from "react"
import { ArrowLeft } from "lucide-react"

import { AppShell } from "@/components/AppShell"
import { ContentItemDetailPage } from "@/components/ContentItemDetailPage"
import { CreateGallery } from "@/components/CreateGallery"
import { HighFidelityGenerationDemo } from "@/components/HighFidelityGenerationDemo"
import { HistoryWorkspace } from "@/components/HistoryWorkspace"
import { GenerateWorkspace } from "@/components/ProductionStudio"
import { ProjectDetailPage } from "@/components/ProjectDetailPage"
import { RecipeDetailPage } from "@/components/RecipeDetailPage"
import { ScriptReviewWorkspace } from "@/components/ScriptReviewWorkspace"
import { SettingsWorkspace } from "@/components/SettingsWorkspace"
import {
  SpecialPipelinesWorkspace,
  type SpecialPipelineMode,
} from "@/components/SpecialPipelinesWorkspace"
import { TaskCenterWorkspace } from "@/components/TaskCenterWorkspace"
import { Button } from "@/components/ui/button"
import { WorkbenchBoard } from "@/components/WorkbenchBoard"
import {
  navigate,
  resolveRoute,
  routeHref,
  usePath,
  type ResolvedRoute,
} from "@/lib/router"

export function App() {
  const path = usePath()
  const route = resolveRoute(path)

  useEffect(() => {
    document.title = `${route.title} · Pixelle`
  }, [route.title])

  // 改版验收期保留独立 Demo；正式产品页面全部只经过下方单一 AppShell。
  if (route.id === "demo-studio") {
    return <HighFidelityGenerationDemo />
  }

  return (
    <AppShell
      layout={route.layout}
      path={path}
      projectScoped={route.projectScoped}
      title={route.title}
    >
      {renderRoute(route)}
    </AppShell>
  )
}

function renderRoute(route: ResolvedRoute): ReactNode {
  switch (route.id) {
    case "legacy-batch":
    case "create-legacy-batch":
      return <RedirectTo path="/create" />
    case "board":
      return <WorkbenchBoard />
    case "board-item":
      return (
        <ContentItemDetailPage
          itemId={route.params.itemId}
          key={route.params.itemId}
        />
      )
    case "create":
      return <CreateGallery />
    case "create-generate":
      return (
        <GenerateWorkspace
          key={route.params.templateId}
          templateId={route.params.templateId}
        />
      )
    case "create-recipe":
      return (
        <RecipeDetailPage
          key={route.params.templateId}
          templateId={route.params.templateId}
        />
      )
    case "create-special":
      return (
        <SpecialPipelinesWorkspace
          initialMode={route.params.mode as SpecialPipelineMode}
          key={`${route.params.mode}:${route.params.templateId ?? "default"}`}
          templateId={route.params.templateId}
        />
      )
    case "create-script-review":
      return <ScriptReviewWorkspace />
    case "tasks":
      return <TaskCenterWorkspace />
    case "library":
      return (
        <HistoryWorkspace
          key={route.query.get("task") ?? "library"}
          latestTaskId={route.query.get("task")}
        />
      )
    case "settings":
      return <SettingsWorkspace />
    case "settings-project":
      return (
        <ProjectDetailPage
          key={route.params.projectId}
          projectId={route.params.projectId}
        />
      )
    case "not-found":
      return <NotFoundPage pathname={route.pathname} />
    case "demo-studio":
      return null
  }
}

function NotFoundPage({ pathname }: { pathname: string }) {
  return (
    <main className="flex min-h-[55vh] max-w-[1240px] items-center p-6">
      <div className="max-w-lg">
        <div className="text-sm font-medium text-primary">404</div>
        <h2 className="mt-2 text-lg font-medium">页面不存在</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          没有找到「{pathname}」。链接可能已失效，或页面已经移动。
        </p>
        <Button asChild className="mt-5">
          <a href={routeHref("/create")}>
            <ArrowLeft data-icon="inline-start" />
            返回快速生产
          </a>
        </Button>
      </div>
    </main>
  )
}

/** hash 路由下挂载即跳转，保留旧书签。 */
function RedirectTo({ path }: { path: string }) {
  useEffect(() => {
    navigate(path)
  }, [path])

  return (
    <main
      aria-live="polite"
      className="max-w-[1240px] p-4 text-sm text-muted-foreground lg:p-6"
    >
      正在前往快速生产…
    </main>
  )
}

export default App
