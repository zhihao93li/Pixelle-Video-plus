import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"

import { ContentStatusBadge } from "@/components/shared/StatusBadge"
import { WorkspacePanel } from "@/components/shared/WorkspacePanel"
import { Button } from "@/components/ui/button"
import { statusLabel } from "@/lib/contentItemMeta"
import { cn } from "@/lib/utils"

type ContentLifecycleActionBase = {
  disabled?: boolean
  helper?: ReactNode
  label: string
  loading?: boolean
}

export type ContentLifecycleAction = ContentLifecycleActionBase &
  ({ href: string; onClick?: never } | { href?: never; onClick: () => void })

export function ContentLifecyclePanel({
  action,
  className,
  guidance,
  status,
  summary,
}: {
  action?: ContentLifecycleAction
  className?: string
  guidance: ReactNode
  status: string
  summary?: ReactNode
}) {
  return (
    <WorkspacePanel
      className={cn("bg-card", className)}
      headerAction={
        <span aria-live="polite">
          <ContentStatusBadge status={status} />
          <span className="sr-only">当前状态：{statusLabel(status)}</span>
        </span>
      }
      padding="compact"
      title="生命周期"
    >
      {summary ? (
        <p className="text-xs leading-5 text-muted-foreground">{summary}</p>
      ) : null}
      <div className={cn(summary && "mt-3 border-t pt-3")}>
        <div className="text-xs font-medium text-foreground">下一步</div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {guidance}
        </p>
        {action ? (
          <>
            {action.href ? (
              <Button
                asChild
                className={cn(
                  "mt-3 h-11 w-full lg:h-8",
                  (action.disabled || action.loading) &&
                    "pointer-events-none opacity-50"
                )}
                aria-disabled={action.disabled || action.loading}
              >
                <a
                  href={
                    action.disabled || action.loading ? undefined : action.href
                  }
                  tabIndex={action.disabled || action.loading ? -1 : undefined}
                >
                  {action.label}
                </a>
              </Button>
            ) : (
              <Button
                className="mt-3 h-11 w-full lg:h-8"
                disabled={action.disabled || action.loading}
                onClick={action.onClick}
              >
                {action.loading ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : null}
                {action.label}
              </Button>
            )}
            {action.helper ? (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {action.helper}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </WorkspacePanel>
  )
}
