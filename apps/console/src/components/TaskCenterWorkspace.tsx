import { useEffect, useMemo, useState, type KeyboardEvent } from "react"
import {
  Activity,
  ChevronRight,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCcw,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react"

import { AsyncState } from "@/components/shared/AsyncState"
import { EmptyState } from "@/components/shared/EmptyState"
import { InlineError } from "@/components/shared/feedback"
import { PageFrame } from "@/components/shared/PageFrame"
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
import { Progress } from "@/components/ui/progress"
import { artifactKindLabel, templateArtifactType } from "@/lib/artifactKind"
import { getBatchPreviewTitle } from "@/lib/batchInput"
import { formatDate, readableError } from "@/lib/format"
import {
  cancelGenerationTask,
  listGenerationBatches,
  listTemplates,
  type GenerationBatch,
  type GenerationBatchItem,
} from "@/lib/generationApi"
import {
  adaptRunStatus,
  knownStatus,
  runStatusIsCancellable,
  statusIs,
  type ProductionRunChildViewModel,
  type ProductionRunViewModel,
  type RunState,
} from "@/lib/productViewModels"
import { routeHref } from "@/lib/router"
import { useTaskCenter, type TrackedTask } from "@/lib/taskCenter"
import { useBatchPolling } from "@/lib/useBatchPolling"
import { cn } from "@/lib/utils"

type LoadState = "loading" | "ready" | "error" | "stale"
type BatchTemplateInfo = { pipelineId: string; displayName: string }
const ACTIVE_RUN_STATES: readonly RunState[] = [
  "uploading",
  "submitting",
  "queued",
  "running",
  "cancelling",
]
const TERMINAL_RUN_STATES: readonly RunState[] = [
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]
type OperationRun = ProductionRunViewModel & {
  source: "batch" | "task"
  trackedTaskId?: string
}

export function TaskCenterWorkspace() {
  const { tasks, updateTask, removeTask } = useTaskCenter()
  const [batches, setBatches] = useState<GenerationBatch[]>([])
  const [templateMap, setTemplateMap] = useState<
    Record<string, BatchTemplateInfo>
  >({})
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const {
    batch: polledBatch,
    setBatch: setPolledBatch,
    error: pollingError,
    cancelBatch,
    isCancelling: isCancellingBatch,
    retryItem,
    retryingItemIndex,
  } = useBatchPolling()

  useEffect(() => {
    let cancelled = false

    void Promise.allSettled([listGenerationBatches(), listTemplates()])
      .then(([batchResult, templateResult]) => {
        if (cancelled) {
          return
        }

        if (batchResult.status === "rejected") {
          setLoadError(readableError(batchResult.reason))
          setLoadState(
            batches.length > 0 || tasks.length > 0 ? "stale" : "error"
          )
          return
        }

        const batchResponse = batchResult.value
        const nextTemplateMap: Record<string, BatchTemplateInfo> = {}
        if (templateResult.status === "fulfilled") {
          for (const template of templateResult.value.templates) {
            nextTemplateMap[template.id] = {
              pipelineId: template.pipeline_id,
              displayName: template.display_name,
            }
          }
          setTemplateMap(nextTemplateMap)
        }
        setBatches(batchResponse.batches)
        if (templateResult.status === "rejected") {
          setLoadError(
            `运行列表已读取，但配方名称暂未同步：${readableError(
              templateResult.reason
            )}`
          )
          setLoadState("stale")
        } else {
          setLoadError(null)
          setLoadState("ready")
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsRefreshing(false)
        }
      })

    return () => {
      cancelled = true
    }
    // reloadToken 是显式刷新信号；已有数据用于判定 error / stale。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken])

  const shownBatches = useMemo(
    () =>
      batches.map((batch) =>
        polledBatch?.batch_id === batch.batch_id ? polledBatch : batch
      ),
    [batches, polledBatch]
  )

  const runs = useMemo(() => {
    const batchTaskIds = new Set(
      shownBatches.flatMap((batch) =>
        batch.items.flatMap((item) => (item.task_id ? [item.task_id] : []))
      )
    )
    const batchRuns = shownBatches.map((batch) =>
      adaptBatchRun(batch, templateMap)
    )
    const taskRuns = tasks
      .filter(({ task }) => !batchTaskIds.has(task.task_id))
      .map((tracked) => adaptTrackedRun(tracked, cancellingId))

    return [...batchRuns, ...taskRuns].sort(
      (left, right) => dateValue(right.createdAt) - dateValue(left.createdAt)
    )
  }, [cancellingId, shownBatches, tasks, templateMap])

  const selectedRun =
    runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null
  const effectiveSelectedRunId = selectedRun?.id ?? null

  useEffect(() => {
    const batch = batches.find(
      (item) => item.batch_id === effectiveSelectedRunId
    )
    setPolledBatch(batch ?? null)
  }, [batches, effectiveSelectedRunId, setPolledBatch])

  const selectedBatch = selectedRun
    ? (shownBatches.find((batch) => batch.batch_id === selectedRun.id) ?? null)
    : null

  const runningCount = runs.filter((run) =>
    statusIn(run.state, ACTIVE_RUN_STATES)
  ).length
  const completedCount = runs.filter((run) =>
    statusIs(run.state, "completed")
  ).length
  const failedCount = runs.filter((run) => statusIs(run.state, "failed")).length

  async function cancelTask(taskId: string) {
    setCancellingId(taskId)
    setActionError(null)
    try {
      updateTask(await cancelGenerationTask(taskId))
    } catch (error) {
      setActionError(readableError(error))
    } finally {
      setCancellingId(null)
    }
  }

  function retryChild(childId: string) {
    const item = selectedBatch?.items.find(
      (candidate) => batchChildId(selectedBatch.batch_id, candidate) === childId
    )
    if (item) {
      void retryItem(item.index)
    }
  }

  return (
    <PageFrame>
      <WorkspaceHeader
        actions={
          <>
            <Button
              aria-label="刷新生产运行"
              disabled={isRefreshing}
              onClick={() => {
                setIsRefreshing(true)
                setReloadToken((token) => token + 1)
              }}
              size="icon-sm"
              variant="outline"
            >
              <RefreshCcw className={cn(isRefreshing && "animate-spin")} />
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={routeHref("/library")}>
                <FolderOpen data-icon="inline-start" />
                打开作品库
              </a>
            </Button>
          </>
        }
        description="以一次提交为单位查看总体进度、子任务与恢复操作。"
        title="生产运行"
      />

      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b pb-4">
        <Stat label="进行中" value={runningCount} />
        <Stat label="已完成" value={completedCount} />
        <Stat destructive={failedCount > 0} label="失败" value={failedCount} />
      </div>

      {loadState === "stale" ? (
        <AsyncState
          action={
            <Button
              onClick={() => {
                setIsRefreshing(true)
                setReloadToken((token) => token + 1)
              }}
              size="sm"
              variant="outline"
            >
              重新读取
            </Button>
          }
          description={loadError}
          state="stale"
          title="运行列表可能不是最新状态"
        />
      ) : null}

      {actionError || pollingError ? (
        <InlineError
          message={actionError || pollingError || "操作未完成"}
          title="任务操作失败"
        />
      ) : null}

      {loadState === "loading" && runs.length === 0 ? (
        <AsyncState
          description="正在同步近期提交与子任务进度。"
          state="loading"
          title="正在读取生产运行"
        />
      ) : null}

      {loadState === "error" && runs.length === 0 ? (
        <AsyncState
          action={
            <Button
              onClick={() => {
                setIsRefreshing(true)
                setReloadToken((token) => token + 1)
              }}
              size="sm"
              variant="outline"
            >
              重试
            </Button>
          }
          description={loadError}
          state="error"
          title="无法读取生产运行"
        />
      ) : null}

      {loadState === "ready" && runs.length === 0 ? (
        <EmptyState
          actions={
            <Button asChild size="sm">
              <a href={routeHref("/create")}>
                <Plus data-icon="inline-start" />
                快速生产
              </a>
            </Button>
          }
          description="提交第一条内容后，可以在这里持续查看进度。"
          icon={Activity}
          title="还没有生产运行"
        />
      ) : null}

      {runs.length > 0 ? (
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)] xl:grid-cols-[clamp(380px,30%,520px)_minmax(0,1fr)]">
          <section
            aria-labelledby="run-list-heading"
            className="min-w-0"
            data-slot="run-list"
          >
            <div className="flex items-baseline justify-between gap-3 border-b pb-2">
              <h3 className="text-sm font-medium" id="run-list-heading">
                最近运行
              </h3>
              <span className="text-xs text-muted-foreground">
                {runs.length} 次
              </span>
            </div>
            <div
              className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 lg:mx-0 lg:block lg:overflow-visible lg:px-0 lg:pb-0"
              role="list"
            >
              {runs.map((run, index) => (
                <div
                  className="w-[min(82vw,300px)] shrink-0 snap-start rounded-lg border lg:w-auto lg:rounded-none lg:border-x-0 lg:border-t-0 lg:last:border-b-0"
                  key={run.id}
                  role="listitem"
                >
                  <button
                    aria-pressed={selectedRun?.id === run.id}
                    className={cn(
                      "group flex min-h-20 w-full items-center gap-3 px-2 py-3 text-left outline-none focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
                      selectedRun?.id === run.id
                        ? "bg-muted"
                        : "hover:bg-muted/50"
                    )}
                    data-run-item
                    onClick={() => setSelectedRunId(run.id)}
                    onKeyDown={(event) =>
                      handleRunListKeyDown(event, index, runs, setSelectedRunId)
                    }
                    type="button"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {run.title}
                        </span>
                        <StatusBadge status={run.state} />
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>{artifactKindLabel(run.artifactKind)}</span>
                        <span>{Math.round(run.progress)}%</span>
                      </div>
                      <Progress className="mt-1.5" value={run.progress} />
                    </div>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {selectedRun ? (
            <RunDetail
              cancellingId={cancellingId}
              isCancellingBatch={isCancellingBatch}
              onCancel={(taskId) => void cancelTask(taskId)}
              onCancelBatch={() => void cancelBatch()}
              onRemove={removeTask}
              onRetryChild={retryChild}
              retryingItemIndex={retryingItemIndex}
              run={selectedRun}
              selectedBatch={selectedBatch}
            />
          ) : null}
        </div>
      ) : null}
    </PageFrame>
  )
}

function RunDetail({
  run,
  selectedBatch,
  retryingItemIndex,
  cancellingId,
  isCancellingBatch,
  onRetryChild,
  onCancel,
  onCancelBatch,
  onRemove,
}: {
  run: OperationRun
  selectedBatch: GenerationBatch | null
  retryingItemIndex: number | null
  cancellingId: string | null
  isCancellingBatch: boolean
  onRetryChild: (childId: string) => void
  onCancel: (taskId: string) => void
  onCancelBatch: () => void
  onRemove: (taskId: string) => void
}) {
  const terminal = statusIn(run.state, TERMINAL_RUN_STATES)

  return (
    <section
      aria-labelledby="selected-run-heading"
      className="min-w-0"
      data-slot="run-detail"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className="truncate text-lg font-medium"
              id="selected-run-heading"
            >
              {run.title}
            </h3>
            <StatusBadge status={run.state} />
            <Badge variant="outline">
              {artifactKindLabel(run.artifactKind)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {run.createdAt
              ? `提交于 ${formatDate(run.createdAt)}`
              : "提交时间未知"}
            {run.updatedAt ? ` · 更新于 ${formatDate(run.updatedAt)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {statusIs(run.state, "completed") ? (
            <Button asChild size="sm" variant="outline">
              <a
                href={routeHref(
                  run.trackedTaskId
                    ? `/library?task=${encodeURIComponent(run.trackedTaskId)}`
                    : "/library"
                )}
              >
                <FolderOpen data-icon="inline-start" />
                查看产物
              </a>
            </Button>
          ) : null}
          {run.canCancel && (run.trackedTaskId || selectedBatch) ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  disabled={
                    selectedBatch
                      ? isCancellingBatch
                      : cancellingId === run.trackedTaskId
                  }
                  size="sm"
                  variant="destructive"
                >
                  {(selectedBatch && isCancellingBatch) ||
                  cancellingId === run.trackedTaskId ? (
                    <Loader2
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <XCircle data-icon="inline-start" />
                  )}
                  取消运行
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>取消这次生产运行？</AlertDialogTitle>
                  <AlertDialogDescription>
                    已经完成的步骤不会回退，正在处理的步骤将请求停止。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>继续运行</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      if (selectedBatch) {
                        onCancelBatch()
                      } else if (run.trackedTaskId) {
                        onCancel(run.trackedTaskId)
                      }
                    }}
                  >
                    取消运行
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          {run.source === "task" && terminal && run.trackedTaskId ? (
            <Button
              aria-label="从最近运行中移除"
              onClick={() => onRemove(run.trackedTaskId!)}
              size="icon-sm"
              variant="ghost"
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 py-5 sm:grid-cols-[minmax(0,1fr)_180px]">
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">总体进度</span>
            <span className="text-lg font-medium tabular-nums">
              {Math.round(run.progress)}%
            </span>
          </div>
          <Progress className="mt-2" value={run.progress} />
          {run.message ? (
            <p className="mt-2 text-xs text-muted-foreground">{run.message}</p>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-1">
          <div>
            <dt className="text-xs text-muted-foreground">子任务</dt>
            <dd className="mt-0.5 text-sm font-medium">
              {run.children.length || 1}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">可恢复失败</dt>
            <dd className="mt-0.5 text-sm font-medium">
              {run.children.filter((child) => child.canRetry).length}
            </dd>
          </div>
        </dl>
      </div>

      {run.error ? (
        <InlineError message={run.error} title="本次运行未完成" />
      ) : null}

      <div className="border-t pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-sm font-medium">子任务</h4>
          {run.children.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              {
                run.children.filter((child) =>
                  statusIs(child.state, "completed")
                ).length
              }
              /{run.children.length} 完成
            </span>
          ) : null}
        </div>

        {run.children.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            单条生产没有拆分子任务，总体状态即为当前状态。
          </p>
        ) : (
          <div className="mt-2 divide-y border-y">
            {run.children.map((child) => {
              const rawItem = selectedBatch?.items.find(
                (item) =>
                  batchChildId(selectedBatch.batch_id, item) === child.id
              )
              const retrying = rawItem?.index === retryingItemIndex
              return (
                <div className="py-3" key={child.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {child.label}
                        </span>
                        <StatusBadge status={child.state} />
                      </div>
                      {child.message ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {child.message}
                        </p>
                      ) : null}
                      <Progress className="mt-2" value={child.progress} />
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {rawItem?.task_id &&
                      statusIs(child.state, "completed") ? (
                        <Button asChild size="sm" variant="outline">
                          <a
                            href={routeHref(
                              `/library?task=${encodeURIComponent(rawItem.task_id)}`
                            )}
                          >
                            <FolderOpen data-icon="inline-start" />
                            查看产物
                          </a>
                        </Button>
                      ) : null}
                      {child.canRetry ? (
                        <Button
                          disabled={retryingItemIndex !== null}
                          onClick={() => onRetryChild(child.id)}
                          size="sm"
                          variant="outline"
                        >
                          {retrying ? (
                            <Loader2
                              className="animate-spin"
                              data-icon="inline-start"
                            />
                          ) : (
                            <RotateCcw data-icon="inline-start" />
                          )}
                          重试
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {child.error ? (
                    <p className="mt-2 text-xs text-destructive">
                      {child.error}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

function adaptBatchRun(
  batch: GenerationBatch,
  templateMap: Record<string, BatchTemplateInfo>
): OperationRun {
  const template = templateMap[batch.template_id]
  const artifactKind = templateArtifactType(template?.pipelineId)
  const children = batch.items.map((item) => adaptBatchChild(batch, item))
  const progress =
    children.length > 0
      ? children.reduce((sum, child) => sum + child.progress, 0) /
        children.length
      : 0
  const completed = children.filter((child) =>
    statusIs(child.state, "completed")
  ).length
  const failed = children.filter((child) =>
    statusIs(child.state, "failed")
  ).length

  return {
    id: batch.batch_id,
    title: `${template?.displayName ?? "批量生产"} ×${batch.total_count}`,
    artifactKind,
    state: adaptRunStatus(batch.status),
    progress: clampProgress(progress),
    message:
      failed > 0
        ? `${completed}/${batch.total_count} 完成，${failed} 失败`
        : `${completed}/${batch.total_count} 完成`,
    error: null,
    createdAt: batch.created_at,
    updatedAt: batch.updated_at,
    children,
    artifact: null,
    canCancel: runStatusIsCancellable(adaptRunStatus(batch.status)),
    canRetry: children.some((child) => child.canRetry),
    source: "batch",
  }
}

function adaptBatchChild(
  batch: GenerationBatch,
  item: GenerationBatchItem
): ProductionRunChildViewModel {
  const state = adaptRunStatus(item.status)
  const progress = statusIs(state, "completed")
    ? 100
    : clampProgress(item.progress?.percentage ?? 0)
  return {
    id: batchChildId(batch.batch_id, item),
    label: getBatchPreviewTitle(item.input, Math.max(0, item.index - 1)),
    state,
    progress,
    message: item.progress?.message || null,
    error: item.error?.message || null,
    artifact: null,
    canRetry: statusIs(state, "failed") || statusIs(state, "cancelled"),
  }
}

function adaptTrackedRun(
  tracked: TrackedTask,
  cancellingId: string | null
): OperationRun {
  const { task } = tracked
  const state =
    cancellingId === task.task_id
      ? knownStatus("cancelling")
      : adaptRunStatus(task.status)
  return {
    id: task.task_id,
    title: tracked.templateName || "单条生产",
    artifactKind: templateArtifactType(task.pipeline_id),
    state,
    progress: statusIs(state, "completed")
      ? 100
      : clampProgress(task.progress.percentage ?? 0),
    message: task.progress.message || null,
    error: task.error?.message || null,
    createdAt: tracked.submittedAt || task.created_at,
    updatedAt: task.updated_at,
    children: [],
    artifact: null,
    canCancel: runStatusIsCancellable(state),
    canRetry: false,
    source: "task",
    trackedTaskId: task.task_id,
  }
}

function batchChildId(batchId: string, item: GenerationBatchItem) {
  return `${batchId}:${item.index}`
}

function statusIn(
  state: ProductionRunViewModel["state"],
  expected: readonly RunState[]
) {
  return expected.some((value) => statusIs(state, value))
}

function clampProgress(value: number) {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
}

function dateValue(value?: string | null) {
  if (!value) {
    return 0
  }
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function handleRunListKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  runs: OperationRun[],
  onSelect: (id: string) => void
) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return
  }
  event.preventDefault()
  const nextIndex =
    event.key === "ArrowDown"
      ? Math.min(runs.length - 1, index + 1)
      : Math.max(0, index - 1)
  const next = runs[nextIndex]
  if (!next) {
    return
  }
  onSelect(next.id)
  const list = event.currentTarget.closest('[role="list"]')
  window.requestAnimationFrame(() => {
    list
      ?.querySelectorAll<HTMLButtonElement>("[data-run-item]")
      .item(nextIndex)
      .focus()
  })
}
