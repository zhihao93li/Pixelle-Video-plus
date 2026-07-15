import { useState } from "react"
import { AlertCircle, ChevronRight } from "lucide-react"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"

import { Badge } from "@/components/ui/badge"
import { useExpertMode } from "@/lib/expertMode"
import type { QualitySummary } from "@/lib/resultSummary"
import { cn } from "@/lib/utils"

/** 面板/表单内错误提示。操作结果类通知请用 toast。 */
export function InlineError({
  title,
  message,
}: {
  title: string
  message: string
}) {
  return (
    <div
      aria-atomic="true"
      aria-live="assertive"
      className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div>
          <div className="font-medium">{title}</div>
          <div className="mt-1 leading-6">{message}</div>
        </div>
      </div>
    </div>
  )
}

/** 键值元数据卡。 */
export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  )
}

export function QualityBadge({ summary }: { summary: QualitySummary }) {
  const variant =
    summary.tone === "failed"
      ? "destructive"
      : summary.tone === "warning"
        ? "warning"
        : summary.tone === "passed"
          ? "success"
          : "outline"

  return <Badge variant={variant}>{summary.label}</Badge>
}

export function QualityMessages({
  failures,
  warnings,
}: Pick<QualitySummary, "failures" | "warnings">) {
  const messages = [
    ...failures.map((message) => ({ tone: "failed" as const, message })),
    ...warnings.map((message) => ({ tone: "warning" as const, message })),
  ]

  if (messages.length === 0) {
    return null
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {messages.map((item, index) => (
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm leading-6",
            item.tone === "failed"
              ? "bg-destructive/10 text-destructive"
              : "bg-warning/10 text-warning"
          )}
          key={`${item.tone}-${index}`}
        >
          {item.message}
        </div>
      ))}
    </div>
  )
}

/**
 * 技术详情折叠区：任务 ID、文件路径、stage 原文等排障信息统一收纳，
 * 默认收起，不在主界面暴露工程细节。
 */
export function TechDetails({
  items,
  label = "技术详情",
}: {
  items: Array<{ label: string; value: string | null | undefined }>
  label?: string
}) {
  const expertMode = useExpertMode()
  const [open, setOpen] = useState(false)
  const visible = items.filter(
    (item): item is { label: string; value: string } => Boolean(item.value)
  )
  if (!expertMode || visible.length === 0) {
    return null
  }
  return (
    <CollapsiblePrimitive.Root onOpenChange={setOpen} open={open}>
      <CollapsiblePrimitive.Trigger className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        {label}
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content>
        <div className="mt-2 flex flex-col gap-2">
          {visible.map((item) => (
            <div
              className="rounded-lg bg-muted/40 p-3 text-xs"
              key={item.label}
            >
              <div className="text-muted-foreground">{item.label}</div>
              <div className="mt-1 font-mono break-all text-muted-foreground">
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  )
}
