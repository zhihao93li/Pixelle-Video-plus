import { useEffect, useState } from "react"
import { ArrowLeft, ArrowRight, Loader2, Lock, RotateCcw } from "lucide-react"

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
import { InlineError } from "@/components/shared/feedback"
import { readableError } from "@/lib/format"
import { navigate } from "@/lib/router"
import { settingsLink } from "@/lib/settingsLinks"
import { FrameTemplatePicker } from "@/components/shared/FrameTemplatePicker"
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
import { pipelineChipLabel, templateRoute } from "@/lib/templatePresentation"

/**
 * 配方详情页（/create/recipes/:id）：产线零件抽屉的继任者
 * （DESIGN.md §2.5：>2 分区 + 大量输入必须页面）。就地换零件全部能力平移，
 * 每个模板参数只有这一个编辑入口；设置页模板面板只做库存管理。
 */

export function RecipeDetailPage({ templateId }: { templateId: string }) {
  const toast = useToast()
  const [template, setTemplate] = useState<ProductionTemplate | null>(null)
  const [projectUsers, setProjectUsers] = useState<string[]>([])
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [isLoading, setIsLoading] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const [overridableKeys, setOverridableKeys] = useState<string[]>([])
  const [effectiveParams, setEffectiveParams] = useState<
    Record<string, unknown>
  >({})
  const [overrides, setOverrides] = useState<Record<string, unknown>>({})
  const [hasLoaded, setHasLoaded] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  // 画面模板图选（批次三）：拉不到列表时静默回落纯文本编辑
  const [frameTemplates, setFrameTemplates] = useState<ResourceTemplate[]>([])

  useEffect(() => {
    let cancelled = false
    void listResourceTemplates()
      .then((response) => {
        if (!cancelled) {
          setFrameTemplates(response.templates)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // 找模板 + 项目引用（哪些项目拿它作默认）
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
        setTemplate(found)
        setNotFound(!found)
        setProjectUsers(
          projectResponse.projects
            .filter(
              (project) =>
                project.default_production_template_id === templateId
            )
            .map((project) => project.name)
        )
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(readableError(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [templateId])

  // 配方默认配置（overridable_keys / effective_params / overrides）
  useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setConfigError(null)
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
    // 注意：isLoading 不能进依赖——会触发 cleanup 取消进行中的请求，转圈永不结束。
  }, [templateId])

  const steps = template ? (PIPELINE_PARTS[template.pipeline_id] ?? []) : []
  // 兜底完整性：白名单里可换、但产线图（主控 key + 附属参数）没画的，自动列进「更多可调参数」。
  const coveredKeys = new Set([
    ...steps.map((step) => step.controlKey).filter(Boolean),
    ...steps.flatMap((step) => step.subKeys || []),
  ])
  const extraKeys = overridableKeys.filter((key) => !coveredKeys.has(key))

  function startEdit(key: string) {
    setEditingKey(key)
    const current = overrides[key] ?? effectiveParams[key]
    setEditValue(current == null ? "" : String(current))
  }

  async function savePart(key: string, rawValue: string | null) {
    setIsSaving(true)
    try {
      const next: Record<string, unknown> = { ...overrides }
      if (rawValue === null || !rawValue.trim()) {
        delete next[key]
      } else {
        const value = rawValue.trim()
        next[key] = PART_NUMBER_KEYS.has(key) ? Number(value) : value
      }
      const config = await updateTemplateGenerationConfig(templateId, next)
      setEffectiveParams(config.effective_params)
      setOverrides(config.overrides)
      setEditingKey(null)
      toast({
        title: rawValue === null ? "已恢复内置默认" : "零件已更换",
        description: "之后用这个配方出片都会默认生效。",
        variant: "success",
      })
    } catch (error) {
      toast({
        title: "更换失败",
        description: readableError(error),
        variant: "error",
      })
    } finally {
      setIsSaving(false)
    }
  }

  function renderEditor(key: string) {
    const options = PART_EDIT_OPTIONS[key]
    const hint = PART_EDIT_HINTS[key]
    const isLongText = PART_LONG_TEXT_KEYS.has(key)
    // 画面模板走图选网格（批次三）；资源拉不到时回落文本框
    const isFramePicker = key === "frame_template" && frameTemplates.length > 0
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {isLongText && (
          <Textarea
            className="min-h-40 font-mono text-xs"
            onChange={(event) => setEditValue(event.target.value)}
            value={editValue}
          />
        )}
        {isFramePicker && (
          <FrameTemplatePicker
            onChange={setEditValue}
            templates={frameTemplates}
            value={editValue}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {options ? (
            <Select onValueChange={setEditValue} value={editValue || undefined}>
              <SelectTrigger className="h-8 w-52">
                <SelectValue placeholder="选择" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : isLongText || isFramePicker ? null : (
            <Input
              className="h-8 w-52"
              onChange={(event) => setEditValue(event.target.value)}
              type={PART_NUMBER_KEYS.has(key) ? "number" : "text"}
              value={editValue}
            />
          )}
          <Button
            disabled={isSaving || !editValue.trim()}
            onClick={() => void savePart(key, editValue)}
            size="sm"
          >
            {isSaving && (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            )}
            保存
          </Button>
          <Button
            disabled={isSaving}
            onClick={() => setEditingKey(null)}
            size="sm"
            variant="ghost"
          >
            取消
          </Button>
          {key in overrides && (
            <Button
              disabled={isSaving}
              onClick={() => void savePart(key, null)}
              size="sm"
              variant="ghost"
            >
              <RotateCcw data-icon="inline-start" />
              恢复内置
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <main className="flex max-w-[1240px] flex-col gap-4 p-4 lg:p-6">
        <BackRow />
        <InlineError title="配方读取失败" message={loadError} />
      </main>
    )
  }

  if (notFound) {
    return (
      <main className="flex max-w-[1240px] flex-col gap-4 p-4 lg:p-6">
        <BackRow />
        <InlineError
          title="配方不存在"
          message="配方不存在，可能已停用或删除。"
        />
      </main>
    )
  }

  if (!template) {
    return (
      <main className="flex max-w-[1240px] flex-col gap-4 p-4 lg:p-6">
        <BackRow />
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在读取配方
        </div>
      </main>
    )
  }

  const customizedCount = Object.keys(overrides).length

  return (
    <main className="flex max-w-[1240px] flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <BackRow />
          <h1 className="truncate text-lg font-semibold">
            {template.display_name}
          </h1>
          <Badge variant="outline">
            {pipelineChipLabel(template.pipeline_id)}
          </Badge>
        </div>
        <Button onClick={() => navigate(templateRoute(template))}>
          开始制作
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex flex-col gap-4">
          {isLoading && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在读取产线配置
            </div>
          )}
          {configError && (
            <InlineError title="产线读取失败" message={configError} />
          )}

          {/* 产线 */}
          {hasLoaded && (
            <section className="rounded-lg border bg-background p-4">
              <div className="text-sm font-semibold">产线</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                这条路经过哪些零件、当前用的是什么。可换零件在这里直接换，保存后成为这个配方的默认。
              </p>
              <div className="mt-3 flex flex-col gap-3">
                {steps.map((step, index) => {
                  const current = humanizePartValue(
                    step.controlKey
                      ? effectiveParams[step.controlKey]
                      : undefined,
                    step.fallback
                  )
                  const changeableHere =
                    !step.fixed &&
                    step.controlKey !== null &&
                    overridableKeys.includes(step.controlKey)
                  const isProjectStep =
                    step.controlKey === null && step.link === "projects"
                  const isEditing =
                    editingKey !== null &&
                    editingKey === step.controlKey &&
                    changeableHere
                  return (
                    <div
                      className="rounded-lg border bg-background p-3"
                      key={`${step.label}-${index}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <span className="text-xs text-muted-foreground">
                              {index + 1}
                            </span>
                            {step.label}
                            {step.controlKey !== null &&
                              step.controlKey in overrides && (
                                <Badge variant="secondary">已自定义</Badge>
                              )}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            当前：{current}
                          </div>
                        </div>
                        {changeableHere && !isEditing && (
                          <Button
                            onClick={() => startEdit(step.controlKey as string)}
                            size="sm"
                            variant="outline"
                          >
                            更换
                          </Button>
                        )}
                        {isProjectStep && (
                          <Button
                            onClick={() =>
                              navigate(settingsLink({ kind: "projects" }))
                            }
                            size="sm"
                            variant="outline"
                          >
                            在项目里改
                          </Button>
                        )}
                        {!changeableHere && !isProjectStep && (
                          <Badge className="shrink-0 gap-1" variant="outline">
                            <Lock className="size-3" />
                            产线固定
                          </Badge>
                        )}
                      </div>
                      {isEditing && renderEditor(step.controlKey as string)}
                      {/* 附属参数（批次三后续）：归属这一步的白名单参数折在步骤卡下，兜底区只留无家可归的 */}
                      {(() => {
                        const subKeys = (step.subKeys || []).filter((key) =>
                          overridableKeys.includes(key)
                        )
                        if (subKeys.length === 0) {
                          return null
                        }
                        return (
                          <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                            {subKeys.map((key) => {
                              const isSubEditing = editingKey === key
                              const subCurrent = humanizePartValue(
                                effectiveParams[key],
                                "未设置"
                              )
                              return (
                                <div key={key}>
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 text-sm">
                                        {PART_KEY_LABELS[key] || key}
                                        {key in overrides && (
                                          <Badge variant="secondary">
                                            已自定义
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="mt-0.5 text-xs text-muted-foreground">
                                        当前：{subCurrent}
                                      </div>
                                    </div>
                                    {!isSubEditing && (
                                      <Button
                                        onClick={() => startEdit(key)}
                                        size="sm"
                                        variant="ghost"
                                      >
                                        更换
                                      </Button>
                                    )}
                                  </div>
                                  {isSubEditing && renderEditor(key)}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })()}
                    </div>
                  )
                })}
                {steps.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    这条产线暂未登记可展示的零件清单。
                  </p>
                )}
              </div>
            </section>
          )}

          {/* 更多可调参数 */}
          {hasLoaded && extraKeys.length > 0 && (
            <section className="rounded-lg border bg-background p-4">
              <div className="text-sm font-semibold">更多可调参数</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                产线图之外这个配方还能调的默认值。
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {extraKeys.map((key) => {
                  const isEditing = editingKey === key
                  const current = humanizePartValue(
                    effectiveParams[key],
                    "未设置"
                  )
                  return (
                    <div
                      className={
                        isEditing
                          ? "rounded-lg border bg-background p-3 sm:col-span-2"
                          : "rounded-lg border bg-background p-3"
                      }
                      key={key}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            {PART_KEY_LABELS[key] ?? key}
                            {key in overrides && (
                              <Badge variant="secondary">已自定义</Badge>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            当前：{current}
                          </div>
                        </div>
                        {!isEditing && (
                          <Button
                            onClick={() => startEdit(key)}
                            size="sm"
                            variant="outline"
                          >
                            更换
                          </Button>
                        )}
                      </div>
                      {isEditing && renderEditor(key)}
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </div>

        {/* 右栏 */}
        <aside className="flex flex-col gap-3">
          <div className="rounded-lg border bg-background p-3">
            <div className="mb-2 text-xs text-muted-foreground">配方</div>
            <div className="text-xs leading-6 text-muted-foreground">
              {pipelineChipLabel(template.pipeline_id)}
              <br />
              {template.is_custom ? "我的配方" : "出厂骨架"}
              <br />
              已自定义 {customizedCount} 项
              {projectUsers.length > 0 && (
                <>
                  <br />
                  项目默认：{projectUsers.join("、")}
                </>
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-background p-3">
            <div className="mb-2 text-xs text-muted-foreground">成品</div>
            <p className="text-xs leading-6 text-muted-foreground">
              {template.description}
            </p>
          </div>

          <div className="rounded-lg border bg-background p-3">
            <div className="mb-2 text-xs text-muted-foreground">操作</div>
            <CloneRecipeButton template={template} />
            <Button
              className="mt-2 w-full"
              onClick={() =>
                navigate(settingsLink({ kind: "template", id: template.id }))
              }
              size="sm"
              variant="ghost"
            >
              在设置里管理
            </Button>
          </div>
        </aside>
      </div>
    </main>
  )
}

/** 「克隆为新配方」：展开起名 → 克隆 → 直接落到新配方详情页。 */
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

  if (!open) {
    return (
      <Button
        className="w-full"
        onClick={() => setOpen(true)}
        size="sm"
        variant="outline"
      >
        克隆为新配方
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        autoFocus
        className="h-8"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            void create()
          }
        }}
        placeholder="给新配方起个名字"
        value={name}
      />
      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={busy || !name.trim()}
          onClick={() => void create()}
          size="sm"
        >
          {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
          创建
        </Button>
        <Button
          disabled={busy}
          onClick={() => setOpen(false)}
          size="sm"
          variant="ghost"
        >
          取消
        </Button>
      </div>
    </div>
  )
}

function BackRow() {
  return (
    <Button onClick={() => navigate("/create")} size="sm" variant="ghost">
      <ArrowLeft data-icon="inline-start" />
      快速生产
    </Button>
  )
}
