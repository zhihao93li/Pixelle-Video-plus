import { useEffect, useState, type FormEvent } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Loader2,
  Lock,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
} from "lucide-react"

import { AsyncState } from "@/components/shared/AsyncState"
import { EmptyState } from "@/components/shared/EmptyState"
import { FrameTemplatePicker } from "@/components/shared/FrameTemplatePicker"
import { InlineError } from "@/components/shared/feedback"
import { PageFrame } from "@/components/shared/PageFrame"
import { WorkspaceHeader } from "@/components/shared/WorkspaceHeader"
import { WorkspacePanel } from "@/components/shared/WorkspacePanel"
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
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { useExpertMode } from "@/lib/expertMode"
import { readableError } from "@/lib/format"
import {
  cloneProductionTemplate,
  getTemplateGenerationConfig,
  listProjects,
  listResourceTemplates,
  listTemplates,
  updateTemplateGenerationConfig,
  type ProductionTemplate,
  type ResourceTemplate,
} from "@/lib/generationApi"
import {
  humanizePartValue,
  PART_EDIT_HINTS,
  PART_EDIT_OPTIONS,
  PART_KEY_LABELS,
  PART_LONG_TEXT_KEYS,
  PART_NUMBER_KEYS,
  PIPELINE_PARTS,
} from "@/lib/pipelineParts"
import {
  productionArtifactSummary,
  productionDescription,
  productionInputSummary,
  productionLineSummary,
  productionStartRoute,
  productionSubmissionSummary,
} from "@/lib/productionSurface"
import { navigate, routeHref } from "@/lib/router"
import { settingsLink } from "@/lib/settingsLinks"
import { cn } from "@/lib/utils"

/**
 * 配方详情页只管理“以后用这份配方时”的默认值。单次生产覆盖仍留在制作页，
 * 项目级写稿设置仍留在项目设置，避免三层配置在同一页争夺控制权。
 */

const EXPERT_ONLY_KEYS = new Set([
  "bgm_path",
  "compose_runtime",
  "image_prompt_generation_rules",
  "image_prompt_visual_context",
  "llm_model",
  "media_workflow",
  "prompt_prefix",
  "source",
  "tts_inference_mode",
  "tts_workflow",
  "workflow_key",
])

function friendlyCopy(value: string) {
  return value
    .replaceAll("workflow", "生成流程")
    .replaceAll("Workflow", "生成流程")
    .replaceAll("算力", "执行位置")
    .replaceAll("RunningHub 云端", "云端执行")
    .replaceAll("本机 ComfyUI", "本地执行")
}

