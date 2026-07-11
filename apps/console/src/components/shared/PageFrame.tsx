import * as React from "react"

import { cn } from "@/lib/utils"

export function PageFrame({
  className,
  ...props
}: React.ComponentProps<"main">) {
  return (
    <main
      className={cn(
        "mx-auto flex w-full min-w-0 max-w-[var(--page-content-width)] flex-1 flex-col gap-5 px-4 pt-5 pb-[max(1.25rem,var(--safe-area-bottom))] lg:px-6",
        className
      )}
      data-slot="page-frame"
      {...props}
    />
  )
}
