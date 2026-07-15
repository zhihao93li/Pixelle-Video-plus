import { lazy, Suspense, useEffect, type ReactNode } from "react"
import { ArrowLeft, LoaderCircle } from "lucide-react"

import { AppShell } from "@/components/AppShell"
import { PageFrame } from "@/components/shared/PageFrame"
import { Button } from "@/components/ui/button"
import type { SpecialPipelineMode } from "@/components/SpecialPipelinesWorkspace"
import {
  resolveRoute,
  routeHref,
  usePath,
  type ResolvedRoute,
} from "@/lib/router"

const ContentItemDetailPage = lazy(() =>
  import("@/components/ContentItemDetailPage").then((module) => ({
    default: module.ContentItemDetailPage,
  }))
)
const CreateGallery = lazy(() =>
  import("@/components/CreateGallery").then((module) => ({
    default: module.CreateGallery,
  }))
)
const HistoryWorkspace = lazy(() =>
  import("@/components/HistoryWorkspace").then((module) => ({
    default: module.HistoryWorkspace,
  }))
)
const GenerateWorkspace = lazy(() =>
  import("@/components/ProductionStudio").then((module) => ({
    default: module.GenerateWorkspace,
  }))
)
const ProjectDetailPage = lazy(() =>
  import("@/components/ProjectDetailPage").then((module) => ({
    default: module.ProjectDetailPage,
  }))
)
const ProductionTaskDetailPage = lazy(() =>
  import("@/components/ProductionTaskDetailPage").then((module) => ({
    default: module.ProductionTaskDetailPage,
  }))
)
const RecipeDetailPage = lazy(() =>
  import("@/components/RecipeDetailPage").then((module) => ({
    default: module.RecipeDetailPage,
  }))
)
const SettingsWorkspace = lazy(() =>
  import("@/components/SettingsWorkspace").then((module) => ({
    default: module.SettingsWorkspace,
  }))
)
const SpecialPipelinesWorkspace = lazy(() =>
  import("@/components/SpecialPipelinesWorkspace").then((module) => ({
    default: module.SpecialPipelinesWorkspace,
  }))
)
const WorkbenchBoard = lazy(() =>
  import("@/components/WorkbenchBoard").then((module) => ({
    default: module.WorkbenchBoard,
  }))
)

export function App() {
  const path = usePath()
  const route = resolveRoute(path)

  useEffect(() => {
    document.title = `${route.title} · Pixelle`
  }, [route.title])

  return (
    <AppShell
      layout={route.layout}
      path={path}
      projectScoped={route.projectScoped}
      title={route.title}
    >
      <Suspense fallback={<RouteLoading />}>{renderRoute(route)}</Suspense>
    </AppShell>
  )
}

function renderRoute(route: ResolvedRoute): ReactNode {
  switch (route.id) {
    case "board":
      return <WorkbenchBoard />
    case "board-item":
      return (
        <ContentItemDetailPage
          itemId={route.params.itemId}
          key={route.params.itemId}
        />
      )
    case "board-task":
      return (
        <ProductionTaskDetailPage
          key={route.params.taskId}
          taskId={route.params.taskId}
        />
      )
    case "create":
      return <CreateGallery />
    case "create-generate":
      return (
        <GenerateWorkspace
          key={route.params.templateId}
          remakeTaskId={route.query.get("remake")}
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
  }
}

function RouteLoading() {
  return (
    <PageFrame
      aria-live="polite"
      className="flex min-h-[45vh] items-center justify-center gap-2 p-6 text-sm text-muted-foreground"
      role="status"
    >
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      正在加载页面…
    </PageFrame>
  )
}

function NotFoundPage({ pathname }: { pathname: string }) {
  return (
    <PageFrame className="min-h-[55vh] justify-center p-6">
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
    </PageFrame>
  )
}

export default App
