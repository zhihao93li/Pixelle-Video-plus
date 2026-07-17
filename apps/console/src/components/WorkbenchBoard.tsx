import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Archive,
  ArchiveRestore,
  Bot,
  CheckCircle2,
  CircleAlert,
  CircleX,
  Clock3,
  ListChecks,
  Loader2,
  RefreshCcw,
  Square,
  X,
} from "lucide-react"

import { AsyncState } from "@/components/shared/AsyncState"
import { PageFrame } from "@/components/shared/PageFrame"
import { WorkspaceHeader } from "@/components/shared/WorkspaceHeader"
import { WorkspacePanel } from "@/components/shared/WorkspacePanel"
import { Badge } from "@/components/ui/badge"
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
} from "@/components/ui/alert-dialog"
import { Progress } from "@/components/ui/progress"
import { useToast } from "@/components/ui/toast"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useCurrentProject } from "@/lib/currentProject"
import { formatDate, readableError } from "@/lib/format"
import {
  archiveProductionTasks,
  cancelProductionTask,
  listWorkbenchTasks,
  listPipelines,
  listTemplates,
  restoreProductionTasks,
  templatesForManagement,
  type PipelineManifest,
  type ProductionTemplate,
  type ProductionTaskState,
  type WorkbenchTaskCard,
} from "@/lib/generationApi"
import { routeHref } from "@/lib/router"
import { cn } from "@/lib/utils"

const POLL_INTERVAL_MS = 5_000
const ALL_FILTER = "__all__"

type WorkbenchColumn = {
  key: ProductionTaskState
  label: string
  description: string
  empty: string
  icon: typeof Clock3
}

const WORKBENCH_COLUMNS: WorkbenchColumn[] = [
  {
    key: "needs_user" as const,
    label: "待你处理",
    description: "路线已暂停，等你确认或操作。",
    empty: "目前没有需要你处理的生产任务",
    icon: Clock3,
  },
  {
    key: "in_progress" as const,
    label: "进行中",
    description: "系统或 Agent 正在继续执行。",
    empty: "目前没有正在执行的任务",
    icon: RefreshCcw,
  },
  {
    key: "failed" as const,
    label: "异常",
    description: "任务已明确失败，需要查看原因。",
    empty: "目前没有明确失败的任务",
    icon: CircleAlert,
  },
  {
    key: "produced" as const,
    label: "已产出",
    description: "必需产物已经生成，可以查看和使用。",
    empty: "还没有符合当前筛选条件的产物",
    icon: CheckCircle2,
  },
]

const CANCELLED_COLUMN: WorkbenchColumn = {
  key: "cancelled",
  label: "已取消",
  description: "只展示用户明确取消的生产任务。",
  empty: "目前没有已取消的任务",
  icon: CircleX,
}
type ColumnItems = Record<ProductionTaskState, WorkbenchTaskCard[]>

const emptyItems = (): ColumnItems => ({
  needs_user: [],
  in_progress: [],
  failed: [],
  produced: [],
  cancelled: [],
})

function sourceLabel(source: string) {
  if (source === "agent") return "Agent 发起"
  if (source === "batch") return "批量发起"
  return "控制台发起"
}

function artifactLabel(artifactType: string) {
  if (artifactType === "image_set") return "图集"
  if (artifactType === "text") return "长文"
  if (artifactType === "audio") return "音频"
  return "视频"
}

type TaskOperationKind = "archive" | "restore" | "cancel"
type PendingTaskOperation = {
  kind: TaskOperationKind
  tasks: WorkbenchTaskCard[]
}

function canArchiveTask(task: WorkbenchTaskCard) {
  return ["failed", "produced", "cancelled"].includes(task.state)
}

