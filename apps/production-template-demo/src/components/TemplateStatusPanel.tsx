import { useCallback, useEffect, useState } from "react"
import {
  Archive,
  ChevronRight,
  Copy,
  Loader2,
  SlidersHorizontal,
  Trash2,
} from "lucide-react"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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
import { Fact, InlineError } from "@/components/shared/feedback"
import { useExpertMode } from "@/lib/expertMode"
import { readableError } from "@/lib/format"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"
import {
  cloneProductionTemplate,
  deleteProductionTemplate,
  listProjects,
  listTemplates,
  setTemplateEnabled,
  type ProductionTemplate,
} from "@/lib/generationApi"
import {
  isDedicatedEntry as isDedicatedEntryTemplate,
  isRetiredTemplate,
  pipelineChipLabel,
} from "@/lib/templatePresentation"

/**
 * 模板与迁移状态（团队自查用）。
 * 面向用户的模板浏览在「快速生产」Gallery；这里保留工程视角的状态明细。
 */

type LoadState = "loading" | "ready" | "error"

function statusLabel(status: ProductionTemplate["migration_status"]) {
  const labels = {
    ready: "React 可提交",
    partial: "部分迁移",
    legacy_only: "Legacy only",
    planned: "计划中",
  }
  return labels[status]
}

function templateRoute(template: ProductionTemplate) {
  if (template.product_entry === "script_review") {
    return "/create/script-review"
  }
  if (template.product_entry !== "generate") {
    return `/create/special/${template.product_entry}`
  }
  return `/create/generate/${template.id}`
}

/** 从现有生产模板克隆一条自定义风格线（专家模式）。
 * id 自动生成（与 CreateGallery「新建配方」对齐，不再暴露内部「模板 ID」概念）。 */
