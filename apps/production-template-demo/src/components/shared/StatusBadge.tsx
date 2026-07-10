import { statusLabel } from "@/lib/contentItemMeta"
import { cn } from "@/lib/utils"

/**
 * 状态徽标：中文 + 语义色，全站唯一来源（DESIGN.md §2.7）。
 * 绿=完成/已发布、红=失败、黄=进行、灰=中性/排队。缺省回落中性 + 原文，防裸奔。
 * StatusBadge = 生成任务/批次状态；ContentStatusBadge = 内容条目生命周期状态。
 */

type Tone = "success" | "destructive" | "progress" | "neutral"

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  destructive: "bg-destructive/10 text-destructive",
  progress: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  neutral: "bg-muted text-muted-foreground",
}

function Pill({
  tone,
  label,
  className,
}: {
  tone: Tone
  label: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
        className
      )}
    >
      {label}
    </span>
  )
}

const STATUS_CONFIG: Record<string, { label: string; tone: Tone }> = {
  completed: { label: "已完成", tone: "success" },
  failed: { label: "失败", tone: "destructive" },
  partial_failed: { label: "部分失败", tone: "destructive" },
  processing: { label: "生成中", tone: "progress" },
  running: { label: "生成中", tone: "progress" },
  pending: { label: "排队中", tone: "neutral" },
  queued: { label: "排队中", tone: "neutral" },
  cancelled: { label: "已取消", tone: "neutral" },
}

export function StatusBadge({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const config = STATUS_CONFIG[status] ?? { label: status, tone: "neutral" }
  return <Pill className={className} label={config.label} tone={config.tone} />
}

// 内容条目状态 → 语义色（标签取 contentItemMeta.statusLabel 的中文）
const CONTENT_TONE: Record<string, Tone> = {
  producing: "progress",
  published: "success",
  measured: "success",
  archived: "neutral",
  failed: "destructive",
  error: "destructive",
}

export function ContentStatusBadge({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const tone = CONTENT_TONE[status] ?? "neutral"
  return <Pill className={className} label={statusLabel(status)} tone={tone} />
}
