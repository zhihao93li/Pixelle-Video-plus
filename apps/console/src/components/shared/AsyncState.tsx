import * as React from "react"
import {
  AlertCircleIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  type LucideIcon,
} from "lucide-react"

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { cn } from "@/lib/utils"

export type AsyncStateKind = "loading" | "error" | "stale"

const STATE_CONFIG: Record<
  AsyncStateKind,
  {
    icon: LucideIcon
    role: "alert" | "status"
    title: string
    variant: "default" | "destructive" | "warning"
  }
> = {
  loading: {
    icon: LoaderCircleIcon,
    role: "status",
    title: "正在读取…",
    variant: "default",
  },
  error: {
    icon: AlertCircleIcon,
    role: "alert",
    title: "暂时无法读取",
    variant: "destructive",
  },
  stale: {
    icon: RefreshCwIcon,
    role: "status",
    title: "内容可能已过期",
    variant: "warning",
  },
}

export function AsyncState({
  action,
  className,
  description,
  state,
  title,
}: {
  action?: React.ReactNode
  className?: string
  description?: React.ReactNode
  state: AsyncStateKind
  title?: React.ReactNode
}) {
  const config = STATE_CONFIG[state]
  const Icon = config.icon

  return (
    <Alert
      aria-atomic="true"
      aria-busy={state === "loading"}
      aria-live={state === "error" ? "assertive" : "polite"}
      className={cn("max-w-2xl", className)}
      data-state={state}
      role={config.role}
      variant={config.variant}
    >
      <Icon className={cn(state === "loading" && "animate-spin")} />
      <AlertTitle>{title ?? config.title}</AlertTitle>
      {description ? <AlertDescription>{description}</AlertDescription> : null}
      {action ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  )
}
