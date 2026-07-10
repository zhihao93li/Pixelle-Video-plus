import { useEffect, useMemo, useState, type KeyboardEvent } from "react"
import {
  CalendarClock,
  Download,
  FileText,
  Images,
  Loader2,
  RefreshCcw,
  Send,
  Trash2,
  Video,
} from "lucide-react"

import { Button } from "@/components/ui/button"
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { InlineError } from "@/components/shared/feedback"
import { Stat } from "@/components/shared/Stat"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { ImageSetView } from "@/components/shared/ImageSetView"
import { TextArticleView } from "@/components/shared/TextArticleView"
import { imageSetLabel } from "@/lib/imageSet"
import { artifactKindLabel, type ArtifactKind } from "@/lib/artifactKind"
import {
  formatDate,
  paramValueLabel,
  readableError,
  voiceLabel,
} from "@/lib/format"
import { useCurrentProject } from "@/lib/currentProject"
import { navigate } from "@/lib/router"
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
import { cn } from "@/lib/utils"

type LoadState = "idle" | "loading" | "ready" | "error"
type ScheduleMode = "queue" | "scheduled"

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
  const [historyState, setHistoryState] = useState<LoadState>("idle")
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryTaskListResponse | null>(null)
  const [statistics, setStatistics] = useState<HistoryStatistics | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState("all")
  const [sortBy, setSortBy] = useState("created_at")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")
  const [pageSize] = useState(20)
  const [page, setPage] = useState(1)

  const [detailState, setDetailState] = useState<LoadState>("idle")
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detail, setDetail] = useState<HistoryTaskDetail | null>(null)
  const [publishPlatforms, setPublishPlatforms] = useState<PublishPlatform[]>([])
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
  const [isPublishOpen, setIsPublishOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [artifactFilter, setArtifactFilter] = useState("all")
  const [metricsByTask, setMetricsByTask] = useState<
    Record<string, ContentItemMetrics>
  >({})
  const [templateIds, setTemplateIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const toast = useToast()

  const visibleTasks = useMemo(() => {
    const tasks = history?.tasks ?? []
    const query = searchQuery.trim().toLowerCase()
    return tasks.filter((task) => {
      if (
        query &&
        !(task.title ?? "").toLowerCase().includes(query) &&
        !task.task_id.toLowerCase().includes(query)
      ) {
        return false
      }
      if (artifactFilter !== "all") {
        const kind =
          readString(readRecord(task.result)?.artifact_type) || "video"
        if (kind !== artifactFilter) {
          return false
        }
      }
      return true
    })
  }, [history, searchQuery, artifactFilter])

  async function refreshHistory(preferredTaskId = selectedTaskId, nextPage = page) {
    setHistoryState("loading")
    setHistoryError(null)
    try {
      const [taskList, stats] = await Promise.all([
        listHistoryTasks({
          page: nextPage,
          pageSize,
          status: statusFilter,
          sortBy,
          sortOrder,
        }),
        getHistoryStatistics(),
      ])
      setHistory(taskList)
      setStatistics(stats)
      setPage(taskList.page)
      setHistoryState("ready")
      const fallbackTaskId = taskList.tasks[0]?.task_id ?? null
      const nextTaskId =
        (preferredTaskId &&
          taskList.tasks.some((task) => task.task_id === preferredTaskId) &&
          preferredTaskId) ||
        (latestTaskId &&
          taskList.tasks.some((task) => task.task_id === latestTaskId) &&
          latestTaskId) ||
        fallbackTaskId
      setSelectedTaskId(nextTaskId)
    } catch (error) {
      setHistoryState("error")
      setHistoryError(readableError(error))
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadInitialState() {
      setHistoryState("loading")
      setHistoryError(null)
      try {
        const [taskList, stats, platformResponse] = await Promise.all([
          listHistoryTasks({
            page,
            pageSize,
            status: statusFilter,
            sortBy,
            sortOrder,
          }),
          getHistoryStatistics(),
          listPublishPlatforms(),
        ])
        if (cancelled) {
          return
        }
        setHistory(taskList)
        setStatistics(stats)
        setPage(taskList.page)
        setHistoryState("ready")
        const nextTaskId =
          (latestTaskId &&
            taskList.tasks.some((task) => task.task_id === latestTaskId) &&
            latestTaskId) ||
          taskList.tasks[0]?.task_id ||
          null
        setSelectedTaskId(nextTaskId)
        setPublishPlatforms(platformResponse.platforms)
        if (platformResponse.platforms.length > 0) {
          setSelectedPlatforms(
            defaultPublishPlatforms(
              platformResponse.platforms,
              project?.publish_platforms
            )
          )
        }
      } catch (error) {
        if (!cancelled) {
          setHistoryState("error")
          setHistoryError(readableError(error))
        }
      }
    }

    void loadInitialState()

    return () => {
      cancelled = true
    }
    // 项目预选只作为初始默认，无需随 project 变化重拉历史
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestTaskId, page, pageSize, sortBy, sortOrder, statusFilter])

  useEffect(() => {
    let cancelled = false

    async function loadTimezones() {
      try {
        const response = await listPublishTimezones()
        if (cancelled) {
          return
        }
        setPublishTimezones(response.timezones)
        setPublishTimezone(response.default_timezone)
      } catch (error) {
        if (!cancelled) {
          setPublishError(readableError(error))
        }
      }
    }

    void loadTimezones()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadPlatformsIfNeeded() {
      if (publishPlatforms.length > 0) {
        return
      }
      try {
        const response = await listPublishPlatforms()
        if (cancelled) {
          return
        }
        setPublishPlatforms(response.platforms)
        if (response.platforms.length > 0) {
          setSelectedPlatforms(
            defaultPublishPlatforms(response.platforms, project?.publish_platforms)
          )
        }
      } catch (error) {
        if (!cancelled) {
          setPublishError(readableError(error))
        }
      }
    }

    void loadPlatformsIfNeeded()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishPlatforms.length])

  // 数据摘要：拉内容条目建 task_id→metrics 映射（失败静默，纯增强不阻塞）
  useEffect(() => {
    let cancelled = false
    void listContentItems({ limit: 500 })
      .then((items) => {
        if (cancelled) {
          return
        }
        const map: Record<string, ContentItemMetrics> = {}
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
            map[taskId] = metrics
          }
        }
        setMetricsByTask(map)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // 配方存在性：详情速览「配方」仅在模板仍存在时链到配方详情页
  useEffect(() => {
    let cancelled = false
    void listTemplates()
      .then((response) => {
        if (cancelled) {
          return
        }
        setTemplateIds(new Set(response.templates.map((template) => template.id)))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedTaskId) {
      return
    }

    const taskId = selectedTaskId
    let cancelled = false
    async function loadDetail() {
      setDetailState("loading")
      setDetailError(null)
      setPublishError(null)
      setPublishChecks([])
      try {
        const [taskDetail, recordResponse] = await Promise.all([
          getHistoryTaskDetail(taskId),
          getPublishRecord(taskId),
        ])
        if (cancelled) {
          return
        }
        setDetail(taskDetail)
        setPublishRecord(recordResponse.record)
        setPublishTitle(buildDefaultTitle(taskDetail.metadata))
        setPublishCaption(buildDefaultCaption(taskDetail.metadata))
        setHashtags("")
        setScheduleMode("queue")
        setDueAt("")
        setDetailState("ready")
      } catch (error) {
        if (!cancelled) {
          setDetailState("error")
          setDetailError(readableError(error))
        }
      }
    }

    void loadDetail()

    return () => {
      cancelled = true
    }
  }, [selectedTaskId])

  const selectedTask = useMemo(
    () => history?.tasks.find((task) => task.task_id === selectedTaskId) ?? null,
    [history?.tasks, selectedTaskId]
  )
  const publishCaptionWithHashtags = appendHashtags(publishCaption, hashtags)
  const requiresTitle = selectedPlatforms.includes("youtube")
  // 只有视频任务能走 Buffer 自动发布；图集/长文是手动路径（下载/复制）
  const detailArtifactType =
    readString(readRecord(readRecord(detail?.metadata)?.result)?.artifact_type) ||
    "video"
  const detailIsVideo = detailArtifactType === "video"
  const canPublish =
    detailStatus(detail) === "completed" &&
    detailIsVideo &&
    selectedPlatforms.length > 0 &&
    publishCaptionWithHashtags.trim().length > 0 &&
    (!requiresTitle || publishTitle.trim().length > 0) &&
    (scheduleMode !== "scheduled" || dueAt.trim().length > 0) &&
    !isPublishing

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
      const scheduledDueAt =
        scheduleMode === "scheduled"
          ? buildScheduledDueAt(dueAt, publishTimezone)
          : null
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
      setSelectedTaskId(null)
      setDetail(null)
      setPublishRecord(null)
      toast({ title: "记录已删除", variant: "success" })
      await refreshHistory(null, 1)
    } catch (error) {
      setDetailError(readableError(error))
    } finally {
      setIsDeleting(false)
    }
  }

  // 左栏行键盘上下导航：焦点在某行时上下键换选中（预览随之切换）
  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return
    }
    const index = visibleTasks.findIndex(
      (task) => task.task_id === selectedTaskId
    )
    if (index === -1) {
      return
    }
    const nextIndex =
      event.key === "ArrowDown"
        ? Math.min(visibleTasks.length - 1, index + 1)
        : Math.max(0, index - 1)
    const next = visibleTasks[nextIndex]
    if (next) {
      event.preventDefault()
      setSelectedTaskId(next.task_id)
    }
  }

  return (
    <main className="grid max-w-[1240px] gap-5 p-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:p-6">
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">作品库</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              点选一条查看详情与发布。
            </p>
          </div>
          <Button
            aria-label="刷新作品库"
            disabled={historyState === "loading"}
            onClick={() => void refreshHistory()}
            size="icon-sm"
            variant="outline"
          >
            <RefreshCcw
              className={cn(historyState === "loading" && "animate-spin")}
            />
          </Button>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b pb-3">
          <Stat label="全部" value={statistics?.total_tasks} />
          <Stat label="完成" value={statistics?.completed} />
          <Stat
            destructive={(statistics?.failed ?? 0) > 0}
            label="失败"
            value={statistics?.failed}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-8 max-w-[240px]"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索标题…"
            value={searchQuery}
          />
          <Select onValueChange={setArtifactFilter} value={artifactFilter}>
            <SelectTrigger className="h-8 w-auto text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部形态</SelectItem>
              <SelectItem value="video">视频</SelectItem>
              <SelectItem value="image_set">图集</SelectItem>
              <SelectItem value="text">长文</SelectItem>
            </SelectContent>
          </Select>
          <Select
            onValueChange={(value) => {
              setStatusFilter(value)
              setPage(1)
            }}
            value={statusFilter}
          >
            <SelectTrigger className="h-8 w-auto text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="completed">已完成</SelectItem>
              <SelectItem value="failed">失败</SelectItem>
              <SelectItem value="running">生成中</SelectItem>
              <SelectItem value="pending">排队中</SelectItem>
            </SelectContent>
          </Select>
          <Select
            onValueChange={(value) => {
              const [nextSortBy, nextOrder] = value.split(":")
              setSortBy(nextSortBy)
              setSortOrder(nextOrder as "asc" | "desc")
              setPage(1)
            }}
            value={`${sortBy}:${sortOrder}`}
          >
            <SelectTrigger className="h-8 w-auto text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at:desc">最新创建</SelectItem>
              <SelectItem value="created_at:asc">最早创建</SelectItem>
              <SelectItem value="completed_at:desc">最近完成</SelectItem>
              <SelectItem value="duration:desc">时长最长</SelectItem>
              <SelectItem value="status:asc">按状态</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {historyError && (
          <InlineError title="作品库读取失败" message={historyError} />
        )}

        {historyState === "loading" && (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在读取作品库
          </div>
        )}

        {historyState === "ready" && history?.tasks.length === 0 && (
          <div className="flex flex-col items-start gap-3 py-6">
            <div className="text-sm text-muted-foreground">还没有生成记录。</div>
            <Button onClick={() => navigate("/create")} size="sm">
              去快速生产
            </Button>
          </div>
        )}

        {visibleTasks.length === 0 &&
          historyState === "ready" &&
          (history?.tasks.length ?? 0) > 0 && (
            <div className="py-6 text-sm text-muted-foreground">
              没有匹配的记录。
            </div>
          )}

        <div className="flex flex-col gap-0.5" onKeyDown={handleListKeyDown}>
          {visibleTasks.map((task) => (
            <LibraryRow
              key={task.task_id}
              metrics={metricsByTask[task.task_id] ?? null}
              onOpenPublish={() => {
                setSelectedTaskId(task.task_id)
                setIsPublishOpen(true)
              }}
              onSelect={() => setSelectedTaskId(task.task_id)}
              selected={selectedTaskId === task.task_id}
              task={task}
            />
          ))}
        </div>

        {history && history.total > 0 && (
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <Button
              disabled={page <= 1 || historyState === "loading"}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
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
                historyState === "loading" ||
                page >= (history.total_pages ?? 1)
              }
              onClick={() =>
                setPage((current) =>
                  Math.min(history.total_pages ?? current, current + 1)
                )
              }
              size="sm"
              variant="outline"
            >
              下一页
            </Button>
          </div>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-5">
        <DetailCard
          canPublish={detailStatus(detail) === "completed" && detailIsVideo}
          detail={detail}
          detailError={detailError}
          detailState={detailState}
          isDeleting={isDeleting}
          onDelete={() => void deleteSelectedTask()}
          onOpenPublish={() => setIsPublishOpen(true)}
          publishRecord={publishRecord}
          selectedTask={selectedTask}
          templateIds={templateIds}
        />
      </section>

      <Sheet onOpenChange={setIsPublishOpen} open={isPublishOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>发布到社媒</SheetTitle>
            <SheetDescription>
              确认标题、文案与平台后提交；可加入队列或定时发布。
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
        <PublishCard
          caption={publishCaption}
          checks={publishChecks}
          detail={detail}
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
          record={publishRecord}
          scheduleMode={scheduleMode}
          selectedPlatforms={selectedPlatforms}
          scheduledDueAt={
            scheduleMode === "scheduled"
              ? buildScheduledDueAt(dueAt, publishTimezone)
              : null
          }
          submitDisabled={!canPublish}
          timezone={publishTimezone}
          timezones={publishTimezones}
          title={publishTitle}
        />
          </div>
        </SheetContent>
      </Sheet>
    </main>
  )
}
function DetailCard({
  selectedTask,
  detail,
  detailState,
  detailError,
  isDeleting,
  canPublish,
  publishRecord,
  onDelete,
  onOpenPublish,
  templateIds,
}: {
  selectedTask: HistoryTaskSummary | null
  detail: HistoryTaskDetail | null
  detailState: LoadState
  detailError: string | null
  isDeleting: boolean
  canPublish: boolean
  publishRecord: PublishRecord | null
  onDelete: () => void
  onOpenPublish: () => void
  templateIds: ReadonlySet<string>
}) {
  const metadata = detail?.metadata ?? null
  const input = readRecord(metadata?.input)
  const result = readRecord(metadata?.result)
  const templateInfo = readRecord(metadata?.production_template)
  const videoUrl = fileUrlFromPath(readString(result?.video_path))
  const artifactType = (readString(result?.artifact_type) ||
    "video") as ArtifactKind
  const isImageSet = artifactType === "image_set"
  const isText = artifactType === "text"
  const isVideo = artifactType === "video"
  const imageSetItems = isImageSet
    ? readArray(result?.image_paths)
        .map((path, index) => {
          const url = fileUrlFromPath(readString(path))
          return url ? { url, label: imageSetLabel(index) } : null
        })
        .filter((item): item is { url: string; label: string } => item !== null)
    : []
  const imageSetCaption = readString(result?.caption)
  const articleText = readString(result?.article)
  const articleTitle = readString(result?.title)
  const storyboardFrames = readArray(readRecord(detail?.storyboard)?.frames)
  const inputText = readString(input?.text) || readString(input?.script)
  const title = selectedTask
    ? selectedTask.title || buildDefaultTitle(metadata)
    : ""

  // 速览定义行：缺值不渲染（不显示「未返回」占位），全部中文化
  const specValue = isVideo
    ? (() => {
        const duration = readNumber(result?.duration)
        return duration === null ? "" : formatDuration(duration)
      })()
    : isImageSet
      ? (() => {
          const pages = readString(result?.page_count)
          return pages ? `${pages} 页` : ""
        })()
      : (() => {
          const words = readString(result?.word_count)
          return words ? `${words} 字` : ""
        })()
  const specLabel = isVideo ? "时长" : isImageSet ? "页数" : "字数"
  const fileSizeValue = (() => {
    const size = readNumber(result?.file_size)
    return size === null ? "" : formatFileSize(size)
  })()
  const voice = readString(input?.tts_voice)
  const ttsMode = readString(input?.tts_inference_mode)
  const voiceValue = voice
    ? voiceLabel(voice)
    : ttsMode
      ? paramValueLabel(ttsMode)
      : ""
  const templateId = readString(templateInfo?.id)
  const templateName = readString(templateInfo?.name)
  const overviewItems: Array<{ label: string; value: string; to?: string }> = [
    {
      label: "创建时间",
      value: selectedTask?.created_at ? formatDate(selectedTask.created_at) : "",
    },
    {
      label: "完成时间",
      value: selectedTask?.completed_at
        ? formatDate(selectedTask.completed_at)
        : "",
    },
    { label: specLabel, value: specValue },
    { label: "文件大小", value: isVideo ? fileSizeValue : "" },
    { label: "声音", value: isVideo ? voiceValue : "" },
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
    <div className="flex min-w-0 flex-col gap-5">
      {!selectedTask && (
        <div className="py-6 text-sm text-muted-foreground">
          选择左侧一条记录查看详情。
        </div>
      )}

      {detailState === "loading" && (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在读取详情
        </div>
      )}

      {detailError && <InlineError title="详情读取失败" message={detailError} />}

      {selectedTask && detail && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-lg font-medium">{title}</h2>
              <StatusBadge status={detailStatus(detail)} />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canPublish && (
                <Button onClick={onOpenPublish} size="sm">
                  <Send data-icon="inline-start" />
                  {publishRecord ? "再次发布" : "发布"}
                </Button>
              )}
              {isVideo && videoUrl && (
                <Button asChild size="sm" variant="outline">
                  <a download href={videoUrl}>
                    <Download data-icon="inline-start" />
                    下载
                  </a>
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    aria-label="删除记录"
                    disabled={isDeleting}
                    size="icon-sm"
                    variant="ghost"
                  >
                    {isDeleting ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}
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

          {overviewItems.length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 border-b pb-3">
              {overviewItems.map((item) => (
                <div key={item.label}>
                  <div className="text-[11px] text-muted-foreground">
                    {item.label}
                  </div>
                  <div className="mt-0.5 text-[13px]">
                    {item.to ? (
                      <button
                        className="text-primary transition-colors hover:underline"
                        onClick={() => navigate(item.to as string)}
                        type="button"
                      >
                        {item.value}
                      </button>
                    ) : (
                      item.value
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-[220px_minmax(0,1fr)]">
            <div className="flex flex-col gap-3">
              {isText ? (
                <TextArticleView article={articleText} title={articleTitle || null} />
              ) : isImageSet ? (
                <ImageSetView items={imageSetItems} caption={imageSetCaption || null} />
              ) : videoUrl ? (
                <video
                  className="aspect-[9/16] w-full rounded-lg border bg-black"
                  controls
                  src={videoUrl}
                />
              ) : (
                <div className="flex aspect-[9/16] items-center justify-center rounded-lg border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                  没有可预览的成片
                </div>
              )}
            </div>

            {inputText && (
              <div className="min-w-0">
                <div className="text-sm font-medium">输入文案</div>
                <CollapsibleText text={inputText} />
              </div>
            )}
          </div>

          {isVideo && storyboardFrames.length > 0 && (
            <div>
              <div className="text-sm font-medium">
                分镜{" "}
                <span className="font-normal text-muted-foreground">
                  {storyboardFrames.length}
                </span>
              </div>
              <div className="mt-2">
                {storyboardFrames.map((frame, index) => (
                  <StoryboardRow frame={frame} index={index} key={index} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 输入文案：默认 6 行截断，长文案给「展开全文」inline 切换。 */
function CollapsibleText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const expandable = text.length > 200 || text.split(/\r?\n/).length > 6
  return (
    <>
      <div
        className={cn(
          "mt-2 whitespace-pre-wrap text-[13px] leading-6 text-muted-foreground",
          !expanded && "line-clamp-6"
        )}
      >
        {text}
      </div>
      {expandable && (
        <button
          className="mt-1 text-xs text-primary transition-colors hover:underline"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? "收起" : "展开全文"}
        </button>
      )}
    </>
  )
}

/** 分镜紧凑行：帧缩略 + 文案首行截断 +「配图提示词」inline 展开（不进弹层）。 */
function StoryboardRow({ frame, index }: { frame: unknown; index: number }) {
  const [showPrompt, setShowPrompt] = useState(false)
  const item = readRecord(frame)
  const frameIndex = readNumber(item?.index)
  const frameNumber = frameIndex === null ? index + 1 : frameIndex + 1
  const imageUrl = fileUrlFromPath(
    readString(item?.composed_image_path) || readString(item?.image_path)
  )
  const narration = readString(item?.narration)
  const prompt = readString(item?.image_prompt)
  return (
    <div className="flex gap-2.5 border-b py-2 last:border-0">
      <div className="h-9 w-6 shrink-0 overflow-hidden rounded-sm bg-muted">
        {imageUrl && (
          <img alt="" className="h-full w-full object-cover" src={imageUrl} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-[11px] text-muted-foreground">
            #{frameNumber}
          </span>
          <span className="truncate text-[13px]">{narration || "（无旁白）"}</span>
        </div>
        {prompt && (
          <>
            <button
              className="mt-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setShowPrompt((value) => !value)}
              type="button"
            >
              {showPrompt ? "收起配图提示词" : "配图提示词"}
            </button>
            {showPrompt && (
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {prompt}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function PublishCard({
  detail,
  platforms,
  selectedPlatforms,
  title,
  caption,
  hashtags,
  scheduleMode,
  dueAt,
  timezone,
  timezones,
  scheduledDueAt,
  record,
  checks,
  error,
  isChecking,
  isPublishing,
  submitDisabled,
  onPlatformsChange,
  onTitleChange,
  onCaptionChange,
  onHashtagsChange,
  onScheduleModeChange,
  onDueAtChange,
  onTimezoneChange,
  onCheck,
  onSubmit,
}: {
  detail: HistoryTaskDetail | null
  platforms: PublishPlatform[]
  selectedPlatforms: string[]
  title: string
  caption: string
  hashtags: string
  scheduleMode: ScheduleMode
  dueAt: string
  timezone: string
  timezones: string[]
  scheduledDueAt: string | null
  record: PublishRecord | null
  checks: PublishCheck[]
  error: string | null
  isChecking: boolean
  isPublishing: boolean
  submitDisabled: boolean
  onPlatformsChange: (value: string[]) => void
  onTitleChange: (value: string) => void
  onCaptionChange: (value: string) => void
  onHashtagsChange: (value: string) => void
  onScheduleModeChange: (value: ScheduleMode) => void
  onDueAtChange: (value: string) => void
  onTimezoneChange: (value: string) => void
  onCheck: () => void
  onSubmit: () => void
}) {
  const completed = detailStatus(detail) === "completed"

  return (
    <Card className="rounded-lg">
      <CardHeader className="border-b">
        <CardTitle>发布准备</CardTitle>
        <CardDescription>
          只对已完成任务开放；提交后走真实 Buffer 发布链路。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!detail && (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            选择一条已完成的视频后，可以检查发布配置并提交。
          </div>
        )}

        {detail && !completed && (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            这条记录尚未完成，完成后才能提交发布。
          </div>
        )}

        {detail && completed && (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-w-0 flex-col gap-4">
              <div>
                <div className="text-sm font-medium">平台</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {platforms.map((platform) => {
                    const checked = selectedPlatforms.includes(platform.id)
                    return (
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                          checked && "border-primary bg-primary/5"
                        )}
                        key={platform.id}
                      >
                        <input
                          checked={checked}
                          className="size-4"
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...selectedPlatforms, platform.id]
                              : selectedPlatforms.filter((id) => id !== platform.id)
                            onPlatformsChange(next)
                          }}
                          type="checkbox"
                        />
                        {platform.label}
                      </label>
                    )
                  })}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium" htmlFor="publish-title">
                    标题
                  </label>
                  <Input
                    id="publish-title"
                    onChange={(event) => onTitleChange(event.target.value)}
                    value={title}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium" htmlFor="publish-hashtags">
                    话题标签
                  </label>
                  <Input
                    id="publish-hashtags"
                    onChange={(event) => onHashtagsChange(event.target.value)}
                    placeholder="#petcare #shorts"
                    value={hashtags}
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium" htmlFor="publish-caption">
                  发布文案
                </label>
                <Textarea
                  className="mt-2 min-h-36 resize-y"
                  id="publish-caption"
                  onChange={(event) => onCaptionChange(event.target.value)}
                  value={caption}
                />
              </div>

              <div>
                <div className="text-sm font-medium">发布时间</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    onClick={() => onScheduleModeChange("queue")}
                    type="button"
                    variant={scheduleMode === "queue" ? "default" : "outline"}
                  >
                    加入 Buffer 队列
                  </Button>
                  <Button
                    onClick={() => onScheduleModeChange("scheduled")}
                    type="button"
                    variant={scheduleMode === "scheduled" ? "default" : "outline"}
                  >
                    <CalendarClock data-icon="inline-start" />
                    指定时间
                  </Button>
                </div>
                {scheduleMode === "scheduled" && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Input
                      onChange={(event) => onDueAtChange(event.target.value)}
                      type="datetime-local"
                      value={dueAt}
                    />
                    <select
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                      onChange={(event) => onTimezoneChange(event.target.value)}
                      value={timezone}
                    >
                      {timezones.map((timezoneOption) => (
                        <option key={timezoneOption} value={timezoneOption}>
                          {timezoneOption}
                        </option>
                      ))}
                    </select>
                    <div className="sm:col-span-2 text-sm text-muted-foreground">
                      发送给 Buffer：{scheduledDueAt || "请选择发布时间"}
                    </div>
                  </div>
                )}
              </div>

              {error && <InlineError title="发布操作失败" message={error} />}
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <div className="text-sm font-medium">当前发布记录</div>
                {record ? (
                  <div className="mt-2 flex flex-col">
                    {(record.jobs ?? []).map((job, index) => (
                      <div
                        className="flex flex-col gap-1 border-b py-2 last:border-0"
                        key={index}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{job.platform}</span>
                          <StatusBadge status={job.status} />
                        </div>
                        {job.buffer_post_id && (
                          <div className="font-mono text-xs text-muted-foreground">
                            {job.buffer_post_id}
                          </div>
                        )}
                        {job.error && (
                          <div className="text-xs text-destructive">
                            {job.error}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-muted-foreground">
                    还没有提交过发布。
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  disabled={isChecking || selectedPlatforms.length === 0}
                  onClick={onCheck}
                  variant="outline"
                >
                  {isChecking ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <RefreshCcw data-icon="inline-start" />
                  )}
                  检查发布配置
                </Button>
                <Button disabled={submitDisabled} onClick={onSubmit}>
                  {isPublishing ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Send data-icon="inline-start" />
                  )}
                  提交到 Buffer
                </Button>
              </div>

              {checks.length > 0 && (
                <>
                  <Separator />
                  <div className="flex flex-col gap-2">
                    {checks.map((check, index) => (
                      <div
                        className={cn(
                          "rounded-lg p-3 text-sm",
                          check.ok
                            ? "bg-primary/5 text-foreground"
                            : "bg-destructive/10 text-destructive"
                        )}
                        key={`${check.name}-${index}`}
                      >
                        <div className="font-medium">{check.name}</div>
                        <div className="mt-1 text-xs">{check.message}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LibraryRow({
  task,
  selected,
  onSelect,
  onOpenPublish,
  metrics,
}: {
  task: HistoryTaskSummary
  selected: boolean
  onSelect: () => void
  onOpenPublish: () => void
  metrics: ContentItemMetrics | null
}) {
  const resultRecord = readRecord(task.result)
  const artifactType = (readString(resultRecord?.artifact_type) ||
    "video") as ArtifactKind
  const isImageSet = artifactType === "image_set"
  const isText = artifactType === "text"
  const isVideo = artifactType === "video"
  const coverUrl = fileUrlFromPath(readString(resultRecord?.cover_path))
  const videoUrl = fileUrlFromPath(readString(resultRecord?.video_path))
  const status = String(task.status)
  const isFailed = status === "failed" || status === "partial_failed"
  const title =
    task.title ||
    (isText ? "未命名长文" : isImageSet ? "未命名图文帖" : "未命名视频")

  const metaParts: string[] = [artifactKindLabel(artifactType)]
  if (isFailed) {
    metaParts.push(readString(resultRecord?.error) || "生成失败")
  } else if (isVideo) {
    const duration = readNumber(resultRecord?.duration)
    if (duration !== null) {
      metaParts.push(formatDuration(duration))
    }
  } else if (isImageSet) {
    const pages = readString(resultRecord?.page_count)
    if (pages) {
      metaParts.push(`${pages} 页`)
    }
  } else if (isText) {
    const words = readString(resultRecord?.word_count)
    if (words) {
      metaParts.push(`${words} 字`)
    }
  }
  if (!isFailed && metrics) {
    const bits: string[] = []
    if (metrics.likes != null) {
      bits.push(`赞 ${metrics.likes}`)
    }
    if (metrics.favorites != null) {
      bits.push(`藏 ${metrics.favorites}`)
    }
    if (metrics.comments != null) {
      bits.push(`评 ${metrics.comments}`)
    }
    if (bits.length > 0) {
      metaParts.push(bits.join(" "))
    }
  }
  if (task.created_at) {
    metaParts.push(formatDate(task.created_at))
  }

  return (
    <div
      className={cn(
        "group flex cursor-pointer gap-2.5 rounded-md px-2 py-2",
        selected ? "bg-muted" : "hover:bg-muted/50"
      )}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="relative h-11 w-8 shrink-0 overflow-hidden rounded bg-muted">
        {isImageSet && coverUrl ? (
          <img alt="" className="h-full w-full object-cover" src={coverUrl} />
        ) : isVideo && videoUrl ? (
          <video
            className="h-full w-full object-cover"
            muted
            playsInline
            preload="metadata"
            src={`${videoUrl}#t=0.1`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            {isText ? (
              <FileText className="size-4" />
            ) : isImageSet ? (
              <Images className="size-4" />
            ) : (
              <Video className="size-4" />
            )}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{title}</div>
        <div
          className={cn(
            "truncate text-xs",
            isFailed ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {metaParts.join(" · ")}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {isVideo && videoUrl ? (
          <Button
            aria-label="下载"
            asChild
            className="size-7"
            size="icon-sm"
            variant="ghost"
          >
            <a download href={videoUrl} onClick={(event) => event.stopPropagation()}>
              <Download />
            </a>
          </Button>
        ) : !isVideo ? (
          <Button
            aria-label="下载"
            className="size-7"
            onClick={(event) => {
              event.stopPropagation()
              onSelect()
            }}
            size="icon-sm"
            variant="ghost"
          >
            <Download />
          </Button>
        ) : null}
        {isVideo && status === "completed" && (
          <Button
            aria-label="发布"
            className="size-7"
            onClick={(event) => {
              event.stopPropagation()
              onOpenPublish()
            }}
            size="icon-sm"
            variant="ghost"
          >
            <Send />
          </Button>
        )}
      </div>
    </div>
  )
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
  return truncate(firstLine || "未命名视频", 100)
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

  if (!cleanTags) {
    return cleanCaption
  }
  if (!cleanCaption) {
    return cleanTags
  }
  return `${cleanCaption}\n\n${cleanTags}`
}

function detailStatus(detail: HistoryTaskDetail | null) {
  return readString(detail?.metadata?.status) || "unknown"
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(value: unknown) {
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number") {
    return String(value)
  }
  return ""
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, maxLength).trim()}...`
}

function buildScheduledDueAt(datetimeLocal: string, timezone: string) {
  if (!datetimeLocal.trim()) {
    return null
  }

  const [datePart, timePart] = datetimeLocal.split("T")
  if (!datePart || !timePart) {
    return null
  }

  const [year, month, day] = datePart.split("-").map(Number)
  const [hour, minute] = timePart.split(":").map(Number)
  if (![year, month, day, hour, minute].every(Number.isFinite)) {
    return null
  }

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
  if (value === "GMT" || value === "UTC") {
    return 0
  }
  const match = value.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/)
  if (!match) {
    return 0
  }
  const sign = match[1] === "-" ? -1 : 1
  const hours = Number(match[2] || 0)
  const minutes = Number(match[3] || 0)
  return sign * (hours * 60 + minutes)
}

function formatOffset(offsetMinutes: number) {
  const sign = offsetMinutes < 0 ? "-" : "+"
  const absolute = Math.abs(offsetMinutes)
  const hours = Math.floor(absolute / 60)
  const minutes = absolute % 60
  return `${sign}${pad2(hours)}:${pad2(minutes)}`
}

function pad2(value: number) {
  return String(value).padStart(2, "0")
}

function formatDuration(seconds: number | null) {
  if (seconds === null) {
    return "未返回"
  }
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)
    return `${minutes}m ${remainingSeconds}s`
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

function formatFileSize(bytes: number | null) {
  if (bytes === null) {
    return "未返回"
  }
  if (bytes < 1024) {
    return `${bytes}B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`
}
