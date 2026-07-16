import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Progress({
  className,
  indeterminate = false,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  indeterminate?: boolean
}) {
  return (
    <ProgressPrimitive.Root
      aria-label={props["aria-label"] ?? "进度"}
      data-slot="progress"
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      value={indeterminate ? undefined : value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "size-full flex-1 bg-primary",
          indeterminate
            ? "origin-left animate-[progress-indeterminate_1.4s_ease-in-out_infinite]"
            : "transition-transform duration-[var(--motion-duration-default)] ease-[var(--motion-easing-standard)]"
        )}
        style={
          indeterminate
            ? undefined
            : { transform: `translateX(-${100 - (value || 0)}%)` }
        }
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
