import { useCallback, useEffect, useState } from "react"
import {
  ArrowLeft,
  Bot,
  FileText,
  Image,
  Loader2,
  Plus,
  Sparkles,
  X,
} from "lucide-react"

import {
  ContentLifecyclePanel,
  type ContentLifecycleAction,
} from "@/components/content/ContentLifecyclePanel"
import { AsyncState } from "@/components/shared/AsyncState"
import { EmptyState } from "@/components/shared/EmptyState"
import { PageFrame } from "@/components/shared/PageFrame"
import { WorkspaceHeader } from "@/components/shared/WorkspaceHeader"
import { WorkspacePanel } from "@/components/shared/WorkspacePanel"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { InlineError, TechDetails } from "@/components/shared/feedback"
import { ProductionSubmitPanel } from "@/components/shared/ProductionSubmitPanel"
import type { ProductionOverrides } from "@/components/shared/ProductionSubmitPanel"
import { draftSetProvenance, formatDate, readableError } from "@/lib/format"
import { languageLabel } from "@/lib/languages"
import {
  ACTOR_LABELS,
  eventTypeLabel,
  VARIANT_STATUS_LABELS,
} from "@/lib/contentItemMeta"
import { generateDraftsForItems } from "@/lib/contentDrafting"
import {
  buildProduceSubmissions,
  isProducibleItem,
  submitContentProduction,
} from "@/lib/produceContent"
import { ImageSetView } from "@/components/shared/ImageSetView"
import { TextArticleView } from "@/components/shared/TextArticleView"
import { imageSetLabel } from "@/lib/imageSet"
import { routeHref } from "@/lib/router"
import { cn } from "@/lib/utils"
import { useCurrentProject } from "@/lib/currentProject"
import { useTaskCenter } from "@/lib/taskCenter"
import {
  artifactFileUrl,
  createContentItems,
  getContentItem,
  getScriptReviewDraftSet,
  getTaskResult,
  patchContentItem,
  transitionContentItem,
  updateScriptReviewDraftSet,
  type ContentItem,
  type GenerationResult,
  type ScriptReviewDraft,
} from "@/lib/generationApi"

/**
 * 内容详情页（/board/item/:id）：抽屉的继任者（DESIGN.md §2.5：分钟级多分区
 * 工作必须页面）。左=多语言文案与分镜编辑，右=状态/溯源/产物/发布/数据/动态。
 * 出片走共享提交管线（lib/produceContent），与看板多选出片行为一致。
 */

type VariantDraft = { title: string; script: string; narrations: string[] }

function scrollToSection(id: string) {
  const target = document.getElementById(id)
  if (!target) {
    return
  }
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches
  target.focus({ preventScroll: true })
  target.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "center",
  })
}

