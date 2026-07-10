import { ChevronRight } from "lucide-react"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"

import { useLocalStorageState } from "@/lib/useLocalStorageState"
import { cn } from "@/lib/utils"

/**
 * 高级设置分组：可折叠、记忆展开状态（localStorage）。
 * 替代原生 <details>，见 DESIGN.md。
 */
export function AdvancedGroup({
  id,
  title,
  description,
  step,
  defaultOpen = false,
  children,
}: {
  id: string
  title: string
  description?: string
  /** 产线步骤编号胶囊（与配方详情页产线图对齐，批次三 PRD）。 */
  step?: string | null
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useLocalStorageState(
    `pixelle-advanced-group-${id}`,
    defaultOpen
  )

  return (
    <CollapsiblePrimitive.Root
      className="rounded-lg border bg-background"
      onOpenChange={setOpen}
      open={open}
    >
      <CollapsiblePrimitive.Trigger className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
        {step && (
          <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            {step}
          </span>
        )}
        <span className="text-sm font-medium">{title}</span>
        {description && (
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {description}
          </span>
        )}
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content>
        <div className="flex flex-col gap-4 border-t p-4">{children}</div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  )
}
