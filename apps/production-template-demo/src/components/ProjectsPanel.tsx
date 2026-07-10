import { useCallback, useEffect, useState } from "react"
import { Archive, Loader2, Pencil, Plus, RotateCcw, Star } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
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
import { refreshProjects } from "@/lib/currentProject"
import { readableError } from "@/lib/format"
import { languageLabel } from "@/lib/languages"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"
import {
  archiveProject,
  createProject,
  listDraftingProfiles,
  listProjects,
  listTemplates,
  restoreProject,
  setDefaultProject,
  type DraftingProfile,
  type Project,
  type ProductionTemplate,
} from "@/lib/generationApi"

const NONE = "__none__"

/**
 * 项目卡片列表（设置页）：看概况、新建、设默认、归档/恢复。
 * 编辑进项目详情页 /settings/projects/:id（DESIGN.md §2.5：多分区编辑必须页面）。
 * 新建保持轻量 Sheet（3 个输入，合规），创建成功直接进详情页继续配置。
 */
export function ProjectsPanel() {
  const toast = useToast()
  const [projects, setProjects] = useState<Project[]>([])
  const [defaultId, setDefaultId] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<DraftingProfile[]>([])
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState("")
  const [createDescription, setCreateDescription] = useState("")
  const [copyFromId, setCopyFromId] = useState<string>(NONE)
  const [createError, setCreateError] = useState<string | null>(null)

  const refresh = useCallback(
    () =>
      Promise.all([listProjects(), listDraftingProfiles(), listTemplates()])
        .then(([projectResponse, profileResponse, templateResponse]) => {
          setProjects(projectResponse.projects)
          setDefaultId(projectResponse.default_project_id)
          setProfiles(profileResponse.profiles)
          setTemplates(templateResponse.templates)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(readableError(error)))
        .finally(() => setIsLoading(false)),
    []
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  const templateName = (id: string | null) =>
    templates.find((template) => template.id === id)?.display_name ?? null
  const profileForProject = (project: Project) =>
    profiles.find((profile) => profile.project_id === project.project_id) ?? null

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
        description: "起草配置已就绪，接下来在详情页继续配置。",
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
      toast({ title: "设置失败", description: readableError(error), variant: "error" })
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
      toast({ title: "归档失败", description: readableError(error), variant: "error" })
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
      toast({ title: "恢复失败", description: readableError(error), variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  const activeProjects = projects.filter((project) => project.status === "active")
  const archivedProjects = projects.filter(
    (project) => project.status === "archived"
  )

  function renderCard(project: Project) {
    const isDefault = project.project_id === defaultId
    const isArchived = project.status === "archived"
    const profile = profileForProject(project)
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
              起草：{profile?.script_template_name ?? "默认"}
            </Badge>
            <Badge variant="outline">
              模板：{templateName(project.default_production_template_id) ?? "内置默认"}
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
                onClick={() => navigate(`/settings/projects/${project.project_id}`)}
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
                    <AlertDialogTitle>归档「{project.name}」？</AlertDialogTitle>
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
    <div className="rounded-lg border bg-background p-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">项目</div>
        <Button onClick={() => setCreateOpen(true)} size="sm" variant="outline">
          <Plus data-icon="inline-start" />
          新建项目
        </Button>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        一个项目 = 一个品牌 / 内容线，管起草配置、默认模板、语言与音色、发布平台。
        点「编辑」进入项目详情页配置。
      </p>

      {loadError && <InlineError title="读取失败" message={loadError} />}

      {isLoading ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在读取项目
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {activeProjects.map(renderCard)}
          {archivedProjects.length > 0 && (
            <>
              <div className="mt-2 text-xs font-medium text-muted-foreground">
                已归档
              </div>
              {archivedProjects.map(renderCard)}
            </>
          )}
        </div>
      )}

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
              <span className="text-xs text-muted-foreground">描述（可选）</span>
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
                  <SelectItem value={NONE}>不复制</SelectItem>
                  {activeProjects.map((project) => (
                    <SelectItem key={project.project_id} value={project.project_id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {createError && <InlineError title="创建失败" message={createError} />}
          </div>
          <SheetFooter>
            <Button disabled={busy} onClick={() => void doCreate()}>
              {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
              创建并进入配置
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
