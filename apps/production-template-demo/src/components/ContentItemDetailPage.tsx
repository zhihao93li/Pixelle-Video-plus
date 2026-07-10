import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Bot, Loader2, Plus, Sparkles, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { InlineError, TechDetails } from "@/components/shared/feedback"
import { ContentStatusBadge } from "@/components/shared/StatusBadge"
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
import { navigate } from "@/lib/router"
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
  const [results, setResults] = useState<Record<string, GenerationResult | null>>(
    {}
  )
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
        narrations: variant?.narrations?.length ? [...variant.narrations] : [""],
      }
    }
    setVariantDrafts(drafts)
    setActiveLanguage((current) =>
      current && languages.includes(current) ? current : languages[0] ?? null
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

  if (loadError) {
    return (
      <main className="flex max-w-[1240px] flex-col gap-4 p-4 lg:p-6">
        <BackRow />
        <InlineError title="内容读取失败" message={loadError} />
      </main>
    )
  }

  if (!item) {
    return (
      <main className="flex max-w-[1240px] flex-col gap-4 p-4 lg:p-6">
        <BackRow />
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在读取内容
        </div>
      </main>
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
  const nonVideoPublishNoun =
    publishArtifactType === "text" ? "长文" : "图集"
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
    { label: "项目", value: item.project },
    { label: "创建时间", value: item.created_at ? formatDate(item.created_at) : "" },
    { label: "语言", value: languages.length > 0 ? `${languages.length} 种` : "" },
    { label: "溯源", value: provenance || "" },
    { label: "关联任务", value: taskIds.length > 0 ? `${taskIds.length} 个` : "" },
  ].filter((overview) => overview.value)

  return (
    <main className="flex max-w-[1240px] flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <BackRow />
          <h1 className="truncate text-lg font-semibold">{item.title}</h1>
          <ContentStatusBadge status={item.status} />
          {item.source === "agent" && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Bot className="size-3.5" /> AI 起草
            </span>
          )}
          {item.source === "derived" && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Sparkles className="size-3.5" /> 衍生选题
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canProduce && (
            <Button
              disabled={produceSubmissions.length === 0}
              onClick={() => setProduceOpen(true)}
              variant="outline"
            >
              {item.status === "produced" ? "再次出片" : "出片"}
              {produceSubmissions.length > 0 &&
                `（${produceSubmissions.length} 个任务）`}
            </Button>
          )}
          {isReviewing && (
            <Button disabled={busy || !allConfirmed} onClick={() => void run(confirmItem)}>
              {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
              确认全部语言
            </Button>
          )}
        </div>
      </div>

      {error && <InlineError title="操作失败" message={error} />}
      {isReviewing && !allConfirmed && (
        <p className="-mt-2 text-right text-xs text-muted-foreground">
          每个语言逐个确认后，才能确认全部
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* 左：多语言文案与分镜 */}
        <section className="flex flex-col gap-4 rounded-lg border bg-background p-4">
          {item.status === "idea" && item.kind === "text" && (
            <div className="flex flex-col gap-2">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                这个选题还没有文案。生成草稿后会进入待确认，由你审核修改。
              </div>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await generateDraftsForItems([item!], toast, refresh)
                  })
                }
              >
                {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
                生成草稿
              </Button>
            </div>
          )}

          {item.kind === "asset" && (
            <div className="flex flex-col gap-2">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                素材条目暂不支持在这里直接出片，请前往「快速生产」使用该素材生成。
              </div>
              <Button onClick={() => navigate("/create")} variant="outline">
                前往快速生产
              </Button>
            </div>
          )}

          {languages.length > 0 && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {languages.map((language) => {
                  const status = item.variants[language]?.status ?? "pending"
                  const active = language === currentLanguage
                  return (
                    <button
                      className={
                        active
                          ? "rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs text-primary"
                          : "rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
                      }
                      key={language}
                      onClick={() => setActiveLanguage(language)}
                      type="button"
                    >
                      {languageLabel(language)} ·{" "}
                      {status === "rejected"
                        ? "已打回"
                        : VARIANT_STATUS_LABELS[status as never] ?? status}
                    </button>
                  )
                })}
              </div>

              {currentLanguage && isReviewing ? (
                <div className="flex flex-col gap-4">
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="text-xs text-muted-foreground">标题</span>
                    <Input
                      onChange={(event) =>
                        patchCurrentDraft({ title: event.target.value })
                      }
                      placeholder="发布标题"
                      value={currentDraft.title}
                    />
                  </label>

                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="text-xs text-muted-foreground">口播全文</span>
                    <Textarea
                      className="min-h-44 resize-y leading-7"
                      onChange={(event) =>
                        patchCurrentDraft({ script: event.target.value })
                      }
                      placeholder="完整口播文案"
                      value={currentDraft.script}
                    />
                  </label>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        分镜（每行一镜，出片按行直出）
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {cleanNarrations(currentDraft.narrations).length} 镜
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {currentDraft.narrations.map((line, index) => (
                        <div className="flex items-center gap-2" key={index}>
                          <span className="w-5 text-right text-xs text-muted-foreground">
                            {index + 1}
                          </span>
                          <Input
                            onChange={(event) => {
                              const next = [...currentDraft.narrations]
                              next[index] = event.target.value
                              patchCurrentDraft({ narrations: next })
                            }}
                            placeholder="一句 = 一个画面 + 一段配音"
                            value={line}
                          />
                          <Button
                            aria-label="删除这一镜"
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
                        </div>
                      ))}
                      <Button
                        className="self-start"
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
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 border-t pt-3">
                    <Button
                      disabled={busy}
                      onClick={() => void run(() => rejectVariant(currentLanguage))}
                      variant="ghost"
                    >
                      打回这版
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => void run(() => confirmVariant(currentLanguage))}
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
                    <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
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
            </>
          )}
        </section>

        {/* 右：状态 / 概览 / 产物 / 发布 / 数据 / 动态 */}
        <aside className="flex flex-col">
          <div className="mb-4 border-b pb-4 last:mb-0 last:border-0 last:pb-0">
            <div className="mb-2 text-sm font-medium">状态</div>
            <ContentStatusBadge status={item.status} />
            <div className="mt-2 text-xs text-muted-foreground">
              {languages
                .map(
                  (lang) =>
                    `${languageLabel(lang)} ${
                      item.variants[lang]?.status === "confirmed"
                        ? "已确认"
                        : "待确认"
                    }`
                )
                .join(" · ")}
            </div>
            {item.status === "producing" && (
              <div className="mt-1 text-xs text-muted-foreground">
                生产中，完成后自动刷新。
              </div>
            )}
          </div>

          {overviewItems.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2 border-b pb-4 last:mb-0 last:border-0 last:pb-0">
              {overviewItems.map((overview) => (
                <div key={overview.label}>
                  <div className="text-[11px] text-muted-foreground">
                    {overview.label}
                  </div>
                  <div className="mt-0.5 text-[13px]">{overview.value}</div>
                </div>
              ))}
            </div>
          )}

          {taskIds.length > 0 && (
            <div
              className="mb-4 scroll-mt-20 border-b pb-4 last:mb-0 last:border-0 last:pb-0"
              id="product-artifacts"
            >
              <div className="mb-2 text-sm font-medium">产物</div>
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
                      <div
                        className="flex h-16 items-center justify-center rounded-md bg-muted/40 text-xs text-muted-foreground"
                        key={taskId}
                      >
                        长文尚未就绪
                      </div>
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
                    <video className="w-full rounded-md" controls key={taskId} src={url} />
                  ) : (
                    <div
                      className="flex h-16 items-center justify-center rounded-md bg-muted/40 text-xs text-muted-foreground"
                      key={taskId}
                    >
                      成片尚未就绪
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {(item.status === "produced" || item.status === "scheduled") && (
            <div className="mb-4 border-b pb-4 last:mb-0 last:border-0 last:pb-0">
              <div className="mb-2 text-sm font-medium">发布</div>
              {isNonVideoPublish && (
                <p className="mb-2 text-xs leading-5 text-muted-foreground">
                  {nonVideoPublishNoun}暂不支持自动发布，请先
                  {publishArtifactType === "text" ? "复制全文" : "下载图集"}
                  ，再手动发到平台。
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {isNonVideoPublish ? (
                  <Button
                    onClick={() =>
                      document
                        .getElementById("product-artifacts")
                        ?.scrollIntoView({ behavior: "smooth", block: "center" })
                    }
                    size="sm"
                    variant="outline"
                  >
                    {publishArtifactType === "text" ? "去复制全文" : "去下载图集"}
                  </Button>
                ) : (
                  <Button
                    disabled={!completedTaskId}
                    onClick={() =>
                      navigate(`/library?task=${completedTaskId ?? ""}`)
                    }
                    size="sm"
                    variant="outline"
                  >
                    去发布
                  </Button>
                )}
                {item.status === "produced" && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await transitionContentItem(item!.item_id, "scheduled")
                      })
                    }
                    size="sm"
                    variant="outline"
                  >
                    已排期
                  </Button>
                )}
                <Button
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
                >
                  已发布
                </Button>
              </div>
            </div>
          )}

          {(item.status === "published" || item.status === "measured") && (
            <div className="mb-4 border-b pb-4 last:mb-0 last:border-0 last:pb-0">
              <div className="mb-2 text-sm font-medium">录入数据</div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["likes", "赞"],
                    ["favorites", "收藏"],
                    ["comments", "评论"],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    className="flex flex-col gap-1 text-xs text-muted-foreground"
                    key={key}
                  >
                    {label}
                    <Input
                      onChange={(event) =>
                        setMetricsDraft((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                      type="number"
                      value={metricsDraft[key]}
                    />
                  </label>
                ))}
              </div>
              <Textarea
                className="mt-2"
                onChange={(event) =>
                  setMetricsDraft((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
                placeholder="备注（可选）"
                rows={2}
                value={metricsDraft.note}
              />
              <div className="mt-2 flex justify-end">
                <Button disabled={busy} onClick={() => void run(saveMetrics)} size="sm">
                  {item.status === "published" ? "保存并标记已复盘" : "更新数据"}
                </Button>
              </div>
              <div className="mt-3 border-t pt-2">
                <button
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => setDerivedOpen((value) => !value)}
                  type="button"
                >
                  {derivedOpen ? "收起衍生选题" : "衍生新选题"}
                </button>
                {derivedOpen && (
                  <div className="mt-2 flex flex-col gap-2">
                    <Textarea
                      onChange={(event) => setDerivedText(event.target.value)}
                      placeholder="每行一个选题"
                      rows={2}
                      value={derivedText}
                    />
                    <Button
                      className="self-end"
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
                    >
                      加入选题池
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mb-4 border-b pb-4 last:mb-0 last:border-0 last:pb-0">
            <div className="mb-2 text-sm font-medium">动态</div>
            <div className="flex flex-col">
              {visibleEvents.map((event, index) => {
                const reason = (event.detail as { reason?: unknown })?.reason
                const hasReason = Boolean(reason)
                return (
                  <div className="border-b py-2 last:border-0" key={index}>
                    <div
                      className={cn(
                        "text-[13px]",
                        hasReason && "text-destructive"
                      )}
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
              {events.length > 3 && (
                <button
                  className="mt-2 self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => setEventsExpanded((value) => !value)}
                  type="button"
                >
                  {eventsExpanded ? "收起" : `展开全部 ${events.length} 条`}
                </button>
              )}
            </div>
          </div>

          <div className="mb-4 border-b pb-4 last:mb-0 last:border-0 last:pb-0">
            <TechDetails
              items={[
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
          </div>
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
              disabled={producing || !produceTemplateId || produceSubmissions.length === 0}
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
    </main>
  )
}

function BackRow() {
  return (
    <Button onClick={() => navigate("/board")} size="sm" variant="ghost">
      <ArrowLeft data-icon="inline-start" />
      工作台
    </Button>
  )
}
