import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, Bot, FileText, Image, Sparkles } from "lucide-react"

import { SceneManifestView } from "@/components/content/review/SceneManifestView"
import { CurrentReviewWorkspace } from "@/components/content/review/CurrentReviewWorkspace"
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
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { InlineError, TechDetails } from "@/components/shared/feedback"
import { formatDate, readableError } from "@/lib/format"
import { languageLabel } from "@/lib/languages"
import {
  ACTOR_LABELS,
  contentProductionFailure,
  eventTypeLabel,
  VARIANT_STATUS_LABELS,
} from "@/lib/contentItemMeta"
import { ImageSetView } from "@/components/shared/ImageSetView"
import { TextArticleView } from "@/components/shared/TextArticleView"
import { imageSetLabel } from "@/lib/imageSet"
import { navigate, routeHref } from "@/lib/router"
import { cn } from "@/lib/utils"
import {
  artifactFileUrl,
  getPendingContentReview,
  getProductionTask,
  getTaskResult,
  markContentPublished,
  recordContentMetrics,
  transitionContentItem,
  type ContentItem,
  type GenerationResult,
  type PendingReviewSession,
} from "@/lib/generationApi"

/** Legacy content-only fallback. Production-linked content always redirects to
 * the stable production task page so the user sees one detail surface. */

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
  const [item, setItem] = useState<ContentItem | null>(null)
  const [pendingReview, setPendingReview] =
    useState<PendingReviewSession | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeLanguage, setActiveLanguage] = useState<string | null>(null)
  const [contentView, setContentView] = useState<"manuscript" | "scenes">(
    "scenes"
  )
  const [results, setResults] = useState<
    Record<string, GenerationResult | null>
  >({})
  const [metricsDraft, setMetricsDraft] = useState({
    likes: "",
    favorites: "",
    comments: "",
    note: "",
    publicationId: "",
  })
  const [publicationDraft, setPublicationDraft] = useState({
    platform: "xiaohongshu",
    publishedAt: new Date().toISOString().slice(0, 16),
    url: "",
    note: "",
  })
  const [eventsExpanded, setEventsExpanded] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [legacyFallbackTaskId, setLegacyFallbackTaskId] = useState<
    string | null
  >(null)
  const initializedContentSession = useRef<string | null>(null)

  const refresh = useCallback(() => setReloadToken((token) => token + 1), [])
  const linkedProductionTaskId = item?.links.production_task_ids?.at(-1)

  useEffect(() => {
    if (!linkedProductionTaskId) return undefined
    let cancelled = false
    void getProductionTask(linkedProductionTaskId)
      .then(() => {
        if (!cancelled) navigate(`/board/tasks/${linkedProductionTaskId}`)
      })
      .catch(() => {
        if (!cancelled) setLegacyFallbackTaskId(linkedProductionTaskId)
      })
    return () => {
      cancelled = true
    }
  }, [linkedProductionTaskId])

  // 加载条目（生产中时 15s 轮询等待回写）
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    async function load() {
      try {
        const context = await getPendingContentReview(itemId)
        const next = context.item
        if (cancelled) {
          return
        }
        setItem(next)
        setPendingReview(context.review)
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

  // 非确认区的辅助表单每条内容只初始化一次。待确认编辑器由
  // review_id + version 直接挂载，不再从页面状态推测当前站点。
  const contentSessionKey = item?.item_id ?? null

  useEffect(() => {
    if (
      !item ||
      !contentSessionKey ||
      initializedContentSession.current === contentSessionKey
    ) {
      return
    }
    initializedContentSession.current = contentSessionKey
    const languages = Array.from(
      new Set([...item.languages, ...Object.keys(item.variants)])
    )
    setActiveLanguage((current) =>
      current && languages.includes(current) ? current : (languages[0] ?? null)
    )
    setError(null)
    setMetricsDraft({
      likes: item.metrics.likes != null ? String(item.metrics.likes) : "",
      favorites:
        item.metrics.favorites != null ? String(item.metrics.favorites) : "",
      comments:
        item.metrics.comments != null ? String(item.metrics.comments) : "",
      note: item.metrics.note ?? "",
      publicationId:
        typeof item.metrics.publication_id === "string"
          ? item.metrics.publication_id
          : (item.publications[0]?.publication_id ?? ""),
    })
  }, [contentSessionKey, item])

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

  if (
    linkedProductionTaskId &&
    legacyFallbackTaskId !== linkedProductionTaskId
  ) {
    return (
      <PageFrame>
        <AsyncState state="loading" title="正在打开生产任务…" />
      </PageFrame>
    )
  }

  const languages = Array.from(
    new Set([...item.languages, ...Object.keys(item.variants)])
  )
  const activeReviewKind = pendingReview?.payload.kind
  const manifestPending = Boolean(
    activeReviewKind && activeReviewKind !== "script"
  )
  const isAgentImageManifest = activeReviewKind === "agent_image_scenes"
  const isImagePagesManifest = activeReviewKind === "image_pages"
  const productionFailure = contentProductionFailure(item)
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
  const currentLanguage = activeLanguage ?? languages[0] ?? null

  async function saveMetrics() {
    await recordContentMetrics({
      itemId: item!.item_id,
      likes: metricsDraft.likes.trim() ? Number(metricsDraft.likes) : undefined,
      favorites: metricsDraft.favorites.trim()
        ? Number(metricsDraft.favorites)
        : undefined,
      comments: metricsDraft.comments.trim()
        ? Number(metricsDraft.comments)
        : undefined,
      note: metricsDraft.note.trim() || undefined,
      publicationId: metricsDraft.publicationId || undefined,
    })
  }

  async function markPublished() {
    await markContentPublished({
      itemId: item!.item_id,
      platform: publicationDraft.platform,
      publishedAt: new Date(publicationDraft.publishedAt).toISOString(),
      publishUrl: publicationDraft.url.trim() || undefined,
      manualEvidence: publicationDraft.note.trim() || undefined,
    })
  }

  const events = [...item.events].reverse()
  const visibleEvents = eventsExpanded ? events : events.slice(0, 3)

  // 右栏速览定义行：缺值不渲染（无「未返回」占位）
  const overviewItems: Array<{ label: string; value: string }> = [
    {
      label: "创建时间",
      value: item.created_at ? formatDate(item.created_at) : "",
    },
    {
      label: "语言",
      value: languages.length > 0 ? `${languages.length} 种` : "",
    },
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
      lifecycleGuidance =
        "这是一条未发起生产的历史内容；新生产统一从快速生产开始。"
      lifecycleAction = {
        href: routeHref("/create"),
        label: "前往快速生产",
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
      if (manifestPending) {
        lifecycleGuidance = isAgentImageManifest
          ? "请在主编辑区确认完整分镜文案和图片提示词；确认后 Agent 才会开始生成图片。"
          : isImagePagesManifest
            ? "请在主编辑区确认分页；确认后原生产任务将自动继续生成配图和图集。"
            : "请在主编辑区确认分镜；确认后原生产任务将自动继续生成画面、配音和视频。"
      } else if (allConfirmed) {
        lifecycleGuidance = "文案已经确认，请在主编辑区继续原生产任务。"
      } else if (nextPendingLanguage) {
        lifecycleGuidance = `请在主编辑区审核 ${languageLabel(nextPendingLanguage)} 版本。`
      } else {
        lifecycleGuidance = "当前没有可审核的语言版本。"
      }
      break
    case "confirmed":
      if (item.scene_manifest) {
        const missingImages = item.scene_manifest.scenes.filter(
          (scene) => !scene.asset_id
        ).length
        lifecycleGuidance =
          missingImages > 0
            ? `分镜已确认，等待 Agent 上传 ${missingImages} 张配图。`
            : "配图已齐，原生产任务将自动继续。"
        lifecycleAction = { label: "刷新状态", onClick: refresh }
      } else {
        lifecycleGuidance = "已确认，原生产任务将继续执行。"
        lifecycleAction = {
          href: taskIds[0]
            ? routeHref(`/board/tasks/${taskIds[0]}`)
            : routeHref("/board"),
          label: taskIds[0] ? "查看生产任务" : "返回工作台",
        }
      }
      break
    case "producing":
      lifecycleGuidance = "生产任务正在运行，完成后页面会自动刷新。"
      lifecycleAction = {
        href: taskIds[0]
          ? routeHref(`/board/tasks/${taskIds[0]}`)
          : routeHref("/board"),
        label: taskIds[0] ? "查看生产任务" : "返回工作台",
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
      {productionFailure ? (
        <InlineError message={productionFailure} title="上次生产未完成" />
      ) : null}

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
            pendingReview?.payload.kind === "script"
              ? "检查标题和完整文案；确认后系统才会继续规划分镜或进入下一步。"
              : pendingReview
                ? "当前只展示这一站需要确认的内容；上一站文案收起为参考。"
                : "查看当前内容的语言版本、文案与分镜。"
          }
          id="content-editor"
          tabIndex={-1}
          title={pendingReview ? "审核与编辑" : "内容版本"}
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

          {pendingReview ? (
            <CurrentReviewWorkspace
              itemId={item.item_id}
              onChanged={refresh}
              review={pendingReview}
            />
          ) : item.scene_manifest && languages.length > 0 ? (
            <Tabs
              onValueChange={(value) =>
                setContentView(value as "manuscript" | "scenes")
              }
              value={contentView}
            >
              <TabsList aria-label="内容版本视图" variant="line">
                <TabsTrigger value="manuscript">稿件</TabsTrigger>
                <TabsTrigger value="scenes">分镜</TabsTrigger>
              </TabsList>
              <TabsContent className="mt-4" value="scenes">
                <SceneManifestView item={item} />
              </TabsContent>
              <TabsContent className="mt-4" value="manuscript">
                <ReadOnlyManuscript
                  activeLanguage={currentLanguage}
                  item={item}
                  languages={languages}
                  onLanguageChange={setActiveLanguage}
                />
              </TabsContent>
            </Tabs>
          ) : item.scene_manifest ? (
            <SceneManifestView item={item} />
          ) : languages.length > 0 ? (
            <ReadOnlyManuscript
              activeLanguage={currentLanguage}
              item={item}
              languages={languages}
              onLanguageChange={setActiveLanguage}
            />
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

          {["produced", "scheduled", "published", "measured"].includes(
            item.status
          ) && (
            <WorkspacePanel padding="compact" title="发布记录">
              {item.publications.length > 0 ? (
                <div className="mb-3 divide-y border-y text-xs">
                  {item.publications.map((publication) => (
                    <div className="py-2" key={publication.publication_id}>
                      <span className="font-medium">
                        {publication.platform}
                      </span>
                      <span className="ml-2 text-muted-foreground">
                        {formatDate(publication.published_at)} ·{" "}
                        {publication.evidence_value}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {isNonVideoPublish && (
                <p className="mb-2 text-xs leading-5 text-muted-foreground">
                  {nonVideoPublishNoun}暂不支持自动发布，请先
                  {publishArtifactType === "text" ? "复制全文" : "下载图集"}
                  ，再手动发到平台。
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel>平台</FieldLabel>
                  <Select
                    onValueChange={(platform) =>
                      setPublicationDraft((current) => ({
                        ...current,
                        platform,
                      }))
                    }
                    value={publicationDraft.platform}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="xiaohongshu">小红书</SelectItem>
                      <SelectItem value="youtube">YouTube</SelectItem>
                      <SelectItem value="tiktok">TikTok</SelectItem>
                      <SelectItem value="instagram">Instagram</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="published-at">发布时间</FieldLabel>
                  <Input
                    id="published-at"
                    onChange={(event) =>
                      setPublicationDraft((current) => ({
                        ...current,
                        publishedAt: event.target.value,
                      }))
                    }
                    type="datetime-local"
                    value={publicationDraft.publishedAt}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="publish-url">发布链接</FieldLabel>
                  <Input
                    id="publish-url"
                    onChange={(event) =>
                      setPublicationDraft((current) => ({
                        ...current,
                        url: event.target.value,
                      }))
                    }
                    placeholder="https://…"
                    value={publicationDraft.url}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="publish-evidence">
                    人工证据备注
                  </FieldLabel>
                  <Input
                    id="publish-evidence"
                    onChange={(event) =>
                      setPublicationDraft((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                    placeholder="没有链接时填写发布记录"
                    value={publicationDraft.note}
                  />
                </Field>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
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
                  disabled={
                    busy ||
                    (!publicationDraft.url.trim() &&
                      !publicationDraft.note.trim())
                  }
                  onClick={() => void run(markPublished)}
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
              {item.publications.length > 1 ? (
                <Field className="mb-3">
                  <FieldLabel>对应发布记录</FieldLabel>
                  <Select
                    onValueChange={(publicationId) =>
                      setMetricsDraft((current) => ({
                        ...current,
                        publicationId,
                      }))
                    }
                    value={metricsDraft.publicationId}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {item.publications.map((publication) => (
                        <SelectItem
                          key={publication.publication_id}
                          value={publication.publication_id}
                        >
                          {publication.platform} ·{" "}
                          {formatDate(publication.published_at)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
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
                label: "任务 ID",
                value: taskIds.length ? taskIds.join(", ") : null,
              },
            ]}
          />
        </aside>
      </div>
    </PageFrame>
  )
}

function ReadOnlyManuscript({
  activeLanguage,
  item,
  languages,
  onLanguageChange,
}: {
  activeLanguage: string | null
  item: ContentItem
  languages: string[]
  onLanguageChange: (language: string) => void
}) {
  const variant = activeLanguage ? item.variants[activeLanguage] : undefined

  return (
    <Tabs onValueChange={onLanguageChange} value={activeLanguage ?? undefined}>
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

      <TabsContent className="mt-4" value={activeLanguage ?? ""}>
        {activeLanguage ? (
          <div className="flex flex-col gap-3">
            {variant?.title ? (
              <div className="text-sm font-medium">{variant.title}</div>
            ) : null}
            <p className="text-sm leading-7 whitespace-pre-wrap text-muted-foreground">
              {variant?.script || "（暂无文案）"}
            </p>
          </div>
        ) : null}
      </TabsContent>
    </Tabs>
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
