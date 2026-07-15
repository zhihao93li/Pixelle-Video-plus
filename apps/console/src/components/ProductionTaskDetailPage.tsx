import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  CircleAlert,
  Clock3,
  ExternalLink,
  LoaderCircle,
  RefreshCcw,
  RotateCcw,
  Square,
} from "lucide-react"

import { AsyncState } from "@/components/shared/AsyncState"
import { PageFrame } from "@/components/shared/PageFrame"
import { WorkspaceHeader } from "@/components/shared/WorkspaceHeader"
import { WorkspacePanel } from "@/components/shared/WorkspacePanel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatDate, readableError } from "@/lib/format"
import {
  cancelProductionTask,
  getProductionTask,
  retryProductionTask,
  type ProductionTask,
} from "@/lib/generationApi"
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

export function ProductionTaskDetailPage({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<ProductionTask | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<"cancel" | "retry" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setTask(await getProductionTask(taskId))
      setError(null)
    } catch (refreshError) {
      setError(readableError(refreshError))
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timeout)
  }, [refresh])

  const latestGenerationTaskId = task?.generation_task_ids.at(-1)
  const progress = task?.progress_percentage
  const canCancel = task?.state === "in_progress"
  const canRetry = task?.state === "failed" || task?.state === "cancelled"
  const primaryHref = useMemo(() => {
    if (!task) return null
    if (task.state === "produced" && latestGenerationTaskId) {
      return `/library?task=${encodeURIComponent(latestGenerationTaskId)}`
    }
    if (task.state === "needs_user") {
      return `/board/item/${task.content_item_id}`
    }
    return null
  }, [latestGenerationTaskId, task])

  async function runAction(kind: "cancel" | "retry") {
    if (!task) return
    setAction(kind)
    setError(null)
    try {
      const updated =
        kind === "cancel"
          ? await cancelProductionTask(task.production_task_id)
          : await retryProductionTask(task.production_task_id)
      setTask(updated)
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <WorkspacePanel
            description="这张卡从提交开始持续记录同一次生产，不会在确认或重试时换成另一张卡。"
            title="当前状态"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={task.state === "failed" ? "destructive" : "secondary"}
              >
                {STATE_LABELS[task.state]}
              </Badge>
              <Badge variant="outline">{task.stage_label}</Badge>
              <Badge variant="outline">{sourceLabel(task.source)}</Badge>
            </div>

            {progress != null && task.state === "in_progress" ? (
              <div className="mt-4 space-y-2">
                <Progress value={progress} />
                <div className="text-right text-xs text-muted-foreground tabular-nums">
                  {Math.round(progress)}%
                </div>
              </div>
            ) : null}

            {task.error ? (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <CircleAlert className="size-4" />
                  {task.error.layer}
                  {task.error.exception_type
                    ? ` · ${task.error.exception_type}`
                    : ""}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {task.error.message}
                </p>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {primaryHref ? (
                <Button asChild size="sm">
                  <a href={routeHref(primaryHref)}>
                    {task.action_label ??
                      (task.state === "produced" ? "查看产物" : "继续处理")}
                    <ExternalLink data-icon="inline-end" />
                  </a>
                </Button>
              ) : null}
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
              {canCancel ? (
                <Button
                  disabled={action != null}
                  onClick={() => void runAction("cancel")}
                  size="sm"
                  variant="outline"
                >
                  {action === "cancel" ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Square />
                  )}
                  取消任务
                </Button>
              ) : null}
            </div>
          </WorkspacePanel>

          <WorkspacePanel
            description="重试会追加一次执行记录，旧失败不会被覆盖。"
            title="执行记录"
          >
            <div className="space-y-2">
              {task.attempts.map((attempt, index) => (
                <div
                  className="flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                  key={attempt.generation_task_id}
                >
                  <div>
                    <div className="font-medium">
                      第 {index + 1} 次执行 · {attempt.status}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {attempt.stage || "尚未进入执行步骤"}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(attempt.updated_at)}
                  </div>
                </div>
              ))}
              {task.attempts.length === 0 ? (
                <div className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                  尚未进入生成引擎
                </div>
              ) : null}
            </div>
          </WorkspacePanel>
        </div>

        <div className="flex flex-col gap-4">
          <WorkspacePanel padding="compact" title="任务信息">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">所属项目</dt>
                <dd className="mt-0.5 break-all">{task.project_id}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">下一责任人</dt>
                <dd className="mt-0.5">{task.next_actor}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">创建时间</dt>
                <dd className="mt-0.5">{formatDate(task.created_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">状态更新时间</dt>
                <dd className="mt-0.5">{formatDate(task.state_since)}</dd>
              </div>
            </dl>
          </WorkspacePanel>

          <WorkspacePanel padding="compact" title="关联记录">
            <div className="space-y-2 text-sm">
              <a
                className="flex items-center justify-between rounded-md border px-3 py-2 hover:border-primary/40"
                href={routeHref(`/board/item/${task.content_item_id}`)}
              >
                内容详情
                <ExternalLink className="size-3.5" />
              </a>
              <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <Clock3 className="size-3.5" />
                {task.generation_task_ids.length} 条生成记录，
                {task.artifact_ids.length} 条产物记录
              </div>
            </div>
          </WorkspacePanel>
        </div>
      </div>
    </PageFrame>
  )
}
