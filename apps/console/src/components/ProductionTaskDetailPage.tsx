import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  CircleAlert,
  LoaderCircle,
  RefreshCcw,
  RotateCcw,
  Square,
} from "lucide-react"

import { CurrentReviewWorkspace } from "@/components/content/review/CurrentReviewWorkspace"
import { ProductionFollowUp } from "@/components/production/ProductionFollowUp"
import { ProductionTimeline } from "@/components/production/ProductionTimeline"
import { ArtifactPreview } from "@/components/shared/ArtifactPreview"
import { AsyncState } from "@/components/shared/AsyncState"
import { PageFrame } from "@/components/shared/PageFrame"
import { WorkspaceHeader } from "@/components/shared/WorkspaceHeader"
import { WorkspacePanel } from "@/components/shared/WorkspacePanel"
import { Badge } from "@/components/ui/badge"
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
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatDate, readableError } from "@/lib/format"
import {
  cancelProductionTask,
  getPendingContentReview,
  getProductionTask,
  getProductionTaskTimeline,
  getTaskResult,
  retryProductionTask,
  type ContentItem,
  type GenerationResult,
  type PendingReviewSession,
  type ProductionTask,
  type ProductionTimelineEntry,
} from "@/lib/generationApi"
import { resultArtifactViewModel } from "@/lib/productionRunAdapters"
import { routeHref } from "@/lib/router"

const STATE_LABELS: Record<ProductionTask["state"], string> = {
  needs_user: "待你处理",
  in_progress: "进行中",
  failed: "异常",
  produced: "已产出",
  cancelled: "已取消",
}

function sourceLabel(source: ProductionTask["source"]) {
  if (source === "agent") return "Agent 发起"
  if (source === "batch") return "批量发起"
  return "控制台发起"
}

