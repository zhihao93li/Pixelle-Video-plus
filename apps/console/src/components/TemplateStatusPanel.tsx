import { useCallback, useEffect, useRef, useState } from "react"
import {
  Copy,
  Loader2,
  PanelsTopLeft,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { AsyncState } from "@/components/shared/AsyncState"
import { EmptyState } from "@/components/shared/EmptyState"
import { Fact, InlineError, TechDetails } from "@/components/shared/feedback"
import { useExpertMode } from "@/lib/expertMode"
import { readableError } from "@/lib/format"
import { productionStartRoute } from "@/lib/productionSurface"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"
import {
  cloneProductionTemplate,
  deleteProductionTemplate,
  listTemplates,
  setTemplateEnabled,
  templatesForManagement,
  type ProductionTemplate,
} from "@/lib/generationApi"
import {
  isCodexOnlyTemplate,
  isSpecialPipelineTemplate,
  pipelineChipLabel,
} from "@/lib/templatePresentation"

/** 模板库存与可用性管理。 */

type LoadState = "loading" | "ready" | "error" | "stale"

/** 从现有生产模板克隆一条自定义风格线（专家模式）。
 * id 自动生成（与 CreateGallery「新建模板」对齐，不再暴露内部「模板 ID」概念）。 */
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
            {`以「${template.display_name}」为基础新建一条风格线；画面、声音等默认继承源模板，可在设置里调整默认配置。`}
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
            {`删除后「${template.display_name}」会从所有列表消失，已用它生成的作品不受影响。此操作不可撤销。`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
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

/** 用户侧启用/停用开关。停用前明确说明影响。 */
function TemplateEnabledControl({
  template,
  onChanged,
}: {
  template: ProductionTemplate
  onChanged: () => void
}) {
  const toast = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const codexOnly = isCodexOnlyTemplate(template)

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
        disabled={isSaving}
        onCheckedChange={(next) => {
          if (next) {
            void apply(true)
          } else {
            setConfirmOpen(true)
          }
        }}
        size="sm"
      />
      <AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              停用「{template.display_name}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              {codexOnly
                ? "停用后 Agent 将不再使用这份模板；已生成的作品与历史不受影响，随时可重新启用。"
                : "停用后它不再出现在快速生产和各处模板选择里；已用它生成的作品与历史不受影响，随时可重新启用。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
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

export function TemplateStatusPanel() {
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [error, setError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [isRefreshing, setIsRefreshing] = useState(true)
  const hasDataRef = useRef(false)
  const expertMode = useExpertMode()

  const reload = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const response = await listTemplates()
      setTemplates(templatesForManagement(response))
      setError(null)
      hasDataRef.current = true
      setLoadState("ready")
    } catch (loadError) {
      setError(readableError(loadError))
      setLoadState(hasDataRef.current ? "stale" : "error")
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    async function initialLoad() {
      await reload()
    }
    void initialLoad()
  }, [reload])

  const readyCount = templates.filter((template) => template.enabled).length
  const unavailableCount = templates.filter(
    (template) => !template.enabled
  ).length

  return (
    <section aria-labelledby="recipes-heading" className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div>
          <h2 className="text-lg font-medium" id="recipes-heading">
            模板管理
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            启用、停用或克隆生产模板，管理长期生产效果。
          </p>
        </div>
        <Button
          aria-label="刷新模板"
          disabled={isRefreshing}
          onClick={() => {
            setIsRefreshing(true)
            void reload()
          }}
          size="icon-sm"
          variant="outline"
        >
          <RefreshCw className={cn(isRefreshing && "animate-spin")} />
        </Button>
      </div>

      {loadState === "loading" ? (
        <AsyncState
          className="mt-5"
          description="正在同步模板状态。"
          state="loading"
          title="正在读取模板"
        />
      ) : null}
      {loadState === "error" ? (
        <AsyncState
          action={
            <Button
              onClick={() => {
                setIsRefreshing(true)
                void reload()
              }}
              size="sm"
              variant="outline"
            >
              重试
            </Button>
          }
          className="mt-5"
          description={error}
          state="error"
          title="模板读取失败"
        />
      ) : null}
      {loadState === "stale" ? (
        <AsyncState
          action={
            <Button
              onClick={() => {
                setIsRefreshing(true)
                void reload()
              }}
              size="sm"
              variant="outline"
            >
              重新读取
            </Button>
          }
          className="mt-5"
          description={error}
          state="stale"
          title="模板列表可能不是最新状态"
        />
      ) : null}

      {(loadState === "ready" || loadState === "stale") &&
      templates.length === 0 ? (
        <EmptyState
          className="mt-5"
          description="当前服务没有返回可用模板。"
          icon={PanelsTopLeft}
          title="暂无模板"
        />
      ) : null}

      {templates.length > 0 ? (
        <>
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3 border-b pb-4">
            <Fact label="可用模板" value={`${readyCount} 个`} />
            <Fact label="暂不可用" value={`${unavailableCount} 个`} />
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {templates.map((template) => {
              const isSpecialPipeline = isSpecialPipelineTemplate(template)
              const codexOnly = isCodexOnlyTemplate(template)
              return (
                <div
                  className="scroll-mt-20 rounded-lg border bg-background p-4"
                  id={template.id}
                  key={template.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {template.display_name}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {template.is_custom && (
                        <Badge variant="outline">自定义</Badge>
                      )}
                      {codexOnly ? (
                        <Badge variant="info">仅 Agent 发起</Badge>
                      ) : null}
                      <Badge variant={template.enabled ? "secondary" : "outline"}>
                        {template.enabled ? "可用" : "已停用"}
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
                    {isSpecialPipeline && (
                      <Badge variant="secondary">专用表单</Badge>
                    )}
                  </div>
                  {expertMode ? (
                    <TechDetails
                      items={[
                        { label: "模板 ID", value: template.id },
                        {
                          label: "输入字段",
                          value: template.input_requirements.join(", "),
                        },
                      ]}
                    />
                  ) : null}
                  {!isSpecialPipeline && (
                    <div className="mt-3">
                      <TemplateEnabledControl
                        onChanged={() => void reload()}
                        template={template}
                      />
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                    {template.enabled && (
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
                    {expertMode && (
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
                    {!codexOnly ? (
                      <Button
                        onClick={() => navigate(productionStartRoute(template))}
                        variant="outline"
                      >
                        {isSpecialPipeline ? "打开专用表单" : "使用这套模板"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : null}
    </section>
  )
}
