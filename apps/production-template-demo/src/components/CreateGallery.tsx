import { useEffect, useMemo, useState, type FormEvent } from "react"
import {
  ArrowRight,
  FileText,
  Images,
  Languages,
  Loader2,
  Plus,
  Settings2,
  Sparkles,
  UploadCloud,
  Video,
  WandSparkles,
  type LucideIcon,
} from "lucide-react"

import { AsyncState } from "@/components/shared/AsyncState"
import { EmptyState } from "@/components/shared/EmptyState"
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
import { useToast } from "@/components/ui/toast"
import { useCurrentProject } from "@/lib/currentProject"
import { readableError } from "@/lib/format"
import {
  cloneProductionTemplate,
  getTemplateGenerationConfig,
  listTemplates,
  type ProductionTemplate,
} from "@/lib/generationApi"
import { PART_KEY_LABELS } from "@/lib/pipelineParts"
import {
  productionArtifactSummary,
  productionDescription,
  productionInputSummary,
  productionStartRoute,
  productionSubmissionSummary,
} from "@/lib/productionSurface"
import { navigate, routeHref } from "@/lib/router"
import { isRetiredTemplate } from "@/lib/templatePresentation"
import { cn } from "@/lib/utils"

type LoadState = "loading" | "ready" | "error"

const FLOW_ENTRIES = new Set(["script_review"])

function isFlowEntry(template: ProductionTemplate) {
  return FLOW_ENTRIES.has(template.product_entry)
}

type Family = {
  id: string
  label: string
  tagline: string
  icon: LucideIcon
  pipelineIds: string[]
  newSources: { pipelineId: string; skeletonId: string; label: string }[]
}

const FAMILIES: Family[] = [
  {
    id: "standard",
    label: "图文口播",
    tagline: "文案、配音与画面合成视频",
    icon: Video,
    pipelineIds: ["standard"],
    newSources: [
      {
        pipelineId: "standard",
        skeletonId: "pipeline_standard_base_v1",
        label: "图文口播",
      },
    ],
  },
  {
    id: "asset",
    label: "素材成片",
    tagline: "用已有图片和视频组织成片",
    icon: UploadCloud,
    pipelineIds: ["asset_based"],
    newSources: [
      {
        pipelineId: "asset_based",
        skeletonId: "pipeline_asset_based_base_v1",
        label: "素材成片",
      },
    ],
  },
  {
    id: "image_post",
    label: "图文帖",
    tagline: "把文案排成封面与多页图集",
    icon: Images,
    pipelineIds: ["image_post"],
    newSources: [
      {
        pipelineId: "image_post",
        skeletonId: "pipeline_image_post_base_v1",
        label: "图文帖",
      },
    ],
  },
  {
    id: "long_form",
    label: "长文",
    tagline: "把确认稿扩写成结构化文章",
    icon: FileText,
    pipelineIds: ["long_form"],
    newSources: [
      {
        pipelineId: "long_form",
        skeletonId: "pipeline_long_form_base_v1",
        label: "长文",
      },
    ],
  },
  {
    id: "direct",
    label: "专用视频",
    tagline: "图片动画、动作迁移与数字人口播",
    icon: WandSparkles,
    pipelineIds: ["i2v", "action_transfer", "digital_human"],
    newSources: [
      {
        pipelineId: "i2v",
        skeletonId: "pixelle_i2v_basic_v1",
        label: "图片生成视频",
      },
      {
        pipelineId: "action_transfer",
        skeletonId: "pixelle_action_transfer_basic_v1",
        label: "动作迁移",
      },
      {
        pipelineId: "digital_human",
        skeletonId: "pixelle_digital_human_basic_v1",
        label: "数字人",
      },
    ],
  },
]