export function RecipeDetailPage({ templateId }: { templateId: string }) {
  const toast = useToast()
  const expertMode = useExpertMode()
  const [template, setTemplate] = useState<ProductionTemplate | null>(null)
  const [projectUsers, setProjectUsers] = useState<string[]>([])
  const [resolvedTemplateId, setResolvedTemplateId] = useState<string | null>(
    null
  )
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pageReloadToken, setPageReloadToken] = useState(0)

  const [isLoading, setIsLoading] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const [configReloadToken, setConfigReloadToken] = useState(0)
  const [overridableKeys, setOverridableKeys] = useState<string[]>([])
  const [effectiveParams, setEffectiveParams] = useState<
    Record<string, unknown>
  >({})
  const [overrides, setOverrides] = useState<Record<string, unknown>>({})
  const [hasLoaded, setHasLoaded] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [editError, setEditError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [frameTemplates, setFrameTemplates] = useState<ResourceTemplate[]>([])

  useEffect(() => {
    let cancelled = false
    void listResourceTemplates()
      .then((response) => {
        if (!cancelled) {
          setFrameTemplates(response.templates)
        }
      })
      .catch(() => {
        // 预览资源不可用时仍可用文本方式编辑，不阻断配方主流程。
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([listTemplates(), listProjects()])
      .then(([templateResponse, projectResponse]) => {
        if (cancelled) {
          return
        }
        const found =
          templateResponse.templates.find((item) => item.id === templateId) ??
          null
        setResolvedTemplateId(templateId)
        setTemplate(found)
        setNotFound(!found)
        setLoadError(null)
        setProjectUsers(
          projectResponse.projects
            .filter(
              (project) => project.default_production_template_id === templateId
            )
            .map((project) => project.name)
        )
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResolvedTemplateId(templateId)
          setTemplate(null)
          setNotFound(false)
          setLoadError(readableError(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [pageReloadToken, templateId])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setHasLoaded(false)
      setConfigError(null)
      setEditingKey(null)
      setEditError(null)
      try {
        const config = await getTemplateGenerationConfig(templateId)
        if (!cancelled) {
          setOverridableKeys(config.overridable_keys)
          setEffectiveParams(config.effective_params)
          setOverrides(config.overrides)
          setHasLoaded(true)
        }
      } catch (error) {
        if (!cancelled) {
          setConfigError(readableError(error))
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [configReloadToken, templateId])

  const steps = template ? (PIPELINE_PARTS[template.pipeline_id] ?? []) : []
  const coveredKeys = new Set([
    ...steps.map((step) => step.controlKey).filter(Boolean),
    ...steps.flatMap((step) => step.subKeys || []),
  ])
  const extraKeys = overridableKeys.filter(
    (key) => !coveredKeys.has(key) && (expertMode || !EXPERT_ONLY_KEYS.has(key))
  )

  function parameterLabel(key: string) {
    const label = PART_KEY_LABELS[key] ?? key
    return expertMode ? label : friendlyCopy(label)
  }

  function partLabel(label: string) {
    return expertMode ? label : friendlyCopy(label)
  }

  function partValue(key: string | null, fallback: string) {
    if (!expertMode && key && EXPERT_ONLY_KEYS.has(key)) {
      return friendlyCopy(fallback)
    }
    const current = key ? effectiveParams[key] : undefined
    if (key === "bgm_volume" && Number.isFinite(Number(current))) {
      return `${Math.round(Number(current) * 100)}%`
    }
    if (key === "tts_speed" && Number.isFinite(Number(current))) {
      return `${Number(current).toFixed(1)}x`
    }
    if (key === "word_count" && Number.isFinite(Number(current))) {
      return `${Number(current)} 字`
    }
    if (
      (key === "media_width" || key === "media_height") &&
      Number.isFinite(Number(current))
    ) {
      return `${Number(current)} px`
    }
    return friendlyCopy(humanizePartValue(current, fallback))
  }

  function startEdit(key: string) {
    setEditingKey(key)
    setEditError(null)
    const current = overrides[key] ?? effectiveParams[key]
    setEditValue(current == null ? "" : String(current))
  }

  function cancelEdit() {
    setEditingKey(null)
    setEditError(null)
  }

  function retryPageLoad() {
    setResolvedTemplateId(null)
    setTemplate(null)
    setNotFound(false)
    setLoadError(null)
    setPageReloadToken((value) => value + 1)
  }

  async function savePart(key: string, rawValue: string | null) {
    const normalized = rawValue?.trim() ?? null
    if (
      normalized &&
      PART_NUMBER_KEYS.has(key) &&
      !Number.isFinite(Number(normalized))
    ) {
      setEditError("请输入有效数字。")
      return
    }

    setIsSaving(true)
    setEditError(null)
    try {
      const next: Record<string, unknown> = { ...overrides }
      if (!normalized) {
        delete next[key]
      } else {
        next[key] = PART_NUMBER_KEYS.has(key) ? Number(normalized) : normalized
      }
      const config = await updateTemplateGenerationConfig(templateId, next)
      setEffectiveParams(config.effective_params)
      setOverrides(config.overrides)
      setEditingKey(null)
      toast({
        title: rawValue === null ? "已恢复配方默认" : "默认设置已保存",
        description: "下次使用这份配方时自动生效。",
        variant: "success",
      })
    } catch (error) {
      setEditError(readableError(error))
    } finally {
      setIsSaving(false)
    }
  }

  function renderEditor(key: string) {
    const options = PART_EDIT_OPTIONS[key]
    const hint =
      !expertMode && key === "tts_voice"
        ? "填写已在项目中配置的音色名称。"
        : PART_EDIT_HINTS[key]
    const isLongText = PART_LONG_TEXT_KEYS.has(key)
    const isFramePicker = key === "frame_template" && frameTemplates.length > 0
    return (
      <div className="mt-3 rounded-lg bg-muted/35 p-3">
        {hint ? (
          <p className="mb-2 text-xs leading-5 text-muted-foreground">{hint}</p>
        ) : null}
        {isLongText ? (
          <Textarea
            aria-label={parameterLabel(key)}
            className="min-h-40 bg-background font-mono text-xs"
            onChange={(event) => setEditValue(event.target.value)}
            value={editValue}
          />
        ) : null}
        {isFramePicker ? (
          <FrameTemplatePicker
            onChange={setEditValue}
            templates={frameTemplates}
            value={editValue}
          />
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {options ? (
            <Select onValueChange={setEditValue} value={editValue || undefined}>
              <SelectTrigger
                aria-label={parameterLabel(key)}
                className="min-h-11 w-full bg-background sm:min-h-8 sm:w-64"
              >
                <SelectValue placeholder="选择一个默认值" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {expertMode ? option.label : friendlyCopy(option.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : isLongText || isFramePicker ? null : (
            <Input
              aria-label={parameterLabel(key)}
              className="min-h-11 w-full bg-background sm:min-h-8 sm:w-64"
              onChange={(event) => setEditValue(event.target.value)}
              type={PART_NUMBER_KEYS.has(key) ? "number" : "text"}
              value={editValue}
            />
          )}
          <Button
            className="min-h-11 sm:min-h-8"
            disabled={isSaving || !editValue.trim()}
            onClick={() => void savePart(key, editValue)}
            type="button"
          >
            {isSaving ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : null}
            保存
          </Button>
          <Button
            className="min-h-11 sm:min-h-8"
            disabled={isSaving}
            onClick={cancelEdit}
            type="button"
            variant="ghost"
          >
            取消
          </Button>
          {key in overrides ? (
            <Button
              className="min-h-11 sm:min-h-8"
              disabled={isSaving}
              onClick={() => void savePart(key, null)}
              type="button"
              variant="ghost"
            >
              <RotateCcw data-icon="inline-start" />
              恢复默认
            </Button>
          ) : null}
        </div>
        {editError ? (
          <InlineError message={editError} title="保存失败" />
        ) : null}
      </div>
    )
  }

  if (resolvedTemplateId !== templateId) {
    return (
      <PageFrame>
        <BackRow />
        <WorkspaceHeader
          description="查看这份配方的默认设置"
          title="配方详情"
        />
        <AsyncState
          description="正在同步配方信息和项目引用。"
          state="loading"
          title="正在读取配方"
        />
      </PageFrame>
    )
  }

  if (loadError) {
    return (
      <PageFrame>
        <BackRow />
        <WorkspaceHeader
          description="查看这份配方的默认设置"
          title="配方详情"
        />
        <AsyncState
          action={
            <Button
              onClick={retryPageLoad}
              size="sm"
              type="button"
              variant="outline"
            >
              重试
            </Button>
          }
          description={loadError}
          state="error"
          title="配方读取失败"
        />
      </PageFrame>
    )
  }

  if (notFound) {
    return (
      <PageFrame>
        <BackRow />
        <WorkspaceHeader
          description="查看这份配方的默认设置"
          title="配方详情"
        />
        <EmptyState
          actions={
            <Button asChild variant="outline">
              <a href={routeHref("/create")}>
                <ArrowLeft data-icon="inline-start" />
                返回快速生产
              </a>
            </Button>
          }
          description="它可能已被删除，或当前账户没有访问权限。"
          icon={SlidersHorizontal}
          title="没有找到这份配方"
        />
      </PageFrame>
    )
  }

  if (!template) {
    return null
  }

  const customizedCount = Object.keys(overrides).length

  return (
    <PageFrame>
      <BackRow />
      <WorkspaceHeader
        actions={
          <Button asChild className="min-h-11 sm:min-h-9">
            <a href={routeHref(productionStartRoute(template))}>
              开始制作
              <ArrowRight data-icon="inline-end" />
            </a>
          </Button>
        }
        description={
          <span>调整长期默认值。开始制作后，仍可以对当次内容单独调整。</span>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {template.display_name}
            <Badge variant="secondary">{productionLineSummary(template)}</Badge>
            {template.is_custom ? (
              <Badge variant="outline">我的配方</Badge>
            ) : null}
          </span>
        }
      />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {isLoading ? (
            <AsyncState
              description="正在同步这份配方的有效默认值。"
              state="loading"
              title="正在读取默认设置"
            />
          ) : null}
          {configError ? (
            <AsyncState
              action={
                <Button
                  onClick={() => setConfigReloadToken((value) => value + 1)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  重试
                </Button>
              }
              description={configError}
              state="error"
              title="默认设置读取失败"
            />
          ) : null}

          {hasLoaded ? (
            <WorkspacePanel
              description="按成片顺序查看各个步骤。在这里保存的内容，会成为这份配方的默认值。"
              title="生产步骤与默认设置"
            >
              {steps.length > 0 ? (
                <ol className="divide-y">
                  {steps.map((step, index) => {
                    const key = step.controlKey
                    const isExpertOnly = Boolean(
                      key && EXPERT_ONLY_KEYS.has(key)
                    )
                    const changeableHere = Boolean(
                      !step.fixed &&
                      key &&
                      overridableKeys.includes(key) &&
                      (expertMode || !isExpertOnly)
                    )
                    const isProjectStep =
                      key === null && step.link === "projects"
                    const isEditing = Boolean(
                      key && editingKey === key && changeableHere
                    )
                    const subKeys = (step.subKeys || []).filter(
                      (subKey) =>
                        overridableKeys.includes(subKey) &&
                        (expertMode || !EXPERT_ONLY_KEYS.has(subKey))
                    )

                    return (
                      <li
                        className="py-4 first:pt-0 last:pb-0"
                        key={`${step.label}-${index}`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-medium">
                                {partLabel(step.label)}
                              </h3>
                              {key && key in overrides ? (
                                <Badge variant="info">已调整</Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs leading-5 break-words text-muted-foreground">
                              当前：{partValue(key, step.fallback)}
                            </p>
                          </div>
                          {changeableHere && !isEditing && key ? (
                            <Button
                              className="min-h-11 sm:min-h-8"
                              onClick={() => startEdit(key)}
                              type="button"
                              variant="outline"
                            >
                              调整
                            </Button>
                          ) : null}
                          {isProjectStep ? (
                            <Button
                              asChild
                              className="min-h-11 sm:min-h-8"
                              variant="outline"
                            >
                              <a
                                href={routeHref(
                                  settingsLink({ kind: "projects" })
                                )}
                              >
                                在项目中调整
                              </a>
                            </Button>
                          ) : null}
                          {!changeableHere && !isProjectStep ? (
                            <Badge className="gap-1" variant="outline">
                              <Lock />
                              {isExpertOnly && !expertMode
                                ? "配方默认"
                                : "固定步骤"}
                            </Badge>
                          ) : null}
                        </div>

                        {isEditing && key ? renderEditor(key) : null}

                        {subKeys.length > 0 ? (
                          <div className="mt-3 ml-3 border-l pl-4 sm:ml-3.5">
                            <div className="divide-y">
                              {subKeys.map((subKey) => {
                                const isSubEditing = editingKey === subKey
                                return (
                                  <div className="py-3" key={subKey}>
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2 text-sm">
                                          {parameterLabel(subKey)}
                                          {subKey in overrides ? (
                                            <Badge variant="info">已调整</Badge>
                                          ) : null}
                                        </div>
                                        <p className="mt-1 text-xs leading-5 break-words text-muted-foreground">
                                          当前：
                                          {partValue(subKey, "未设置")}
                                        </p>
                                      </div>
                                      {!isSubEditing ? (
                                        <Button
                                          className="min-h-11 sm:min-h-8"
                                          onClick={() => startEdit(subKey)}
                                          type="button"
                                          variant="ghost"
                                        >
                                          调整
                                        </Button>
                                      ) : null}
                                    </div>
                                    {isSubEditing ? renderEditor(subKey) : null}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <EmptyState
                  className="min-h-48 border-dashed"
                  description="仍可以使用这份配方制作，只是暂时没有可在这里调整的默认值。"
                  headingLevel={3}
                  icon={SlidersHorizontal}
                  title="暂无可调整步骤"
                />
              )}
            </WorkspacePanel>
          ) : null}

          {hasLoaded && extraKeys.length > 0 ? (
            <WorkspacePanel
              description="这些默认值不属于某一个成片步骤。"
              title="其他默认设置"
            >
              <div className="grid gap-x-5 sm:grid-cols-2">
                {extraKeys.map((key) => {
                  const isEditing = editingKey === key
                  return (
                    <div
                      className={cn(
                        "border-b py-3 first:pt-0 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0",
                        isEditing && "sm:col-span-2"
                      )}
                      key={key}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            {parameterLabel(key)}
                            {key in overrides ? (
                              <Badge variant="info">已调整</Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs leading-5 break-words text-muted-foreground">
                            当前：{partValue(key, "未设置")}
                          </p>
                        </div>
                        {!isEditing ? (
                          <Button
                            className="min-h-11 sm:min-h-8"
                            onClick={() => startEdit(key)}
                            type="button"
                            variant="outline"
                          >
                            调整
                          </Button>
                        ) : null}
                      </div>
                      {isEditing ? renderEditor(key) : null}
                    </div>
                  )
                })}
              </div>
            </WorkspacePanel>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-5">
          <WorkspacePanel title="配方概览">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <dt className="text-xs text-muted-foreground">成品</dt>
                <dd className="mt-1 text-sm font-medium">
                  {productionArtifactSummary(template)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">提交方式</dt>
                <dd className="mt-1 text-sm font-medium">
                  {productionSubmissionSummary(template)}
                </dd>
              </div>
              <div className="col-span-2 border-t pt-3">
                <dt className="text-xs text-muted-foreground">需要准备</dt>
                <dd className="mt-1 text-sm font-medium">
                  {productionInputSummary(template)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">默认调整</dt>
                <dd className="mt-1 text-sm font-medium">
                  {customizedCount > 0 ? `${customizedCount} 项` : "未调整"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">使用项目</dt>
                <dd className="mt-1 text-sm font-medium">
                  {projectUsers.length > 0
                    ? `${projectUsers.length} 个`
                    : "暂无"}
                </dd>
              </div>
            </dl>
            {projectUsers.length > 0 ? (
              <p className="mt-4 border-t pt-3 text-xs leading-5 text-muted-foreground">
                已作为项目默认：{projectUsers.join("、")}
              </p>
            ) : null}
          </WorkspacePanel>

          <WorkspacePanel title="成品说明">
            <p className="text-sm leading-6 text-muted-foreground">
              {productionDescription(template)}
            </p>
          </WorkspacePanel>

          <WorkspacePanel title="管理配方">
            <CloneRecipeButton template={template} />
            <Button
              asChild
              className="mt-2 min-h-11 w-full sm:min-h-8"
              variant="ghost"
            >
              <a
                href={routeHref(
                  settingsLink({ kind: "template", id: template.id })
                )}
              >
                <Settings2 data-icon="inline-start" />
                在设置中管理
              </a>
            </Button>
          </WorkspacePanel>
        </aside>
      </div>

      <div className="sticky bottom-[calc(4.25rem+var(--safe-area-bottom))] z-10 -mx-2 rounded-xl border bg-background/95 p-2 shadow-lg backdrop-blur lg:hidden">
        <Button asChild className="min-h-11 w-full">
          <a href={routeHref(productionStartRoute(template))}>
            开始制作
            <ArrowRight data-icon="inline-end" />
          </a>
        </Button>
      </div>
    </PageFrame>
  )
}

function CloneRecipeButton({ template }: { template: ProductionTemplate }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)

  async function create() {
    const displayName = name.trim()
    if (!displayName) {
      return
    }
    setBusy(true)
    try {
      const created = await cloneProductionTemplate({
        sourceTemplateId: template.id,
        id: `my_${template.pipeline_id}_${Date.now().toString(36)}`,
        displayName,
      })
      toast({ title: `「${displayName}」已创建`, variant: "success" })
      navigate(`/create/recipes/${created.id}`)
    } catch (error) {
      toast({
        title: "克隆失败",
        description: readableError(error),
        variant: "error",
      })
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void create()
  }

  if (!open) {
    return (
      <Button
        className="min-h-11 w-full sm:min-h-8"
        onClick={() => setOpen(true)}
        type="button"
        variant="outline"
      >
        <Copy data-icon="inline-start" />
        克隆为新配方
      </Button>
    )
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <label className="text-xs font-medium" htmlFor="clone-recipe-name">
        新配方名称
      </label>
      <Input
        autoFocus
        className="min-h-11 sm:min-h-8"
        id="clone-recipe-name"
        onChange={(event) => setName(event.target.value)}
        placeholder="例如：竖版口播·简洁"
        value={name}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={busy || !name.trim()}
          type="submit"
        >
          {busy ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : null}
          创建
        </Button>
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={busy}
          onClick={() => {
            setOpen(false)
            setName("")
          }}
          type="button"
          variant="ghost"
        >
          取消
        </Button>
      </div>
    </form>
  )
}

function BackRow() {
  return (
    <Button
      asChild
      className="min-h-11 self-start px-0 sm:min-h-8"
      variant="ghost"
    >
      <a href={routeHref("/create")}>
        <ArrowLeft data-icon="inline-start" />
        快速生产
      </a>
    </Button>
  )
}
