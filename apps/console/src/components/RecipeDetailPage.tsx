import { useEffect, useState, type FormEvent } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Eye,
  Loader2,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
} from "lucide-react"

import { AsyncState } from "@/components/shared/AsyncState"
import { EmptyState } from "@/components/shared/EmptyState"
import { InlineError } from "@/components/shared/feedback"
import { PromptPeekSheet } from "@/components/shared/PromptPeekSheet"
import { PageFrame } from "@/components/shared/PageFrame"
import { WorkspaceHeader } from "@/components/shared/WorkspaceHeader"
import { WorkspacePanel } from "@/components/shared/WorkspacePanel"
import { UnsavedChangesGuard } from "@/components/settings/UnsavedChangesGuard"
import { RecipeGenerationSettings } from "@/components/recipe/RecipeGenerationSettings"
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
  createPromptTemplate,
  getTemplateDraftingConfig,
  listProjects,
  listScriptReviewTemplates,
  listTemplates,
  resetTemplateDraftingConfig,
  updatePromptTemplate,
  updateTemplateDraftingConfig,
  type DraftingSpec,
  type ProductionTemplate,
  type ScriptReviewPromptTemplate,
} from "@/lib/generationApi"
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
 * 配方详情页管理从写稿到成片的长期默认值。项目只选择默认配方，
 * 单次生产覆盖仍留在制作页。
 */

export function RecipeDetailPage({ templateId }: { templateId: string }) {
  const expertMode = useExpertMode()
  const path = usePath()
  const [template, setTemplate] = useState<ProductionTemplate | null>(null)
  const [projectUsers, setProjectUsers] = useState<string[]>([])
  const [resolvedTemplateId, setResolvedTemplateId] = useState<string | null>(
    null
  )
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pageReloadToken, setPageReloadToken] = useState(0)
  const [draftingDirty, setDraftingDirty] = useState(false)
  const [generationDirty, setGenerationDirty] = useState(false)

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
          {template.product_entry === "generate" &&
          template.input_requirements.includes("script") ? (
            <RecipeDraftingPanel
              onDirtyChange={setDraftingDirty}
              template={template}
            />
          ) : null}
          <RecipeGenerationSettings
            expertMode={expertMode}
            onDirtyChange={setGenerationDirty}
            templateId={template.id}
          />
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
      <UnsavedChangesGuard
        currentPath={path}
        dirty={draftingDirty || generationDirty}
      />
    </PageFrame>
  )
}

type PromptKind = "script" | "split"

