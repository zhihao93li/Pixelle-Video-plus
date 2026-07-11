import { useCallback, useEffect, useRef, useState } from "react"
import {
  Archive,
  FolderKanban,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Star,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
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
import { useToast } from "@/components/ui/toast"
import { InlineError } from "@/components/shared/feedback"
import { AsyncState } from "@/components/shared/AsyncState"
import { EmptyState } from "@/components/shared/EmptyState"
import { refreshProjects } from "@/lib/currentProject"
import { readableError } from "@/lib/format"
import { languageLabel } from "@/lib/languages"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"
import {
  archiveProject,
  createProject,
  listProjects,
  listTemplates,
  restoreProject,
  setDefaultProject,
  type Project,
  type ProductionTemplate,
} from "@/lib/generationApi"

const NONE = "__none__"
type LoadState = "loading" | "ready" | "error" | "stale"

/**
 * 项目卡片列表（设置页）：看概况、新建、设默认、归档/恢复。
 * 编辑进项目详情页 /settings/projects/:id（DESIGN.md §2.5：多分区编辑必须页面）。
 * 新建保持轻量 Sheet（3 个输入，合规），创建成功直接进详情页继续配置。
 */
export function ProjectsPanel() {
  const toast = useToast()
  const [projects, setProjects] = useState<Project[]>([])
  const [defaultId, setDefaultId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [isRefreshing, setIsRefreshing] = useState(true)
  const hasDataRef = useRef(false)
  const [busy, setBusy] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState("")
  const [createDescription, setCreateDescription] = useState("")
  const [copyFromId, setCopyFromId] = useState<string>(NONE)
  const [createError, setCreateError] = useState<string | null>(null)

  const refresh = useCallback(
    () =>
      Promise.all([listProjects(), listTemplates()])
        .then(([projectResponse, templateResponse]) => {
          setProjects(projectResponse.projects)
          setDefaultId(projectResponse.default_project_id)
          setTemplates(templateResponse.templates)
          setLoadError(null)
          hasDataRef.current = true
          setLoadState("ready")
        })
        .catch((error: unknown) => {
          setLoadError(readableError(error))
          setLoadState(hasDataRef.current ? "stale" : "error")
        })
        .finally(() => setIsRefreshing(false)),
    []
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  const templateName = (id: string | null) =>
    templates.find((template) => template.id === id)?.display_name ?? null
  async function refreshAll() {
    await refresh()
    await refreshProjects()
  }

  async function doCreate() {
    if (!createName.trim()) {
      setCreateError("请先给项目起个名字。")
      return
    }
    setBusy(true)
    setCreateError(null)
    try {
      const created = await createProject({
        name: createName.trim(),
        description: createDescription.trim(),
        copyFromProjectId: copyFromId === NONE ? undefined : copyFromId,
      })
      toast({
        title: "项目已创建",
        description: "接下来在详情页补充品牌与生产默认。",
        variant: "success",
      })
      setCreateOpen(false)
      setCreateName("")
      setCreateDescription("")
      setCopyFromId(NONE)
      await refreshAll()
      navigate(`/settings/projects/${created.project_id}`)
    } catch (error) {
      setCreateError(readableError(error))
    } finally {
      setBusy(false)
    }
  }

  async function makeDefault(projectId: string) {
    setBusy(true)
    try {
      await setDefaultProject(projectId)
      toast({ title: "已设为默认项目", variant: "success" })
      await refreshAll()
    } catch (error) {
      toast({
        title: "设置失败",
        description: readableError(error),
        variant: "error",
      })
    } finally {
      setBusy(false)
    }
  }

  async function doArchive(projectId: string) {
    setBusy(true)
    try {
      await archiveProject(projectId)
      toast({ title: "项目已归档", variant: "success" })
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
      toast({ title: "项目已恢复", variant: "success" })
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

  const activeProjects = projects.filter(
    (project) => project.status === "active"
  )
  const archivedProjects = projects.filter(
    (project) => project.status === "archived"
  )

  function renderCard(project: Project) {
    const isDefault = project.project_id === defaultId
    const isArchived = project.status === "archived"
    return (
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3",
          isDefault && "border-primary/40 bg-primary/5"
        )}
        key={project.project_id}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{project.name}</span>
            {isDefault && (
              <Badge variant="secondary">
                <Star data-icon="inline-start" />
                默认
              </Badge>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge variant="outline">
              配方：
              {templateName(project.default_production_template_id) ??
                "内置默认"}
            </Badge>
            <Badge variant="outline">
              {project.languages.map(languageLabel).join(" / ") || "无语言"}
            </Badge>
            <Badge variant="outline">
              发布平台 {project.publish_platforms.length}
            </Badge>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isArchived ? (
            <Button
              disabled={busy}
              onClick={() => void doRestore(project.project_id)}
              size="sm"
              variant="ghost"
            >
              <RotateCcw data-icon="inline-start" />
              恢复
            </Button>
          ) : (
            <>
              {!isDefault && (
                <Button
                  disabled={busy}
                  onClick={() => void makeDefault(project.project_id)}
                  size="sm"
                  variant="ghost"
                >
                  设为默认
                </Button>
              )}
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
                    aria-label="归档项目"
                    disabled={busy || isDefault}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Archive />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      归档「{project.name}」？
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      归档后从切换器隐藏，数据保留，可随时恢复。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => void doArchive(project.project_id)}
                    >
                      归档
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <section aria-labelledby="projects-heading" className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div>
          <h2 className="text-lg font-medium" id="projects-heading">
            项目
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            每个项目代表一个品牌或内容线，管理默认配方、语言音色与发布平台。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            aria-label="刷新项目"
            disabled={isRefreshing}
            onClick={() => {
              setIsRefreshing(true)
              void refresh()
            }}
            size="icon-sm"
            variant="outline"
          >
            <RefreshCw className={cn(isRefreshing && "animate-spin")} />
          </Button>
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <Plus data-icon="inline-start" />
            新建项目
          </Button>
        </div>
      </div>

      {loadState === "loading" ? (
        <AsyncState
          className="mt-5"
          description="正在同步项目与配方默认值。"
          state="loading"
          title="正在读取项目"
        />
      ) : null}
      {loadState === "error" ? (
        <AsyncState
          action={
            <Button
              onClick={() => {
                setIsRefreshing(true)
                void refresh()
              }}
              size="sm"
              variant="outline"
            >
              重试
            </Button>
          }
          className="mt-5"
          description={loadError}
          state="error"
          title="项目读取失败"
        />
      ) : null}
      {loadState === "stale" ? (
        <AsyncState
          action={
            <Button
              onClick={() => {
                setIsRefreshing(true)
                void refresh()
              }}
              size="sm"
              variant="outline"
            >
              重新读取
            </Button>
          }
          className="mt-5"
          description={loadError}
          state="stale"
          title="项目列表可能不是最新状态"
        />
      ) : null}

      {loadState === "ready" && projects.length === 0 ? (
        <EmptyState
          actions={
            <Button onClick={() => setCreateOpen(true)} size="sm">
              <Plus data-icon="inline-start" />
              新建项目
            </Button>
          }
          className="mt-5"
          description="创建第一个项目后，可以配置品牌专属的生产默认值。"
          icon={FolderKanban}
          title="还没有项目"
        />
      ) : null}

      {projects.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          {activeProjects.map(renderCard)}
          {archivedProjects.length > 0 ? (
            <>
              <div className="mt-3 border-b pb-2 text-xs font-medium text-muted-foreground">
                已归档
              </div>
              {archivedProjects.map(renderCard)}
            </>
          ) : null}
        </div>
      ) : null}

      {/* 新建项目（3 个输入，轻量 Sheet 合规；创建后直接进详情页） */}
      <Sheet onOpenChange={setCreateOpen} open={createOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>新建项目</SheetTitle>
            <SheetDescription className="text-left">
              创建后自动生成起草配置，进入详情页继续调整。
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">项目名称</span>
              <Input
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="例如：PetWoods 小红书"
                value={createName}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">
                描述（可选）
              </span>
              <Textarea
                onChange={(event) => setCreateDescription(event.target.value)}
                rows={2}
                value={createDescription}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">
                从现有项目复制默认值（可选）
              </span>
              <Select onValueChange={setCopyFromId} value={copyFromId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={NONE}>不复制</SelectItem>
                    {activeProjects.map((project) => (
                      <SelectItem
                        key={project.project_id}
                        value={project.project_id}
                      >
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
            {createError && (
              <InlineError title="创建失败" message={createError} />
            )}
          </div>
          <SheetFooter>
            <Button disabled={busy} onClick={() => void doCreate()}>
              {busy && (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              )}
              创建并进入配置
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  )
}
