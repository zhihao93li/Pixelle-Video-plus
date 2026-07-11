import { useEffect, useMemo, useState } from "react"
import {
  Download,
  FileText,
  FolderOpen,
  Images,
  Loader2,
  RefreshCcw,
  Search,
  Send,
  Trash2,
  Video,
} from "lucide-react"

import { ArtifactPreview } from "@/components/shared/ArtifactPreview"
import { AsyncState } from "@/components/shared/AsyncState"
import { EmptyState } from "@/components/shared/EmptyState"
import { InlineError } from "@/components/shared/feedback"
import { PageFrame } from "@/components/shared/PageFrame"
import {
  PublishAttemptList,
  PublishComposer,
} from "@/components/shared/PublishComposer"
import { Stat } from "@/components/shared/Stat"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { WorkspaceHeader } from "@/components/shared/WorkspaceHeader"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useToast } from "@/components/ui/toast"
import { artifactKindLabel, type ArtifactKind } from "@/lib/artifactKind"
import { useCurrentProject } from "@/lib/currentProject"
import {
  formatBytes,
  formatDate,
  formatDuration,
  paramValueLabel,
  readableError,
  voiceLabel,
} from "@/lib/format"
import {
  checkPublishConfiguration,
  deleteHistoryTask,
  fileUrlFromPath,
  getHistoryStatistics,
  getHistoryTaskDetail,
  getPublishRecord,
  listContentItems,
  listHistoryTasks,
  listPublishPlatforms,
  listPublishTimezones,
  listTemplates,
  publishTask,
  type ContentItemMetrics,
  type HistoryStatistics,
  type HistoryTaskDetail,
  type HistoryTaskListResponse,
  type HistoryTaskSummary,
  type PublishCheck,
  type PublishPlatform,
  type PublishRecord,
} from "@/lib/generationApi"
import { imageSetLabel } from "@/lib/imageSet"
import {
  adaptPublishStatus,
  adaptRunStatus,
  knownStatus,
  statusIs,
  type AdaptedPublishAttemptState,
  type AdaptedRunState,
  type ArtifactViewModel,
  type PublishAttemptState,
  type PublishAttemptViewModel,
} from "@/lib/productViewModels"
import { navigate, parsePath, routeHref, usePath } from "@/lib/router"
import { cn } from "@/lib/utils"

type LoadState = "loading" | "ready" | "error" | "stale"
type ScheduleMode = "queue" | "scheduled"

const STATUS_FILTERS = new Set([
  "all",
  "completed",
  "failed",
  "running",
  "pending",
])
const ARTIFACT_FILTERS = new Set(["all", "video", "image_set", "text"])
const SORT_OPTIONS = new Set([
  "created_at:desc",
  "created_at:asc",
  "completed_at:desc",
  "duration:desc",
  "status:asc",
])
const PAGE_SIZE = 20

function defaultPublishPlatforms(
  available: PublishPlatform[],
  projectPlatforms?: string[]
): string[] {
  const preferred = (projectPlatforms ?? []).filter((id) =>
    available.some((platform) => platform.id === id)
  )
  if (preferred.length > 0) {
    return preferred
  }
  const fallback =
    available.find((platform) => platform.id === "youtube") ?? available[0]
  return fallback ? [fallback.id] : []
}

