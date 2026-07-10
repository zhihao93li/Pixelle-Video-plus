import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Bot,
  Check,
  LayoutDashboard,
  Loader2,
  Plus,
  RefreshCcw,
} from "lucide-react"

import { AsyncState } from "@/components/shared/AsyncState"
import { EmptyState } from "@/components/shared/EmptyState"
import { PageFrame } from "@/components/shared/PageFrame"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useToast } from "@/components/ui/toast"
import { ProductionSubmitPanel } from "@/components/shared/ProductionSubmitPanel"
import type { ProductionOverrides } from "@/components/shared/ProductionSubmitPanel"
import { ContentStatusBadge } from "@/components/shared/StatusBadge"
import { WorkspaceHeader } from "@/components/shared/WorkspaceHeader"
import { WorkspacePanel } from "@/components/shared/WorkspacePanel"
import { AddContentDialog } from "@/components/AddContentDialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { BOARD_COLUMNS } from "@/lib/contentItemMeta"
import { formatDate, readableError } from "@/lib/format"
import { languageLabel } from "@/lib/languages"
import { navigate, routeHref } from "@/lib/router"
import { generateDraftsForItems } from "@/lib/contentDrafting"
import {
  buildProduceSubmissions,
  isProducibleItem,
  submitContentProduction,
} from "@/lib/produceContent"
import { useCurrentProject } from "@/lib/currentProject"
import { useTaskCenter } from "@/lib/taskCenter"
import { cn } from "@/lib/utils"
import {
  getTask,
  importExistingContentItems,
  listContentItems,
  transitionContentItem,
  type ContentItem,
} from "@/lib/generationApi"

const POLL_INTERVAL_MS = 30000
const PUBLISH_HOUR = 9 // 每天 09:00（Asia/Shanghai）发布节奏

const isSelectable = isProducibleItem