export function ContentItemDetailPage({ itemId }: { itemId: string }) {
  const toast = useToast()
  const taskCenter = useTaskCenter()
  const { projectId } = useCurrentProject()
  const [item, setItem] = useState<ContentItem | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeLanguage, setActiveLanguage] = useState<string | null>(null)
  const [variantDrafts, setVariantDrafts] = useState<
    Record<string, VariantDraft>
  >({})
  const [results, setResults] = useState<
    Record<string, GenerationResult | null>
  >({})
  const [provenance, setProvenance] = useState<string | null>(null)
  const [metricsDraft, setMetricsDraft] = useState({
    likes: "",
    favorites: "",
    comments: "",
    note: "",
  })
  const [derivedText, setDerivedText] = useState("")
  const [derivedOpen, setDerivedOpen] = useState(false)
  const [eventsExpanded, setEventsExpanded] = useState(false)
  const [produceOpen, setProduceOpen] = useState(false)
  const [produceTemplateId, setProduceTemplateId] = useState("")
  const [produceOverrides, setProduceOverrides] = useState<ProductionOverrides>(
    {}
  )
  const [producing, setProducing] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  const refresh = useCallback(() => setReloadToken((token) => token + 1), [])

  // 加载条目（生产中时 15s 轮询等待回写）
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    async function load() {
      try {
        const next = await getContentItem(itemId)
        if (cancelled) {
          return
        }
        setItem(next)
        setLoadError(null)
        if (next.status === "producing") {
          timer = window.setTimeout(() => setReloadToken((t) => t + 1), 15_000)
        }
      } catch (fetchError) {
        if (!cancelled) {
          setLoadError(readableError(fetchError))
        }
      }
    }

    void load()
    return () => {
      cancelled = true
      if (timer) {
        window.clearTimeout(timer)
      }
    }
  }, [itemId, reloadToken])

  // 条目/状态跃迁时重置编辑态（同状态轮询不冲掉编辑）——渲染期调整模式
  const initKey = item ? `${item.item_id}:${item.status}` : null
  const [initializedFor, setInitializedFor] = useState<string | null>(null)
  if (item && initKey && initializedFor !== initKey) {
    setInitializedFor(initKey)
    const drafts: Record<string, VariantDraft> = {}
    const languages = Array.from(
      new Set([...item.languages, ...Object.keys(item.variants)])
    )
    for (const language of languages) {
      const variant = item.variants[language]
      drafts[language] = {
        title: variant?.title ?? "",
        script: variant?.script ?? "",
        narrations: variant?.narrations?.length
          ? [...variant.narrations]
          : [""],
      }
    }
    setVariantDrafts(drafts)
    setActiveLanguage((current) =>
      current && languages.includes(current) ? current : (languages[0] ?? null)
    )
    setError(null)
    setDerivedText(`${item.title} 的后续`)
    setMetricsDraft({
      likes: item.metrics.likes != null ? String(item.metrics.likes) : "",
      favorites:
        item.metrics.favorites != null ? String(item.metrics.favorites) : "",
      comments:
        item.metrics.comments != null ? String(item.metrics.comments) : "",
      note: item.metrics.note ?? "",
    })
  }

  // 产物
  useEffect(() => {
    const taskIds = item?.links.task_ids ?? []
    if (taskIds.length === 0) {
      return
    }
    let cancelled = false
    void Promise.allSettled(taskIds.map((id) => getTaskResult(id))).then(
      (settled) => {
        if (cancelled) {
          return
        }
        const next: Record<string, GenerationResult | null> = {}
        taskIds.forEach((id, index) => {
          const outcome = settled[index]
          next[id] = outcome.status === "fulfilled" ? outcome.value : null
        })
        setResults(next)
      }
    )
    return () => {
      cancelled = true
    }
  }, [item?.links.task_ids])

  // 溯源
  useEffect(() => {
    const draftSetId = item?.links.draft_set_id
    if (!draftSetId) {
      return
    }
    let cancelled = false
    void getScriptReviewDraftSet(String(draftSetId))
      .then((draftSet) => {
        if (!cancelled) {
          setProvenance(draftSetProvenance(draftSet))
        }
      })
      .catch(() => {
        // 拿不到不显示
      })
    return () => {
      cancelled = true
    }
  }, [item?.links.draft_set_id])

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true)
      setError(null)
      try {
        await action()
        refresh()
      } catch (actionError) {
        setError(readableError(actionError))
      } finally {
        setBusy(false)
      }
    },
    [refresh]
  )

  if (loadError && !item) {
    return (
      <PageFrame>
        <BackRow />
        <WorkspaceHeader
          description="无法读取这条内容。返回工作台选择其他内容，或重新尝试。"
          title="内容暂时不可用"
        />
        <AsyncState
          action={
            <Button onClick={refresh} size="sm" variant="outline">
              重新读取
            </Button>
          }
          className="max-w-none"
          description={loadError}
          state="error"
          title="内容读取失败"
        />
      </PageFrame>
    )
  }

  if (!item) {
    return (
      <PageFrame>
        <BackRow />
        <WorkspaceHeader
          description="正在同步内容、语言版本与关联产物。"
          title="内容详情"
        />
        <AsyncState
          className="max-w-none"
          state="loading"
          title="正在读取内容…"
        />
      </PageFrame>
    )
  }

  const languages = Array.from(
    new Set([...item.languages, ...Object.keys(item.variants)])
  )
  const isReviewing = item.status === "pending_review"
  const allConfirmed =
    item.languages.length > 0 &&
    item.languages.every((lang) => item.variants[lang]?.status === "confirmed")
  const taskIds = item.links.task_ids ?? []
  const completedTaskId =
    taskIds.find((id) => results[id]?.status === "completed") ?? taskIds[0]
  // 发布区按本条目「最新完成任务」的产物形态分支（三态并存时以最新为准）
  const latestCompletedResult =
    [...taskIds].reverse().find((id) => results[id]?.status === "completed") ??
    null
  const publishArtifactType =
    (latestCompletedResult && results[latestCompletedResult]?.artifact_type) ||
    "video"
  const isNonVideoPublish = publishArtifactType !== "video"
  const nonVideoPublishNoun = publishArtifactType === "text" ? "长文" : "图集"
  const canProduce = isProducibleItem(item) && item.status !== "idea"
  const produceSubmissions = buildProduceSubmissions([item])
  const currentLanguage = activeLanguage ?? languages[0] ?? null
  const currentDraft: VariantDraft = (currentLanguage &&
    variantDrafts[currentLanguage]) || {
    title: "",
    script: "",
    narrations: [""],
  }
  const currentVariant = currentLanguage
    ? item.variants[currentLanguage]
    : undefined

  function patchCurrentDraft(patch: Partial<VariantDraft>) {
    if (!currentLanguage) {
      return
    }
    setVariantDrafts((current) => ({
      ...current,
      [currentLanguage]: { ...currentDraft, ...patch },
    }))
  }

  function cleanNarrations(values: string[]) {
    return values.map((line) => line.trim()).filter(Boolean)
  }

  async function syncDraftSet() {
    const draftSetId = item!.links.draft_set_id
    const draftIndex = item!.links.draft_index
    if (!draftSetId || draftIndex == null) {
      return
    }
    const draftSet = await getScriptReviewDraftSet(String(draftSetId))
    const drafts: ScriptReviewDraft[] = draftSet.drafts.map((draft) => {
      if (draft.index !== draftIndex) {
        return draft
      }
      const languageDrafts = { ...(draft.language_drafts ?? {}) }
      for (const [language, edited] of Object.entries(variantDrafts)) {
        languageDrafts[language] = {
          title: edited.title,
          script: edited.script,
          narrations: cleanNarrations(edited.narrations),
        }
      }
      return { ...draft, language_drafts: languageDrafts }
    })
    await updateScriptReviewDraftSet(String(draftSetId), { drafts })
  }

  async function confirmVariant(language: string) {
    const draft = variantDrafts[language]
    await patchContentItem(item!.item_id, {
      variants: {
        [language]: {
          status: "confirmed",
          title: draft?.title ?? "",
          script: draft?.script ?? "",
          narrations: cleanNarrations(draft?.narrations ?? []),
        },
      },
    })
    await syncDraftSet()
  }

  async function rejectVariant(language: string) {
    const draft = variantDrafts[language]
    await patchContentItem(item!.item_id, {
      variants: {
        [language]: {
          status: "rejected",
          script: draft?.script ?? "",
          narrations: cleanNarrations(draft?.narrations ?? []),
        },
      },
    })
    await syncDraftSet()
    if (item!.status === "pending_review") {
      await transitionContentItem(item!.item_id, "draft_ready", {
        reason: "打回重写",
      })
    }
  }

  async function confirmItem() {
    for (const language of item!.languages) {
      const draft = variantDrafts[language]
      if (!draft) {
        continue
      }
      await patchContentItem(item!.item_id, {
        variants: {
          [language]: {
            status: "confirmed",
            title: draft.title,
            script: draft.script,
            narrations: cleanNarrations(draft.narrations),
          },
        },
      })
    }
    await syncDraftSet()
    await transitionContentItem(item!.item_id, "confirmed")
  }

  async function submitProduce() {
    if (!produceTemplateId || produceSubmissions.length === 0) {
      return
    }
    setProducing(true)
    try {
      await submitContentProduction({
        submissions: produceSubmissions,
        templateId: produceTemplateId,
        overrides: produceOverrides,
        projectId: projectId ?? undefined,
        allItems: [item!],
        trackTask: taskCenter.trackTask,
      })
      toast({ title: "出片已提交", variant: "success" })
      setProduceOpen(false)
      refresh()
    } catch (produceError) {
      toast({
        title: "出片失败",
        description: readableError(produceError),
        variant: "error",
      })
    } finally {
      setProducing(false)
    }
  }

  async function saveMetrics() {
    const metrics: Record<string, unknown> = {
      recorded_at: new Date().toISOString(),
    }
    if (metricsDraft.likes.trim()) metrics.likes = Number(metricsDraft.likes)
    if (metricsDraft.favorites.trim())
      metrics.favorites = Number(metricsDraft.favorites)
    if (metricsDraft.comments.trim())
      metrics.comments = Number(metricsDraft.comments)
    if (metricsDraft.note.trim()) metrics.note = metricsDraft.note.trim()
    await patchContentItem(item!.item_id, { metrics })
    if (item!.status === "published") {
      await transitionContentItem(item!.item_id, "measured")
    }
  }

  const events = [...item.events].reverse()
  const visibleEvents = eventsExpanded ? events : events.slice(0, 3)

  // 右栏速览定义行：溯源 + 零散元数据合并，缺值不渲染（无「未返回」占位）
  const overviewItems: Array<{ label: string; value: string }> = [
    {
      label: "创建时间",
      value: item.created_at ? formatDate(item.created_at) : "",
    },
    {
      label: "语言",
      value: languages.length > 0 ? `${languages.length} 种` : "",
    },
    { label: "溯源", value: provenance || "" },
    {
      label: "关联任务",
      value: taskIds.length > 0 ? `${taskIds.length} 个` : "",
    },
  ].filter((overview) => overview.value)

  const sourceLabel =
    item.source === "agent"
      ? "AI 起草"
      : item.source === "derived"
        ? "衍生选题"
        : "手动添加"
  const languageSummary =
    languages.length > 0
      ? languages
          .map(
            (language) =>
              `${languageLabel(language)} ${
                item.variants[language]?.status === "confirmed"
                  ? "已确认"
                  : item.variants[language]?.status === "rejected"
                    ? "已打回"
                    : "待确认"
              }`
          )
          .join(" · ")
      : item.kind === "asset"
        ? "素材内容"
        : "尚无语言版本"
  const nextPendingLanguage = item.languages.find(
    (language) => item.variants[language]?.status !== "confirmed"
  )

  let lifecycleGuidance = "当前阶段没有需要处理的动作。"
  let lifecycleAction: ContentLifecycleAction | undefined

  switch (item.status) {
    case "idea":
      if (item.kind === "text") {
        lifecycleGuidance = "先生成草稿，再逐个审核语言版本。"
        lifecycleAction = {
          label: "生成草稿",
          loading: busy,
          onClick: () => {
            void run(async () => {
              await generateDraftsForItems([item], toast, refresh)
            })
          },
        }
      } else {
        lifecycleGuidance = "素材内容需要从快速生产入口选择生成方式。"
        lifecycleAction = {
          href: routeHref("/create"),
          label: "前往快速生产",
        }
      }
      break
    case "drafting":
      lifecycleGuidance = "草稿正在生成，完成后会自动进入下一阶段。"
      lifecycleAction = { label: "刷新状态", onClick: refresh }
      break
    case "draft_ready":
      lifecycleGuidance = "草稿已经返回，等待进入审核。"
      lifecycleAction = { label: "刷新状态", onClick: refresh }
      break
    case "pending_review":
      if (allConfirmed) {
        lifecycleGuidance = "所有语言版本都已确认，可以完成本轮审核。"
        lifecycleAction = {
          label: "确认全部语言",
          loading: busy,
          onClick: () => {
            void run(confirmItem)
          },
        }
      } else if (nextPendingLanguage) {
        lifecycleGuidance = `继续审核 ${languageLabel(nextPendingLanguage)} 版本。`
        lifecycleAction = {
          label: `审核${languageLabel(nextPendingLanguage)}版`,
          onClick: () => {
            setActiveLanguage(nextPendingLanguage)
            window.requestAnimationFrame(() =>
              scrollToSection("content-editor")
            )
          },
        }
      } else {
        lifecycleGuidance = "当前没有可审核的语言版本。"
      }
      break
    case "confirmed":
      if (canProduce) {
        lifecycleGuidance = "审核已完成，选择生产模板并提交出片。"
        lifecycleAction = {
          disabled: produceSubmissions.length === 0,
          helper:
            produceSubmissions.length === 0
              ? "请先确认至少一个语言版本。"
              : undefined,
          label: "开始出片",
          onClick: () => setProduceOpen(true),
        }
      } else {
        lifecycleGuidance = "这类素材需要从快速生产入口继续。"
        lifecycleAction = {
          href: routeHref("/create"),
          label: "前往快速生产",
        }
      }
      break
    case "producing":
      lifecycleGuidance = "生产任务正在运行，完成后页面会自动刷新。"
      lifecycleAction = {
        href: routeHref("/tasks"),
        label: "查看任务",
      }
      break
    case "produced":
    case "scheduled":
      lifecycleGuidance = isNonVideoPublish
        ? `检查${nonVideoPublishNoun}产物后，手动发布到目标平台。`
        : "检查作品并前往发布。"
      lifecycleAction = isNonVideoPublish
        ? {
            label: "查看产物",
            onClick: () => scrollToSection("product-artifacts"),
          }
        : {
            disabled: !completedTaskId,
            helper: completedTaskId ? undefined : "等待产物任务就绪后可发布。",
            href: routeHref(`/library?task=${completedTaskId ?? ""}`),
            label: "去发布",
          }
      break
    case "published":
      lifecycleGuidance = "录入发布数据，保存后完成本轮复盘。"
      lifecycleAction = {
        label: "保存并标记已复盘",
        loading: busy,
        onClick: () => {
          void run(saveMetrics)
        },
      }
      break
    case "measured":
      lifecycleGuidance = "本轮已复盘；后续可以继续更新数据。"
      lifecycleAction = {
        label: "更新数据",
        loading: busy,
        onClick: () => {
          void run(saveMetrics)
        },
      }
      break
    case "archived":
      lifecycleGuidance = "内容已归档，不再进入后续生产阶段。"
      break
  }

  return (
    <PageFrame>
      <BackRow />
      <WorkspaceHeader
        description={
          <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {item.source === "agent" ? (
              <Bot className="size-3.5" aria-hidden="true" />
            ) : item.source === "derived" ? (
              <Sparkles className="size-3.5" aria-hidden="true" />
            ) : null}
            <span>{sourceLabel}</span>
            <span aria-hidden="true">·</span>
            <span>更新于 {formatDate(item.updated_at)}</span>
          </span>
        }
        title={item.title}
      />

      {loadError ? (
        <AsyncState
          action={
            <Button onClick={refresh} size="sm" variant="outline">
              重新读取
            </Button>
          }
          className="max-w-none"
          description={`${loadError} 当前仍展示上一次成功读取的内容。`}
          state="stale"
          title="内容可能已过期"
        />
      ) : null}

      {error && <InlineError title="操作失败" message={error} />}

      <div className="sticky top-[calc(6.5rem+0.5rem)] z-20 lg:hidden">
        <ContentLifecyclePanel
          action={lifecycleAction}
          guidance={lifecycleGuidance}
          status={item.status}
          summary={languageSummary}
        />
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        {/* 左：多语言文案与分镜 */}
        <WorkspacePanel
          contentClassName="flex flex-col gap-4"
          description={
            isReviewing
              ? "逐个检查标题、口播全文与分镜；确认后再完成整条内容的审核。"
              : "查看当前内容的语言版本、文案与分镜。"
          }
          id="content-editor"
          tabIndex={-1}
          title={isReviewing ? "审核与编辑" : "内容版本"}
        >
          {item.status === "idea" && item.kind === "text" ? (
            <EmptyState
              className="min-h-64 border-0 bg-muted/20"
              description="这个选题还没有文案。使用生命周期栏的下一步生成草稿，之后再逐个审核语言版本。"
              icon={FileText}
              title="还没有草稿"
            />
          ) : null}

          {item.kind === "asset" ? (
            <EmptyState
              className="min-h-64 border-0 bg-muted/20"
              description="素材内容需要从快速生产入口选择生成方式；这里仍保留它的生命周期与发布记录。"
              icon={Image}
              title="素材内容"
            />
          ) : null}

          {languages.length > 0 ? (
            <Tabs
              onValueChange={setActiveLanguage}
              value={currentLanguage ?? undefined}
            >
              <div className="overflow-x-auto">
                <TabsList
                  aria-label="语言版本"
                  className="h-11 w-max min-w-full justify-start"
                  variant="line"
                >
                  {languages.map((language) => {
                    const status = item.variants[language]?.status ?? "pending"
                    return (
                      <TabsTrigger
                        className="h-11 shrink-0 px-3"
                        key={language}
                        value={language}
                      >
                        {languageLabel(language)} ·{" "}
                        {status === "rejected"
                          ? "已打回"
                          : VARIANT_STATUS_LABELS[status]}
                      </TabsTrigger>
                    )
                  })}
                </TabsList>
              </div>

              <TabsContent className="mt-4" value={currentLanguage ?? ""}>
                {currentLanguage && isReviewing ? (
                  <div className="flex flex-col gap-4">
                    <FieldGroup>
                      <Field>
                        <FieldLabel
                          htmlFor={`content-title-${currentLanguage}`}
                        >
                          标题
                        </FieldLabel>
                        <Input
                          autoComplete="off"
                          id={`content-title-${currentLanguage}`}
                          name={`title-${currentLanguage}`}
                          onChange={(event) =>
                            patchCurrentDraft({ title: event.target.value })
                          }
                          placeholder="输入发布标题…"
                          value={currentDraft.title}
                        />
                      </Field>

                      <Field>
                        <FieldLabel
                          htmlFor={`content-script-${currentLanguage}`}
                        >
                          口播全文
                        </FieldLabel>
                        <Textarea
                          autoComplete="off"
                          className="min-h-44 resize-y leading-7"
                          id={`content-script-${currentLanguage}`}
                          name={`script-${currentLanguage}`}
                          onChange={(event) =>
                            patchCurrentDraft({ script: event.target.value })
                          }
                          placeholder="输入完整口播文案…"
                          value={currentDraft.script}
                        />
                      </Field>
                    </FieldGroup>

                    <FieldSet>
                      <FieldLegend variant="label">分镜</FieldLegend>
                      <FieldDescription>
                        每行一镜，出片按行直出；当前{" "}
                        {cleanNarrations(currentDraft.narrations).length} 镜。
                      </FieldDescription>
                      <FieldGroup className="gap-2">
                        {currentDraft.narrations.map((line, index) => (
                          <Field
                            className="min-w-0"
                            key={index}
                            orientation="horizontal"
                          >
                            <FieldLabel
                              className="sr-only"
                              htmlFor={`content-scene-${currentLanguage}-${index}`}
                            >
                              第 {index + 1} 镜
                            </FieldLabel>
                            <span className="w-5 text-right text-xs text-muted-foreground">
                              {index + 1}
                            </span>
                            <Input
                              autoComplete="off"
                              className="min-w-0 flex-1"
                              id={`content-scene-${currentLanguage}-${index}`}
                              name={`scene-${currentLanguage}-${index}`}
                              onChange={(event) => {
                                const next = [...currentDraft.narrations]
                                next[index] = event.target.value
                                patchCurrentDraft({ narrations: next })
                              }}
                              placeholder="一句 = 一个画面 + 一段配音…"
                              value={line}
                            />
                            <Button
                              aria-label="删除这一镜"
                              className="size-11 shrink-0 sm:size-7"
                              onClick={() => {
                                const next = currentDraft.narrations.filter(
                                  (_, i) => i !== index
                                )
                                patchCurrentDraft({
                                  narrations: next.length > 0 ? next : [""],
                                })
                              }}
                              size="icon-sm"
                              variant="ghost"
                            >
                              <X />
                            </Button>
                          </Field>
                        ))}
                        <Button
                          className="h-11 self-start sm:h-7"
                          onClick={() =>
                            patchCurrentDraft({
                              narrations: [...currentDraft.narrations, ""],
                            })
                          }
                          size="sm"
                          variant="ghost"
                        >
                          <Plus data-icon="inline-start" />
                          加一镜
                        </Button>
                      </FieldGroup>
                    </FieldSet>

                    <div className="flex justify-end gap-2 border-t pt-3">
                      <Button
                        className="h-11 sm:h-8"
                        disabled={busy}
                        onClick={() =>
                          void run(() => rejectVariant(currentLanguage))
                        }
                        variant="ghost"
                      >
                        打回这版
                      </Button>
                      <Button
                        className="h-11 sm:h-8"
                        disabled={busy}
                        onClick={() =>
                          void run(() => confirmVariant(currentLanguage))
                        }
                        variant="outline"
                      >
                        确认{languageLabel(currentLanguage)}版
                      </Button>
                    </div>
                  </div>
                ) : (
                  currentLanguage && (
                    <div className="flex flex-col gap-3">
                      {currentVariant?.title && (
                        <div className="text-sm font-medium">
                          {currentVariant.title}
                        </div>
                      )}
                      <p className="text-sm leading-7 whitespace-pre-wrap text-muted-foreground">
                        {currentVariant?.script || "（暂无文案）"}
                      </p>
                      {(currentVariant?.narrations?.length ?? 0) > 0 && (
                        <div className="overflow-hidden rounded-lg border">
                          {currentVariant!.narrations.map((line, index) => (
                            <div
                              className={
                                index > 0
                                  ? "flex gap-2 border-t px-3 py-1.5 text-sm"
                                  : "flex gap-2 px-3 py-1.5 text-sm"
                              }
                              key={index}
                            >
                              <span className="text-xs text-muted-foreground">
                                {index + 1}
                              </span>
                              {line}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                )}
              </TabsContent>
            </Tabs>
          ) : item.status !== "idea" && item.kind !== "asset" ? (
            <EmptyState
              className="min-h-56 border-0 bg-muted/20"
              description="这条内容尚未返回可查看的语言版本。"
              icon={FileText}
              title="暂无语言版本"
            />
          ) : null}
        </WorkspacePanel>

        {/* 右：状态 / 概览 / 产物 / 发布 / 数据 / 动态 */}
        <aside className="flex min-w-0 flex-col gap-4">
          <div className="sticky top-[calc(4.25rem+1rem)] z-20 hidden lg:block">
            <ContentLifecyclePanel
              action={lifecycleAction}
              guidance={lifecycleGuidance}
              status={item.status}
              summary={languageSummary}
            />
          </div>

          {overviewItems.length > 0 && (
            <WorkspacePanel
              contentClassName="pt-3"
              padding="none"
              title="内容概览"
              variant="plain"
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                {overviewItems.map((overview) => (
                  <div key={overview.label}>
                    <dt className="text-xs text-muted-foreground">
                      {overview.label}
                    </dt>
                    <dd className="mt-0.5 text-sm break-words">
                      {overview.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </WorkspacePanel>
          )}

          {taskIds.length > 0 && (
            <WorkspacePanel
              className="scroll-mt-28"
              padding="compact"
              id="product-artifacts"
              tabIndex={-1}
              title="产物"
            >
              <div className="flex flex-col gap-2">
                {taskIds.map((taskId) => {
                  const result = results[taskId]
                  if (result?.artifact_type === "text") {
                    const article =
                      typeof result.metadata?.article === "string"
                        ? result.metadata.article
                        : ""
                    return article ? (
                      <TextArticleView
                        article={article}
                        key={taskId}
                        title={
                          typeof result.metadata?.title === "string"
                            ? result.metadata.title
                            : item.title
                        }
                      />
                    ) : (
                      <AsyncState
                        className="max-w-none"
                        description="任务完成后会在这里显示全文。"
                        key={taskId}
                        state="loading"
                        title="长文尚未就绪"
                      />
                    )
                  }
                  if (result?.artifact_type === "image_set") {
                    const items = result.artifacts
                      .filter((artifact) => artifact.kind === "image")
                      .map((artifact, index) => ({
                        url: artifactFileUrl(artifact) ?? "",
                        label: imageSetLabel(index, artifact.role),
                      }))
                      .filter((item) => item.url)
                    return (
                      <ImageSetView
                        caption={
                          typeof result.metadata?.caption === "string"
                            ? result.metadata.caption
                            : null
                        }
                        items={items}
                        key={taskId}
                      />
                    )
                  }
                  const url =
                    result && result.primary_video
                      ? artifactFileUrl(result.primary_video)
                      : null
                  return url ? (
                    <video
                      className="w-full rounded-md"
                      controls
                      key={taskId}
                      preload="metadata"
                      src={url}
                    />
                  ) : (
                    <AsyncState
                      className="max-w-none"
                      description="任务完成后会在这里显示作品。"
                      key={taskId}
                      state="loading"
                      title="产物尚未就绪"
                    />
                  )
                })}
              </div>
            </WorkspacePanel>
          )}

          {(item.status === "produced" || item.status === "scheduled") && (
            <WorkspacePanel padding="compact" title="发布记录">
              {isNonVideoPublish && (
                <p className="mb-2 text-xs leading-5 text-muted-foreground">
                  {nonVideoPublishNoun}暂不支持自动发布，请先
                  {publishArtifactType === "text" ? "复制全文" : "下载图集"}
                  ，再手动发到平台。
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {item.status === "produced" && (
                  <Button
                    className="h-11 sm:h-7"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await transitionContentItem(item!.item_id, "scheduled")
                      })
                    }
                    size="sm"
                    variant="outline"
                  >
                    标记已排期
                  </Button>
                )}
                <Button
                  className="h-11 sm:h-7"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (item!.status === "produced") {
                        await transitionContentItem(item!.item_id, "scheduled")
                      }
                      await transitionContentItem(item!.item_id, "published")
                    })
                  }
                  size="sm"
                  variant="outline"
                >
                  标记已发布
                </Button>
              </div>
            </WorkspacePanel>
          )}

          {(item.status === "published" || item.status === "measured") && (
            <WorkspacePanel padding="compact" title="数据与复盘">
              <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {(
                  [
                    ["likes", "赞"],
                    ["favorites", "收藏"],
                    ["comments", "评论"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key}>
                    <FieldLabel htmlFor={`metrics-${key}`}>{label}</FieldLabel>
                    <Input
                      autoComplete="off"
                      id={`metrics-${key}`}
                      inputMode="numeric"
                      min="0"
                      name={key}
                      onChange={(event) =>
                        setMetricsDraft((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                      type="number"
                      value={metricsDraft[key]}
                    />
                  </Field>
                ))}
              </FieldGroup>
              <Field className="mt-3">
                <FieldLabel htmlFor="metrics-note">复盘备注</FieldLabel>
                <Textarea
                  autoComplete="off"
                  id="metrics-note"
                  name="metrics-note"
                  onChange={(event) =>
                    setMetricsDraft((current) => ({
                      ...current,
                      note: event.target.value,
                    }))
                  }
                  placeholder="记录有效信号或后续调整…"
                  rows={3}
                  value={metricsDraft.note}
                />
                <FieldDescription>
                  使用上方生命周期栏的唯一下一步保存本轮数据。
                </FieldDescription>
              </Field>
              <div className="mt-3 border-t pt-2">
                <Button
                  aria-expanded={derivedOpen}
                  className="h-11 px-0 sm:h-7"
                  onClick={() => setDerivedOpen((value) => !value)}
                  size="sm"
                  variant="ghost"
                >
                  {derivedOpen ? "收起衍生选题" : "衍生新选题"}
                </Button>
                {derivedOpen && (
                  <div className="mt-2 flex flex-col gap-2">
                    <Field>
                      <FieldLabel htmlFor="derived-topics">衍生选题</FieldLabel>
                      <Textarea
                        autoComplete="off"
                        id="derived-topics"
                        name="derived-topics"
                        onChange={(event) => setDerivedText(event.target.value)}
                        placeholder="每行输入一个选题…"
                        rows={3}
                        value={derivedText}
                      />
                    </Field>
                    <Button
                      className="h-11 self-end sm:h-7"
                      disabled={busy || !derivedText.trim()}
                      onClick={() =>
                        void run(async () => {
                          const titles = derivedText
                            .split("\n")
                            .map((line) => line.trim())
                            .filter(Boolean)
                          if (titles.length > 0) {
                            await createContentItems({
                              titles,
                              source: "derived",
                              projectId: item!.project,
                            })
                            toast({
                              title: `已加入 ${titles.length} 个衍生选题`,
                              variant: "success",
                            })
                          }
                          setDerivedOpen(false)
                        })
                      }
                      size="sm"
                      variant="outline"
                    >
                      加入选题池
                    </Button>
                  </div>
                )}
              </div>
            </WorkspacePanel>
          )}

          <WorkspacePanel padding="none" title="动态" variant="plain">
            <div className="flex flex-col">
              {visibleEvents.map((event, index) => {
                const reason = (event.detail as { reason?: unknown })?.reason
                const hasReason = Boolean(reason)
                return (
                  <div className="border-b py-2 last:border-0" key={index}>
                    <div
                      className={cn("text-sm", hasReason && "text-destructive")}
                    >
                      {eventTypeLabel(event.type)}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {ACTOR_LABELS[event.actor] ?? event.actor} ·{" "}
                      {formatDate(event.at)}
                    </div>
                    {hasReason && (
                      <div className="mt-1 text-xs leading-5 text-destructive">
                        {String(reason)}
                      </div>
                    )}
                  </div>
                )
              })}
              {events.length === 0 ? (
                <p className="py-3 text-xs text-muted-foreground">暂无动态</p>
              ) : null}
              {events.length > 3 && (
                <Button
                  className="mt-2 h-11 self-start px-0 sm:h-7"
                  onClick={() => setEventsExpanded((value) => !value)}
                  size="sm"
                  variant="ghost"
                >
                  {eventsExpanded ? "收起" : `展开全部 ${events.length} 条`}
                </Button>
              )}
            </div>
          </WorkspacePanel>

          <TechDetails
            items={[
              { label: "项目", value: item.project },
              { label: "条目 ID", value: item.item_id },
              {
                label: "草稿集 ID",
                value: item.links.draft_set_id
                  ? String(item.links.draft_set_id)
                  : null,
              },
              {
                label: "任务 ID",
                value: taskIds.length ? taskIds.join(", ") : null,
              },
            ]}
          />
        </aside>
      </div>

      {/* 出片确认（短任务，Sheet 合规） */}
      <Sheet onOpenChange={setProduceOpen} open={produceOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>出片</SheetTitle>
            <SheetDescription className="text-left">
              为「{item.title}」的 {produceSubmissions.length}{" "}
              个已确认语言版本选择生产模板。
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <ProductionSubmitPanel
              onOverridesChange={setProduceOverrides}
              onTemplateChange={setProduceTemplateId}
              overrides={produceOverrides}
              projectId={projectId ?? undefined}
              requiredInput="script"
              templateId={produceTemplateId}
            />
            <Button
              className="h-11 sm:h-8"
              disabled={
                producing ||
                !produceTemplateId ||
                produceSubmissions.length === 0
              }
              onClick={() => void submitProduce()}
            >
              {producing && (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              )}
              开始出片（{produceSubmissions.length}）
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </PageFrame>
  )
}

function BackRow() {
  return (
    <Button
      asChild
      className="h-11 w-fit px-0 sm:h-7"
      size="sm"
      variant="ghost"
    >
      <a href={routeHref("/board")}>
        <ArrowLeft data-icon="inline-start" />
        返回工作台
      </a>
    </Button>
  )
}
