import { Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { TechDetails } from "@/components/shared/feedback"
import { getBatchPreviewTitle } from "@/lib/batchInput"
import { useExpertMode } from "@/lib/expertMode"
import type { GenerationBatch, GenerationBatchItem } from "@/lib/generationApi"
import { adaptRunStatus, statusIs } from "@/lib/productViewModels"
import { cn } from "@/lib/utils"

/**
 * 批次进度卡（共享）：状态行 + 每条任务状态 + 单条重试。
 * 生成页批量提交、i2v 批量、任务中心「批次」区共用。
 */

export function BatchStatusCard({
  batch,
  onRetryItem,
  retryingItemIndex,
  artifactLabel,
  bare = false,
  className,
}: {
  batch: GenerationBatch | null
  onRetryItem: (itemIndex: number) => void
  retryingItemIndex: number | null
  /** 产物形态徽标文案（视频/图集/长文/产线）；不传则不显示。 */
  artifactLabel?: string | null
  /** true 时只渲染内容（不套 Card），供任务中心行内展开复用。 */
  bare?: boolean
  className?: string
}) {
  const expertMode = useExpertMode()
  const body = !batch ? (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
      创建或选择一个批次。
    </div>
  ) : (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={adaptRunStatus(batch.status)} />
        {artifactLabel && <Badge variant="outline">{artifactLabel}</Badge>}
        <Badge variant="outline">{batch.total_count} 条</Badge>
        <Badge variant="outline">失败 {batch.failed_count}</Badge>
      </div>
      {expertMode ? (
        <TechDetails
          items={[
            { label: "批次 ID", value: batch.batch_id },
            { label: "批次原始状态", value: batch.status },
          ]}
        />
      ) : null}
      <div className="flex max-h-[520px] flex-col gap-2 overflow-auto pr-1">
        {batch.items.map((item) => {
          const status = adaptRunStatus(item.status)
          return (
            <div
              className="rounded-lg border bg-background p-3"
              key={item.index}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    <span className="mr-1.5 text-xs text-muted-foreground">
                      #{item.index}
                    </span>
                    {getBatchPreviewTitle(item.input, item.index - 1)}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <StatusBadge status={status} />
                  {canRetryBatchItem(item) && (
                    <Button
                      disabled={retryingItemIndex !== null}
                      onClick={() => onRetryItem(item.index)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {retryingItemIndex === item.index && (
                        <Loader2 className="animate-spin" />
                      )}
                      重试
                    </Button>
                  )}
                </div>
              </div>
              {item.progress ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  {item.progress.message ||
                    `已完成 ${item.progress.percentage}%`}
                </div>
              ) : null}
              {item.error ? (
                <div className="mt-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
                  {item.error.message}
                </div>
              ) : null}
              {expertMode ? (
                <div className="mt-2">
                  <TechDetails
                    items={[
                      {
                        label: "任务 ID",
                        value: item.task_id || "尚未创建",
                      },
                      { label: "原始状态", value: item.status },
                      { label: "运行阶段", value: item.progress?.stage },
                      { label: "错误层级", value: item.error?.layer },
                    ]}
                  />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )

  if (bare) {
    return body
  }

  return (
    <Card className={cn("rounded-lg", className)}>
      <CardHeader className="border-b">
        <CardTitle>批次进度</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}

function canRetryBatchItem(item: GenerationBatchItem): boolean {
  const status = adaptRunStatus(item.status)
  return statusIs(status, "failed") || statusIs(status, "cancelled")
}
