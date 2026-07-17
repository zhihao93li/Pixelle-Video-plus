import * as React from "react"

import { cn } from "@/lib/utils"

export function WorkspaceHeader({
  actions,
  className,
  description,
  headingLevel = 2,
  title,
  titleId,
  ...props
}: Omit<React.ComponentProps<"header">, "title"> & {
  actions?: React.ReactNode
  description?: React.ReactNode
  headingLevel?: 1 | 2
  title: React.ReactNode
  titleId?: string
}) {
  const generatedTitleId = React.useId()
  const resolvedTitleId = titleId ?? generatedTitleId
  const Heading = headingLevel === 1 ? "h1" : "h2"

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
        <Heading
          className="text-xl leading-7 font-semibold tracking-tight text-balance"
          id={resolvedTitleId}
        >
          {title}
        </Heading>
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
