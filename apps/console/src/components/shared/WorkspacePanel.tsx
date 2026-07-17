import * as React from "react"

import { cn } from "@/lib/utils"

const CONTENT_PADDING_CLASS = {
  default: "p-4",
  compact: "p-3",
  none: "p-0",
} as const

export type WorkspacePanelVariant = "surface" | "plain"
export type WorkspacePanelPadding = keyof typeof CONTENT_PADDING_CLASS

export function WorkspacePanel({
  children,
  className,
  contentClassName,
  description,
  headerAction,
  padding = "default",
  title,
  titleId,
  variant = "surface",
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  contentClassName?: string
  description?: React.ReactNode
  headerAction?: React.ReactNode
  padding?: WorkspacePanelPadding
  title?: React.ReactNode
  titleId?: string
  variant?: WorkspacePanelVariant
}) {
  const generatedTitleId = React.useId()
  const resolvedTitleId = titleId ?? generatedTitleId
  const hasHeader = Boolean(title || description || headerAction)

  return (
    <section
      aria-labelledby={title ? resolvedTitleId : undefined}
      className={cn(
        "min-w-0 text-sm",
        variant === "surface" &&
          "overflow-hidden rounded-lg border bg-card text-card-foreground",
        className
      )}
      data-slot="workspace-panel"
      data-variant={variant}
      {...props}
    >
      {hasHeader ? (
        <div
          className={cn(
            "flex min-w-0 items-start justify-between gap-3 border-b",
            variant === "surface" ? "p-4" : "pb-3"
          )}
          data-slot="workspace-panel-header"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {title ? (
              <h2 className="text-base font-semibold" id={resolvedTitleId}>
                {title}
              </h2>
            ) : null}
            {description ? (
              <div className="text-sm leading-5 text-pretty text-muted-foreground">
                {description}
              </div>
            ) : null}
          </div>
          {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
        </div>
      ) : null}
      <div
        className={cn(CONTENT_PADDING_CLASS[padding], contentClassName)}
        data-slot="workspace-panel-content"
      >
        {children}
      </div>
    </section>
  )
}
