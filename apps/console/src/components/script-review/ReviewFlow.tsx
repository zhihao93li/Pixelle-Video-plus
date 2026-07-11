import { Check, ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type ReviewStep = 1 | 2 | 3

const STEPS: Array<{
  step: ReviewStep
  label: string
  shortLabel: string
  description: string
}> = [
  {
    step: 1,
    label: "选择选题与语言",
    shortLabel: "选题",
    description: "确定本批内容范围",
  },
  {
    step: 2,
    label: "逐条审核草稿",
    shortLabel: "审核",
    description: "确认标题、全文与分镜",
  },
  {
    step: 3,
    label: "确认并提交生产",
    shortLabel: "提交",
    description: "选择模板并创建真实任务",
  },
]

export function ReviewFlowStepper({
  current,
  hasDraft,
  onStepChange,
}: {
  current: ReviewStep
  hasDraft: boolean
  onStepChange: (step: ReviewStep) => void
}) {
  return (
    <nav aria-label="审核流程步骤" className="border-b pb-4">
      <ol className="grid grid-cols-3 gap-1 sm:gap-2">
        {STEPS.map((item) => {
          const enabled = item.step === 1 || hasDraft
          const isCurrent = current === item.step
          const isComplete = item.step < current

          return (
            <li className="min-w-0" key={item.step}>
              <Button
                aria-current={isCurrent ? "step" : undefined}
                className="group min-h-11 w-full min-w-0 justify-start px-2 text-left sm:px-3"
                disabled={!enabled}
                onClick={() => onStepChange(item.step)}
                size="lg"
                type="button"
                variant={isCurrent ? "secondary" : "ghost"}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                    isCurrent
                      ? "border-primary bg-primary text-primary-foreground"
                      : isComplete
                        ? "border-success/30 bg-success/10 text-success"
                        : "border-border bg-background"
                  )}
                >
                  {isComplete ? (
                    <Check aria-hidden="true" className="size-3.5" />
                  ) : (
                    item.step
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium sm:hidden">
                    {item.shortLabel}
                  </span>
                  <span className="hidden truncate text-sm font-medium sm:block">
                    {item.label}
                  </span>
                  <span className="hidden truncate text-xs text-muted-foreground lg:block">
                    {item.description}
                  </span>
                </span>
              </Button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function StepActionBar({
  backLabel,
  onBack,
  primaryAction,
  secondaryAction,
  summary,
}: {
  backLabel?: string
  onBack?: () => void
  primaryAction: React.ReactNode
  secondaryAction?: React.ReactNode
  summary?: React.ReactNode
}) {
  return (
    <div className="sticky bottom-[calc(4.5rem+var(--safe-area-bottom)+0.75rem)] z-30 flex min-w-0 flex-col gap-2 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between lg:bottom-4">
      <div className="flex min-w-0 items-center gap-2">
        {onBack ? (
          <Button
            aria-label={backLabel ?? "返回上一步"}
            className="min-h-11 sm:min-h-8"
            onClick={onBack}
            size="sm"
            type="button"
            variant="ghost"
          >
            <ChevronLeft data-icon="inline-start" />
            <span className="hidden sm:inline">{backLabel ?? "上一步"}</span>
          </Button>
        ) : null}
        {summary ? (
          <div className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground sm:text-sm">
            {summary}
          </div>
        ) : null}
      </div>
      <div
        className={cn(
          "grid min-w-0 grid-cols-1 gap-2 sm:flex sm:items-center",
          secondaryAction
            ? "min-[420px]:grid-cols-2"
            : "min-[420px]:flex min-[420px]:justify-end"
        )}
      >
        {secondaryAction}
        {primaryAction}
      </div>
    </div>
  )
}