function RecipeDraftingPanel({
  template,
  onDirtyChange,
}: {
  template: ProductionTemplate
  onDirtyChange: (dirty: boolean) => void
}) {
  const toast = useToast()
  const [drafting, setDrafting] = useState<DraftingSpec>(template.drafting)
  const [savedDrafting, setSavedDrafting] = useState<DraftingSpec>(
    template.drafting
  )
  const [scriptTemplates, setScriptTemplates] = useState<
    ScriptReviewPromptTemplate[]
  >([])
  const [splitTemplates, setSplitTemplates] = useState<
    ScriptReviewPromptTemplate[]
  >([])
  const [allRecipes, setAllRecipes] = useState<ProductionTemplate[]>([])
  const [isOverridden, setIsOverridden] = useState(false)
  const [languageModelsText, setLanguageModelsText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [peek, setPeek] = useState<{ kind: PromptKind; name: string } | null>(
    null
  )
  const [promptEdit, setPromptEdit] = useState<{
    kind: PromptKind
    name: string
    content: string
    originalContent: string
    source: string
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      getTemplateDraftingConfig(template.id),
      listScriptReviewTemplates(),
      listTemplates(),
    ])
      .then(([config, prompts, recipes]) => {
        if (cancelled) return
        setDrafting(config.drafting)
        setSavedDrafting(config.drafting)
        setLanguageModelsText(
          Object.entries(config.drafting.language_script_models)
            .map(([language, model]) => `${language}=${model}`)
            .join("\n")
        )
        setIsOverridden(config.is_overridden)
        setScriptTemplates(prompts.script_templates)
        setSplitTemplates(prompts.split_templates)
        setAllRecipes(recipes.templates)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(readableError(loadError))
      })
    return () => {
      cancelled = true
    }
  }, [template.id])

  const dirty = JSON.stringify(drafting) !== JSON.stringify(savedDrafting)
  const promptDirty = Boolean(
    promptEdit && promptEdit.content !== promptEdit.originalContent
  )
  useEffect(() => {
    onDirtyChange(dirty || promptDirty)
  }, [dirty, onDirtyChange, promptDirty])
  useEffect(() => {
    return () => onDirtyChange(false)
  }, [onDirtyChange])

  function setLanguageModels(value: string) {
    setLanguageModelsText(value)
    const entries: Record<string, string> = {}
    for (const rawLine of value.split("\n")) {
      const [language, ...modelParts] = rawLine.split("=")
      const model = modelParts.join("=").trim()
      if (language.trim() && model) entries[language.trim()] = model
    }
    setDrafting((current) => ({
      ...current,
      language_script_models: entries,
    }))
  }

  async function saveDrafting(next = drafting) {
    setBusy(true)
    setError(null)
    try {
      const response = await updateTemplateDraftingConfig(template.id, next)
      setDrafting(response.drafting)
      setSavedDrafting(response.drafting)
      setLanguageModelsText(
        Object.entries(response.drafting.language_script_models)
          .map(([language, model]) => `${language}=${model}`)
          .join("\n")
      )
      setIsOverridden(response.is_overridden)
      toast({ title: "写稿设置已保存", variant: "success" })
      return response.drafting
    } catch (saveError) {
      setError(readableError(saveError))
      return null
    } finally {
      setBusy(false)
    }
  }

  async function resetDrafting() {
    setBusy(true)
    setError(null)
    try {
      const response = await resetTemplateDraftingConfig(template.id)
      setDrafting(response.drafting)
      setSavedDrafting(response.drafting)
      setLanguageModelsText(
        Object.entries(response.drafting.language_script_models)
          .map(([language, model]) => `${language}=${model}`)
          .join("\n")
      )
      setIsOverridden(false)
      toast({ title: "已恢复配方内置写稿设置", variant: "success" })
    } catch (resetError) {
      setError(readableError(resetError))
    } finally {
      setBusy(false)
    }
  }

  function openPromptEditor(kind: PromptKind) {
    const name =
      kind === "script"
        ? drafting.script_template_name
        : drafting.split_template_name
    const pool = kind === "script" ? scriptTemplates : splitTemplates
    const selected = pool.find((item) => item.name === name)
    if (!selected) return
    setPromptEdit({
      kind,
      name,
      content: selected.content,
      originalContent: selected.content,
      source: selected.source,
    })
  }

  async function savePromptBody() {
    if (!promptEdit) return
    setBusy(true)
    setError(null)
    try {
      const usedByOtherRecipe = allRecipes.some(
        (recipe) =>
          recipe.id !== template.id &&
          (recipe.drafting.script_template_name === promptEdit.name ||
            recipe.drafting.split_template_name === promptEdit.name)
      )
      let name = promptEdit.name
      if (promptEdit.source === "builtin" || usedByOtherRecipe) {
        const created = await createPromptTemplate({
          kind: promptEdit.kind,
          name: `${template.display_name} · ${promptEdit.name}`,
          content: promptEdit.content,
        })
        name = created.name
      } else {
        await updatePromptTemplate({
          kind: promptEdit.kind,
          name,
          content: promptEdit.content,
        })
      }
      const next = {
        ...drafting,
        [promptEdit.kind === "script"
          ? "script_template_name"
          : "split_template_name"]: name,
      }
      const saved = await updateTemplateDraftingConfig(template.id, next)
      setDrafting(saved.drafting)
      setSavedDrafting(saved.drafting)
      setIsOverridden(saved.is_overridden)
      setPromptEdit(null)
      const prompts = await listScriptReviewTemplates()
      setScriptTemplates(prompts.script_templates)
      setSplitTemplates(prompts.split_templates)
      toast({ title: "提示词正文已保存", variant: "success" })
    } catch (promptError) {
      setError(readableError(promptError))
    } finally {
      setBusy(false)
    }
  }

  function promptField(kind: PromptKind) {
    const script = kind === "script"
    const pool = script ? scriptTemplates : splitTemplates
    const value = script
      ? drafting.script_template_name
      : drafting.split_template_name
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">
          {script ? "写稿 Prompt" : "分镜 Prompt"}
        </span>
        <div className="flex gap-1.5">
          <Select
            onValueChange={(name) =>
              setDrafting((current) => ({
                ...current,
                [script ? "script_template_name" : "split_template_name"]: name,
              }))
            }
            value={value}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pool.map((item) => (
                <SelectItem key={item.name} value={item.name}>
                  {item.name}
                  {item.source === "builtin" ? "（内置）" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            aria-label={`查看${script ? "写稿" : "分镜"}提示词`}
            onClick={() => setPeek({ kind, name: value })}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Eye />
          </Button>
          <Button
            onClick={() => openPromptEditor(kind)}
            size="sm"
            type="button"
            variant="outline"
          >
            编辑正文
          </Button>
        </div>
      </div>
    )
  }

  return (
    <WorkspacePanel
      description="设置如何把选题写成文案，并把文案改写为可生产的分镜文本。"
      title="文案生成"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {promptField("script")}
        {promptField("split")}
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs text-muted-foreground">写稿模型</span>
          <Input
            onChange={(event) =>
              setDrafting((current) => ({
                ...current,
                script_model: event.target.value,
              }))
            }
            placeholder="留空使用系统默认模型"
            value={drafting.script_model}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs text-muted-foreground">分镜模型</span>
          <Input
            onChange={(event) =>
              setDrafting((current) => ({
                ...current,
                split_model: event.target.value,
              }))
            }
            placeholder="留空使用系统默认模型"
            value={drafting.split_model}
          />
        </label>
      </div>
      <label className="mt-3 flex flex-col gap-1.5 text-sm">
        <span className="text-xs text-muted-foreground">
          按语言指定写稿模型（每行“语言=模型”）
        </span>
        <Textarea
          className="min-h-20 font-mono text-xs"
          onChange={(event) => setLanguageModels(event.target.value)}
          placeholder={"Chinese=gpt-4.1\nEnglish=gpt-4.1-mini"}
          value={languageModelsText}
        />
      </label>
      {promptEdit ? (
        <div className="mt-3 rounded-lg border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2 text-sm font-medium">
            <span>编辑：{promptEdit.name}</span>
            <Badge variant="outline">
              {promptEdit.source === "builtin" ? "保存为副本" : "自定义"}
            </Badge>
          </div>
          <Textarea
            className="mt-2 min-h-64 font-mono text-xs leading-5"
            onChange={(event) =>
              setPromptEdit((current) =>
                current ? { ...current, content: event.target.value } : current
              )
            }
            value={promptEdit.content}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              disabled={busy}
              onClick={() => setPromptEdit(null)}
              size="sm"
              variant="ghost"
            >
              取消
            </Button>
            <Button
              disabled={
                busy ||
                !promptEdit.content.trim() ||
                promptEdit.content === promptEdit.originalContent
              }
              onClick={() => void savePromptBody()}
              size="sm"
            >
              {busy ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : null}
              保存正文
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="mt-3">
          <InlineError message={error} title="写稿设置保存失败" />
        </div>
      ) : null}
      <div className="mt-4 flex justify-end gap-2 border-t pt-3">
        {isOverridden ? (
          <Button
            disabled={busy}
            onClick={() => void resetDrafting()}
            size="sm"
            variant="ghost"
          >
            <RotateCcw data-icon="inline-start" />
            恢复内置
          </Button>
        ) : null}
        <Button
          disabled={busy || !dirty}
          onClick={() => void saveDrafting()}
          size="sm"
        >
          {busy ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : null}
          保存写稿设置
        </Button>
      </div>
      <PromptPeekSheet
        kind={peek?.kind ?? "script"}
        name={peek?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) setPeek(null)
        }}
        open={peek != null}
      />
    </WorkspacePanel>
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
