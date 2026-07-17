import { useCallback, useEffect, useRef, useState } from "react"
import {
  Archive,
  FolderKanban,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { AsyncState } from "@/components/shared/AsyncState"
import { EmptyState } from "@/components/shared/EmptyState"
import { InlineError } from "@/components/shared/feedback"
import { refreshProjects } from "@/lib/currentProject"
import { readableError } from "@/lib/format"
import { navigate } from "@/lib/router"
import {
  archiveProject,
  createProject,
  listProjects,
  restoreProject,
  type Project,
} from "@/lib/generationApi"

type LoadState = "loading" | "ready" | "error" | "stale"

/** 内容空间只负责归属与筛选；生产默认统一由模板管理。 */
export function ProjectsPanel() {
  const toast = useToast()
  const [projects, setProjects] = useState<Project[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [isRefreshing, setIsRefreshing] = useState(true)
  const hasDataRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState("")
  const [createDescription, setCreateDescription] = useState("")
  const [createError, setCreateError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const response = await listProjects()
      setProjects(response.projects)
      setLoadError(null)
      hasDataRef.current = true
      setLoadState("ready")
    } catch (error) {
      setLoadError(readableError(error))
      setLoadState(hasDataRef.current ? "stale" : "error")
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    async function initialLoad() {
      await refresh()
    }
    void initialLoad()
  }, [refresh])

  async function refreshAll() {
    await refresh()
    await refreshProjects()
  }

  async function doCreate() {
    if (!createName.trim()) {
      setCreateError("请先给内容空间起个名字。")
      return
    }
    setBusy(true)
    setCreateError(null)
    try {
      const created = await createProject({
        name: createName.trim(),
        description: createDescription.trim(),
      })
      toast({
        title: "内容空间已创建",
        description: "之后的内容、任务和作品可以归入这个空间。",
        variant: "success",
      })
      setCreateOpen(false)
      setCreateName("")
      setCreateDescription("")
      await refreshAll()
      navigate(`/settings/projects/${created.project_id}`)
    } catch (error) {
      setCreateError(readableError(error))
    } finally {
      setBusy(false)
    }
  }

  async function doArchive(projectId: string) {
    setBusy(true)
    try {
      await archiveProject(projectId)
      toast({ title: "内容空间已归档", variant: "success" })
      await refreshAll()
    } catch (error) {
      toast({
        title: "归档失败",
        description: readableError(error),
        variant: "error",
      })
    } finally {
      setBusy(false)
    }
  }

  async function doRestore(projectId: string) {
    setBusy(true)
    try {
      await restoreProject(projectId)
      toast({ title: "内容空间已恢复", variant: "success" })
      await refreshAll()
    } catch (error) {
      toast({
        title: "恢复失败",
        description: readableError(error),
        variant: "error",
      })
    } finally {
      setBusy(false)
    }
  }

  const activeProjects = projects.filter((item) => item.status === "active")
  const archivedProjects = projects.filter(
    (item) => item.status === "archived"
  )

  function renderCard(project: Project) {
    const archived = project.status === "archived"
    return (
      <article
        className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4"
        key={project.project_id}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium">{project.name}</h3>
            {archived ? <Badge variant="outline">已归档</Badge> : null}
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
            {project.description || "用于归集一组相关的内容、任务和作品。"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {archived ? (
            <Button
              disabled={busy}
              onClick={() => void doRestore(project.project_id)}
              size="sm"
              variant="outline"
            >
              <RotateCcw data-icon="inline-start" />
              恢复
            </Button>
          ) : (
            <>
              <Button
                onClick={() =>
                  navigate(`/settings/projects/${project.project_id}`)
                }
                size="sm"
                variant="outline"
              >
                <Pencil data-icon="inline-start" />
                编辑
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    aria-label={`归档${project.name}`}
                    disabled={busy || activeProjects.length <= 1}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Archive />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>归档“{project.name}”？</AlertDialogTitle>
                    <AlertDialogDescription>
                      这个空间会从日常切换列表中隐藏，已有内容、任务和作品仍会保留，之后可以恢复。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => void doArchive(project.project_id)}
                    >
                      确认归档
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </article>
    )
  }

  return (
    <section aria-labelledby="projects-heading" className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div>
          <h2 className="text-lg font-medium" id="projects-heading">
            内容空间
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            用来区分不同账号、品牌或工作方向的内容、任务和作品。生产效果请在模板中管理。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            aria-label="刷新内容空间"
            disabled={isRefreshing}
            onClick={() => void refresh()}
            size="icon-sm"
            variant="outline"
          >
            <RefreshCw className={isRefreshing ? "animate-spin" : undefined} />
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            新建内容空间
          </Button>
        </div>
      </div>

      {loadState === "loading" ? (
        <AsyncState
          className="mt-5"
          description="正在读取内容空间。"
          state="loading"
          title="正在读取"
        />
      ) : null}
      {loadState === "error" ? (
        <AsyncState
          action={
            <Button onClick={() => void refresh()} variant="outline">
              重试
            </Button>
          }
          className="mt-5"
          description={loadError}
          state="error"
          title="内容空间读取失败"
        />
      ) : null}
      {loadState === "stale" ? (
        <div className="mt-5">
          <InlineError
            message={loadError || "刷新失败，当前仍显示上次读取的内容。"}
            title="刷新失败"
          />
        </div>
      ) : null}

      {loadState !== "loading" && loadState !== "error" ? (
        <div className="mt-5 space-y-6">
          {activeProjects.length > 0 ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {activeProjects.map(renderCard)}
            </div>
          ) : (
            <EmptyState
              actions={
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus data-icon="inline-start" />
                  新建内容空间
                </Button>
              }
              description="创建后，内容、任务和作品都会按空间归类。"
              icon={FolderKanban}
              title="还没有内容空间"
            />
          )}

          {archivedProjects.length > 0 ? (
            <div>
              <h3 className="mb-3 text-sm font-medium">已归档</h3>
              <div className="grid gap-3 xl:grid-cols-2">
                {archivedProjects.map(renderCard)}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <Sheet onOpenChange={setCreateOpen} open={createOpen}>
        <SheetContent className="flex flex-col">
          <SheetHeader>
            <SheetTitle>新建内容空间</SheetTitle>
            <SheetDescription>
              只需要一个容易识别的名字；生产模板在快速生产和模板管理中选择。
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-5 px-4">
            <label className="grid gap-2 text-sm font-medium">
              名称
              <Input
                autoFocus
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="例如：PetWoods 小红书"
                value={createName}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              说明（选填）
              <Textarea
                className="min-h-28"
                onChange={(event) => setCreateDescription(event.target.value)}
                placeholder="说明这个空间主要管理什么内容"
                value={createDescription}
              />
            </label>
            {createError ? (
              <InlineError message={createError} title="无法创建" />
            ) : null}
          </div>
          <SheetFooter>
            <Button
              disabled={busy}
              onClick={() => setCreateOpen(false)}
              variant="outline"
            >
              取消
            </Button>
            <Button disabled={busy} onClick={() => void doCreate()}>
              {busy ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <Plus data-icon="inline-start" />
              )}
              创建内容空间
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  )
}
