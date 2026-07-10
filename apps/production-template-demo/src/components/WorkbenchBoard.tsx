import { useCallback, useEffect, useMemo, useState } from "react"
import { Bot, Check, Loader2, Plus, RefreshCcw } from "lucide-react"

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
import { InlineError } from "@/components/shared/feedback"
import { ProductionSubmitPanel } from "@/components/shared/ProductionSubmitPanel"
import type { ProductionOverrides } from "@/components/shared/ProductionSubmitPanel"
import { AddContentDialog } from "@/components/AddContentDialog"
import { BOARD_COLUMNS, statusLabel } from "@/lib/contentItemMeta"
import { formatDate, readableError } from "@/lib/format"
import { languageLabel } from "@/lib/languages"
import { navigate } from "@/lib/router"
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
  onOpen,
  failed,
}: {
  item: ContentItem
  selected: boolean
  selectable: boolean
  onToggleSelect: () => void
  onOpen: () => void
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
    <div
      className={cn(
        "group relative rounded-lg border bg-background p-3 text-left transition-colors hover:border-primary/40",
        selected && "border-primary bg-primary/5"
      )}
    >
      {selectable && (
        <button
          aria-label={selected ? "取消选择" : "选择"}
          className={cn(
            "absolute top-2 right-2 flex size-5 items-center justify-center rounded border transition-opacity",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/30 bg-background opacity-0 group-hover:opacity-100"
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

      <button
        className="block w-full pr-6 text-left"
        onClick={onOpen}
        type="button"
      >
        <div className="line-clamp-2 text-sm font-medium">{item.title}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {item.languages.map((language) => {
            const variant = item.variants[language]
            const isConfirmed = variant?.status === "confirmed"
            return (
              <Badge
                key={language}
                variant={isConfirmed ? "secondary" : "outline"}
              >
                {languageLabel(language)}
              </Badge>
            )
          })}
        </div>
        {failed && (
          <div className="mt-2">
            <Badge variant="destructive">生产失败</Badge>
          </div>
        )}
        {progress != null && !failed && (
          <Progress className="mt-2" value={progress} />
        )}
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {item.source === "agent" && <Bot className="size-3" />}
            {item.source === "agent" ? "AI" : statusLabel(item.status)}
          </span>
          <span>{formatDate(item.updated_at)}</span>
        </div>
        {item.metrics.likes != null && (
          <div className="mt-1 text-xs text-muted-foreground">
            赞 {item.metrics.likes}
          </div>
        )}
      </button>
    </div>
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [failedItemIds, setFailedItemIds] = useState<Set<string>>(new Set())
  const [produceOpen, setProduceOpen] = useState(false)
  const [produceTemplateId, setProduceTemplateId] = useState("")
  const [produceOverrides, setProduceOverrides] = useState<ProductionOverrides>({})
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
        const settled = await Promise.allSettled(taskIds.map((id) => getTask(id)))
        const tasks = settled
          .filter(
            (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof getTask>>> =>
              result.status === "fulfilled"
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
      const column = BOARD_COLUMNS.find((col) => col.statuses.includes(item.status))
      if (column) {
        map[column.key].push(item)
      }
    }
    return map
  }, [items])

  const selectedItems = items.filter((item) => selectedIds.has(item.item_id))
  const producedColumn = byColumn.ready?.filter((item) => item.status === "produced") ?? []

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

  return (
    <main className="flex w-full max-w-[1600px] flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          从选题到已发布，一条内容的完整流水线。
        </p>
        <div className="flex items-center gap-2">
          <Button
            aria-label="刷新"
            disabled={loading}
            onClick={() => void refresh({ reconcile: true })}
            size="icon-sm"
            variant="outline"
          >
            <RefreshCcw className={cn(loading && "animate-spin")} />
          </Button>
          {!hasItems && !loading && (
            <Button
              disabled={importing}
              onClick={() => void runImport()}
              variant="outline"
            >
              {importing && (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              )}
              导入存量
            </Button>
          )}
          <Button onClick={() => setAddOpen(true)}>
            <Plus data-icon="inline-start" />
            添加内容
          </Button>
        </div>
      </div>

      {error && <InlineError title="读取失败" message={error} />}

      {loading ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在读取内容
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {BOARD_COLUMNS.map((column) => {
            const columnItems = byColumn[column.key] ?? []
            return (
              <div
                className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2"
                key={column.key}
              >
                <div className="flex items-center justify-between px-1">
                  <span className="text-sm font-medium">{column.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {columnItems.length}
                  </span>
                </div>
                {column.key === "ready" && producedColumn.length > 0 && (
                  <Button
                    onClick={scheduleByCadence}
                    size="sm"
                    variant="outline"
                  >
                    按节奏排期
                  </Button>
                )}
                <div className="flex flex-col gap-2">
                  {columnItems.map((item) => (
                    <ItemCard
                      failed={failedItemIds.has(item.item_id)}
                      item={item}
                      key={item.item_id}
                      onOpen={() => navigate(`/board/item/${item.item_id}`)}
                      onToggleSelect={() => toggleSelect(item.item_id)}
                      selectable={isSelectable(item)}
                      selected={selectedIds.has(item.item_id)}
                    />
                  ))}
                  {columnItems.length === 0 && (
                    <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                      空
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 多选操作条：选题→生成草稿，确认稿→出片 */}
      {selectedItems.length > 0 && (
        <div className="sticky bottom-4 z-30 mx-auto flex w-fit items-center gap-3 rounded-full border bg-background px-4 py-2 shadow-lg">
          <span className="text-sm">已选 {selectedItems.length} 条</span>
          <Button onClick={() => setSelectedIds(new Set())} size="sm" variant="ghost">
            取消
          </Button>
          {draftableSelected.length > 0 && (
            <Button
              onClick={() => void submitDrafting()}
              size="sm"
              variant={produceSubmissions.length > 0 ? "outline" : "default"}
            >
              生成草稿（{draftableSelected.length}）
            </Button>
          )}
          {produceSubmissions.length > 0 && (
            <Button onClick={() => setProduceOpen(true)} size="sm">
              出片
            </Button>
          )}
        </div>
      )}

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
              为 {selectedItems.length} 条内容、共 {produceSubmissions.length} 个出片任务选择生产模板。
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
              disabled={producing || !produceTemplateId || produceSubmissions.length === 0}
              onClick={() => void submitProduction()}
            >
              {producing && (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              )}
              开始出片（{produceSubmissions.length}）
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </main>
  )
}
