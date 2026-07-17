import { useEffect, useMemo, useState, type FormEvent } from "react"
import {
  CircleCheck,
  ArrowRight,
  Bot,
  Images,
  Loader2,
  Plus,
  Settings2,
  Sparkles,
  TriangleAlert,
  UploadCloud,
  Video,
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
  getSettingsDiagnostics,
  listPipelines,
  listTemplates,
  type PipelineManifest,
  type ProductionTemplate,
  type SettingsDiagnosticCheck,
} from "@/lib/generationApi"
import { appSetupReadiness } from "@/lib/productionReadiness"
import { PART_KEY_LABELS } from "@/lib/pipelineParts"
import {
  productionArtifactSummary,
  productionDescription,
  productionInputSummary,
  productionStartRoute,
  productionSubmissionSummary,
} from "@/lib/productionSurface"
import { navigate, routeHref } from "@/lib/router"
import { settingsLink } from "@/lib/settingsLinks"
import { cn } from "@/lib/utils"

type LoadState = "loading" | "ready" | "error"
type ConfigSummaryState = "loading" | "ready" | "stale" | "error"
type RecipeDefaultsState = "loading" | "ready" | "error"

const AGENT_FAMILY_ID = "agent"

type Family = {
  id: string
  label: string
  tagline: string
  icon: LucideIcon
  pipelineIds: string[]
  newSources: { pipelineId: string; skeletonId: string; label: string }[]
}

const FAMILY_PRESENTATION: Array<
  Pick<Family, "id" | "label" | "tagline" | "icon">
> = [
  {
    id: "口播视频",
    label: "口播视频",
    tagline: "从主题或完整文案开始生成视频",
    icon: Video,
  },
  {
    id: "素材创作",
    label: "素材创作",
    tagline: "用已有图片、视频或人物素材生成成品",
    icon: UploadCloud,
  },
  {
    id: "图文内容",
    label: "图文内容",
    tagline: "把文案生成图集或长文",
    icon: Images,
  },
]

