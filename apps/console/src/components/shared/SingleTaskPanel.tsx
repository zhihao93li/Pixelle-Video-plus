import { Copy, Loader2, RefreshCcw } from "lucide-react"
import type { ReactNode } from "react"

import { ArtifactPreview } from "@/components/shared/ArtifactPreview"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { InlineError, TechDetails } from "@/components/shared/feedback"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { useToast } from "@/components/ui/toast"
import { useExpertMode } from "@/lib/expertMode"
import { statusIs, type ProductionRunViewModel } from "@/lib/productViewModels"

/** 单条生产任务的共享状态/结果轨，只消费用户态 ViewModel。 */
export function SingleTaskPanel({
  actionError,
  artifactError,
  isCancelling = false,
  onCancel,
  onRetryResult,
  resultDetails,
  resultFetchError,
  run,
}: {
  actionError?: string | null
  artifactError?: string | null
  isCancelling?: boolean
  onCancel?: () => void
  onRetryResult?: () => void
  resultDetails?: ReactNode
  resultFetchError?: string | null
  run: ProductionRunViewModel
}) {
  const expertMode = useExpertMode()
  const toast = useToast()
  const completed = statusIs(run.state, "completed")
  const title = run.artifact ? "生成结果" : "任务状态"
  const description = run.artifact
    ? "结果已就绪，可检查质量并继续发布。"
    : "在这里跟踪本次生产，不需要返回任务列表。"

  return (
    <aside
      className="flex min-w-0 flex-col gap-5 xl:sticky xl:top-[5.5rem] xl:self-start"
      data-slot="production-rail"
    >
      <Card className="flex min-h-[420px] flex-col rounded-lg xl:h-[calc(100svh-10.25rem)] xl:min-h-[640px]">
        <CardHeader className="border-b">
          <CardTitle aria-level={2} role="heading">
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <div className="flex items-center justify-between gap-3">
            <StatusBadge status={run.state} />
            <div className="flex shrink-0 items-center gap-2">
              {expertMode ? (
                <Button
                  aria-label="复制任务 ID"
                  onClick={() => {
                    void navigator.clipboard?.writeText(run.id)
                    toast({ title: "任务 ID 已复制", variant: "success" })
                  }}
                  size="icon-sm"
                  type="button"
                  variant="outline"
                >
                  <Copy />
                </Button>
              ) : null}
              {run.canCancel && onCancel ? (
                <Button
                  disabled={isCancelling}
                  onClick={onCancel}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isCancelling ? <Loader2 className="animate-spin" /> : null}
                  取消任务
                </Button>
              ) : null}
            </div>
          </div>

          {!completed ? (
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">
                  {run.message || "正在处理任务"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {Math.round(run.progress)}%
                </span>
              </div>
              <Progress className="mt-3" value={run.progress} />
            </div>
          ) : null}

          {run.error ? (
            <InlineError message={run.error} title="任务失败" />
          ) : null}
          {actionError ? (
            <InlineError message={actionError} title="任务操作失败" />
          ) : null}

          {resultFetchError ? (
            <div className="flex flex-col gap-3">
              <InlineError message={resultFetchError} title="结果读取失败" />
              {onRetryResult ? (
                <Button onClick={onRetryResult} type="button" variant="outline">
                  <RefreshCcw data-icon="inline-start" />
                  重新读取结果
                </Button>
              ) : null}
            </div>
          ) : artifactError ? (
            <InlineError message={artifactError} title="结果不可预览" />
          ) : completed && !run.artifact ? (
            <div
              aria-live="polite"
              className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground"
              role="status"
            >
              <Loader2 className="animate-spin" />
              正在读取生成结果…
            </div>
          ) : null}

          {run.artifact ? (
            <>
              <ArtifactPreview artifact={run.artifact} />
              {resultDetails}
            </>
          ) : null}

          <TechDetails items={[{ label: "任务 ID", value: run.id }]} />
        </CardContent>
      </Card>
    </aside>
  )
}
