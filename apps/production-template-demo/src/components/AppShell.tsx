import {
  Columns3,
  FolderOpen,
  ListChecks,
  Moon,
  Plus,
  Settings,
  Sun,
  Video,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTheme } from "@/components/theme-provider"
import { useCurrentProject } from "@/lib/currentProject"
import { languageLabel } from "@/lib/languages"
import { navigate } from "@/lib/router"
import { settingsLink } from "@/lib/settingsLinks"
import { useTaskCenter } from "@/lib/taskCenter"
import { cn } from "@/lib/utils"

const MANAGE_PROJECTS_VALUE = "__manage_projects__"

function ProjectSwitcher() {
  const { projectId, projects, setProjectId } = useCurrentProject()
  const active = projects.filter((project) => project.status === "active")
  if (active.length === 0) {
    return null
  }
  return (
    <div className="px-3 pb-3">
      <Select
        onValueChange={(value) => {
          if (value === MANAGE_PROJECTS_VALUE) {
            navigate(settingsLink({ kind: "projects" }))
            return
          }
          setProjectId(value)
        }}
        value={projectId ?? undefined}
      >
        <SelectTrigger aria-label="切换项目" className="w-full">
          <SelectValue placeholder="选择项目">
            {active.find((item) => item.project_id === projectId)?.name}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {active.map((project) => (
            <SelectItem key={project.project_id} value={project.project_id}>
              <span className="flex flex-col gap-0.5">
                <span>{project.name}</span>
                <span className="text-xs text-muted-foreground">
                  {project.languages.map(languageLabel).join(" / ") || "无语言"} ·{" "}
                  {project.publish_platforms.length} 平台
                </span>
              </span>
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={MANAGE_PROJECTS_VALUE}>管理项目…</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

const NAV_ITEMS = [
  { path: "/board", label: "工作台", icon: Columns3 },
  { path: "/create", label: "快速生产", icon: Plus },
  { path: "/tasks", label: "任务", icon: ListChecks },
  { path: "/library", label: "作品库", icon: FolderOpen },
  { path: "/settings", label: "设置", icon: Settings },
]

function isActive(path: string, itemPath: string) {
  const pathname = path.split("?")[0]
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`)
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  return (
    <Button
      aria-label={isDark ? "切换到浅色模式" : "切换到深色模式"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      size="icon-sm"
      variant="ghost"
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  )
}

export function AppShell({
  path,
  title,
  children,
}: {
  path: string
  title: string
  children: React.ReactNode
}) {
  const { runningCount } = useTaskCenter()

  return (
    <div className="flex min-h-svh bg-muted/30 text-foreground">
      <aside className="sticky top-0 hidden h-svh w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center justify-between px-4 py-5">
          <div className="flex items-center gap-2 text-base font-semibold">
            <Video className="size-5 text-primary" />
            Pixelle
          </div>
          <ThemeToggle />
        </div>
        <ProjectSwitcher />
        <nav aria-label="主导航" className="flex flex-col gap-1 px-2">
          {NAV_ITEMS.map((item) => {
            const active = isActive(path, item.path)
            return (
              <button
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
                key={item.path}
                onClick={() => navigate(item.path)}
                type="button"
              >
                <item.icon className="size-4" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.path === "/tasks" && runningCount > 0 && (
                  <Badge
                    className={cn(active && "bg-background text-foreground")}
                    variant="secondary"
                  >
                    {runningCount}
                  </Badge>
                )}
              </button>
            )
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b bg-background px-4 py-3 lg:px-6">
          {/* 全站容器左对齐（DESIGN.md §2.6）：标题与页面内容共享左缘，切页不跳位 */}
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-xl font-semibold">{title}</h1>
            <div className="lg:hidden">
              <ThemeToggle />
            </div>
            <nav
              aria-label="主导航"
              className="flex gap-1 overflow-x-auto lg:hidden"
            >
              {NAV_ITEMS.map((item) => {
                const active = isActive(path, item.path)
                return (
                  <button
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    type="button"
                  >
                    <item.icon className="size-4" />
                    {item.label}
                    {item.path === "/tasks" && runningCount > 0 && (
                      <span className="rounded-full bg-background/20 px-1.5 text-xs">
                        {runningCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </nav>
          </div>
        </header>
        {children}
      </div>
    </div>
  )
}