function RecipeCard({
  customizedSummary,
  isProjectDefault,
  template,
}: {
  customizedSummary: string | null
  isProjectDefault: boolean
  template: ProductionTemplate
}) {
  return (
    <article
      className={cn(
        "group flex min-h-64 flex-col rounded-lg border bg-card text-card-foreground transition-[border-color,box-shadow,transform] duration-[var(--motion-duration-fast)] ease-[var(--motion-easing-standard)] focus-within:border-primary/50 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm",
        isProjectDefault && "border-primary/40 ring-1 ring-primary/20"
      )}
    >
      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {productionArtifactSummary(template)}
          </Badge>
          {isProjectDefault ? (
            <Badge variant="success">项目默认</Badge>
          ) : template.is_custom ? (
            <Badge variant="outline">我的配方</Badge>
          ) : null}
        </div>

        <h3 className="mt-3 text-sm leading-6 font-medium">
          {template.display_name}
        </h3>
        <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
          {productionDescription(template)}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">输入</dt>
            <dd className="mt-0.5 truncate text-sm">
              {productionInputSummary(template)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">提交方式</dt>
            <dd className="mt-0.5 truncate text-sm">
              {productionSubmissionSummary(template)}
            </dd>
          </div>
          <div className="col-span-2 min-w-0">
            <dt className="text-xs text-muted-foreground">默认设置</dt>
            <dd className="mt-0.5 line-clamp-1 text-sm">
              {customizedSummary
                ? `已调整：${customizedSummary}`
                : template.is_custom
                  ? "沿用我的配方设置"
                  : "沿用出厂设置"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex items-center gap-1 border-t p-2">
        <Button
          asChild
          className="min-h-11 flex-1 justify-start sm:min-h-0"
          variant="ghost"
        >
          <a href={routeHref(productionStartRoute(template))}>
            开始制作
            <ArrowRight data-icon="inline-end" />
          </a>
        </Button>
        <Button
          aria-label={`调整「${template.display_name}」配方`}
          asChild
          className="size-11 sm:size-8"
          size="icon"
          variant="ghost"
        >
          <a href={routeHref(`/create/recipes/${template.id}`)}>
            <Settings2 />
          </a>
        </Button>
      </div>
    </article>
  )
}

function NewRecipeForm({
  family,
  onCancel,
  onCreated,
}: {
  family: Family
  onCancel: () => void
  onCreated: (template: ProductionTemplate) => void
}) {
  const toast = useToast()
  const [name, setName] = useState("")
  const [sourceId, setSourceId] = useState(
    family.newSources.length === 1 ? family.newSources[0].skeletonId : ""
  )
  const [busy, setBusy] = useState(false)

  async function create() {
    const displayName = name.trim()
    const source = family.newSources.find(
      (item) => item.skeletonId === sourceId
    )
    if (!displayName || !source || busy) {
      return
    }

    setBusy(true)
    try {
      const template = await cloneProductionTemplate({
        sourceTemplateId: source.skeletonId,
        id: `my_${source.pipelineId}_${Date.now().toString(36)}`,
        displayName,
      })
      toast({
        title: `「${displayName}」已创建`,
        description: "接下来调整默认设置。",
        variant: "success",
      })
      onCreated(template)
    } catch (error) {
      toast({
        title: "创建失败",
        description: readableError(error),
        variant: "error",
      })
    } finally {
      setBusy(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void create()
  }

  const nameId = `new-recipe-name-${family.id}`

  return (
    <form
      className="mb-4 rounded-lg border border-dashed bg-muted/20 p-4"
      onSubmit={handleSubmit}
    >
      <div className="text-sm font-medium">新建{family.label}配方</div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        从出厂设置复制一份，再调整成适合你的默认效果。
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="grid gap-3 sm:grid-cols-2">
          {family.newSources.length > 1 ? (
            <label className="flex min-w-0 flex-col gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">制作方式</span>
              <Select onValueChange={setSourceId} value={sourceId || undefined}>
                <SelectTrigger className="h-11 w-full sm:h-8">
                  <SelectValue placeholder="选择制作方式" />
                </SelectTrigger>
                <SelectContent>
                  {family.newSources.map((source) => (
                    <SelectItem
                      key={source.skeletonId}
                      value={source.skeletonId}
                    >
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : null}
          <label className="flex min-w-0 flex-col gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">配方名称</span>
            <Input
              autoFocus
              className="h-11 sm:h-8"
              id={nameId}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：日常口播"
              value={name}
            />
          </label>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            className="min-h-11 sm:min-h-0"
            disabled={busy}
            onClick={onCancel}
            type="button"
            variant="ghost"
          >
            取消
          </Button>
          <Button
            className="min-h-11 sm:min-h-0"
            disabled={busy || !name.trim() || !sourceId}
            type="submit"
          >
            {busy ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Plus data-icon="inline-start" />
            )}
            创建配方
          </Button>
        </div>
      </div>
    </form>
  )
}

export function CreateGallery() {
  const { project, projectId } = useCurrentProject()
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [error, setError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [reloadToken, setReloadToken] = useState(0)
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null)
  const [newRecipeFamily, setNewRecipeFamily] = useState<string | null>(null)
  const [customized, setCustomized] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoadState("loading")
      setError(null)
      setNewRecipeFamily(null)
      try {
        const response = await listTemplates(projectId ?? undefined)
        if (cancelled) {
          return
        }
        setTemplates(response.templates)
        setLoadState("ready")

        const visible = response.templates.filter(
          (template) =>
            template.enabled &&
            !isRetiredTemplate(template) &&
            !isFlowEntry(template)
        )
        const results = await Promise.allSettled(
          visible.map(async (template) => {
            const config = await getTemplateGenerationConfig(template.id)
            return [template.id, Object.keys(config.overrides)] as const
          })
        )
        if (cancelled) {
          return
        }

        const summary: Record<string, string> = {}
        for (const result of results) {
          if (result.status !== "fulfilled") {
            continue
          }
          const [id, keys] = result.value
          if (keys.length > 0) {
            summary[id] = keys
              .map((key) => PART_KEY_LABELS[key] ?? key)
              .join("、")
          }
        }
        setCustomized(summary)
      } catch (loadError) {
        if (!cancelled) {
          setError(readableError(loadError))
          setLoadState("error")
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [projectId, reloadToken])

  const productTemplates = useMemo(
    () =>
      templates.filter(
        (template) =>
          template.enabled &&
          !isRetiredTemplate(template) &&
          !isFlowEntry(template)
      ),
    [templates]
  )
  const flowTemplates = useMemo(
    () =>
      templates.filter(
        (template) => isFlowEntry(template) && !template.retired
      ),
    [templates]
  )
  const defaultTemplateId = project?.default_production_template_id || ""
  const defaultTemplate = productTemplates.find(
    (template) => template.id === defaultTemplateId
  )
  const defaultFamily = FAMILIES.find((family) =>
    family.pipelineIds.includes(defaultTemplate?.pipeline_id ?? "")
  )
  const selectedFamily =
    FAMILIES.find((family) => family.id === selectedFamilyId) ??
    defaultFamily ??
    FAMILIES[0]
  const selectedTemplates = productTemplates.filter((template) =>
    selectedFamily.pipelineIds.includes(template.pipeline_id)
  )
  const hasAnyEntry = productTemplates.length > 0 || flowTemplates.length > 0

  return (
    <PageFrame>
      <WorkspaceHeader
        actions={
          project ? <Badge variant="outline">{project.name}</Badge> : undefined
        }
        description="先选择成品类型，再用现成配方开始制作；需要长期调整的效果可以保存为自己的配方。"
        headingLevel={1}
        title="选择生产方式"
      />

      {loadState === "loading" ? (
        <AsyncState
          description="正在读取当前项目可用的配方。"
          state="loading"
          title="正在读取配方"
        />
      ) : null}

      {loadState === "error" ? (
        <AsyncState
          action={
            <Button
              onClick={() => setReloadToken((token) => token + 1)}
              size="sm"
              type="button"
              variant="outline"
            >
              重新读取
            </Button>
          }
          description={error || "暂时无法读取配方，请重试。"}
          state="error"
          title="配方读取失败"
        />
      ) : null}

      {loadState === "ready" && !hasAnyEntry ? (
        <EmptyState
          description="当前没有可用的生产配方。请先到设置中检查配方状态。"
          icon={Sparkles}
          title="暂无可用配方"
        />
      ) : null}

      {loadState === "ready" && hasAnyEntry ? (
        <div className="grid min-w-0 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <WorkspacePanel
            contentClassName="overflow-x-auto lg:overflow-visible"
            description="选择最终要交付的内容形式"
            padding="none"
            title="生产方式"
            variant="plain"
          >
            <nav
              aria-label="生产方式"
              className="flex min-w-max gap-2 pb-1 lg:min-w-0 lg:flex-col"
            >
              {FAMILIES.map((family) => {
                const Icon = family.icon
                const active = selectedFamily.id === family.id
                const count = productTemplates.filter((template) =>
                  family.pipelineIds.includes(template.pipeline_id)
                ).length
                return (
                  <button
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 min-w-40 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-[var(--motion-duration-fast)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:min-w-0",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    key={family.id}
                    onClick={() => {
                      setSelectedFamilyId(family.id)
                      setNewRecipeFamily(null)
                    }}
                    type="button"
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-foreground">
                        {family.label}
                      </span>
                      <span className="mt-0.5 hidden truncate text-xs text-muted-foreground lg:block">
                        {family.tagline}
                      </span>
                    </span>
                    <Badge variant={active ? "info" : "outline"}>{count}</Badge>
                  </button>
                )
              })}
            </nav>
          </WorkspacePanel>

          <div className="flex min-w-0 flex-col gap-5">
            <WorkspacePanel
              description={selectedFamily.tagline}
              headerAction={
                <Button
                  aria-expanded={newRecipeFamily === selectedFamily.id}
                  className="min-h-11 sm:min-h-0"
                  onClick={() =>
                    setNewRecipeFamily((current) =>
                      current === selectedFamily.id ? null : selectedFamily.id
                    )
                  }
                  size="sm"
                  variant="outline"
                >
                  <Plus data-icon="inline-start" />
                  新建配方
                </Button>
              }
              title={selectedFamily.label}
            >
              {newRecipeFamily === selectedFamily.id ? (
                <NewRecipeForm
                  family={selectedFamily}
                  onCancel={() => setNewRecipeFamily(null)}
                  onCreated={(template) =>
                    navigate(`/create/recipes/${template.id}`)
                  }
                />
              ) : null}

              {selectedTemplates.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {selectedTemplates.map((template) => (
                    <RecipeCard
                      customizedSummary={customized[template.id] ?? null}
                      isProjectDefault={template.id === defaultTemplateId}
                      key={template.id}
                      template={template}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  actions={
                    <Button
                      className="min-h-11 sm:min-h-8"
                      onClick={() => setNewRecipeFamily(selectedFamily.id)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Plus data-icon="inline-start" />
                      新建配方
                    </Button>
                  }
                  className="min-h-64"
                  description="可以从这条生产方式的出厂设置创建一份。"
                  icon={selectedFamily.icon}
                  title="还没有可用配方"
                />
              )}
            </WorkspacePanel>

            {flowTemplates.length > 0 ? (
              <WorkspacePanel
                description="需要先审核内容，再一次提交多个结果"
                title="审核流程"
              >
                <div className="divide-y">
                  {flowTemplates.map((template) => (
                    <a
                      className="flex min-h-14 items-center gap-3 py-3 text-left transition-colors duration-[var(--motion-duration-fast)] hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                      href={routeHref(productionStartRoute(template))}
                      key={template.id}
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Languages className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {template.display_name}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                          {productionDescription(template)}
                        </span>
                      </span>
                      <Badge
                        className="hidden sm:inline-flex"
                        variant="outline"
                      >
                        审核后批量
                      </Badge>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </a>
                  ))}
                </div>
              </WorkspacePanel>
            ) : null}
          </div>
        </div>
      ) : null}
    </PageFrame>
  )
}
