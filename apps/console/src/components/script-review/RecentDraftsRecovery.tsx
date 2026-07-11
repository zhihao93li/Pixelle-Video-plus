import { useState } from "react"
import { ChevronRight, FileClock, RefreshCcw } from "lucide-react"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"

import { AsyncState } from "@/components/shared/AsyncState"
import { EmptyState } from "@/components/shared/EmptyState"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ScriptReviewDraftSet } from "@/lib/generationApi"
import { cn } from "@/lib/utils"

export type DraftRecoveryState = "loading" | "ready" | "error" | "stale"

export function RecentDraftsRecovery({
  draftSets,
  error,
  isRefreshing,
  onOpenDraft,
  onRefresh,
  selectedDraftSetId,
  state,
}: {
  draftSets: ScriptReviewDraftSet[]
  error: string | null
  isRefreshing: boolean
  onOpenDraft: (draftSet: ScriptReviewDraftSet, step: 2 | 3) => void
  onRefresh: () => void
  selectedDraftSetId?: string
  state: DraftRecoveryState
}) {
  const [open, setOpen] = useState(false)

  return (
    <CollapsiblePrimitive.Root
      className="overflow-hidden rounded-lg border bg-card/50"
      onOpenChange={setOpen}
      open={open}
    >
      <div className="flex min-h-11 items-center gap-1 pr-2">
        <CollapsiblePrimitive.Trigger className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset">
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
              open && "rotate-90"
            )}
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            恢复最近草稿
          </span>
          {state === "stale" ? <Badge variant="warning">需刷新</Badge> : null}
          {draftSets.length > 0 ? (
            <Badge variant="outline">{draftSets.length}</Badge>
          ) : null}
        </CollapsiblePrimitive.Trigger>
        <Button
          aria-label="刷新最近审核草稿"
          className="min-h-11 min-w-11 sm:min-h-7 sm:min-w-7"
          disabled={isRefreshing}
          onClick={onRefresh}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <RefreshCcw className={cn(isRefreshing && "animate-spin")} />
        </Button>
      </div>

      <CollapsiblePrimitive.Content>
        <div className="border-t p-3">
          {state === "loading" && draftSets.length === 0 ? (
            <AsyncState
              className="max-w-none"
              description="正在读取当前项目的审核草稿。"
              state="loading"
              title="正在读取最近草稿"
            />
          ) : null}

          {state === "error" && draftSets.length === 0 ? (
            <AsyncState
              action={
                <Button
                  onClick={onRefresh}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  重试
                </Button>
              }
              className="max-w-none"
              description={error ?? "当前项目的草稿列表读取失败。"}
              state="error"
              title="无法读取最近草稿"
            />
          ) : null}

          {state === "stale" ? (
            <AsyncState
              action={
                <Button
                  onClick={onRefresh}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  重新读取
                </Button>
              }
              className="mb-3 max-w-none"
              description={error ?? "正在保留上一次成功读取的草稿列表。"}
              state="stale"
              title="最近草稿可能不是最新状态"
            />
          ) : null}

          {state === "ready" && draftSets.length === 0 ? (
            <EmptyState
              className="min-h-40"
              description="生成第一批审核草稿后，可以从这里继续审核或再次出片。"
              headingLevel={3}
              icon={FileClock}
              title="还没有可恢复的草稿"
            />
          ) : null}

          {draftSets.length > 0 ? (
            <div className="flex flex-col" role="list">
              {draftSets.slice(0, 8).map((item) => {
                const nextStep = item.status === "submitted" ? 3 : 2
                const topic = item.topics[0] || "未命名选题"
                const remainingTopics = Math.max(item.topics.length - 1, 0)

                return (
                  <div
                    className={cn(
                      "flex min-w-0 flex-col gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center",
                      selectedDraftSetId === item.draft_set_id && "text-primary"
                    )}
                    key={item.draft_set_id}
                    role="listitem"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {topic}
                        </span>
                        {remainingTopics > 0 ? (
                          <Badge variant="outline">+{remainingTopics}</Badge>
                        ) : null}
                        <StatusBadge status={item.status} />
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {item.languages.join(" / ") || "未记录语言"} · 更新于{" "}
                        {formatUpdatedAt(item.updated_at)}
                      </div>
                    </div>
                    <Button
                      className="min-h-11 w-full sm:min-h-7 sm:w-auto"
                      onClick={() => onOpenDraft(item, nextStep)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {nextStep === 3 ? "再次出片" : "继续审核"}
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  )
}

function formatUpdatedAt(value: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return "未知时间"
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp)
}
