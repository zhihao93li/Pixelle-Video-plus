import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"

/**
 * 来源 chip：让预填值旁边看得出「这值来自哪一层」，点一下直达设置页对应区块。
 * 判定规则由调用方给出（当前值 === 该层默认值 → 显示该层；用户改过 → 本次覆盖，不带链接）。
 */

export type SourceKind = "project" | "recipe" | "builtin" | "override"

const LABELS: Record<SourceKind, string> = {
  project: "项目默认",
  recipe: "配方默认",
  builtin: "内置默认",
  override: "本次覆盖",
}

export function SourceChip({
  source,
  to,
}: {
  source: SourceKind
  /** settingsLink(...) 结果；不传则纯展示 */
  to?: string
}) {
  const label = LABELS[source]
  const base =
    "inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground"
  if (to) {
    return (
      <button
        className={cn(
          base,
          "transition-colors hover:text-foreground hover:underline"
        )}
        onClick={() => navigate(to)}
        type="button"
      >
        {label}
      </button>
    )
  }
  return <span className={base}>{label}</span>
}