function CancelTaskButton({
  disabled,
  kind,
  onConfirm,
  pending,
}: {
  disabled: boolean
  kind: "cancel" | "abandon"
  onConfirm: () => void
  pending: boolean
}) {
  const abandoning = kind === "abandon"
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={disabled} size="sm" variant="outline">
          {pending ? <LoaderCircle className="animate-spin" /> : <Square />}
          {abandoning ? "放弃任务" : "取消任务"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {abandoning ? "确定放弃这条任务？" : "确定取消这条任务？"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            任务会停在当前位置，已保存的文案、分镜和产物不会被删除。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>继续任务</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {abandoning ? "确认放弃" : "确认取消"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function ProductionTaskDetailPage({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<ProductionTask | null>(null)
  const [item, setItem] = useState<ContentItem | null>(null)
  const [pendingReview, setPendingReview] =
    useState<PendingReviewSession | null>(null)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [resultLoading, setResultLoading] = useState(false)
  const [resultError, setResultError] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<ProductionTimelineEntry[]>([])
  const [timelineCursor, setTimelineCursor] = useState<string | null>(null)
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [timelineResults, setTimelineResults] = useState<
    Record<string, GenerationResult | null>
  >({})
  const [timelineResultErrors, setTimelineResultErrors] = useState<
    Record<string, string | null>
  >({})
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<"cancel" | "retry" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadTimelineResults = useCallback(
    async (entries: ProductionTimelineEntry[]) => {
      const taskIds = Array.from(
        new Set(
          entries
            .filter((entry) => entry.event_type === "artifact_produced")
            .map((entry) => entry.generation_task_id)
            .filter((id): id is string => Boolean(id))
        )
      )
      await Promise.all(
        taskIds.map(async (generationTaskId) => {
          try {
            const nextResult = await getTaskResult(generationTaskId)
            setTimelineResults((current) => ({
              ...current,
              [generationTaskId]: nextResult,
            }))
            setTimelineResultErrors((current) => ({
              ...current,
              [generationTaskId]: null,
            }))
          } catch (fetchError) {
            setTimelineResults((current) => ({
              ...current,
              [generationTaskId]: null,
            }))
            setTimelineResultErrors((current) => ({
              ...current,
              [generationTaskId]: readableError(fetchError),
            }))
          }
        })
      )
    },
    []
  )

  const loadTimeline = useCallback(
    async (cursor?: string) => {
      setTimelineLoading(true)
      try {
        const page = await getProductionTaskTimeline(taskId, {
          cursor,
          limit: 30,
        })
        setTimeline((current) =>
          cursor ? [...current, ...page.items] : page.items
        )
        setTimelineCursor(page.next_cursor)
        setTimelineError(null)
        await loadTimelineResults(page.items)
      } catch (fetchError) {
        setTimelineError(readableError(fetchError))
      } finally {
        setTimelineLoading(false)
      }
    },
    [loadTimelineResults, taskId]
  )

  const refresh = useCallback(async () => {
    try {
      const nextTask = await getProductionTask(taskId)
      setTask(nextTask)

      const context = await getPendingContentReview(nextTask.content_item_id)
      setItem(context.item)
      setPendingReview(context.review)

      const latestTaskId = nextTask.generation_task_ids.at(-1)
      if (nextTask.state === "produced" && latestTaskId) {
        setResultLoading(true)
        try {
          setResult(await getTaskResult(latestTaskId))
          setResultError(null)
        } catch (resultFetchError) {
          setResult(null)
          setResultError(readableError(resultFetchError))
        } finally {
          setResultLoading(false)
        }
      } else {
        setResult(null)
        setResultError(null)
        setResultLoading(false)
      }
      await loadTimeline()
      setError(null)
    } catch (refreshError) {
      setError(readableError(refreshError))
    } finally {
      setLoading(false)
    }
  }, [loadTimeline, taskId])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timeout)
  }, [refresh])

  useEffect(() => {
    if (task?.state !== "in_progress") return undefined
    let cancelled = false
    let timeout: number | undefined
    const poll = async () => {
      await refresh()
      if (!cancelled) timeout = window.setTimeout(poll, 2_000)
    }
    timeout = window.setTimeout(poll, 2_000)
    return () => {
      cancelled = true
      if (timeout) window.clearTimeout(timeout)
    }
  }, [refresh, task?.state])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    document.addEventListener("visibilitychange", handleVisibility)
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility)
  }, [refresh])

  const latestGenerationTaskId = task?.generation_task_ids.at(-1)
  const progress = task?.progress_percentage
  const canRetry = task?.state === "failed" || task?.state === "cancelled"
  const artifact = resultArtifactViewModel(result, null)
  const primaryHref = useMemo(() => {
    if (!task || task.state !== "produced" || !latestGenerationTaskId)
      return null
    return `/library?task=${encodeURIComponent(latestGenerationTaskId)}`
  }, [latestGenerationTaskId, task])

  const visibleTimeline = useMemo(() => {
    return timeline.filter((entry) => {
      if (
        task?.state === "needs_user" &&
        pendingReview?.review_id &&
        entry.revision_id === pendingReview.review_id &&
        entry.category === "output"
      ) {
        return false
      }
      if (
        task?.state === "produced" &&
        item?.status !== "published" &&
        item?.status !== "measured" &&
        entry.event_type === "artifact_produced" &&
        entry.generation_task_id === latestGenerationTaskId
      ) {
        return false
      }
      if (
        task?.state === "failed" &&
        entry.event_type === "production_failed" &&
        entry.generation_task_id === latestGenerationTaskId
      ) {
        return false
      }
      if (
        task?.state === "cancelled" &&
        entry.event_type === "task_cancelled"
      ) {
        return false
      }
      return true
    })
  }, [
    item?.status,
    latestGenerationTaskId,
    pendingReview?.review_id,
    task?.state,
    timeline,
  ])

  async function runAction(kind: "cancel" | "retry") {
    if (!task) return
    setAction(kind)
    setError(null)
    try {
      if (kind === "cancel") await cancelProductionTask(task.production_task_id)
      else await retryProductionTask(task.production_task_id)
      await refresh()
    } catch (actionError) {
      setError(readableError(actionError))
    } finally {
      setAction(null)
    }
  }

  if (loading && !task) {
    return (
      <PageFrame>
        <AsyncState state="loading" title="正在读取生产任务" />
      </PageFrame>
    )
  }

  if (!task) {
    return (
      <PageFrame>
        <AsyncState
          action={
            <Button asChild size="sm" variant="outline">
              <a href={routeHref("/board")}>返回工作台</a>
            </Button>
          }
          description={error ?? "这张生产任务卡不存在或已经不可读。"}
          state="error"
          title="无法打开任务"
        />
      </PageFrame>
    )
  }

  const currentTitle =
    task.state === "needs_user"
      ? task.stage_label
      : task.state === "produced" && item?.status === "published"
        ? "记录发布数据"
        : task.state === "produced" && item?.status === "measured"
          ? "任务已完成"
          : task.state === "produced"
            ? "检查产物并发布"
            : "当前状态"

  return (
    <PageFrame>
      <WorkspaceHeader
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <a href={routeHref("/board")}>
                <ArrowLeft data-icon="inline-start" />
                返回工作台
              </a>
            </Button>
            <Button
              aria-label="刷新任务"
              disabled={action != null}
              onClick={() => void refresh()}
              size="icon-sm"
              variant="outline"
            >
              <RefreshCcw />
            </Button>
          </>
        }
        description={`${task.pipeline_id} · ${task.recipe_id}`}
        title={task.title}
      />

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <WorkspacePanel
          description={
            task.state === "needs_user"
              ? "这是当前唯一需要处理的内容；完成后会进入下方生产记录。"
              : "只展示当前最重要的状态或操作。"
          }
          title={currentTitle}
        >
          {task.state === "needs_user" ? (
            <div className="space-y-4">
              {pendingReview ? (
                <CurrentReviewWorkspace
                  itemId={task.content_item_id}
                  onChanged={refresh}
                  review={pendingReview}
                />
              ) : (
                <AsyncState
                  action={
                    <Button
                      onClick={() => void refresh()}
                      size="sm"
                      variant="outline"
                    >
                      重新读取
                    </Button>
                  }
                  description="任务正在等待人工确认，但当前确认内容还未读取到。"
                  state="stale"
                  title="确认内容暂未就绪"
                />
              )}
              <div className="flex justify-end">
                <CancelTaskButton
                  disabled={action != null}
                  kind="abandon"
                  onConfirm={() => void runAction("cancel")}
                  pending={action === "cancel"}
                />
              </div>
            </div>
          ) : task.state === "produced" ? (
            <div className="space-y-4">
              {item?.status === "published" ||
              item?.status === "measured" ? null : (
                <>
                  {resultLoading && !result ? (
                    <AsyncState state="loading" title="正在读取产物" />
                  ) : resultError ? (
                    <AsyncState
                      action={
                        <Button
                          onClick={() => void refresh()}
                          size="sm"
                          variant="outline"
                        >
                          <RefreshCcw />
                          重新读取产物
                        </Button>
                      }
                      description={resultError}
                      state="error"
                      title="产物读取失败"
                    />
                  ) : (
                    <ArtifactPreview artifact={artifact} />
                  )}
                  {primaryHref ? (
                    <div className="flex justify-end">
                      <Button asChild size="sm" variant="outline">
                        <a href={routeHref(primaryHref)}>在作品库中打开</a>
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
              {item ? (
                <ProductionFollowUp
                  item={item}
                  onChanged={refresh}
                  productionTaskId={task.production_task_id}
                />
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    task.state === "failed" ? "destructive" : "secondary"
                  }
                >
                  {STATE_LABELS[task.state]}
                </Badge>
                <Badge variant="outline">{task.stage_label}</Badge>
                <Badge variant="outline">{sourceLabel(task.source)}</Badge>
              </div>

              {task.state === "in_progress" ? (
                <div className="space-y-2">
                  <Progress
                    aria-label={task.stage_label}
                    indeterminate={progress == null}
                    value={progress ?? undefined}
                  />
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>{task.stage_label}</span>
                    {progress != null ? (
                      <span>{Math.round(progress)}%</span>
                    ) : (
                      <span>正在处理</span>
                    )}
                  </div>
                </div>
              ) : null}

              {task.state === "failed" && task.error ? (
                <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <div className="font-medium">{task.stage_label}</div>
                    <div className="mt-1">{task.error.message}</div>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2">
                {canRetry ? (
                  <Button
                    disabled={action != null}
                    onClick={() => void runAction("retry")}
                    size="sm"
                    variant="outline"
                  >
                    {action === "retry" ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <RotateCcw />
                    )}
                    原样重试
                  </Button>
                ) : null}
                {task.state === "in_progress" ? (
                  <CancelTaskButton
                    disabled={action != null}
                    kind="cancel"
                    onConfirm={() => void runAction("cancel")}
                    pending={action === "cancel"}
                  />
                ) : null}
              </div>
            </div>
          )}
        </WorkspacePanel>

        {timelineError ? (
          <AsyncState
            action={
              <Button
                onClick={() => void loadTimeline()}
                size="sm"
                variant="outline"
              >
                重新读取记录
              </Button>
            }
            description={timelineError}
            state="error"
            title="生产记录读取失败"
          />
        ) : (
          <div className="rounded-xl border bg-card p-5 sm:p-6">
            <ProductionTimeline
              entries={visibleTimeline}
              resultErrors={timelineResultErrors}
              results={timelineResults}
            />
            {timelineCursor ? (
              <div className="mt-5 flex justify-center border-t pt-4">
                <Button
                  disabled={timelineLoading}
                  onClick={() => void loadTimeline(timelineCursor)}
                  size="sm"
                  variant="outline"
                >
                  {timelineLoading ? (
                    <LoaderCircle className="animate-spin" />
                  ) : null}
                  查看更早记录
                </Button>
              </div>
            ) : null}
          </div>
        )}

        <details className="rounded-lg border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            任务信息
          </summary>
          <dl className="grid gap-4 border-t px-4 py-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">内容空间</dt>
              <dd className="mt-1 break-all">{task.project_id}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">发起方式</dt>
              <dd className="mt-1">{sourceLabel(task.source)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">创建时间</dt>
              <dd className="mt-1">{formatDate(task.created_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">最后更新</dt>
              <dd className="mt-1">{formatDate(task.updated_at)}</dd>
            </div>
          </dl>
        </details>
      </div>
    </PageFrame>
  )
}
