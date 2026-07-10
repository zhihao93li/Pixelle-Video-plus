import { useEffect, useState } from "react"
import {
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCcw,
  Trash2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { BatchStatusCard } from "@/components/shared/BatchStatusCard"
import { InlineError } from "@/components/shared/feedback"
import { Stat } from "@/components/shared/Stat"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { artifactKindLabel, templateArtifactType } from "@/lib/artifactKind"
import { isTerminalBatchStatus } from "@/lib/batchInput"
import { formatDate, readableError } from "@/lib/format"
import {
  cancelGenerationTask,
  isTerminalStatus,
  listGenerationBatches,
  listTemplates,
  type GenerationBatch,
} from "@/lib/generationApi"
import { navigate } from "@/lib/router"
import { useBatchPolling } from "@/lib/useBatchPolling"
import { useTaskCenter } from "@/lib/taskCenter"
import { cn } from "@/lib/utils"

export function TaskCenterWorkspace() {
  const { tasks, updateTask, removeTask } = useTaskCenter()
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function cancelTask(taskId: string) {
    setCancellingId(taskId)
    setActionError(null)
    try {
      const latest = await cancelGenerationTask(taskId)
      updateTask(latest)
    } catch (error) {
      setActionError(readableError(error))
    } finally {
      setCancellingId(null)
    }
  }

  const runningCount = tasks.filter(
    ({ task }) => !isTerminalStatus(task.status)
  ).length
  const completedCount = tasks.filter(
    ({ task }) => task.status === "completed"
  ).length
  const failedCount = tasks.filter(({ task }) => task.status === "failed").length

  return (
    <main className="flex max-w-[1240px] flex-col gap-6 p-4 lg:p-6">
      <BatchesSection />

      <section className="flex flex-col">
        <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-b pb-3">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <Stat label="进行中" value={runningCount} />
            <Stat label="已完成" value={completedCount} />
            <Stat destructive={failedCount > 0} label="失败" value={failedCount} />
          </div>
          <Button
            onClick={() => navigate("/library")}
            size="sm"
            variant="outline"
          >
            <FolderOpen data-icon="inline-start" />
            打开作品库
          </Button>
        </div>

        {actionError && (
          <InlineError title="任务操作失败" message={actionError} />
        )}

        {tasks.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-10">
            <div className="text-[13px] text-muted-foreground">
              还没有生成任务。创建第一条内容后，进度会显示在这里。
            </div>
            <Button onClick={() => navigate("/create")} size="sm">
              <Plus data-icon="inline-start" />
              快速生产
            </Button>
          </div>
        ) : (
          <div className="mt-2 flex flex-col">
            {tasks.map(({ task, templateName, submittedAt }) => {
              const running = !isTerminalStatus(task.status)
              return (
                <div className="border-b py-2.5 last:border-0" key={task.task_id}>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={task.status} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">
                        {templateName || "生成任务"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        提交于 {formatDate(submittedAt)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {task.status === "completed" && (
                        <Button
                          onClick={() =>
                            navigate(`/library?task=${task.task_id}`)
                          }
                          size="sm"
                          variant="ghost"
                        >
                          查看与发布
                        </Button>
                      )}
                      {running && (
                        <Button
                          disabled={cancellingId === task.task_id}
                          onClick={() => void cancelTask(task.task_id)}
                          size="sm"
                          variant="ghost"
                        >
                          {cancellingId === task.task_id && (
                            <Loader2 className="animate-spin" />
                          )}
                          取消
                        </Button>
                      )}
                      {!running && (
                        <Button
                          aria-label="从列表移除"
                          onClick={() => removeTask(task.task_id)}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </div>

                  {running && (task.progress.message || task.progress.stage) && (
                    <div className="mt-1 pl-[3.75rem] text-xs text-muted-foreground">
                      {task.progress.message || task.progress.stage} ·{" "}
                      {Math.round(task.progress.percentage)}%
                    </div>
                  )}

                  {task.status === "failed" && task.error && (
                    <div className="mt-1 pl-[3.75rem] text-xs text-destructive">
                      {task.error.message}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}

type BatchTemplateInfo = { pipelineId: string; displayName: string }

/** 任务中心「批次」区：近期批次行（形态徽标 + 配方名 ×N + 汇总状态），可展开查看/重试。 */
function BatchesSection() {
  const [batches, setBatches] = useState<GenerationBatch[]>([])
  const [templateMap, setTemplateMap] = useState<
    Record<string, BatchTemplateInfo>
  >({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)
  const {
    batch: polledBatch,
    setBatch: setPolledBatch,
    retryItem,
    retryingItemIndex,
  } = useBatchPolling()

  useEffect(() => {
    let cancelled = false
    void Promise.all([listGenerationBatches(), listTemplates()])
      .then(([batchResponse, templateResponse]) => {
        if (cancelled) {
          return
        }
        setBatches(batchResponse.batches)
        const map: Record<string, BatchTemplateInfo> = {}
        for (const template of templateResponse.templates) {
          map[template.id] = {
            pipelineId: template.pipeline_id,
            displayName: template.display_name,
          }
        }
        setTemplateMap(map)
        setError(null)
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(readableError(loadError))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  // 展开的批次交给轮询 hook（仅非终态轮询）；折叠则停
  useEffect(() => {
    setPolledBatch(
      batches.find((batch) => batch.batch_id === expandedId) ?? null
    )
    // 只在展开项变化时重置，避免每次列表刷新打断轮询
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId])

  // 空批次时整区不渲染（不加空状态噪音）
  if (!isLoading && batches.length === 0 && !error) {
    return null
  }

  return (
    <section className="flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b pb-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium">批次</span>
          <span className="text-xs text-muted-foreground">
            近期批量提交，展开看每条状态、失败可单条重试
          </span>
        </div>
        <Button
          disabled={isLoading}
          onClick={() => setReloadToken((token) => token + 1)}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshCcw className={cn(isLoading && "animate-spin")} />
        </Button>
      </div>
      <div className="mt-3">
        {error && <InlineError title="批次读取失败" message={error} />}
        <div className="flex flex-col gap-2">
          {batches.slice(0, 12).map((batch) => {
            const info = templateMap[batch.template_id]
            const artifactLabel = info
              ? artifactKindLabel(templateArtifactType(info.pipelineId))
              : "产线"
            const recipeName = info?.displayName ?? batch.template_id
            const expanded = expandedId === batch.batch_id
            const shown =
              expanded && polledBatch?.batch_id === batch.batch_id
                ? polledBatch
                : batch
            return (
              <div
                className="rounded-lg border bg-background"
                key={batch.batch_id}
              >
                <button
                  className="flex w-full items-center justify-between gap-3 p-3 text-left"
                  onClick={() =>
                    setExpandedId(expanded ? null : batch.batch_id)
                  }
                  type="button"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="outline">{artifactLabel}</Badge>
                    <span className="truncate text-sm font-medium">
                      {recipeName} ×{shown.total_count}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {batchSummary(shown)}
                    </span>
                    {expanded ? (
                      <ChevronUp className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    )}
                  </div>
                </button>
                {expanded && (
                  <div className="border-t p-3">
                    <BatchStatusCard
                      artifactLabel={artifactLabel}
                      bare
                      batch={shown}
                      onRetryItem={retryItem}
                      retryingItemIndex={retryingItemIndex}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function batchSummary(batch: GenerationBatch): string {
  const done = batch.items.filter((item) => item.status === "completed").length
  const failed = batch.failed_count
  if (isTerminalBatchStatus(batch.status) && done === batch.total_count) {
    return "全部完成"
  }
  return (
    `${done}/${batch.total_count} 完成` + (failed > 0 ? ` · ${failed} 失败` : "")
  )
}