export function HistoryWorkspace({
  latestTaskId,
}: {
  latestTaskId: string | null
}) {
  const path = usePath()
  const routeQuery = useMemo(() => parsePath(path).query, [path])
  const statusFilter = validQueryValue(
    routeQuery.get("status"),
    STATUS_FILTERS,
    "all"
  )
  const artifactFilter = validQueryValue(
    routeQuery.get("kind"),
    ARTIFACT_FILTERS,
    "all"
  )
  const sort = validQueryValue(
    routeQuery.get("sort"),
    SORT_OPTIONS,
    "created_at:desc"
  )
  const [sortBy, sortOrderValue] = sort.split(":")
  const sortOrder = sortOrderValue === "asc" ? "asc" : "desc"
  const page = positiveInteger(routeQuery.get("page"), 1)
  const searchQuery = routeQuery.get("q")?.trim() ?? ""
  const selectedTaskId = routeQuery.get("task") || latestTaskId
  const publishRequested = routeQuery.get("publish") === "1"

  const [historyState, setHistoryState] = useState<LoadState>("loading")
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryTaskListResponse | null>(null)
  const [statistics, setStatistics] = useState<HistoryStatistics | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null)
  const [detailState, setDetailState] = useState<LoadState>("loading")
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detail, setDetail] = useState<HistoryTaskDetail | null>(null)
  const [detailRefreshToken, setDetailRefreshToken] = useState(0)
  const [publishPlatforms, setPublishPlatforms] = useState<PublishPlatform[]>(
    []
  )
  const [publishTimezones, setPublishTimezones] = useState<string[]>([
    "Asia/Shanghai",
    "UTC",
  ])
  const [publishRecord, setPublishRecord] = useState<PublishRecord | null>(null)
  const [publishChecks, setPublishChecks] = useState<PublishCheck[]>([])
  const [publishError, setPublishError] = useState<string | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const { project } = useCurrentProject()
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
  const [publishTitle, setPublishTitle] = useState("")
  const [publishCaption, setPublishCaption] = useState("")
  const [hashtags, setHashtags] = useState("")
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("queue")
  const [dueAt, setDueAt] = useState("")
  const [publishTimezone, setPublishTimezone] = useState("Asia/Shanghai")
  const [metricsByTask, setMetricsByTask] = useState<
    Record<string, ContentItemMetrics>
  >({})
  const [templateIds, setTemplateIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const toast = useToast()

  const requestKey = `${page}:${statusFilter}:${sort}`
  const isHistoryRefreshing =
    history !== null && loadedRequestKey !== `${requestKey}:${refreshToken}`

  const visibleTasks = useMemo(
    () => filterHistoryTasks(history?.tasks ?? [], searchQuery, artifactFilter),
    [artifactFilter, history?.tasks, searchQuery]
  )

  useEffect(() => {
    let cancelled = false
    const hadHistory = history !== null
    const activeRequestKey = `${requestKey}:${refreshToken}`

    void Promise.allSettled([
      listHistoryTasks({
        page,
        pageSize: PAGE_SIZE,
        status: statusFilter,
        sortBy,
        sortOrder,
      }),
      getHistoryStatistics(),
    ]).then(([taskListResult, statisticsResult]) => {
      if (cancelled) {
        return
      }
      setLoadedRequestKey(activeRequestKey)

      if (taskListResult.status === "rejected") {
        setHistoryError(readableError(taskListResult.reason))
        setHistoryState(hadHistory ? "stale" : "error")
        return
      }

      const taskList = taskListResult.value
      setHistory(taskList)
      if (statisticsResult.status === "fulfilled") {
        setStatistics(statisticsResult.value)
        setHistoryError(null)
        setHistoryState("ready")
      } else {
        setHistoryError(
          `作品列表已读取，但数据摘要暂未同步：${readableError(
            statisticsResult.reason
          )}`
        )
        setHistoryState("stale")
      }

      const filtered = filterHistoryTasks(
        taskList.tasks,
        searchQuery,
        artifactFilter
      )
      const nextTaskId =
        (selectedTaskId &&
          filtered.some((task) => task.task_id === selectedTaskId) &&
          selectedTaskId) ||
        filtered[0]?.task_id ||
        null
      if (nextTaskId !== selectedTaskId) {
        navigate(libraryPath(routeQuery, { task: nextTaskId }))
      }
    })

    return () => {
      cancelled = true
    }
    // routeQuery 只用于保留当前参数；服务端请求由 requestKey 驱动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, refreshToken])

  useEffect(() => {
    let cancelled = false
    void listPublishPlatforms()
      .then((response) => {
        if (cancelled) {
          return
        }
        setPublishPlatforms(response.platforms)
        setSelectedPlatforms(
          defaultPublishPlatforms(
            response.platforms,
            project?.publish_platforms
          )
        )
      })
      .catch((error) => {
        if (!cancelled) {
          setPublishError(readableError(error))
        }
      })
    return () => {
      cancelled = true
    }
    // 项目平台只作为进入页面时的预选。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    void listPublishTimezones()
      .then((response) => {
        if (cancelled) {
          return
        }
        setPublishTimezones(response.timezones)
        setPublishTimezone(response.default_timezone)
      })
      .catch((error) => {
        if (!cancelled) {
          setPublishError(readableError(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void listContentItems({ limit: 500 })
      .then((items) => {
        if (cancelled) {
          return
        }
        const nextMetrics: Record<string, ContentItemMetrics> = {}
        for (const item of items) {
          const metrics = item.metrics
          const hasData =
            metrics &&
            (metrics.likes != null ||
              metrics.favorites != null ||
              metrics.comments != null)
          if (!hasData) {
            continue
          }
          for (const taskId of item.links?.task_ids ?? []) {
            nextMetrics[taskId] = metrics
          }
        }
        setMetricsByTask(nextMetrics)
      })
      .catch(() => {
        // 数据摘要是非阻塞增强；作品与发布仍以 history API 为真源。
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void listTemplates()
      .then((response) => {
        if (!cancelled) {
          setTemplateIds(
            new Set(response.templates.map((template) => template.id))
          )
        }
      })
      .catch(() => {
        // 仅影响配方快捷链接，不改变作品详情或生产数据。
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedTaskId) {
      return
    }
    const taskId = selectedTaskId
    const hadDetail = detail !== null
    let cancelled = false

    void Promise.allSettled([
      getHistoryTaskDetail(taskId),
      getPublishRecord(taskId),
    ]).then(([detailResult, recordResult]) => {
      if (cancelled) {
        return
      }
      if (detailResult.status === "rejected") {
        setDetailError(readableError(detailResult.reason))
        setDetailState(hadDetail ? "stale" : "error")
        return
      }

      const taskDetail = detailResult.value
      setDetail(taskDetail)
      setDetailError(null)
      setDetailState("ready")
      setPublishTitle(buildDefaultTitle(taskDetail.metadata))
      setPublishCaption(buildDefaultCaption(taskDetail.metadata))
      setHashtags("")
      setScheduleMode("queue")
      setDueAt("")
      setPublishChecks([])

      if (recordResult.status === "fulfilled") {
        setPublishRecord(recordResult.value.record)
      } else {
        setPublishRecord(null)
        setPublishError(readableError(recordResult.reason))
      }
    })

    return () => {
      cancelled = true
    }
    // task 变化会由 App 的 key 重新挂载；token 只用于原位重试。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId, detailRefreshToken])

  const selectedTask = useMemo(
    () =>
      history?.tasks.find((task) => task.task_id === selectedTaskId) ?? null,
    [history?.tasks, selectedTaskId]
  )
  const artifact = useMemo(
    () => adaptHistoryArtifact(detail, selectedTask),
    [detail, selectedTask]
  )
  const publishAttempts = useMemo(
    () => adaptPublishAttempts(publishRecord, publishPlatforms),
    [publishPlatforms, publishRecord]
  )
  const selectedPublishState = summarizePublishState(publishAttempts)
  const publishCaptionWithHashtags = appendHashtags(publishCaption, hashtags)
  const requiresTitle = selectedPlatforms.includes("youtube")
  const runState = adaptRunStatus(detailStatus(detail) || selectedTask?.status)
  const scheduledDueAt =
    scheduleMode === "scheduled"
      ? buildScheduledDueAt(dueAt, publishTimezone)
      : null
  const publishDisabledReason = getPublishDisabledReason({
    artifact,
    runState,
    selectedPlatforms,
    caption: publishCaptionWithHashtags,
    title: publishTitle,
    requiresTitle,
    scheduleMode,
    dueAt,
    isPublishing,
  })
  const canPublish = publishDisabledReason === null

  function updateLibraryQuery(
    patch: Record<string, string | number | null | undefined>
  ) {
    navigate(libraryPath(routeQuery, patch))
  }

  function selectTask(taskId: string) {
    updateLibraryQuery({ task: taskId })
  }

  function submitSearch(value: string) {
    const nextQuery = value.trim()
    const nextTasks = filterHistoryTasks(
      history?.tasks ?? [],
      nextQuery,
      artifactFilter
    )
    updateLibraryQuery({
      q: nextQuery || null,
      page: 1,
      task: nextTasks[0]?.task_id ?? null,
    })
  }

  async function checkConfig() {
    setIsChecking(true)
    setPublishError(null)
    setPublishChecks([])
    try {
      const response = await checkPublishConfiguration(selectedPlatforms)
      setPublishChecks(response.checks)
    } catch (error) {
      setPublishError(readableError(error))
    } finally {
      setIsChecking(false)
    }
  }

  async function submitPublish() {
    if (!selectedTaskId || !canPublish) {
      return
    }
    setIsPublishing(true)
    setPublishError(null)
    try {
      const response = await publishTask(selectedTaskId, {
        platforms: selectedPlatforms,
        title: publishTitle.trim(),
        caption: publishCaptionWithHashtags.trim(),
        dueAt: scheduledDueAt,
      })
      setPublishRecord(response.record)
      toast({ title: "发布任务已提交", variant: "success" })
    } catch (error) {
      setPublishError(readableError(error))
    } finally {
      setIsPublishing(false)
    }
  }

  async function deleteSelectedTask() {
    if (!selectedTaskId) {
      return
    }
    setIsDeleting(true)
    setDetailError(null)
    try {
      await deleteHistoryTask(selectedTaskId)
      toast({ title: "记录已删除", variant: "success" })
      updateLibraryQuery({ page: 1, task: null })
    } catch (error) {
      setDetailError(readableError(error))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <PageFrame>
      <WorkspaceHeader
        actions={
          <Button
            aria-label="刷新作品库"
            disabled={isHistoryRefreshing}
            onClick={() => setRefreshToken((token) => token + 1)}
            size="icon-sm"
            variant="outline"
          >
            <RefreshCcw className={cn(isHistoryRefreshing && "animate-spin")} />
          </Button>
        }
        description="筛选产物，预览内容并查看发布状态。"
        title="作品与发布"
      />

      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b pb-4">
        <Stat label="全部" value={statistics?.total_tasks} />
        <Stat label="已完成" value={statistics?.completed} />
        <Stat
          destructive={(statistics?.failed ?? 0) > 0}
          label="失败"
          value={statistics?.failed}
        />
      </div>

      <div className="flex flex-col gap-3 border-b pb-4">
        <LibrarySearchForm
          initialQuery={searchQuery}
          key={searchQuery}
          onSubmit={submitSearch}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select
            onValueChange={(value) => {
              const nextTasks = filterHistoryTasks(
                history?.tasks ?? [],
                searchQuery,
                value
              )
              updateLibraryQuery({
                kind: value === "all" ? null : value,
                page: 1,
                task: nextTasks[0]?.task_id ?? null,
              })
            }}
            value={artifactFilter}
          >
            <SelectTrigger aria-label="筛选作品形态" className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部形态</SelectItem>
                <SelectItem value="video">视频</SelectItem>
                <SelectItem value="image_set">图集</SelectItem>
                <SelectItem value="text">长文</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            onValueChange={(value) =>
              updateLibraryQuery({
                status: value === "all" ? null : value,
                page: 1,
                task: null,
              })
            }
            value={statusFilter}
          >
            <SelectTrigger aria-label="筛选作品状态" className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="completed">已完成</SelectItem>
                <SelectItem value="failed">失败</SelectItem>
                <SelectItem value="running">生成中</SelectItem>
                <SelectItem value="pending">排队中</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            onValueChange={(value) =>
              updateLibraryQuery({
                sort: value === "created_at:desc" ? null : value,
                page: 1,
                task: null,
              })
            }
            value={sort}
          >
            <SelectTrigger aria-label="排序作品" className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="created_at:desc">最新创建</SelectItem>
                <SelectItem value="created_at:asc">最早创建</SelectItem>
                <SelectItem value="completed_at:desc">最近完成</SelectItem>
                <SelectItem value="duration:desc">时长最长</SelectItem>
                <SelectItem value="status:asc">按状态</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {historyState === "stale" ? (
        <AsyncState
          action={
            <Button
              onClick={() => setRefreshToken((token) => token + 1)}
              size="sm"
              variant="outline"
            >
              重新读取
            </Button>
          }
          description={historyError}
          state="stale"
          title="作品列表可能不是最新状态"
        />
      ) : null}

      {historyState === "loading" && !history ? (
        <AsyncState
          description="正在同步作品与数据摘要。"
          state="loading"
          title="正在读取作品库"
        />
      ) : null}

      {historyState === "error" && !history ? (
        <AsyncState
          action={
            <Button
              onClick={() => setRefreshToken((token) => token + 1)}
              size="sm"
              variant="outline"
            >
              重试
            </Button>
          }
          description={historyError}
          state="error"
          title="无法读取作品库"
        />
      ) : null}

      {historyState === "ready" && history?.tasks.length === 0 ? (
        <EmptyState
          actions={
            <Button asChild size="sm">
              <a href={routeHref("/create")}>去快速生产</a>
            </Button>
          }
          description="完成第一条生产任务后，产物会出现在这里。"
          icon={FolderOpen}
          title="还没有作品"
        />
      ) : null}

      {history && history.tasks.length > 0 ? (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section aria-labelledby="library-list-heading" className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 border-b pb-2">
              <h3 className="text-sm font-medium" id="library-list-heading">
                作品
              </h3>
              <span className="text-xs text-muted-foreground">
                {history.total} 条
              </span>
            </div>

            {isHistoryRefreshing ? (
              <div
                aria-live="polite"
                className="flex items-center gap-2 border-b py-2 text-xs text-muted-foreground"
              >
                <Loader2 className="size-3.5 animate-spin" />
                正在更新列表
              </div>
            ) : null}

            {visibleTasks.length === 0 ? (
              <EmptyState
                actions={
                  <Button
                    onClick={() =>
                      updateLibraryQuery({ kind: null, q: null, task: null })
                    }
                    size="sm"
                    variant="outline"
                  >
                    清除筛选
                  </Button>
                }
                className="mt-3 min-h-40"
                description="调整关键词或作品形态后再试。"
                title="没有匹配的作品"
              />
            ) : (
              <div
                className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 xl:mx-0 xl:block xl:overflow-visible xl:px-0 xl:pb-0"
                role="list"
              >
                {visibleTasks.map((task) => (
                  <LibraryRow
                    key={task.task_id}
                    metrics={metricsByTask[task.task_id] ?? null}
                    onOpenPublish={() => {
                      updateLibraryQuery({ publish: "1", task: task.task_id })
                    }}
                    onSelect={() => selectTask(task.task_id)}
                    publishState={
                      selectedTaskId === task.task_id
                        ? selectedPublishState
                        : null
                    }
                    selected={selectedTaskId === task.task_id}
                    task={task}
                  />
                ))}
              </div>
            )}

            {history.total > 0 ? (
              <div className="flex items-center justify-between gap-3 border-t pt-3">
                <Button
                  disabled={page <= 1 || isHistoryRefreshing}
                  onClick={() =>
                    updateLibraryQuery({
                      page: Math.max(1, page - 1),
                      task: null,
                    })
                  }
                  size="sm"
                  variant="outline"
                >
                  上一页
                </Button>
                <div className="text-xs text-muted-foreground">
                  第 {history.page} / {history.total_pages ?? 1} 页
                </div>
                <Button
                  disabled={
                    isHistoryRefreshing || page >= (history.total_pages ?? 1)
                  }
                  onClick={() =>
                    updateLibraryQuery({
                      page: Math.min(history.total_pages ?? page, page + 1),
                      task: null,
                    })
                  }
                  size="sm"
                  variant="outline"
                >
                  下一页
                </Button>
              </div>
            ) : null}
          </section>

          <DetailPanel
            artifact={artifact}
            canPublish={
              statusIs(runState, "completed") && artifact?.kind === "video"
            }
            detail={detail}
            detailError={detailError}
            detailState={detailState}
            isDeleting={isDeleting}
            onDelete={() => void deleteSelectedTask()}
            onOpenPublish={() => updateLibraryQuery({ publish: "1" })}
            onRetry={() => {
              setDetailState("loading")
              setDetailRefreshToken((token) => token + 1)
            }}
            publishAttempts={publishAttempts}
            selectedTask={selectedTask}
            templateIds={templateIds}
          />
        </div>
      ) : null}

      <Sheet
        onOpenChange={(open) => {
          if (open !== publishRequested) {
            updateLibraryQuery({ publish: open ? "1" : null })
          }
        }}
        open={publishRequested}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>发布作品</SheetTitle>
            <SheetDescription>
              确认平台、文案与发布时间后提交到发布队列。
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-[max(1rem,var(--safe-area-bottom))]">
            <PublishComposer
              attempts={publishAttempts}
              caption={publishCaption}
              checks={publishChecks}
              disabledReason={publishDisabledReason}
              dueAt={dueAt}
              error={publishError}
              hashtags={hashtags}
              isChecking={isChecking}
              isPublishing={isPublishing}
              onCaptionChange={setPublishCaption}
              onCheck={() => void checkConfig()}
              onDueAtChange={setDueAt}
              onHashtagsChange={setHashtags}
              onPlatformsChange={setSelectedPlatforms}
              onScheduleModeChange={setScheduleMode}
              onSubmit={() => void submitPublish()}
              onTimezoneChange={setPublishTimezone}
              onTitleChange={setPublishTitle}
              platforms={publishPlatforms}
              scheduleMode={scheduleMode}
              scheduledDueAt={scheduledDueAt}
              selectedPlatforms={selectedPlatforms}
              submitDisabled={!canPublish}
              timezone={publishTimezone}
              timezones={publishTimezones}
              title={publishTitle}
            />
          </div>
        </SheetContent>
      </Sheet>
    </PageFrame>
  )
}

function LibrarySearchForm({
  initialQuery,
  onSubmit,
}: {
  initialQuery: string
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState(initialQuery)
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(value)
      }}
      role="search"
    >
      <Input
        aria-label="搜索作品标题"
        className="max-w-sm"
        onChange={(event) => setValue(event.target.value)}
        placeholder="搜索标题…"
        value={value}
      />
      <Button aria-label="搜索" size="icon-sm" type="submit" variant="outline">
        <Search />
      </Button>
    </form>
  )
}

function DetailPanel({
  selectedTask,
  detail,
  artifact,
  detailState,
  detailError,
  isDeleting,
  canPublish,
  publishAttempts,
  onDelete,
  onOpenPublish,
  onRetry,
  templateIds,
}: {
  selectedTask: HistoryTaskSummary | null
  detail: HistoryTaskDetail | null
  artifact: ArtifactViewModel | null
  detailState: LoadState
  detailError: string | null
  isDeleting: boolean
  canPublish: boolean
  publishAttempts: PublishAttemptViewModel[]
  onDelete: () => void
  onOpenPublish: () => void
  onRetry: () => void
  templateIds: ReadonlySet<string>
}) {
  if (!selectedTask) {
    return (
      <EmptyState
        className="min-h-72"
        description="从列表选择一条作品，查看预览与发布进度。"
        title="选择一条作品"
      />
    )
  }

  if (detailState === "loading" && !detail) {
    return (
      <AsyncState
        description="正在准备预览与发布状态。"
        state="loading"
        title="正在读取作品详情"
      />
    )
  }

  if (detailState === "error" && !detail) {
    return (
      <AsyncState
        action={
          <Button onClick={onRetry} size="sm" variant="outline">
            重试
          </Button>
        }
        description={detailError}
        state="error"
        title="无法读取作品详情"
      />
    )
  }

  const metadata = detail?.metadata ?? null
  const input = readRecord(metadata?.input)
  const result = readRecord(metadata?.result)
  const templateInfo = readRecord(metadata?.production_template)
  const artifactKind = artifact?.kind ?? historyArtifactKind(result)
  const inputText = readString(input?.text) || readString(input?.script)
  const title = selectedTask.title || buildDefaultTitle(metadata)
  const runState = adaptRunStatus(detailStatus(detail) || selectedTask.status)
  const failureMessage = historyErrorMessage(result)
  const runFailed = statusIs(runState, "failed")
  const unresolvedFailureMessage =
    runState.kind === "unknown" ? failureMessage : null
  const storyboardFrames = readArray(readRecord(detail?.storyboard)?.frames)
  const templateId = readString(templateInfo?.id)
  const templateName = readString(templateInfo?.name)
  const spec = artifactSpecification(artifactKind, result)
  const fileSize = readNumber(result?.file_size)
  const voice = readString(input?.tts_voice)
  const voiceMode = readString(input?.tts_inference_mode)
  const voiceValue = voice
    ? voiceLabel(voice)
    : voiceMode
      ? paramValueLabel(voiceMode)
      : ""
  const overviewItems: Array<{ label: string; value: string; to?: string }> = [
    {
      label: "创建时间",
      value: selectedTask.created_at ? formatDate(selectedTask.created_at) : "",
    },
    {
      label: "完成时间",
      value: selectedTask.completed_at
        ? formatDate(selectedTask.completed_at)
        : "",
    },
    spec,
    {
      label: "文件大小",
      value:
        artifactKind === "video" && fileSize !== null
          ? formatBytes(fileSize)
          : "",
    },
    {
      label: "声音",
      value: artifactKind === "video" ? voiceValue : "",
    },
    {
      label: "配方",
      value: templateName,
      to:
        templateId && templateIds.has(templateId)
          ? `/create/recipes/${templateId}`
          : undefined,
    },
  ].filter((item) => item.value)

  return (
    <section aria-labelledby="library-detail-heading" className="min-w-0">
      {detailState === "stale" ? (
        <AsyncState
          action={
            <Button onClick={onRetry} size="sm" variant="outline">
              重新读取
            </Button>
          }
          className="mb-4"
          description={detailError}
          state="stale"
          title="详情可能不是最新状态"
        />
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className="truncate text-lg font-medium"
              id="library-detail-heading"
            >
              {title}
            </h3>
            <StatusBadge status={runState} />
            <Badge variant="outline">{artifactKindLabel(artifactKind)}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {selectedTask.created_at
              ? `创建于 ${formatDate(selectedTask.created_at)}`
              : "创建时间未知"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canPublish ? (
            <Button onClick={onOpenPublish} size="sm">
              <Send data-icon="inline-start" />
              {publishAttempts.length > 0 ? "再次发布" : "发布"}
            </Button>
          ) : null}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                aria-label="删除记录"
                disabled={isDeleting}
                size="icon-sm"
                variant="ghost"
              >
                {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除这条记录？</AlertDialogTitle>
                <AlertDialogDescription>
                  删除后会移除这条生成记录和相关文件，无法恢复。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>删除</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {overviewItems.length > 0 ? (
        <dl className="flex flex-wrap gap-x-8 gap-y-3 border-b py-4">
          {overviewItems.map((item) => (
            <div key={item.label}>
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd className="mt-0.5 text-sm">
                {item.to ? (
                  <a
                    className="text-primary hover:underline"
                    href={routeHref(item.to)}
                  >
                    {item.value}
                  </a>
                ) : (
                  item.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {runFailed || unresolvedFailureMessage ? (
        <InlineError
          message={
            (runFailed ? failureMessage : unresolvedFailureMessage) ||
            "生成服务返回失败，请回到任务页查看可恢复的子任务。"
          }
          title={runFailed ? "这次生成没有完成" : "状态待同步"}
        />
      ) : null}

      <div
        className={cn(
          "grid gap-5 py-5",
          artifactKind === "video" && "md:grid-cols-[260px_minmax(0,1fr)]"
        )}
      >
        <ArtifactPreview artifact={artifact} />
        {inputText ? (
          <div className="min-w-0">
            <h4 className="text-sm font-medium">输入文案</h4>
            <CollapsibleText text={inputText} />
          </div>
        ) : null}
      </div>

      {publishAttempts.length > 0 ? (
        <section
          aria-labelledby="detail-publish-heading"
          className="border-t pt-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-medium" id="detail-publish-heading">
              发布状态
            </h4>
            {canPublish ? (
              <Button onClick={onOpenPublish} size="sm" variant="ghost">
                查看与调整
              </Button>
            ) : null}
          </div>
          <PublishAttemptList
            attempts={publishAttempts}
            className="mt-2"
            compact
          />
        </section>
      ) : null}

      {artifactKind === "video" && storyboardFrames.length > 0 ? (
        <section aria-labelledby="storyboard-heading" className="border-t pt-4">
          <h4 className="text-sm font-medium" id="storyboard-heading">
            分镜
            <span className="ml-1 font-normal text-muted-foreground">
              {storyboardFrames.length}
            </span>
          </h4>
          <div className="mt-2 divide-y border-y">
            {storyboardFrames.map((frame, index) => (
              <StoryboardRow frame={frame} index={index} key={index} />
            ))}
          </div>
        </section>
      ) : null}
    </section>
  )
}

function LibraryRow({
  task,
  selected,
  onSelect,
  onOpenPublish,
  metrics,
  publishState,
}: {
  task: HistoryTaskSummary
  selected: boolean
  onSelect: () => void
  onOpenPublish: () => void
  metrics: ContentItemMetrics | null
  publishState: AdaptedPublishAttemptState | null
}) {
  const result = readRecord(task.result)
  const artifactType = historyArtifactKind(result)
  const isImageSet = artifactType === "image_set"
  const isText = artifactType === "text"
  const isVideo = artifactType === "video"
  const coverUrl = resolveFileUrl(readString(result?.cover_path))
  const videoUrl = resolveFileUrl(readString(result?.video_path))
  const runState = adaptRunStatus(task.status)
  const failureMessage = historyErrorMessage(result)
  const isFailed = statusIs(runState, "failed")
  const visibleFailureMessage =
    isFailed || runState.kind === "unknown" ? failureMessage : null
  const title =
    task.title ||
    (isText ? "未命名长文" : isImageSet ? "未命名图集" : "未命名视频")
  const metaParts = buildLibraryMeta(
    artifactType,
    result,
    metrics,
    isFailed,
    visibleFailureMessage
  )

  return (
    <div
      className={cn(
        "group flex w-[min(88vw,340px)] shrink-0 snap-start items-center gap-1 rounded-lg border p-1 xl:w-auto xl:rounded-none xl:border-x-0 xl:border-t-0 xl:p-0 xl:py-2 xl:last:border-b-0",
        selected && "bg-muted"
      )}
      role="listitem"
    >
      <button
        aria-pressed={selected}
        className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-md px-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={onSelect}
        type="button"
      >
        <div className="relative flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground">
          {isImageSet && coverUrl ? (
            <img alt="" className="size-full object-cover" src={coverUrl} />
          ) : isVideo && videoUrl ? (
            <video
              aria-hidden="true"
              className="size-full object-cover"
              muted
              playsInline
              preload="metadata"
              src={`${videoUrl}#t=0.1`}
            />
          ) : isText ? (
            <FileText className="size-4" />
          ) : isImageSet ? (
            <Images className="size-4" />
          ) : (
            <Video className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          <div
            className={cn(
              "mt-0.5 truncate text-xs",
              isFailed || visibleFailureMessage
                ? "text-destructive"
                : "text-muted-foreground"
            )}
          >
            {metaParts.join(" · ")}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={runState} />
            {publishState ? <StatusBadge status={publishState} /> : null}
          </div>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        {isVideo && videoUrl ? (
          <Button asChild size="icon-sm" variant="ghost">
            <a aria-label="下载视频" download href={videoUrl}>
              <Download />
            </a>
          </Button>
        ) : null}
        {isVideo && statusIs(runState, "completed") ? (
          <Button
            aria-label="发布视频"
            onClick={onOpenPublish}
            size="icon-sm"
            variant="ghost"
          >
            <Send />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function CollapsibleText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const expandable = text.length > 200 || text.split(/\r?\n/).length > 6
  return (
    <>
      <div
        className={cn(
          "mt-2 text-sm leading-6 whitespace-pre-wrap text-muted-foreground",
          !expanded && "line-clamp-6"
        )}
      >
        {text}
      </div>
      {expandable ? (
        <Button
          className="mt-1 px-0"
          onClick={() => setExpanded((value) => !value)}
          size="sm"
          variant="link"
        >
          {expanded ? "收起" : "展开全文"}
        </Button>
      ) : null}
    </>
  )
}

function StoryboardRow({ frame, index }: { frame: unknown; index: number }) {
  const [showPrompt, setShowPrompt] = useState(false)
  const item = readRecord(frame)
  const frameIndex = readNumber(item?.index)
  const frameNumber = frameIndex === null ? index + 1 : frameIndex + 1
  const imageUrl = resolveFileUrl(
    readString(item?.composed_image_path) || readString(item?.image_path)
  )
  const narration = readString(item?.narration)
  const prompt = readString(item?.image_prompt)
  return (
    <div className="flex gap-3 py-3">
      <div className="h-12 w-8 shrink-0 overflow-hidden rounded-md bg-muted">
        {imageUrl ? (
          <img alt="" className="size-full object-cover" src={imageUrl} />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">
            #{frameNumber}
          </span>
          <span className="truncate text-sm">{narration || "（无旁白）"}</span>
        </div>
        {prompt ? (
          <>
            <Button
              className="mt-1 h-auto px-0 py-0"
              onClick={() => setShowPrompt((value) => !value)}
              size="sm"
              variant="link"
            >
              {showPrompt ? "收起配图提示词" : "配图提示词"}
            </Button>
            {showPrompt ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {prompt}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}

function adaptHistoryArtifact(
  detail: HistoryTaskDetail | null,
  task: HistoryTaskSummary | null
): ArtifactViewModel | null {
  if (!detail || !task) {
    return null
  }
  const result = readRecord(detail.metadata?.result)
  if (!result) {
    return null
  }
  const kind = historyArtifactKind(result)
  const title = task.title || buildDefaultTitle(detail.metadata)
  const base = {
    id: task.task_id,
    title,
    createdAt: task.created_at,
  }

  if (kind === "image_set") {
    const pathItems = readArray(result.image_paths)
      .map((path, index) => {
        const url = resolveFileUrl(readString(path))
        return url
          ? { id: `${task.task_id}:${index}`, url, label: imageSetLabel(index) }
          : null
      })
      .filter(
        (item): item is { id: string; url: string; label: string } =>
          item !== null
      )
    const artifactItems = readArray(result.artifacts)
      .map(readRecord)
      .filter(
        (item): item is Record<string, unknown> =>
          item !== null && readString(item.kind) === "image"
      )
      .map((item, index) => {
        const url = resolveArtifactUrl(item)
        return url
          ? {
              id: `${task.task_id}:artifact:${index}`,
              url,
              label: imageSetLabel(index, readString(item.role)),
            }
          : null
      })
      .filter(
        (item): item is { id: string; url: string; label: string } =>
          item !== null
      )
    return {
      ...base,
      kind: "image_set",
      images: pathItems.length > 0 ? pathItems : artifactItems,
      caption: readString(result.caption) || null,
    }
  }

  if (kind === "text") {
    const resultMetadata = readRecord(result.metadata)
    const article =
      readString(result.article) || readString(resultMetadata?.article)
    if (!article) {
      return null
    }
    return {
      ...base,
      kind: "text",
      article,
    }
  }

  const videoArtifact = readArray(result.artifacts)
    .map(readRecord)
    .find((item) => item && readString(item.kind) === "video")
  const videoUrl =
    resolveFileUrl(readString(result.video_path)) ||
    resolveArtifactUrl(videoArtifact ?? null)
  if (!videoUrl) {
    return null
  }
  return {
    ...base,
    kind: "video",
    src: videoUrl,
    downloadUrl: videoUrl,
    poster: resolveFileUrl(readString(result.cover_path)),
    duration: readNumber(result.duration),
    fileSize: readNumber(result.file_size),
  }
}

function adaptPublishAttempts(
  record: PublishRecord | null,
  platforms: PublishPlatform[]
): PublishAttemptViewModel[] {
  if (!record?.jobs) {
    return []
  }
  const platformLabels = new Map(
    platforms.map((platform) => [platform.id, platform.label])
  )
  return record.jobs.map((job, index) => {
    const state = adaptPublishStatus(job.status)
    return {
      id: job.buffer_post_id || `${job.platform}:${index}`,
      platformId: job.platform,
      platformLabel: platformLabels.get(job.platform) || job.platform,
      state,
      scheduledAt: job.due_at || null,
      publishedAt: statusIs(state, "published") ? job.updated_at || null : null,
      publicUrl: job.public_video_url || null,
      error: job.error || null,
      canRetry: statusIs(state, "failed"),
    }
  })
}

function summarizePublishState(
  attempts: PublishAttemptViewModel[]
): AdaptedPublishAttemptState | null {
  const failed = findPublishState(attempts, "failed")
  if (failed) return failed
  const publishing = findPublishState(attempts, "publishing")
  if (publishing) return publishing
  const scheduled = findPublishState(attempts, "scheduled")
  if (scheduled) return scheduled
  const unknown = attempts.find((attempt) => attempt.state.kind === "unknown")
  if (unknown) return unknown.state
  if (
    attempts.length > 0 &&
    attempts.every((attempt) => statusIs(attempt.state, "published"))
  ) {
    return knownStatus("published")
  }
  return findPublishState(attempts, "idle")
}

function findPublishState(
  attempts: PublishAttemptViewModel[],
  expected: PublishAttemptState
) {
  return (
    attempts.find((attempt) => statusIs(attempt.state, expected))?.state ?? null
  )
}

function getPublishDisabledReason({
  artifact,
  runState,
  selectedPlatforms,
  caption,
  title,
  requiresTitle,
  scheduleMode,
  dueAt,
  isPublishing,
}: {
  artifact: ArtifactViewModel | null
  runState: AdaptedRunState
  selectedPlatforms: string[]
  caption: string
  title: string
  requiresTitle: boolean
  scheduleMode: ScheduleMode
  dueAt: string
  isPublishing: boolean
}) {
  if (isPublishing) {
    return "正在提交，请稍候。"
  }
  if (!statusIs(runState, "completed")) {
    return "作品完成后才能发布。"
  }
  if (artifact?.kind !== "video") {
    return "当前自动发布仅支持视频；图集和长文请先下载。"
  }
  if (selectedPlatforms.length === 0) {
    return "请至少选择一个发布平台。"
  }
  if (!caption.trim()) {
    return "请填写发布文案。"
  }
  if (requiresTitle && !title.trim()) {
    return "所选平台需要标题。"
  }
  if (scheduleMode === "scheduled" && !dueAt.trim()) {
    return "请选择发布时间。"
  }
  return null
}

function filterHistoryTasks(
  tasks: HistoryTaskSummary[],
  query: string,
  artifactFilter: string
) {
  const normalizedQuery = query.trim().toLowerCase()
  return tasks.filter((task) => {
    if (
      normalizedQuery &&
      !(task.title ?? "").toLowerCase().includes(normalizedQuery) &&
      !task.task_id.toLowerCase().includes(normalizedQuery)
    ) {
      return false
    }
    return (
      artifactFilter === "all" ||
      historyArtifactKind(readRecord(task.result)) === artifactFilter
    )
  })
}

function buildLibraryMeta(
  artifactType: ArtifactKind,
  result: Record<string, unknown> | null,
  metrics: ContentItemMetrics | null,
  isFailed: boolean,
  failureMessage: string | null
) {
  const parts = [artifactKindLabel(artifactType)]
  if (failureMessage) {
    parts.push(failureMessage)
  } else if (isFailed) {
    parts.push("生成失败")
  } else if (artifactType === "video") {
    const duration = readNumber(result?.duration)
    if (duration !== null) {
      parts.push(formatDuration(duration))
    }
  } else if (artifactType === "image_set") {
    const pages = readNumber(result?.page_count)
    if (pages !== null) {
      parts.push(`${pages} 页`)
    }
  } else {
    const words = readNumber(result?.word_count)
    if (words !== null) {
      parts.push(`${words} 字`)
    }
  }
  if (!isFailed && metrics) {
    const metricsParts: string[] = []
    if (metrics.likes != null) metricsParts.push(`赞 ${metrics.likes}`)
    if (metrics.favorites != null) metricsParts.push(`藏 ${metrics.favorites}`)
    if (metrics.comments != null) metricsParts.push(`评 ${metrics.comments}`)
    if (metricsParts.length > 0) parts.push(metricsParts.join(" "))
  }
  return parts
}

function artifactSpecification(
  kind: ArtifactKind,
  result: Record<string, unknown> | null
) {
  if (kind === "video") {
    const duration = readNumber(result?.duration)
    return {
      label: "时长",
      value: duration === null ? "" : formatDuration(duration),
    }
  }
  if (kind === "image_set") {
    const pages = readNumber(result?.page_count)
    return { label: "页数", value: pages === null ? "" : `${pages} 页` }
  }
  const words = readNumber(result?.word_count)
  return { label: "字数", value: words === null ? "" : `${words} 字` }
}

function historyArtifactKind(
  result: Record<string, unknown> | null
): ArtifactKind {
  const kind = readString(result?.artifact_type)
  return kind === "image_set" || kind === "text" ? kind : "video"
}

function historyErrorMessage(result: Record<string, unknown> | null) {
  const error = readRecord(result?.error)
  return readString(error?.message) || readString(result?.error) || null
}

function buildDefaultTitle(metadata: Record<string, unknown> | null) {
  const input = readRecord(metadata?.input)
  const title = readString(input?.title).trim()
  if (title) {
    return truncate(title, 100)
  }
  const text = readString(input?.text) || readString(input?.script)
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return truncate(firstLine || "未命名作品", 100)
}

function buildDefaultCaption(metadata: Record<string, unknown> | null) {
  const input = readRecord(metadata?.input)
  const text = readString(input?.text) || readString(input?.script)
  return truncate(text.trim(), 500)
}

function appendHashtags(caption: string, hashtags: string) {
  const cleanCaption = caption.trim()
  const cleanTags = hashtags
    .replaceAll(",", " ")
    .replaceAll("，", " ")
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
    .join(" ")
  return [cleanCaption, cleanTags].filter(Boolean).join("\n\n")
}

function libraryPath(
  source: URLSearchParams,
  patch: Record<string, string | number | null | undefined>
) {
  const next = new URLSearchParams(source)
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") {
      next.delete(key)
    } else {
      next.set(key, String(value))
    }
  }
  const query = next.toString()
  return `/library${query ? `?${query}` : ""}`
}

function validQueryValue(
  value: string | null,
  allowed: ReadonlySet<string>,
  fallback: string
) {
  return value && allowed.has(value) ? value : fallback
}

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function detailStatus(detail: HistoryTaskDetail | null) {
  return readString(detail?.metadata?.status)
}

function resolveArtifactUrl(artifact: Record<string, unknown> | null) {
  if (!artifact) return null
  return (
    resolveFileUrl(readString(artifact.url)) ||
    resolveFileUrl(readString(artifact.path))
  )
}

function resolveFileUrl(value: string) {
  if (!value) return null
  if (/^https?:\/\//.test(value)) return value
  return fileUrlFromPath(value)
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(value: unknown) {
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  return ""
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength).trim()}...`
}

function buildScheduledDueAt(datetimeLocal: string, timezone: string) {
  if (!datetimeLocal.trim()) return null
  const [datePart, timePart] = datetimeLocal.split("T")
  if (!datePart || !timePart) return null
  const [year, month, day] = datePart.split("-").map(Number)
  const [hour, minute] = timePart.split(":").map(Number)
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null
  const offsetMinutes = getTimezoneOffsetMinutes(
    timezone,
    new Date(Date.UTC(year, month - 1, day, hour, minute))
  )
  return `${datePart}T${pad2(hour)}:${pad2(minute)}:00${formatOffset(offsetMinutes)}`
}

function getTimezoneOffsetMinutes(timezone: string, date: Date) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
      timeZoneName: "longOffset",
    })
    const timeZoneName = formatter
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value
    return parseGmtOffset(timeZoneName || "GMT")
  } catch {
    return -date.getTimezoneOffset()
  }
}

function parseGmtOffset(value: string) {
  if (value === "GMT" || value === "UTC") return 0
  const match = value.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/)
  if (!match) return 0
  const sign = match[1] === "-" ? -1 : 1
  return sign * (Number(match[2] || 0) * 60 + Number(match[3] || 0))
}

function formatOffset(offsetMinutes: number) {
  const sign = offsetMinutes < 0 ? "-" : "+"
  const absolute = Math.abs(offsetMinutes)
  return `${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`
}

function pad2(value: number) {
  return String(value).padStart(2, "0")
}