function RecipeCard({
  customizedSummary,
  defaultsState,
  template,
}: {
  customizedSummary: string | null
  defaultsState: RecipeDefaultsState
  template: ProductionTemplate
}) {
  const defaultsSummary =
    defaultsState === "loading"
      ? "正在读取默认设置…"
      : defaultsState === "error"
        ? "默认设置暂时无法读取"
        : customizedSummary
          ? `已调整：${customizedSummary}`
          : template.is_custom
            ? "沿用我的模板设置"
            : "沿用出厂设置"

  return (
    <article
      className="group flex min-h-64 flex-col rounded-lg border bg-card text-card-foreground transition-[border-color,box-shadow,transform] duration-[var(--motion-duration-fast)] ease-[var(--motion-easing-standard)] focus-within:border-primary/50 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm"
    >
      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {productionArtifactSummary(template)}
          </Badge>
          {template.is_custom ? (
            <Badge variant="outline">我的模板</Badge>
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
            <dd className="mt-0.5 line-clamp-1 text-sm">{defaultsSummary}</dd>
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
          aria-label={`调整「${template.display_name}」模板`}
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

function configText(template: ProductionTemplate, key: string) {
  const value = template.fixed_params[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function AgentRecipeCard({ template }: { template: ProductionTemplate }) {
  const style =
    configText(template, "prompt_prefix") ??
    configText(template, "image_prompt_visual_context") ??
    "尚未设置专属风格"
  const voice = configText(template, "tts_voice") ?? "跟随系统音色"
  const frameTemplate = configText(template, "frame_template")
  const layout = frameTemplate?.includes("1080x1920")
    ? "竖版字幕画面"
    : (frameTemplate ?? "跟随模板版式")

  return (
    <article className="rounded-lg border bg-muted/15 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">视频</Badge>
        <Badge variant="info">仅 Agent 发起</Badge>
        {!template.enabled ? <Badge variant="outline">已停用</Badge> : null}
      </div>
      <h3 className="mt-3 text-base font-medium">{template.display_name}</h3>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
        {productionDescription(template)}请在 Agent
        对话中提出主题或文案，确认分镜后自动进入合成。
      </p>

      <ol className="mt-4 grid gap-2 sm:grid-cols-3">
        {["规划分镜并确认", "Agent 生成配图", "Pixelle 配音与合成"].map(
          (step, index) => (
            <li
              className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"
              key={step}
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                {index + 1}
              </span>
              {step}
            </li>
          )
        )}
      </ol>

      <dl className="mt-4 grid gap-3 border-t pt-3 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">图片风格</dt>
          <dd className="mt-0.5 truncate text-sm" title={style}>
            {style}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">默认音色</dt>
          <dd className="mt-0.5 truncate text-sm" title={voice}>
            {voice}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">画面版式</dt>
          <dd className="mt-0.5 truncate text-sm" title={layout}>
            {layout}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="text-xs leading-5 text-muted-foreground">
          {template.enabled
            ? "这里仅展示和配置；制作必须从 Agent 发起。"
            : "这份模板已停用；调整模板后可在设置中重新启用。"}
        </p>
        <Button asChild size="sm" variant="outline">
          <a href={routeHref(`/create/recipes/${template.id}`)}>
            <Settings2 data-icon="inline-start" />
            调整模板
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
      <div className="text-sm font-medium">新建{family.label}模板</div>
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
            <span className="text-xs text-muted-foreground">模板名称</span>
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
            创建模板
          </Button>
        </div>
      </div>
    </form>
  )
}

export function CreateGallery() {
  const { project } = useCurrentProject()
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [error, setError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [pipelines, setPipelines] = useState<PipelineManifest[]>([])
  const [agentTemplates, setAgentTemplates] = useState<ProductionTemplate[]>([])
  const [reloadToken, setReloadToken] = useState(0)
  const [configReloadToken, setConfigReloadToken] = useState(0)
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null)
  const [newRecipeFamily, setNewRecipeFamily] = useState<string | null>(null)
  const [customized, setCustomized] = useState<Record<string, string>>({})
  const [configSummaryState, setConfigSummaryState] =
    useState<ConfigSummaryState>("loading")
  const [configFailures, setConfigFailures] = useState<Record<string, string>>(
    {}
  )
  const [diagnostics, setDiagnostics] = useState<SettingsDiagnosticCheck[]>([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoadState("loading")
      setError(null)
      setNewRecipeFamily(null)
      try {
        const [response, pipelineResponse] = await Promise.all([
          listTemplates(),
          listPipelines(),
        ])
        if (cancelled) {
          return
        }
        setCustomized({})
        setConfigFailures({})
        setConfigSummaryState("loading")
        setTemplates(response.templates)
        setPipelines(pipelineResponse.pipelines)
        setAgentTemplates(response.agent_templates ?? [])
        setLoadState("ready")
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
  }, [reloadToken])

  useEffect(() => {
    let cancelled = false
    void getSettingsDiagnostics()
      .then((response) => {
        if (!cancelled) setDiagnostics(response.checks)
      })
      .catch(() => {
        if (!cancelled) setDiagnostics([])
      })
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  useEffect(() => {
    if (loadState !== "ready") {
      return
    }

    const visible = templates.filter((template) => template.enabled)
    let cancelled = false

    async function loadConfigSummaries() {
      if (visible.length === 0) {
        setCustomized({})
        setConfigFailures({})
        setConfigSummaryState("ready")
        return
      }

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
      const failures: Record<string, string> = {}
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const failedTemplate = visible[index]
          failures[failedTemplate.id] = readableError(result.reason)
          return
        }
        const [id, keys] = result.value
        if (keys.length > 0) {
          summary[id] = keys
            .map((key) => PART_KEY_LABELS[key] ?? key)
            .join("、")
        }
      })

      setCustomized(summary)
      setConfigFailures(failures)
      const failureCount = Object.keys(failures).length
      if (failureCount === 0) {
        setConfigSummaryState("ready")
      } else {
        setConfigSummaryState(
          failureCount === visible.length ? "error" : "stale"
        )
      }
    }

    void loadConfigSummaries()

    return () => {
      cancelled = true
    }
  }, [configReloadToken, loadState, templates])

  const productTemplates = useMemo(
    () =>
      templates.filter(
        (template) => template.enabled
      ),
    [templates]
  )
  const families = useMemo<Family[]>(
    () =>
      FAMILY_PRESENTATION.flatMap((presentation) => {
        const familyPipelines = pipelines.filter(
          (pipeline) =>
            pipeline.product_family === presentation.id &&
            pipeline.access_scope === "public" &&
            pipeline.launch_surfaces.includes("react")
        )
        if (familyPipelines.length === 0) return []
        const pipelineIds = familyPipelines.map((pipeline) => pipeline.id)
        const newSources = familyPipelines.flatMap((pipeline) => {
          const skeleton = productTemplates.find(
            (template) =>
              template.pipeline_id === pipeline.id && !template.is_custom
          )
          return skeleton
            ? [
                {
                  pipelineId: pipeline.id,
                  skeletonId: skeleton.id,
                  label: pipeline.name,
                },
              ]
            : []
        })
        return [{ ...presentation, pipelineIds, newSources }]
      }),
    [pipelines, productTemplates]
  )
  const visibleAgentTemplates = agentTemplates
  const selectedFamily = families.find(
    (family) => family.id === selectedFamilyId
  ) ??
    families[0] ?? {
      id: "unavailable",
      label: "生产方式",
      tagline: "当前没有可从控制台发起的生产路线",
      icon: Video,
      pipelineIds: [],
      newSources: [],
    }
  const agentSelected =
    selectedFamilyId === AGENT_FAMILY_ID && visibleAgentTemplates.length > 0
  const selectedTemplates = productTemplates.filter((template) =>
    selectedFamily.pipelineIds.includes(template.pipeline_id)
  )
  const selectedConfigFailures = selectedTemplates.flatMap((template) => {
    const message = configFailures[template.id]
    return message ? [`${template.display_name}：${message}`] : []
  })
  const selectedConfigState =
    selectedConfigFailures.length === selectedTemplates.length
      ? "error"
      : "stale"
  const selectedConfigError = `${selectedConfigFailures.length} 份模板读取失败：${selectedConfigFailures
    .slice(0, 2)
    .join(
      "；"
    )}${selectedConfigFailures.length > 2 ? "；还有其他模板未能读取" : ""}`
  const hasAnyProduction =
    families.length > 0 || visibleAgentTemplates.length > 0
  const setupItems = appSetupReadiness(diagnostics, Boolean(project))
  const missingSetupItems = setupItems.filter((item) => !item.ok)

  return (
    <PageFrame>
      <WorkspaceHeader
        actions={
          project ? (
            <Badge
              className="max-w-full truncate"
              title={project.name}
              variant="outline"
            >
              {project.name}
            </Badge>
          ) : undefined
        }
        description="先选择成品类型，再用现成模板开始制作；需要长期调整的效果可以保存为自己的模板。"
        title="选择生产方式"
      />

      {diagnostics.length > 0 && missingSetupItems.length > 0 ? (
        <section className="rounded-lg border border-amber-300/70 bg-amber-50/70 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400" />
              <div>
                <h2 className="text-sm font-medium">首次使用还需完成基础设置</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  这些项目来自当前机器的真实检测；完成后提示会自动消失。
                </p>
              </div>
            </div>
            <Button
              onClick={() =>
                navigate(settingsLink({ kind: missingSetupItems[0].settingsKind }))
              }
              size="sm"
              variant="outline"
            >
              去完成第一项
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {setupItems.map((item) => (
              <div
                className="flex items-start gap-2 rounded-md border bg-background/80 px-3 py-2.5"
                key={item.id}
              >
                {item.ok ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-amber-500" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {item.message}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {loadState === "loading" ? (
        <AsyncState
          description="正在读取可用模板。"
          state="loading"
          title="正在读取模板"
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
          description={error || "暂时无法读取模板，请重试。"}
          state="error"
          title="模板读取失败"
        />
      ) : null}

      {loadState === "ready" && !hasAnyProduction ? (
        <EmptyState
          description="当前没有可用的生产模板。请先到设置中检查模板状态。"
          icon={Sparkles}
          title="暂无可用模板"
        />
      ) : null}

      {loadState === "ready" && hasAnyProduction ? (
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
              {families.map((family) => {
                const Icon = family.icon
                const active = !agentSelected && selectedFamily.id === family.id
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
              {visibleAgentTemplates.length > 0 ? (
                <button
                  aria-current={agentSelected ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 min-w-40 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-[var(--motion-duration-fast)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:min-w-0",
                    agentSelected
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  onClick={() => {
                    setSelectedFamilyId(AGENT_FAMILY_ID)
                    setNewRecipeFamily(null)
                  }}
                  type="button"
                >
                  <Bot className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-foreground">
                      Agent 专用制作
                    </span>
                    <span className="mt-0.5 hidden truncate text-xs text-muted-foreground lg:block">
                      Agent 配图，Pixelle 合成
                    </span>
                  </span>
                  <Badge variant={agentSelected ? "info" : "outline"}>
                    {visibleAgentTemplates.length}
                  </Badge>
                </button>
              ) : null}
            </nav>
          </WorkspacePanel>

          <div className="flex min-w-0 flex-col gap-5">
            {agentSelected ? (
              <WorkspacePanel
                description="了解 Agent 与 Pixelle 协作生成配图视频的方式，并调整长期默认设置"
                title="Agent 专用制作"
              >
                <div className="grid gap-3">
                  {visibleAgentTemplates.map((template) => (
                    <AgentRecipeCard key={template.id} template={template} />
                  ))}
                </div>
              </WorkspacePanel>
            ) : (
              <>
                <WorkspacePanel
                  description={selectedFamily.tagline}
                  headerAction={
                    <Button
                      aria-expanded={newRecipeFamily === selectedFamily.id}
                      className="min-h-11 sm:min-h-0"
                      onClick={() =>
                        setNewRecipeFamily((current) =>
                          current === selectedFamily.id
                            ? null
                            : selectedFamily.id
                        )
                      }
                      size="sm"
                      variant="outline"
                    >
                      <Plus data-icon="inline-start" />
                      新建模板
                    </Button>
                  }
                  title={selectedFamily.label}
                >
                  {selectedConfigFailures.length > 0 ? (
                    <AsyncState
                      action={
                        <Button
                          onClick={() => {
                            setConfigSummaryState("loading")
                            setConfigFailures({})
                            setConfigReloadToken((token) => token + 1)
                          }}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          重新读取默认设置
                        </Button>
                      }
                      className="mb-4 max-w-none"
                      description={selectedConfigError}
                      state={selectedConfigState}
                      title={
                        selectedConfigState === "error"
                          ? "无法读取模板默认设置"
                          : "部分模板默认设置可能已过期"
                      }
                    />
                  ) : null}

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
                          defaultsState={
                            configSummaryState === "loading"
                              ? "loading"
                              : configFailures[template.id]
                                ? "error"
                                : "ready"
                          }
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
                          新建模板
                        </Button>
                      }
                      className="min-h-64"
                      description="可以从这条生产方式的出厂设置创建一份。"
                      icon={selectedFamily.icon}
                      title="还没有可用模板"
                    />
                  )}
                </WorkspacePanel>
              </>
            )}
          </div>
        </div>
      ) : null}
    </PageFrame>
  )
}
