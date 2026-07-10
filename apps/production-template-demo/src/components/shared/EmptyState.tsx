import * as React from "react"
import type { LucideIcon } from "lucide-react"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { cn } from "@/lib/utils"

export function EmptyState({
  actions,
  className,
  description,
  headingLevel = 2,
  icon: Icon,
  title,
}: {
  actions?: React.ReactNode
  className?: string
  description?: React.ReactNode
  headingLevel?: 2 | 3
  icon?: LucideIcon
  title: React.ReactNode
}) {
  return (
    <Empty
      className={cn(
        "min-h-56 rounded-lg border bg-card/40 text-card-foreground",
        className
      )}
      data-state="empty"
    >
      <EmptyHeader>
        {Icon ? (
          <EmptyMedia variant="icon">
            <Icon aria-hidden="true" />
          </EmptyMedia>
        ) : null}
        <EmptyTitle aria-level={headingLevel} role="heading">
          {title}
        </EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {actions ? <EmptyContent>{actions}</EmptyContent> : null}
    </Empty>
  )
}
