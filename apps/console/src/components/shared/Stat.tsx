import { cn } from "@/lib/utils"

/**
 * 页内头裸数字统计项（DESIGN.md §2.7 / 库页附录 A）：
 * 数字 text-xl tabular-nums + label 12px muted，失败等负向数可标红。
 */
export function Stat({
  label,
  value,
  destructive,
}: {
  label: string
  value?: number
  destructive?: boolean
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className={cn(
          "text-xl font-medium tabular-nums",
          destructive && "text-destructive"
        )}
      >
        {value ?? "-"}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}
