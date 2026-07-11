import * as React from "react"
import { FolderOpenIcon } from "lucide-react"

import { AsyncState } from "@/components/shared/AsyncState"
import { EmptyState } from "@/components/shared/EmptyState"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type ProjectScopeState = "loading" | "error" | "empty" | "ready"

function BoundaryFrame({
  children,
  className,
  state,
}: {
  children: React.ReactNode
  className?: string
  state: Exclude<ProjectScopeState, "ready">
}) {
  return (
    <div
      className={cn(
        "flex min-h-64 w-full min-w-0 items-center justify-center",
        className
      )}
      data-slot="project-scope-boundary"
      data-state={state}
    >
      {children}
    </div>
  )
}

export function ProjectScopeBoundary({
  children,
  className,
  emptyDescription = "请先创建一个项目，再开始内容生产。",
  emptyTitle = "还没有可用项目",
  errorMessage = "暂时无法读取项目列表，请重试。",
  onManageProjects,
  onRetry,
  state,
}: {
  children: React.ReactNode
  className?: string
  emptyDescription?: React.ReactNode
  emptyTitle?: React.ReactNode
  errorMessage?: React.ReactNode
  onManageProjects?: () => void
  onRetry?: () => void
  state: ProjectScopeState
}) {
  if (state === "ready") {
    return <>{children}</>
  }

  if (state === "loading") {
    return (
      <BoundaryFrame className={className} state={state}>
        <AsyncState state="loading" title="正在读取项目…" />
      </BoundaryFrame>
    )
  }

  if (state === "error") {
    return (
      <BoundaryFrame className={className} state={state}>
        <AsyncState
          action={
            onRetry ? (
              <Button onClick={onRetry} size="sm" variant="outline">
                重新读取
              </Button>
            ) : undefined
          }
          description={errorMessage}
          state="error"
          title="项目读取失败"
        />
      </BoundaryFrame>
    )
  }

  return (
    <BoundaryFrame className={className} state={state}>
      <EmptyState
        actions={
          onManageProjects ? (
            <Button onClick={onManageProjects}>管理项目</Button>
          ) : undefined
        }
        className="max-w-2xl"
        description={emptyDescription}
        icon={FolderOpenIcon}
        title={emptyTitle}
      />
    </BoundaryFrame>
  )
}
