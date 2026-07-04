import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCcw,
  Send,
  Trash2,
  Video,
  XCircle,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  ApiError,
  checkPublishConfiguration,
  deleteHistoryTask,
  fileUrlFromPath,
  getHistoryStatistics,
  getHistoryTaskDetail,
  getPublishRecord,
  listHistoryTasks,
  listPublishPlatforms,
  listPublishTimezones,
  publishTask,
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
  const [pageSize, setPageSize] = useState(20)
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

  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
  const [publishTitle, setPublishTitle] = useState("")
  const [publishCaption, setPublishCaption] = useState("")
  const [hashtags, setHashtags] = useState("")
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("queue")
  const [dueAt, setDueAt] = useState("")
  const [publishTimezone, setPublishTimezone] = useState("Asia/Shanghai")

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
          const defaultPlatform =
            platformResponse.platforms.find((platform) => platform.id === "youtube") ??
            platformResponse.platforms[0]
          setSelectedPlatforms([defaultPlatform.id])
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
          const defaultPlatform =
            response.platforms.find((platform) => platform.id === "youtube") ??
            response.platforms[0]
          setSelectedPlatforms([defaultPlatform.id])
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
  }, [publishPlatforms.length])

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
  const canPublish =
    detailStatus(detail) === "completed" &&
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
    const ok = window.confirm("删除后会移除这条生成记录和相关文件。确认删除？")
    if (!ok) {
      return
    }

    setIsDeleting(true)
    setDetailError(null)
    try {
      await deleteHistoryTask(selectedTaskId)
      setSelectedTaskId(null)
      setDetail(null)
      setPublishRecord(null)
      await refreshHistory(null, 1)
    } catch (error) {
      setDetailError(readableError(error))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <main className="mx-auto grid max-w-[1240px] gap-5 p-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:p-6">
      <section className="flex flex-col gap-4">
        <Card className="rounded-lg">
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>历史记录</CardTitle>
                <CardDescription>
                  查看已生成视频，恢复详情并进入发布准备。
                </CardDescription>
              </div>
              <Button
                aria-label="刷新历史记录"
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
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2">
              <Metric label="全部" value={String(statistics?.total_tasks ?? "-")} />
              <Metric label="完成" value={String(statistics?.completed ?? "-")} />
              <Metric label="失败" value={String(statistics?.failed ?? "-")} />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">状态</span>
                <select
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                  onChange={(event) => {
                    setStatusFilter(event.target.value)
                    setPage(1)
                  }}
                  value={statusFilter}
                >
                  <option value="all">全部</option>
                  <option value="completed">已完成</option>
                  <option value="failed">失败</option>
                  <option value="running">进行中</option>
                  <option value="pending">等待中</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">排序字段</span>
                <select
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                  onChange={(event) => {
                    setSortBy(event.target.value)
                    setPage(1)
                  }}
                  value={sortBy}
                >
                  <option value="created_at">创建时间</option>
                  <option value="completed_at">完成时间</option>
                  <option value="duration">时长</option>
                  <option value="status">状态</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">排序方向</span>
                <select
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                  onChange={(event) => {
                    setSortOrder(event.target.value as "asc" | "desc")
                    setPage(1)
                  }}
                  value={sortOrder}
                >
                  <option value="desc">从新到旧</option>
                  <option value="asc">从旧到新</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">每页数量</span>
                <select
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                  onChange={(event) => {
                    setPageSize(Number(event.target.value))
                    setPage(1)
                  }}
                  value={pageSize}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>

            {historyError && (
              <InlineError title="历史读取失败" message={historyError} />
            )}

            <div className="mt-4 flex flex-col gap-2">
              {historyState === "loading" && (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  正在读取历史记录
                </div>
              )}

              {historyState === "ready" && history?.tasks.length === 0 && (
                <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                  暂无生成记录。先在“生成视频”里创建一个真实任务。
                </div>
              )}

              {history?.tasks.map((task) => (
                <button
                  className={cn(
                    "rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted/50",
                    selectedTaskId === task.task_id &&
                      "border-primary bg-primary/5"
                  )}
                  key={task.task_id}
                  onClick={() => setSelectedTaskId(task.task_id)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {task.title || task.task_id}
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {task.task_id}
                      </div>
                    </div>
                    <StatusBadge status={String(task.status)} />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {formatDate(task.created_at)}
                  </div>
                </button>
              ))}
            </div>

            {history && history.total > 0 && (
              <div className="mt-4 flex items-center justify-between gap-3">
                <Button
                  disabled={page <= 1 || historyState === "loading"}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  variant="outline"
                >
                  上一页
                </Button>
                <div className="text-sm text-muted-foreground">
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
                  variant="outline"
                >
                  下一页
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="flex min-w-0 flex-col gap-5">
        <DetailCard
          detail={detail}
          detailError={detailError}
          detailState={detailState}
          isDeleting={isDeleting}
          onDelete={() => void deleteSelectedTask()}
          selectedTask={selectedTask}
        />

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
      </section>
    </main>
  )
}

function DetailCard({
  selectedTask,
  detail,
  detailState,
  detailError,
  isDeleting,
  onDelete,
}: {
  selectedTask: HistoryTaskSummary | null
  detail: HistoryTaskDetail | null
  detailState: LoadState
  detailError: string | null
  isDeleting: boolean
  onDelete: () => void
}) {
  const metadata = detail?.metadata ?? null
  const input = readRecord(metadata?.input)
  const result = readRecord(metadata?.result)
  const videoUrl = fileUrlFromPath(readString(result?.video_path))
  const storyboardFrames = readArray(readRecord(detail?.storyboard)?.frames)
  const inputMode = readString(input?.mode) || "未返回"
  const inputScenes = readString(input?.n_scenes) || "未返回"
  const ttsMode = readString(input?.tts_inference_mode) || "未返回"
  const ttsVoice = readString(input?.tts_voice) || "未返回"

  return (
    <Card className="rounded-lg">
      <CardHeader className="border-b">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>视频详情</CardTitle>
            <CardDescription>
              这里展示真实历史记录中的输入、成片和 storyboard。
            </CardDescription>
          </div>
          {selectedTask && (
            <Button
              disabled={isDeleting}
              onClick={onDelete}
              variant="destructive"
            >
              {isDeleting ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <Trash2 data-icon="inline-start" />
              )}
              删除
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!selectedTask && (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            选择左侧一条历史记录查看详情。
          </div>
        )}

        {detailState === "loading" && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在读取任务详情
          </div>
        )}

        {detailError && <InlineError title="详情读取失败" message={detailError} />}

        {selectedTask && detail && (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={detailStatus(detail)} />
                <Badge variant="outline">{selectedTask.task_id}</Badge>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Fact label="标题" value={selectedTask.title || buildDefaultTitle(metadata)} />
                <Fact label="创建时间" value={formatDate(selectedTask.created_at)} />
                <Fact label="完成时间" value={formatDate(selectedTask.completed_at)} />
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <Fact label="模式" value={inputMode} />
                <Fact label="分镜数" value={inputScenes} />
                <Fact label="TTS" value={ttsMode} />
                <Fact label="声音" value={ttsVoice} />
              </div>

              <div>
                <div className="text-sm font-medium">输入文案</div>
                <div className="mt-2 max-h-48 overflow-auto rounded-lg border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">
                  {readString(input?.text) || readString(input?.script) || "未返回"}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium">Storyboard</div>
                {storyboardFrames.length > 0 ? (
                  <div className="mt-2 grid gap-2">
                    {storyboardFrames.map((frame, index) => {
                      const item = readRecord(frame)
                      const frameIndex = readNumber(item?.index)
                      const frameNumber =
                        frameIndex === null ? index + 1 : frameIndex + 1
                      const imageUrl = fileUrlFromPath(
                        readString(item?.composed_image_path) ||
                          readString(item?.image_path)
                      )
                      const videoSegmentUrl = fileUrlFromPath(
                        readString(item?.video_segment_path) ||
                          readString(item?.video_path)
                      )
                      const audioUrl = fileUrlFromPath(readString(item?.audio_path))
                      return (
                        <div className="rounded-lg border bg-background p-3" key={index}>
                          <div className="text-xs text-muted-foreground">
                            Frame {frameNumber}
                          </div>
                          <div className="mt-1 text-sm leading-6">
                            {readString(item?.narration) || "未返回旁白"}
                          </div>
                          {readString(item?.image_prompt) && (
                            <div className="mt-2 rounded-lg bg-muted/40 p-2 text-xs leading-5 text-muted-foreground">
                              {readString(item?.image_prompt)}
                            </div>
                          )}
                          {(imageUrl || videoSegmentUrl || audioUrl) && (
                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                              {imageUrl && (
                                <img
                                  alt={`Frame ${index + 1}`}
                                  className="max-h-72 w-full rounded-lg border object-contain"
                                  src={imageUrl}
                                />
                              )}
                              {videoSegmentUrl && (
                                <video
                                  className="max-h-72 w-full rounded-lg border bg-black"
                                  controls
                                  src={videoSegmentUrl}
                                />
                              )}
                              {audioUrl && (
                                <audio
                                  className="md:col-span-2 w-full"
                                  controls
                                  src={audioUrl}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="mt-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                    这条记录没有返回 storyboard。
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {videoUrl ? (
                <>
                  <video
                    className="aspect-[9/16] max-h-[520px] rounded-lg border bg-black"
                    controls
                    src={videoUrl}
                  />
                  <Button asChild variant="outline">
                    <a download href={videoUrl}>
                      <Download data-icon="inline-start" />
                      下载或打开成片
                    </a>
                  </Button>
                  <div className="grid gap-2">
                    <Fact
                      label="时长"
                      value={formatDuration(readNumber(result?.duration))}
                    />
                    <Fact
                      label="帧数"
                      value={
                        readString(result?.n_frames) ||
                        readString(result?.frames) ||
                        "未返回"
                      }
                    />
                    <Fact
                      label="文件大小"
                      value={formatFileSize(readNumber(result?.file_size))}
                    />
                  </div>
                </>
              ) : (
                <div className="flex aspect-[9/16] items-center justify-center rounded-lg border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                  没有可预览的成片路径
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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
            当前任务状态不是 completed，不能提交发布。
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
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-sm font-medium">当前发布记录</div>
                {record ? (
                  <div className="mt-3 flex flex-col gap-2">
                    {(record.jobs ?? []).map((job, index) => (
                      <div className="rounded-lg bg-background p-3" key={index}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{job.platform}</span>
                          <Badge
                            variant={
                              job.status === "failed" ? "destructive" : "secondary"
                            }
                          >
                            {job.status}
                          </Badge>
                        </div>
                        {job.buffer_post_id && (
                          <div className="mt-1 font-mono text-xs text-muted-foreground">
                            {job.buffer_post_id}
                          </div>
                        )}
                        {job.error && (
                          <div className="mt-2 text-xs text-destructive">
                            {job.error}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-muted-foreground">
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status || "unknown"
  const Icon =
    normalized === "completed"
      ? CheckCircle2
      : normalized === "failed"
        ? XCircle
        : normalized === "running"
          ? Loader2
          : Video

  return (
    <Badge variant={normalized === "failed" ? "destructive" : "secondary"}>
      <Icon
        className={cn(normalized === "running" && "animate-spin")}
        data-icon="inline-start"
      />
      {normalized}
    </Badge>
  )
}

function InlineError({ title, message }: { title: string; message: string }) {
  return (
    <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <div>
          <div className="font-medium">{title}</div>
          <div className="mt-1 leading-6">{message}</div>
        </div>
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

function formatDate(value?: string | null) {
  if (!value) {
    return "未返回"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function readableError(error: unknown) {
  if (error instanceof ApiError) {
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