function TemplateCloneSheet({
  template,
  onCloned,
}: {
  template: ProductionTemplate
  onCloned: () => void
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [displayName, setDisplayName] = useState("")
  const [description, setDescription] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openSheet() {
    setDisplayName(`${template.display_name} 副本`)
    setDescription(template.description)
    setError(null)
    setOpen(true)
  }

  const canSubmit = !isSaving && Boolean(displayName.trim())

  async function submit() {
    if (!canSubmit) {
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      await cloneProductionTemplate({
        sourceTemplateId: template.id,
        id: `my_${template.pipeline_id}_${Date.now().toString(36)}`,
        displayName: displayName.trim(),
        description: description.trim() || undefined,
      })
      toast({ title: "已克隆模板", variant: "success" })
      setOpen(false)
      onCloned()
    } catch (cloneError) {
      setError(readableError(cloneError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <Button onClick={openSheet} size="sm" variant="outline">
        <Copy data-icon="inline-start" />
        克隆
      </Button>
      <SheetContent className="flex flex-col gap-4">
        <SheetHeader>
          <SheetTitle>克隆生产模板</SheetTitle>
          <SheetDescription>
            以「{template.display_name}」为基础新建一条风格线；画面、声音等默认继承源模板，可在设置里调整默认配置。
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">模板名称</span>
            <Input
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="给这条风格线起个名字"
              value={displayName}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">描述（可选）</span>
            <Textarea
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              value={description}
            />
          </label>
          {error && <InlineError title="克隆失败" message={error} />}
        </div>

        <SheetFooter>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {isSaving ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Copy data-icon="inline-start" />
            )}
            保存克隆
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** 删除自定义模板（AlertDialog 确认）。 */
function TemplateDeleteButton({
  template,
  onDeleted,
}: {
  template: ProductionTemplate
  onDeleted: () => void
}) {
  const toast = useToast()
  const [isDeleting, setIsDeleting] = useState(false)

  async function remove() {
    setIsDeleting(true)
    try {
      await deleteProductionTemplate(template.id)
      toast({ title: "已删除自定义模板", variant: "success" })
      onDeleted()
    } catch (deleteError) {
      toast({
        title: "删除失败",
        description: readableError(deleteError),
        variant: "error",
      })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Trash2 data-icon="inline-start" />
          删除
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除这条自定义模板？</AlertDialogTitle>
          <AlertDialogDescription>
            删除后「{template.display_name}」会从所有列表消失，已用它生成的作品不受影响。此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={isDeleting}
            onClick={() => void remove()}
          >
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** 用户侧启用/停用开关。停用走确认；被项目默认引用时禁用并说明原因。 */
function TemplateEnabledControl({
  template,
  usedByProjects,
  onChanged,
}: {
  template: ProductionTemplate
  usedByProjects: string[]
  onChanged: () => void
}) {
  const toast = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const lockedByProject = template.enabled && usedByProjects.length > 0

  async function apply(next: boolean) {
    setIsSaving(true)
    try {
      await setTemplateEnabled(template.id, next)
      toast({ title: next ? "已启用模板" : "已停用模板", variant: "success" })
      setConfirmOpen(false)
      onChanged()
    } catch (toggleError) {
      toast({
        title: "操作失败",
        description: readableError(toggleError),
        variant: "error",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">
        {template.enabled ? "已启用" : "已停用"}
      </span>
      <Switch
        aria-label={template.enabled ? "停用模板" : "启用模板"}
        checked={template.enabled}
        disabled={isSaving || lockedByProject}
        onCheckedChange={(next) => {
          if (next) {
            void apply(true)
          } else {
            setConfirmOpen(true)
          }
        }}
        size="sm"
      />
      {lockedByProject && (
        <span className="text-xs text-muted-foreground">
          项目「{usedByProjects.join("、")}」正用它作默认，换默认后可停用
        </span>
      )}
      <AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>停用「{template.display_name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              停用后它不再出现在快速生产和各处模板选择里；已用它生成的作品与历史不受影响，随时可重新启用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={isSaving}
              onClick={() => void apply(false)}
            >
              停用
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** 已退役分组：只读、标注替代品（迁移说明）。 */
function RetiredTemplatesGroup({
  templates,
}: {
  templates: ProductionTemplate[]
}) {
  const [open, setOpen] = useState(false)
  if (templates.length === 0) {
    return null
  }
  return (
    <CollapsiblePrimitive.Root
      className="mt-5 rounded-lg border bg-muted/20"
      onOpenChange={setOpen}
      open={open}
    >
      <CollapsiblePrimitive.Trigger className="flex w-full items-center gap-1.5 px-4 py-3 text-sm font-medium">
        <ChevronRight
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
        <Archive className="size-3.5 text-muted-foreground" />
        已退役模板
        <Badge variant="outline">{templates.length}</Badge>
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          只读 · 历史作品不受影响
        </span>
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content>
        <div className="grid gap-3 border-t p-4 lg:grid-cols-2">
          {templates.map((template) => (
            <div
              className="scroll-mt-20 rounded-lg border bg-background/60 p-4"
              id={template.id}
              key={template.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-semibold text-muted-foreground">
                  {template.display_name}
                </div>
                <Badge variant="outline">已退役</Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {template.id}
              </div>
              {template.migration_notes && (
                <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm leading-6 text-muted-foreground">
                  {template.migration_notes}
                </div>
              )}
            </div>
          ))}
        </div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  )
}

export function TemplateStatusPanel() {
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [error, setError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [projectDefaults, setProjectDefaults] = useState<
    Record<string, string[]>
  >({})
  const expertMode = useExpertMode()

  const reload = useCallback(async () => {
    try {
      const [response, projectResponse] = await Promise.all([
        listTemplates(),
        listProjects(),
      ])
      setTemplates(response.templates)
      const usage: Record<string, string[]> = {}
      for (const project of projectResponse.projects) {
        const templateId = project.default_production_template_id
        if (templateId) {
          usage[templateId] = [...(usage[templateId] ?? []), project.name]
        }
      }
      setProjectDefaults(usage)
      setLoadState("ready")
    } catch (loadError) {
      setError(readableError(loadError))
      setLoadState("error")
    }
  }, [])

  useEffect(() => {
    async function initialLoad() {
      await reload()
    }
    void initialLoad()
  }, [reload])

  const readyCount = templates.filter((template) => template.enabled).length
  const legacyCount = templates.filter(
    (template) => template.migration_status === "legacy_only"
  ).length
  const plannedCount = templates.filter(
    (template) => template.migration_status === "planned"
  ).length
  const retiredTemplates = templates.filter(isRetiredTemplate)
  const visibleTemplates = templates.filter(
    (template) => !isRetiredTemplate(template)
  )

  return (
    <Card className="rounded-lg">
      <CardHeader className="border-b">
        <CardTitle>模板与迁移状态</CardTitle>
        <CardDescription>
          团队内部视角：各生产模板的入口、pipeline 与迁移进度。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loadState === "loading" && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在读取模板状态
          </div>
        )}

        {loadState === "error" && (
          <InlineError title="模板读取失败" message={error || "未知错误"} />
        )}

        {loadState === "ready" && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Fact label="React 可提交" value={`${readyCount} 个`} />
              <Fact label="Legacy only" value={`${legacyCount} 个`} />
              <Fact label="Planned" value={`${plannedCount} 个`} />
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              {visibleTemplates.map((template) => {
                const isDedicatedEntry = isDedicatedEntryTemplate(template)
                return (
                  <div
                    className="scroll-mt-20 rounded-lg border bg-background p-4"
                    id={template.id}
                    key={template.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">
                          {template.display_name}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {template.id}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {template.is_custom && (
                          <Badge variant="outline">自定义</Badge>
                        )}
                        <Badge
                          variant={
                            template.migration_status === "ready" ||
                            template.migration_status === "partial"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {statusLabel(template.migration_status)}
                        </Badge>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      {template.description}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {pipelineChipLabel(template.pipeline_id)}
                      </Badge>
                      {isDedicatedEntry && (
                        <Badge variant="secondary">专用入口</Badge>
                      )}
                      <Badge variant="outline">
                        输入：{template.input_requirements.join(", ")}
                      </Badge>
                      {expertMode && template.streamlit_source && (
                        <Badge variant="outline">
                          {template.streamlit_source}
                        </Badge>
                      )}
                    </div>
                    {!isDedicatedEntry && (
                      <div className="mt-3">
                        <TemplateEnabledControl
                          onChanged={() => void reload()}
                          template={template}
                          usedByProjects={projectDefaults[template.id] ?? []}
                        />
                      </div>
                    )}
                    {template.migration_notes && (
                      <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm leading-6 text-muted-foreground">
                        {template.migration_notes}
                      </div>
                    )}
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                      {template.enabled &&
                        template.product_entry === "generate" && (
                          <Button
                            onClick={() =>
                              navigate(`/create/recipes/${template.id}`)
                            }
                            size="sm"
                            variant="outline"
                          >
                            <SlidersHorizontal data-icon="inline-start" />
                            调参数
                          </Button>
                        )}
                      {expertMode && template.product_entry === "generate" && (
                        <TemplateCloneSheet
                          onCloned={() => void reload()}
                          template={template}
                        />
                      )}
                      {template.is_custom && (
                        <TemplateDeleteButton
                          onDeleted={() => void reload()}
                          template={template}
                        />
                      )}
                      <Button
                        onClick={() => navigate(templateRoute(template))}
                        variant="outline"
                      >
                        {isDedicatedEntry ? "打开专用入口" : "使用这个模板"}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>

            <RetiredTemplatesGroup templates={retiredTemplates} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
