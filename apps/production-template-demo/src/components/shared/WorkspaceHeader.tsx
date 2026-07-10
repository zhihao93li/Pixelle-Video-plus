import * as React from "react"

import { cn } from "@/lib/utils"

export function WorkspaceHeader({
  actions,
  className,
  description,
  title,
  titleId,
  ...props
}: Omit<React.ComponentProps<"header">, "title"> & {
  actions?: React.ReactNode
  description?: React.ReactNode
  title: React.ReactNode
  titleId?: string
}) {
  const generatedTitleId = React.useId()
  const resolvedTitleId = titleId ?? generatedTitleId

  return (
    <header
      className={cn(
        "flex min-w-0 flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
      data-slot="workspace-header"
      {...props}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h1
          className="text-lg leading-7 font-medium tracking-tight text-balance"
          id={resolvedTitleId}
        >
          {title}
        </h1>
        {description ? (
          <div className="max-w-3xl text-sm leading-6 text-pretty text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  )
}