function ItemCard({
  item,
  selected,
  selectable,
  onToggleSelect,
  failed,
}: {
  item: ContentItem
  selected: boolean
  selectable: boolean
  onToggleSelect: () => void
  failed: boolean
}) {
  const taskCenter = useTaskCenter()
  const taskIds = item.links.task_ids ?? []
  const progress =
    item.status === "producing"
      ? taskIds
          .map((id) => taskCenter.getTask(id)?.task.progress?.percentage ?? 0)
          .reduce((sum, value, _index, list) => sum + value / list.length, 0)
      : null

  return (
    <article
      className={cn(
        "group relative rounded-lg border bg-card text-left transition-colors focus-within:border-primary/50 hover:border-primary/40",
        selected && "border-primary bg-primary/5"
      )}
    >
      {selectable && (
        <button
          aria-label={selected ? "取消选择" : "选择"}
          className={cn(
            "absolute top-2 right-2 z-10 flex size-5 items-center justify-center rounded border transition-opacity after:absolute after:-inset-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/30 bg-background opacity-100 lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100"
          )}
          onClick={(event) => {
            event.stopPropagation()
            onToggleSelect()
          }}
          type="button"
        >
          {selected && <Check className="size-3.5" />}
        </button>
      )}

      <a
        className="block rounded-lg p-3 pr-9 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
        href={routeHref(`/board/item/${item.item_id}`)}
      >
        <div className="line-clamp-2 text-sm font-medium">{item.title}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <ContentStatusBadge status={item.status} />
          {failed ? <Badge variant="destructive">生产失败</Badge> : null}
          {item.languages.map((language) => {
            const variant = item.variants[language]
            const isConfirmed = variant?.status === "confirmed"
            return (
              <Badge
                key={language}
                variant={isConfirmed ? "success" : "outline"}
              >
                {languageLabel(language)}
              </Badge>
            )
          })}
        </div>
        {progress != null && !failed ? (
          <Progress className="mt-3" value={progress} />
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {item.source === "agent" ? <Bot className="size-3" /> : null}
            {item.source === "agent"
              ? "AI 起草"
              : item.source === "derived"
                ? "衍生选题"
                : "手动添加"}
          </span>
          <span>{formatDate(item.updated_at)}</span>
        </div>
        {item.metrics.likes != null && (
          <div className="mt-1 text-xs text-muted-foreground">
            赞 {item.metrics.likes}
          </div>
        )}
      </a>
    </article>
  )
}

type BoardColumn = (typeof BOARD_COLUMNS)[number]

function LifecycleLane({
  column,
  failedItemIds,
  items,
  onSchedule,
  onToggleSelect,
  selectedIds,
}: {
  column: BoardColumn
  failedItemIds: Set<string>
  items: ContentItem[]
  onSchedule?: () => void
  onToggleSelect: (itemId: string) => void
  selectedIds: Set<string>
}) {
  const step = BOARD_COLUMNS.findIndex((item) => item.key === column.key) + 1

  return (
    <WorkspacePanel
      className="h-full bg-muted/20"
      contentClassName="flex flex-col gap-2"
      headerAction={<Badge variant="secondary">{items.length}</Badge>}
      padding="compact"
      title={
        <span className="inline-flex items-center gap-2">
          <span className="text-muted-foreground tabular-nums">
            {String(step).padStart(2, "0")}
          </span>
          {column.label}
        </span>
      }
    >
      {column.key === "ready" && onSchedule ? (
        <Button
          className="h-11 w-full lg:h-7"
          onClick={onSchedule}
          size="sm"
          variant="outline"
        >
          按节奏排期
        </Button>
      ) : null}
      {items.map((item) => (
        <ItemCard
          failed={failedItemIds.has(item.item_id)}
          item={item}
          key={item.item_id}
          onToggleSelect={() => onToggleSelect(item.item_id)}
          selectable={isSelectable(item)}
          selected={selectedIds.has(item.item_id)}
        />
      ))}
      {items.length === 0 ? (
        <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed px-3 text-center text-xs text-muted-foreground">
          这个阶段暂无内容
        </div>
      ) : null}
    </WorkspacePanel>
  )
}

export function WorkbenchBoard() {
  const toast = useToast()
  const taskCenter = useTaskCenter()
  const { projectId } = useCurrentProject()
  const [items, setItems] = useState<ContentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [activeColumnKey, setActiveColumnKey] = useState(BOARD_COLUMNS[0].key)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [failedItemIds, setFailedItemIds] = useState<Set<string>>(new Set())
  const [produceOpen, setProduceOpen] = useState(false)
  const [produceTemplateId, setProduceTemplateId] = useState("")
  const [produceOverrides, setProduceOverrides] = useState<ProductionOverrides>(
    {}
  )
  const [producing, setProducing] = useState(false)

  const reconcileProducing = useCallback(
    async (current: ContentItem[]): Promise<boolean> => {
      const inProduction = current.filter((item) => item.status === "producing")
      const failed = new Set<string>()
      let changed = false
      for (const item of inProduction) {
        const taskIds = item.links.task_ids ?? []
        if (taskIds.length === 0) {
          continue
        }
        const settled = await Promise.allSettled(
          taskIds.map((id) => getTask(id))
        )
        const tasks = settled
          .filter(
            (
              result
            ): result is PromiseFulfilledResult<
              Awaited<ReturnType<typeof getTask>>
            > => result.status === "fulfilled"
          )
          .map((result) => result.value)
        if (tasks.length < taskIds.length) {
          continue
        }
        if (tasks.every((task) => task.status === "completed")) {
          try {
            await transitionContentItem(item.item_id, "produced", {}, "system")
            changed = true
          } catch {
            // 状态可能已被其它路径推进，忽略
          }
        } else if (tasks.some((task) => task.status === "failed")) {
          failed.add(item.item_id)
        }
      }
      setFailedItemIds(failed)
      return changed
    },
    []
  )

  const refresh = useCallback(
    async (options: { reconcile?: boolean } = {}) => {
      try {
        const query = { limit: 500, project: projectId ?? undefined }
        let list = await listContentItems(query)
        if (options.reconcile) {
          const changed = await reconcileProducing(list)
          if (changed) {
            list = await listContentItems(query)
          }
        }
        setItems(list)
        setError(null)
      } catch (refreshError) {
        setError(readableError(refreshError))
      } finally {
        setLoading(false)
      }
    },
    [reconcileProducing, projectId]
  )

  useEffect(() => {
    async function tick() {
      await refresh({ reconcile: true })
    }
    void tick()
    const interval = window.setInterval(() => {
      void tick()
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [refresh])

  const byColumn = useMemo(() => {
    const map: Record<string, ContentItem[]> = {}
    for (const column of BOARD_COLUMNS) {
      map[column.key] = []
    }
    for (const item of items) {
      const column = BOARD_COLUMNS.find((col) =>
        col.statuses.includes(item.status)
      )
      if (column) {
        map[column.key].push(item)
      }
    }
    return map
  }, [items])

  const selectedItems = items.filter((item) => selectedIds.has(item.item_id))
  const producedColumn =
    byColumn.ready?.filter((item) => item.status === "produced") ?? []

  function toggleSelect(itemId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  async function runImport() {
    setImporting(true)
    try {
      const result = await importExistingContentItems()
      toast({
        title: `已导入 ${result.created} 条内容`,
        variant: "success",
      })
      await refresh()
    } catch (importError) {
      toast({
        title: "导入失败",
        description: readableError(importError),
        variant: "error",
      })
    } finally {
      setImporting(false)
    }
  }

  const draftableSelected = selectedItems.filter(
    (item) => item.kind === "text" && item.status === "idea"
  )

  async function submitDrafting() {
    const items = draftableSelected
    setSelectedIds(new Set())
    try {
      // 起草配置由后端按当前项目解析（1:1，自愈补建），前端只传 projectId
      await generateDraftsForItems(items, toast, () => void refresh(), {
        projectId: projectId ?? undefined,
      })
    } catch (draftError) {
      toast({
        title: "起草失败",
        description: readableError(draftError),
        variant: "error",
      })
    }
  }

  const produceSubmissions = useMemo(
    () => buildProduceSubmissions(selectedItems),
    [selectedItems]
  )

  async function submitProduction() {
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
        allItems: items,
        trackTask: taskCenter.trackTask,
      })
      toast({
        title: `已提交 ${new Set(produceSubmissions.map((row) => row.itemId)).size} 条内容出片`,
        variant: "success",
      })
      setProduceOpen(false)
      setSelectedIds(new Set())
      await refresh()
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

  function scheduleByCadence() {
    if (producedColumn.length === 0) {
      return
    }
    const first = producedColumn[0]
    const taskId = (first.links.task_ids ?? [])[0]
    const start = new Date()
    start.setDate(start.getDate() + 1)
    start.setHours(PUBLISH_HOUR, 0, 0, 0)
    toast({
      title: `已按每天 ${PUBLISH_HOUR}:00 生成排期建议`,
      description: `${producedColumn.length} 条待发布，最早 ${formatDate(
        start.toISOString()
      )}。逐条在发布页确认。`,
    })
    if (taskId) {
      navigate(`/library?task=${taskId}`)
    }
  }

  const hasItems = items.length > 0
  const activeColumn =
    BOARD_COLUMNS.find((column) => column.key === activeColumnKey) ??
    BOARD_COLUMNS[0]
  const activeColumnItems = byColumn[activeColumn.key] ?? []

  return (
    <PageFrame width="wide">
      <WorkspaceHeader
        actions={
          <>
            <Button
              aria-label="刷新"
              className="size-11 lg:size-7"
              disabled={loading}
              onClick={() => void refresh({ reconcile: true })}
              size="icon-sm"
              variant="outline"
            >
              <RefreshCcw className={cn(loading && "animate-spin")} />
            </Button>
            {hasItems && selectedItems.length === 0 ? (
              <Button className="h-11 lg:h-8" onClick={() => setAddOpen(true)}>
                <Plus data-icon="inline-start" />
                添加内容
              </Button>
            ) : null}
          </>
        }
        description="按生命周期组织选题、草稿、审核、生产与发布；每条内容始终只有一个当前阶段。"
        title="内容流水线"
      />

      {error && hasItems ? (
        <AsyncState
          action={
            <Button
              onClick={() => void refresh({ reconcile: true })}
              size="sm"
              variant="outline"
            >
              重新读取
            </Button>
          }
          className="max-w-none"
          description={`${error} 当前仍展示上一次成功读取的内容。`}
          state="stale"
          title="内容可能已过期"
        />
      ) : null}

      {loading ? (
        <AsyncState
          className="max-w-none"
          description="正在同步当前项目的内容与生产状态。"
          state="loading"
          title="正在读取内容…"
        />
      ) : error && !hasItems ? (
        <AsyncState
          action={
            <Button
              onClick={() => void refresh({ reconcile: true })}
              size="sm"
              variant="outline"
            >
              重新读取
            </Button>
          }
          className="max-w-none"
          description={error}
          state="error"
          title="内容读取失败"
        />
      ) : !hasItems ? (
        <EmptyState
          actions={
            <div className="flex flex-wrap justify-center gap-2">
              <Button className="h-11 lg:h-8" onClick={() => setAddOpen(true)}>
                <Plus data-icon="inline-start" />
                添加第一条内容
              </Button>
              <Button
                className="h-11 lg:h-8"
                disabled={importing}
                onClick={() => void runImport()}
                variant="outline"
              >
                {importing ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : null}
                导入存量
              </Button>
            </div>
          }
          description="添加选题，或导入已有内容；之后会沿着草稿、审核、生产、发布逐步推进。"
          icon={LayoutDashboard}
          title="工作台还没有内容"
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 lg:hidden">
            <div className="overflow-x-auto pb-1">
              <ToggleGroup
                aria-label="选择生命周期阶段"
                className="w-max justify-start"
                onValueChange={(value) => {
                  if (value) {
                    setActiveColumnKey(value)
                  }
                }}
                spacing={1}
                type="single"
                value={activeColumn.key}
                variant="outline"
              >
                {BOARD_COLUMNS.map((column, index) => (
                  <ToggleGroupItem
                    aria-label={`第 ${index + 1} 阶段：${column.label}，${(byColumn[column.key] ?? []).length} 条`}
                    className="h-11 shrink-0 px-3"
                    key={column.key}
                    value={column.key}
                  >
                    {column.label}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {(byColumn[column.key] ?? []).length}
                    </span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <LifecycleLane
              column={activeColumn}
              failedItemIds={failedItemIds}
              items={activeColumnItems}
              onSchedule={
                activeColumn.key === "ready" && producedColumn.length > 0
                  ? scheduleByCadence
                  : undefined
              }
              onToggleSelect={toggleSelect}
              selectedIds={selectedIds}
            />
          </div>

          <div
            aria-label="内容生命周期看板"
            className="hidden overflow-x-auto pb-2 lg:block"
            role="region"
          >
            <div className="grid min-w-[72rem] grid-cols-6 items-stretch gap-3">
              {BOARD_COLUMNS.map((column) => {
                const columnItems = byColumn[column.key] ?? []
                return (
                  <LifecycleLane
                    column={column}
                    failedItemIds={failedItemIds}
                    items={columnItems}
                    key={column.key}
                    onSchedule={
                      column.key === "ready" && producedColumn.length > 0
                        ? scheduleByCadence
                        : undefined
                    }
                    onToggleSelect={toggleSelect}
                    selectedIds={selectedIds}
                  />
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* 多选操作条：选题→生成草稿，确认稿→出片 */}
      {selectedItems.length > 0 ? (
        <div className="sticky bottom-[calc(4.5rem+var(--safe-area-bottom)+0.75rem)] z-30 mx-auto flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur lg:bottom-4 lg:w-fit lg:justify-start lg:gap-3 lg:rounded-full lg:px-4">
          <span className="px-1 text-sm">已选 {selectedItems.length} 条</span>
          <Button
            className="h-10 lg:h-7"
            onClick={() => setSelectedIds(new Set())}
            size="sm"
            variant="ghost"
          >
            取消
          </Button>
          {draftableSelected.length > 0 ? (
            <Button
              className="h-10 lg:h-7"
              onClick={() => void submitDrafting()}
              size="sm"
              variant={produceSubmissions.length > 0 ? "outline" : "default"}
            >
              生成草稿（{draftableSelected.length}）
            </Button>
          ) : null}
          {produceSubmissions.length > 0 ? (
            <Button
              className="h-10 lg:h-7"
              onClick={() => setProduceOpen(true)}
              size="sm"
            >
              出片
            </Button>
          ) : null}
        </div>
      ) : null}

      <AddContentDialog
        onCreated={() => void refresh()}
        onOpenChange={setAddOpen}
        open={addOpen}
      />

      {/* 出片 Sheet */}
      <Sheet onOpenChange={setProduceOpen} open={produceOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>出片</SheetTitle>
            <SheetDescription className="text-left">
              为 {selectedItems.length} 条内容、共 {produceSubmissions.length}{" "}
              个出片任务选择生产模板。
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
          </div>
          <SheetFooter>
            <Button
              disabled={
                producing ||
                !produceTemplateId ||
                produceSubmissions.length === 0
              }
              onClick={() => void submitProduction()}
            >
              {producing ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : null}
              开始出片（{produceSubmissions.length}）
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </PageFrame>
  )
}
