import { useEffect, useState, type FormEvent } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Loader2,
  Settings2,
  SlidersHorizontal,
} from "lucide-react"

import { AsyncState } from "@/components/shared/AsyncState"
import { EmptyState } from "@/components/shared/EmptyState"
import { PageFrame } from "@/components/shared/PageFrame"
import { WorkspaceHeader } from "@/components/shared/WorkspaceHeader"
import { WorkspacePanel } from "@/components/shared/WorkspacePanel"
import { UnsavedChangesGuard } from "@/components/settings/UnsavedChangesGuard"
import { RecipeGenerationSettings } from "@/components/recipe/RecipeGenerationSettings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { useExpertMode } from "@/lib/expertMode"
import { readableError } from "@/lib/format"
import {
  cloneProductionTemplate,
  listPipelines,
  listTemplates,
  templatesForManagement,
  type ProductionTemplate,
} from "@/lib/generationApi"
import { isCodexOnlyTemplate } from "@/lib/templatePresentation"
import {
  productionArtifactSummary,
  productionDescription,
  productionInputSummary,
  productionLineSummary,
  productionStartRoute,
  productionSubmissionSummary,
} from "@/lib/productionSurface"
import { navigate, routeHref, usePath } from "@/lib/router"
import { settingsLink } from "@/lib/settingsLinks"

/**
 * 模板详情页管理从写稿到成片的长期默认值。项目只选择默认模板，
 * 单次生产覆盖仍留在制作页。
 */

export function RecipeDetailPage({ templateId }: { templateId: string }) {
  const expertMode = useExpertMode()
  const path = usePath()
  const [template, setTemplate] = useState<ProductionTemplate | null>(null)
  const [resolvedTemplateId, setResolvedTemplateId] = useState<string | null>(
    null
  )
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pageReloadToken, setPageReloadToken] = useState(0)
  const [generationDirty, setGenerationDirty] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([listTemplates(), listPipelines()])
      .then(([templateResponse, pipelineResponse]) => {
        if (cancelled) {
          return
        }
        const found =
          templatesForManagement(templateResponse).find(
            (item) => item.id === templateId
          ) ?? null
        const foundPipeline = found
          ? (pipelineResponse.pipelines.find(
              (item) => item.id === found.pipeline_id
            ) ?? null)
          : null
        setResolvedTemplateId(templateId)
        setTemplate(found)
        setNotFound(!found)
        setLoadError(
          found && !foundPipeline
            ? `模板引用的生产路线 ${found.pipeline_id} 不存在。`
            : null
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

  function retryPageLoad() {
    setResolvedTemplateId(null)
    setTemplate(null)
    setNotFound(false)
    setLoadError(null)
    setPageReloadToken((value) => value + 1)
  }

  if (resolvedTemplateId !== templateId) {
    return (
      <PageFrame>
        <BackRow />
        <WorkspaceHeader
          description="查看这份模板的默认设置"
          title="模板详情"
        />
        <AsyncState
          description="正在同步模板信息。"
          state="loading"
          title="正在读取模板"
        />
      </PageFrame>
    )
  }

  if (loadError) {
    return (
      <PageFrame>
        <BackRow />
        <WorkspaceHeader
          description="查看这份模板的默认设置"
          title="模板详情"
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
          title="模板读取失败"
        />
      </PageFrame>
    )
  }

  if (notFound) {
    return (
      <PageFrame>
        <BackRow />
        <WorkspaceHeader
          description="查看这份模板的默认设置"
          title="模板详情"
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
          title="没有找到这份模板"
        />
      </PageFrame>
    )
  }

  if (!template) {
    return null
  }

  const codexOnly = isCodexOnlyTemplate(template)
  return (
    <PageFrame>
      <BackRow />
      <WorkspaceHeader
        actions={
          codexOnly ? undefined : (
            <Button asChild className="min-h-11 sm:min-h-9">
              <a href={routeHref(productionStartRoute(template))}>
                开始制作
                <ArrowRight data-icon="inline-end" />
              </a>
            </Button>
          )
        }
        description={
          <span>
            {codexOnly
              ? "调整长期默认值；保存后，Agent 下次制作时自动读取。"
              : "调整长期默认值。开始制作后，仍可以对当次内容单独调整。"}
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {template.display_name}
            <Badge variant="secondary">{productionLineSummary(template)}</Badge>
            {codexOnly ? <Badge variant="info">仅 Agent 发起</Badge> : null}
            {template.is_custom ? (
              <Badge variant="outline">我的模板</Badge>
            ) : null}
          </span>
        }
      />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <RecipeGenerationSettings
            codexOnly={codexOnly}
            expertMode={expertMode}
            onDirtyChange={setGenerationDirty}
            template={template}
          />
        </div>

        <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-5">
          <WorkspacePanel title="模板概览">
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
            </dl>
          </WorkspacePanel>

          <WorkspacePanel title="成品说明">
            <p className="text-sm leading-6 text-muted-foreground">
              {productionDescription(template)}
            </p>
          </WorkspacePanel>

          {codexOnly ? (
            <WorkspacePanel title="如何使用">
              <ol className="space-y-2 text-sm leading-6 text-muted-foreground">
                <li>1. 在 Agent 对话中提供主题或文案。</li>
                <li>2. 在控制台确认 Agent 给出的分镜和图片提示词。</li>
                <li>3. Agent 生成配图后，Pixelle 自动配音并合成视频。</li>
              </ol>
            </WorkspacePanel>
          ) : null}

          <WorkspacePanel title="管理模板">
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

      {!codexOnly ? (
        <div className="sticky bottom-[calc(4.25rem+var(--safe-area-bottom))] z-10 -mx-2 rounded-xl border bg-background/95 p-2 shadow-lg backdrop-blur lg:hidden">
          <Button asChild className="min-h-11 w-full">
            <a href={routeHref(productionStartRoute(template))}>
              开始制作
              <ArrowRight data-icon="inline-end" />
            </a>
          </Button>
        </div>
      ) : null}
      <UnsavedChangesGuard currentPath={path} dirty={generationDirty} />
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
        克隆为新模板
      </Button>
    )
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <label className="text-xs font-medium" htmlFor="clone-recipe-name">
        新模板名称
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