function TaskCard({
  task,
  managing,
  selected,
  onToggle,
  onRequestOperation,
}: {
  task: WorkbenchTaskCard
  managing: boolean
  selected: boolean
  onToggle: (task: WorkbenchTaskCard) => void
  onRequestOperation: (
    kind: TaskOperationKind,
    tasks: WorkbenchTaskCard[]
  ) => void
}) {
  const progress = task.progress?.percentage
  const archived = task.archived_at != null
  const selectable = archived || canArchiveTask(task)
  const content = (
    <>
      <div className="flex items-start gap-2">
        {managing ? (
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border text-[10px] leading-none",
              selected && "border-primary bg-primary text-primary-foreground"
            )}
          >
            {selected ? "✓" : null}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm font-medium">{task.title}</div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{artifactLabel(task.artifact_type)}</Badge>
            <Badge
              variant={task.state === "failed" ? "destructive" : "secondary"}
            >
              {task.stage.label}
            </Badge>
            {archived ? <Badge variant="outline">已归档</Badge> : null}
          </div>
        </div>
      </div>

      {task.state === "in_progress" ? (
        <div className="mt-3 flex flex-col gap-1">
          <Progress
            aria-label={task.stage.label}
            indeterminate={progress == null}
            value={progress ?? undefined}
          />
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">{task.stage.label}</span>
            <span className="shrink-0 tabular-nums">
              {progress != null ? `${Math.round(progress)}%` : "正在处理…"}
            </span>
          </div>
        </div>
      ) : null}

      {task.error ? (
        <p className="mt-2 line-clamp-2 text-xs text-destructive">
          {task.error.message}
        </p>
      ) : null}

      {task.action && !archived ? (
        <div className="mt-3 text-xs font-medium text-primary">
          {task.action.label} →
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1">
          {task.source === "agent" ? <Bot className="size-3" /> : null}
          <span className="truncate">
            {task.project_name} · {sourceLabel(task.source)}
          </span>
        </span>
        <span>{formatDate(task.updated_at)}</span>
      </div>
    </>
  )

  return (
    <article
      className={cn(
        "group rounded-lg border bg-card text-left transition-colors",
        !managing && "hover:border-primary/40",
        selected && "border-primary bg-primary/5",
        archived && "bg-muted/30"
      )}
    >
      {managing ? (
        <button
          aria-pressed={selected}
          className="block w-full rounded-lg p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!selectable}
          onClick={() => onToggle(task)}
          type="button"
        >
          {content}
          {!selectable ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {task.state === "in_progress"
                ? "正在运行，请先取消任务"
                : "正在等待你处理，请先放弃任务"}
            </p>
          ) : null}
        </button>
      ) : (
        <>
          <a
            className="block rounded-t-lg p-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            href={routeHref(`/board/tasks/${task.production_task_id}`)}
          >
            {content}
          </a>
          <div className="flex justify-end border-t px-2 py-1.5">
            {archived ? (
              <Button
                onClick={() => onRequestOperation("restore", [task])}
                size="xs"
                variant="ghost"
              >
                <ArchiveRestore data-icon="inline-start" />
                恢复
              </Button>
            ) : task.state === "in_progress" || task.state === "needs_user" ? (
              <Button
                onClick={() => onRequestOperation("cancel", [task])}
                size="xs"
                variant="ghost"
              >
                <Square data-icon="inline-start" />
                {task.state === "needs_user" ? "放弃任务" : "取消任务"}
              </Button>
            ) : (
              <Button
                onClick={() => onRequestOperation("archive", [task])}
                size="xs"
                variant="ghost"
              >
                <Archive data-icon="inline-start" />
                归档
              </Button>
            )}
          </div>
        </>
      )}
    </article>
  )
}

function TaskLane({
  column,
  items,
  loadingMore,
  nextCursor,
  onLoadMore,
  totalCount,
  managing,
  selectedIds,
  onToggle,
  onRequestOperation,
}: {
  column: WorkbenchColumn
  items: WorkbenchTaskCard[]
  loadingMore?: boolean
  nextCursor?: string | null
  onLoadMore?: () => void
  totalCount: number
  managing: boolean
  selectedIds: Set<string>
  onToggle: (task: WorkbenchTaskCard) => void
  onRequestOperation: (
    kind: TaskOperationKind,
    tasks: WorkbenchTaskCard[]
  ) => void
}) {
  const Icon = column.icon
  return (
    <WorkspacePanel
      className="h-full bg-muted/20"
      contentClassName="flex flex-col gap-2"
      description={column.description}
      headerAction={<Badge variant="secondary">{totalCount}</Badge>}
      padding="compact"
      title={
        <span className="inline-flex items-center gap-2">
          <Icon
            className={cn(
              "size-4",
              column.key === "in_progress" && "text-primary"
            )}
          />
          {column.label}
        </span>
      }
    >
      {items.map((task) => (
        <TaskCard
          key={task.production_task_id}
          managing={managing}
          onRequestOperation={onRequestOperation}
          onToggle={onToggle}
          selected={selectedIds.has(task.production_task_id)}
          task={task}
        />
      ))}
      {items.length === 0 ? (
        <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed px-3 text-center text-xs text-muted-foreground">
          {column.empty}
        </div>
      ) : null}
      {nextCursor && onLoadMore ? (
        <Button
          disabled={loadingMore}
          onClick={onLoadMore}
          size="sm"
          variant="ghost"
        >
          {loadingMore ? "正在读取…" : "加载更多"}
        </Button>
      ) : null}
    </WorkspacePanel>
  )
}

export function WorkbenchBoard() {
  const { projectId } = useCurrentProject()
  const toast = useToast()
  const [items, setItems] = useState<ColumnItems>(emptyItems)
  const [counts, setCounts] = useState<Record<ProductionTaskState, number>>({
    needs_user: 0,
    in_progress: 0,
    failed: 0,
    produced: 0,
    cancelled: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeColumnKey, setActiveColumnKey] =
    useState<ProductionTaskState>("needs_user")
  const [artifactType, setArtifactType] = useState(ALL_FILTER)
  const [source, setSource] = useState(ALL_FILTER)
  const [pipelineId, setPipelineId] = useState(ALL_FILTER)
  const [recipeId, setRecipeId] = useState(ALL_FILTER)
  const [createdFrom, setCreatedFrom] = useState("")
  const [createdTo, setCreatedTo] = useState("")
  const [includeArchived, setIncludeArchived] = useState(false)
  const [managing, setManaging] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pendingOperation, setPendingOperation] =
    useState<PendingTaskOperation | null>(null)
  const [operationRunning, setOperationRunning] = useState(false)
  const [taskView, setTaskView] = useState<"active" | "cancelled">("active")
  const [pipelines, setPipelines] = useState<PipelineManifest[]>([])
  const [recipes, setRecipes] = useState<ProductionTemplate[]>([])
  const [nextCursors, setNextCursors] = useState<
    Record<ProductionTaskState, string | null>
  >({
    needs_user: null,
    in_progress: null,
    failed: null,
    produced: null,
    cancelled: null,
  })
  const [loadingMore, setLoadingMore] = useState<ProductionTaskState | null>(
    null
  )

  const visibleColumns = useMemo(
    () => (taskView === "cancelled" ? [CANCELLED_COLUMN] : WORKBENCH_COLUMNS),
    [taskView]
  )

  useEffect(() => {
    void Promise.all([listPipelines(), listTemplates()])
      .then(([pipelineResponse, templateResponse]) => {
        setPipelines(pipelineResponse.pipelines)
        setRecipes(templatesForManagement(templateResponse))
      })
      .catch(() => {
        setPipelines([])
        setRecipes([])
      })
  }, [projectId])

  const queryForState = useCallback(
    (state: ProductionTaskState, cursor?: string) => ({
      state,
      projectId: projectId ?? undefined,
      pipelineId: pipelineId === ALL_FILTER ? undefined : pipelineId,
      recipeId: recipeId === ALL_FILTER ? undefined : recipeId,
      artifactType: artifactType === ALL_FILTER ? undefined : artifactType,
      source: source === ALL_FILTER ? undefined : source,
      createdFrom: createdFrom ? `${createdFrom}T00:00:00Z` : undefined,
      createdTo: createdTo ? `${createdTo}T23:59:59Z` : undefined,
      includeArchived,
      cursor,
      limit: 24,
    }),
    [
      artifactType,
      createdFrom,
      createdTo,
      includeArchived,
      pipelineId,
      projectId,
      recipeId,
      source,
    ]
  )

  const refresh = useCallback(async () => {
    if (!projectId) {
      setItems(emptyItems())
      setLoading(false)
      return
    }
    try {
      const responses = await Promise.all(
        visibleColumns.map((column) =>
          listWorkbenchTasks(queryForState(column.key))
        )
      )
      const next = emptyItems()
      const cursors: Record<ProductionTaskState, string | null> = {
        needs_user: null,
        in_progress: null,
        failed: null,
        produced: null,
        cancelled: null,
      }
      visibleColumns.forEach((column, index) => {
        next[column.key] = responses[index].items
        cursors[column.key] = responses[index].next_cursor
      })
      setItems(next)
      setNextCursors(cursors)
      if (responses[0]) setCounts(responses[0].counts)
      setError(null)
    } catch (refreshError) {
      setError(readableError(refreshError))
    } finally {
      setLoading(false)
    }
  }, [projectId, queryForState, visibleColumns])

  const loadMore = useCallback(
    async (state: ProductionTaskState) => {
      const cursor = nextCursors[state]
      if (!cursor) return
      setLoadingMore(state)
      try {
        const response = await listWorkbenchTasks(queryForState(state, cursor))
        setItems((current) => ({
          ...current,
          [state]: [
            ...current[state],
            ...response.items.filter(
              (candidate) =>
                !current[state].some(
                  (item) =>
                    item.production_task_id === candidate.production_task_id
                )
            ),
          ],
        }))
        setNextCursors((current) => ({
          ...current,
          [state]: response.next_cursor,
        }))
      } catch (loadError) {
        setError(readableError(loadError))
      } finally {
        setLoadingMore(null)
      }
    },
    [nextCursors, queryForState]
  )

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0)
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS)
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [refresh])

  const hasTasks = useMemo(
    () => visibleColumns.some((column) => items[column.key].length > 0),
    [items, visibleColumns]
  )
  const activeColumn =
    visibleColumns.find((column) => column.key === activeColumnKey) ??
    visibleColumns[0]
  const visibleTasks = useMemo(
    () => visibleColumns.flatMap((column) => items[column.key]),
    [items, visibleColumns]
  )
  const selectedTasks = visibleTasks.filter((task) =>
    selectedIds.has(task.production_task_id)
  )
  const selectedArchiveTasks = selectedTasks.filter(
    (task) => task.archived_at == null && canArchiveTask(task)
  )
  const selectedRestoreTasks = selectedTasks.filter(
    (task) => task.archived_at != null
  )

  function toggleTask(task: WorkbenchTaskCard) {
    const selectable = task.archived_at != null || canArchiveTask(task)
    if (!selectable) return
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(task.production_task_id))
        next.delete(task.production_task_id)
      else next.add(task.production_task_id)
      return next
    })
  }

  function requestOperation(
    kind: TaskOperationKind,
    tasks: WorkbenchTaskCard[]
  ) {
    if (tasks.length === 0) return
    setPendingOperation({ kind, tasks })
  }

  async function runPendingOperation() {
    if (!pendingOperation) return
    setOperationRunning(true)
    try {
      const ids = pendingOperation.tasks.map((task) => task.production_task_id)
      if (pendingOperation.kind === "archive") {
        await archiveProductionTasks(ids)
        toast({
          title: `已归档 ${ids.length} 条任务`,
          description: "作品、文件和生产记录仍然保留。",
          variant: "success",
        })
      } else if (pendingOperation.kind === "restore") {
        await restoreProductionTasks(ids)
        toast({
          title: `已恢复 ${ids.length} 条任务`,
          variant: "success",
        })
      } else {
        await Promise.all(ids.map((id) => cancelProductionTask(id)))
        toast({
          title:
            pendingOperation.tasks[0]?.state === "needs_user"
              ? "任务已放弃"
              : "任务已取消",
          variant: "success",
        })
      }
      setSelectedIds(new Set())
      setPendingOperation(null)
      await refresh()
    } catch (operationError) {
      toast({
        title: "操作失败",
        description: readableError(operationError),
        variant: "error",
      })
    } finally {
      setOperationRunning(false)
    }
  }

  return (
    <PageFrame>
      <WorkspaceHeader
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                setManaging((value) => !value)
                setSelectedIds(new Set())
              }}
              size="sm"
              variant={managing ? "secondary" : "outline"}
            >
              {managing ? (
                <X data-icon="inline-start" />
              ) : (
                <ListChecks data-icon="inline-start" />
              )}
              {managing ? "完成管理" : "管理"}
            </Button>
            <Button
              aria-label="刷新"
              className="size-11 lg:size-7"
              disabled={loading}
              onClick={() => void refresh()}
              size="icon-sm"
              variant="outline"
            >
              <RefreshCcw className={cn(loading && "animate-spin")} />
            </Button>
          </div>
        }
        description="所有生产路线都在这里汇总；先看是否需要你处理、是否正常运行，以及最终是否已经产出。"
        title="工作台"
      />

      <div className="flex flex-wrap gap-2">
        <Select
          onValueChange={(value) =>
            setTaskView(value as "active" | "cancelled")
          }
          value={taskView}
        >
          <SelectTrigger className="w-32" aria-label="按任务状态筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">日常任务</SelectItem>
            <SelectItem value="cancelled">已取消</SelectItem>
          </SelectContent>
        </Select>
        <Select
          onValueChange={(value) => {
            setPipelineId(value)
            setRecipeId(ALL_FILTER)
          }}
          value={pipelineId}
        >
          <SelectTrigger className="w-40" aria-label="按路线筛选">
            <SelectValue placeholder="全部路线" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>全部路线</SelectItem>
            {pipelines.map((pipeline) => (
              <SelectItem key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select onValueChange={setRecipeId} value={recipeId}>
          <SelectTrigger className="w-40" aria-label="按模板筛选">
            <SelectValue placeholder="全部模板" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>全部模板</SelectItem>
            {recipes
              .filter(
                (recipe) =>
                  pipelineId === ALL_FILTER || recipe.pipeline_id === pipelineId
              )
              .map((recipe) => (
                <SelectItem key={recipe.id} value={recipe.id}>
                  {recipe.display_name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select onValueChange={setArtifactType} value={artifactType}>
          <SelectTrigger className="w-32" aria-label="按产物筛选">
            <SelectValue placeholder="全部产物" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>全部产物</SelectItem>
            <SelectItem value="video">视频</SelectItem>
            <SelectItem value="image_set">图集</SelectItem>
            <SelectItem value="text">长文</SelectItem>
          </SelectContent>
        </Select>
        <Select onValueChange={setSource} value={source}>
          <SelectTrigger className="w-32" aria-label="按来源筛选">
            <SelectValue placeholder="全部来源" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>全部来源</SelectItem>
            <SelectItem value="react">控制台</SelectItem>
            <SelectItem value="agent">Agent</SelectItem>
            <SelectItem value="batch">批量</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-xs text-muted-foreground">
          <span>起</span>
          <input
            aria-label="创建时间起点"
            className="min-w-28 bg-transparent text-foreground outline-none"
            onChange={(event) => setCreatedFrom(event.target.value)}
            type="date"
            value={createdFrom}
          />
        </label>
        <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-xs text-muted-foreground">
          <span>止</span>
          <input
            aria-label="创建时间终点"
            className="min-w-28 bg-transparent text-foreground outline-none"
            onChange={(event) => setCreatedTo(event.target.value)}
            type="date"
            value={createdTo}
          />
        </label>
        <Button
          aria-pressed={includeArchived}
          onClick={() => {
            setIncludeArchived((value) => !value)
            setSelectedIds(new Set())
          }}
          size="sm"
          variant={includeArchived ? "secondary" : "outline"}
        >
          {includeArchived ? "已显示归档" : "显示已归档"}
        </Button>
      </div>

      {managing ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
          <div className="text-sm">
            已选择{" "}
            <span className="font-medium tabular-nums">
              {selectedTasks.length}
            </span>{" "}
            条任务
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={selectedArchiveTasks.length === 0}
              onClick={() => requestOperation("archive", selectedArchiveTasks)}
              size="sm"
              variant="outline"
            >
              <Archive data-icon="inline-start" />
              归档
              {selectedArchiveTasks.length > 0
                ? ` ${selectedArchiveTasks.length}`
                : ""}
            </Button>
            {includeArchived ? (
              <Button
                disabled={selectedRestoreTasks.length === 0}
                onClick={() =>
                  requestOperation("restore", selectedRestoreTasks)
                }
                size="sm"
                variant="outline"
              >
                <ArchiveRestore data-icon="inline-start" />
                恢复
                {selectedRestoreTasks.length > 0
                  ? ` ${selectedRestoreTasks.length}`
                  : ""}
              </Button>
            ) : null}
            <Button
              disabled={selectedTasks.length === 0}
              onClick={() => setSelectedIds(new Set())}
              size="sm"
              variant="ghost"
            >
              取消选择
            </Button>
          </div>
        </div>
      ) : null}

      {error && hasTasks ? (
        <AsyncState
          action={
            <Button onClick={() => void refresh()} size="sm" variant="outline">
              重新读取
            </Button>
          }
          className="max-w-none"
          description={`${error} 当前仍展示上一次成功读取的任务。`}
          state="stale"
          title="任务状态可能已过期"
        />
      ) : null}

      {loading && !hasTasks ? (
        <AsyncState
          className="max-w-none"
          description="正在同步所有生产路线。"
          state="loading"
          title="正在读取任务…"
        />
      ) : error && !hasTasks ? (
        <AsyncState
          action={
            <Button onClick={() => void refresh()} size="sm" variant="outline">
              重新读取
            </Button>
          }
          className="max-w-none"
          description={error}
          state="error"
          title="任务读取失败"
        />
      ) : !hasTasks ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/10 p-6 text-center">
          <div>
            <div className="text-sm font-medium">还没有生产任务</div>
            <p className="mt-1 text-sm text-muted-foreground">
              新生产统一从快速生产或 Agent 发起，任务会自动汇总到这里。
            </p>
          </div>
          <Button asChild size="sm">
            <a href={routeHref("/create")}>去快速生产</a>
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 lg:hidden">
            <div className="overflow-x-auto pb-1">
              <ToggleGroup
                aria-label="选择任务状态"
                className="w-max justify-start"
                onValueChange={(value) =>
                  value && setActiveColumnKey(value as ProductionTaskState)
                }
                spacing={1}
                type="single"
                value={activeColumn.key}
                variant="outline"
              >
                {visibleColumns.map((column) => (
                  <ToggleGroupItem
                    className="h-11 shrink-0 px-3"
                    key={column.key}
                    value={column.key}
                  >
                    {column.label}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {counts[column.key]}
                    </span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <TaskLane
              column={activeColumn}
              items={items[activeColumn.key]}
              loadingMore={loadingMore === activeColumn.key}
              managing={managing}
              nextCursor={nextCursors[activeColumn.key]}
              onLoadMore={() => void loadMore(activeColumn.key)}
              onRequestOperation={requestOperation}
              onToggle={toggleTask}
              selectedIds={selectedIds}
              totalCount={counts[activeColumn.key]}
            />
          </div>

          <div
            aria-label="生产任务看板"
            className="hidden overflow-x-auto pb-2 lg:block"
            role="region"
          >
            <div
              className={cn(
                "grid items-stretch gap-3",
                taskView === "cancelled"
                  ? "grid-cols-1"
                  : "min-w-[64rem] grid-cols-4"
              )}
            >
              {visibleColumns.map((column) => (
                <TaskLane
                  column={column}
                  items={items[column.key]}
                  key={column.key}
                  loadingMore={loadingMore === column.key}
                  managing={managing}
                  nextCursor={nextCursors[column.key]}
                  onLoadMore={() => void loadMore(column.key)}
                  onRequestOperation={requestOperation}
                  onToggle={toggleTask}
                  selectedIds={selectedIds}
                  totalCount={counts[column.key]}
                />
              ))}
            </div>
          </div>
        </>
      )}

      <AlertDialog
        onOpenChange={(open) =>
          !open && !operationRunning && setPendingOperation(null)
        }
        open={pendingOperation != null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingOperation?.kind === "archive"
                ? `归档 ${pendingOperation.tasks.length} 条任务？`
                : pendingOperation?.kind === "restore"
                  ? `恢复 ${pendingOperation.tasks.length} 条任务？`
                  : pendingOperation?.tasks[0]?.state === "needs_user"
                    ? "放弃这条任务？"
                    : "取消这条任务？"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingOperation?.kind === "archive"
                ? "任务卡将从日常工作台隐藏，作品、文件和生产记录不会删除。"
                : pendingOperation?.kind === "restore"
                  ? "任务卡将重新回到原来的状态栏目。"
                  : pendingOperation?.tasks[0]?.state === "needs_user"
                    ? "这条路线将不再继续，任务会进入“已取消”。"
                    : "系统会停止当前生产，已经产生的执行记录会保留。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={operationRunning}>
              返回
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={operationRunning}
              onClick={(event) => {
                event.preventDefault()
                void runPendingOperation()
              }}
            >
              {operationRunning ? <Loader2 className="animate-spin" /> : null}
              {pendingOperation?.kind === "archive"
                ? "确认归档"
                : pendingOperation?.kind === "restore"
                  ? "确认恢复"
                  : pendingOperation?.tasks[0]?.state === "needs_user"
                    ? "确认放弃"
                    : "确认取消"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageFrame>
  )
}
