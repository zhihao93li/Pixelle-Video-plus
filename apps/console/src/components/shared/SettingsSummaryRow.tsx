import { SlidersHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"

export function SettingsSummaryRow({
  summary,
  actionLabel = "调整本次设置",
  className,
  onClick,
}: {
  summary: string
  actionLabel?: string
  className?: string
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-lg border bg-background px-4 text-left transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        className
      )}
      onClick={onClick}
      type="button"
    >
      <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">{summary}</span>
      <span className="shrink-0 text-sm font-medium text-primary">
        {actionLabel}
      </span>
    </button>
  )
}
