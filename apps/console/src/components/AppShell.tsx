import { useEffect, useRef, type MouseEvent, type ReactNode } from "react"
import {
  AlertCircle,
  Columns3,
  FolderOpen,
  Loader2,
  Moon,
  Plus,
  RefreshCcw,
  Settings,
  Sun,
  Video,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { ProjectScopeBoundary } from "@/components/shared/ProjectScopeBoundary"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTheme } from "@/components/theme-provider"
import { useCurrentProject } from "@/lib/currentProject"
import {
  isNavigationActive,
  navigate,
  PRIMARY_NAV_ROUTES,
  routeHref,
  type RouteId,
  type RouteLayout,
} from "@/lib/router"
import { settingsLink } from "@/lib/settingsLinks"
import { cn } from "@/lib/utils"

const MAIN_CONTENT_ID = "main-content"
const MANAGE_PROJECTS_VALUE = "__manage_projects__"

const NAV_ICONS: Partial<Record<RouteId, LucideIcon>> = {
  board: Columns3,
  create: Plus,
  library: FolderOpen,
  settings: Settings,
}

type ProjectState = ReturnType<typeof useCurrentProject>

function ProjectSwitcher({
  compact = false,
  state,
}: {
  compact?: boolean
  state: ProjectState
}) {
  const activeProjects = state.projects.filter(
    (project) => project.status === "active"
  )

  if (state.status === "idle" || state.status === "loading") {
    return (
      <div
        aria-live="polite"
        className={cn(
          "flex items-center gap-2 text-sm text-muted-foreground",
          compact ? "h-11 min-w-0 flex-1 px-2" : "px-3 py-2"
        )}
      >
        <Loader2 className="size-4 shrink-0 animate-spin" />
        <span className="truncate">正在读取内容空间</span>
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-destructive",
          compact ? "min-w-0 flex-1" : "mx-3 rounded-lg bg-destructive/10 p-3"
        )}
        role="status"
      >
        <AlertCircle className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs">
          内容空间加载失败
        </span>
        <Button
          aria-label="重新读取内容空间"
          className={cn(compact && "size-11")}
          onClick={() => void state.refresh()}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <RefreshCcw />
        </Button>
      </div>
    )
  }

  if (activeProjects.length === 0) {
    return (
      <a
        className={cn(
          "text-sm font-medium text-primary hover:underline",
          compact
            ? "flex h-11 min-w-0 flex-1 items-center px-2"
            : "mx-3 block rounded-lg border border-dashed p-3 text-center"
        )}
        href={routeHref(settingsLink({ kind: "projects" }))}
      >
        新建内容空间
      </a>
    )
  }

  const selected = activeProjects.find(
    (project) => project.project_id === state.projectId
  )
  const selectedProject = selected ?? activeProjects[0]

  return (
    <div className={cn(compact ? "min-w-0 flex-1" : "px-3 pb-3")}>
      <Select
        onValueChange={(value) => {
          if (value === MANAGE_PROJECTS_VALUE) {
            navigate(settingsLink({ kind: "projects" }))
            return
          }
          state.setProjectId(value)
        }}
        value={selectedProject.project_id}
      >
        <SelectTrigger
          aria-label={`切换内容空间，当前：${selectedProject.name}`}
          className={cn(
            "w-full",
            compact && "h-11 min-w-0 border-0 bg-muted/50"
          )}
          title={selectedProject.name}
        >
          <SelectValue placeholder="选择内容空间">
            {selectedProject.name}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {activeProjects.map((project) => (
              <SelectItem key={project.project_id} value={project.project_id}>
                <span className="flex flex-col gap-0.5">
                  <span>{project.name}</span>
                  <span className="text-xs text-muted-foreground">
                    内容、任务与作品空间
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectItem value={MANAGE_PROJECTS_VALUE}>管理内容空间…</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  return (
    <Button
      aria-label={isDark ? "切换到浅色模式" : "切换到深色模式"}
      className={cn(compact && "size-11")}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  )
}

function ProjectBoundary({
  children,
  projectScoped,
  state,
}: {
  children: ReactNode
  projectScoped: boolean
  state: ProjectState
}) {
  if (!projectScoped) {
    return children
  }

  const boundaryState =
    state.status === "idle" || state.status === "loading"
      ? "loading"
      : state.status === "error"
        ? "error"
        : state.project
          ? "ready"
          : "empty"

  return (
    <ProjectScopeBoundary
      className="mx-auto min-h-[45vh] w-full max-w-[var(--page-content-width)] px-4 lg:px-6"
      emptyDescription="创建一个内容空间后，才能开始组织内容、生成作品和发布。"
      emptyTitle="暂无可用内容空间"
      errorMessage={state.error || "暂时无法读取内容空间，请重试。"}
      onManageProjects={() => navigate(settingsLink({ kind: "projects" }))}
      onRetry={() => void state.refresh()}
      state={boundaryState}
    >
      {children}
    </ProjectScopeBoundary>
  )
}

function focusMainContent({ scroll }: { scroll: boolean }) {
  const target = document.getElementById(MAIN_CONTENT_ID)
  if (!target) {
    return
  }
  target.focus({ preventScroll: true })
  if (scroll) {
    target.scrollIntoView({ block: "start" })
  }
}

export function AppShell({
  path,
  title,
  layout,
  projectScoped,
  children,
}: {
  path: string
  title: string
  layout: RouteLayout
  projectScoped: boolean
  children: ReactNode
}) {
  const projectState = useCurrentProject()
  const previousPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (previousPathRef.current === null || previousPathRef.current === path) {
      previousPathRef.current = path
      return
    }
    previousPathRef.current = path
    const frame = window.requestAnimationFrame(() =>
      focusMainContent({ scroll: false })
    )
    return () => window.cancelAnimationFrame(frame)
  }, [path])

  function handleSkipLink(event: MouseEvent<HTMLAnchorElement>) {
    // hash 已用于路由，阻止浏览器把它替换成 #main-content。
    event.preventDefault()
    focusMainContent({ scroll: true })
  }

  return (
    <div className="flex min-h-svh bg-muted/30 text-foreground">
      <a
        className="fixed top-2 left-2 z-50 -translate-y-16 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground opacity-0 transition-[transform,opacity] duration-150 focus:translate-y-0 focus:opacity-100"
        href={`#${MAIN_CONTENT_ID}`}
        onClick={handleSkipLink}
      >
        跳到主要内容
      </a>

      <aside className="sticky top-0 hidden h-svh w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-[68px] items-center justify-between px-4">
          <div className="flex items-center gap-2 text-base font-semibold">
            <Video className="size-5 text-primary" />
            Pixelle
          </div>
          <ThemeToggle />
        </div>

        <ProjectSwitcher state={projectState} />

        <nav aria-label="主导航" className="flex flex-col gap-1 px-2">
          {PRIMARY_NAV_ROUTES.map((route) => {
            const active = isNavigationActive(path, route.nav.path)
            const Icon = NAV_ICONS[route.id]
            if (!Icon) {
              return null
            }
            return (
              <a
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
                href={routeHref(route.nav.path)}
                key={route.id}
              >
                <Icon className="size-4" />
                <span className="flex-1">{route.nav.label}</span>
              </a>
            )
          })}
        </nav>
      </aside>

      <div
        className="flex min-w-0 flex-1 flex-col pb-[calc(4.5rem+var(--safe-area-bottom))] lg:pb-0"
        data-layout={layout}
      >
        <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-sm">
          <div
            className="flex items-center gap-2 px-3 lg:hidden"
            style={{
              minHeight: "calc(3.5rem + var(--safe-area-top))",
              paddingInline: "max(0.75rem, var(--safe-area-inline))",
              paddingTop: "var(--safe-area-top)",
            }}
          >
            <a
              aria-label="Pixelle 工作台"
              className="flex shrink-0 items-center gap-1.5 text-sm font-semibold"
              href={routeHref("/board")}
            >
              <Video className="size-5 text-primary" />
              Pixelle
            </a>
            <ProjectSwitcher compact state={projectState} />
            <ThemeToggle compact />
          </div>
          <div className="mx-auto flex h-12 w-full max-w-[var(--page-content-width)] items-center px-4 lg:h-[68px] lg:px-6">
            <h1 className="text-base font-semibold" id="page-title">
              {title}
            </h1>
          </div>
        </header>

        <div
          aria-labelledby="page-title"
          className="min-w-0 flex-1 outline-none"
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
        >
          <ProjectBoundary
            key={
              projectScoped
                ? (projectState.projectId ?? "no-project")
                : "global"
            }
            projectScoped={projectScoped}
            state={projectState}
          >
            {children}
          </ProjectBoundary>
        </div>
      </div>

      <nav
        aria-label="主导航"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur-sm lg:hidden"
        style={{ paddingBottom: "var(--safe-area-bottom)" }}
      >
        <div
          className="grid grid-cols-5"
          style={{ paddingInline: "var(--safe-area-inline)" }}
        >
          {PRIMARY_NAV_ROUTES.map((route) => {
            const active = isNavigationActive(path, route.nav.path)
            const Icon = NAV_ICONS[route.id]
            if (!Icon) {
              return null
            }
            return (
              <a
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-xs font-medium transition-colors duration-150",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
                href={routeHref(route.nav.path)}
                key={route.id}
              >
                <span className="relative">
                  <Icon className="size-5" />
                </span>
                <span>{route.nav.label}</span>
              </a>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
