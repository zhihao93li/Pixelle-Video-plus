import * as React from "react"

import { cn } from "@/lib/utils"

const WIDTH_CLASS = {
  standard: "max-w-[1240px]",
  wide: "max-w-[1600px]",
  narrow: "max-w-[960px]",
  fluid: "max-w-none",
} as const

export type PageFrameWidth = keyof typeof WIDTH_CLASS

export function PageFrame({
  className,
  width = "standard",
  ...props
}: React.ComponentProps<"main"> & {
  width?: PageFrameWidth
}) {
  return (
    <main
      className={cn(
        "flex w-full min-w-0 flex-1 flex-col gap-5 px-4 pt-5 pb-[max(1.25rem,var(--safe-area-bottom))] lg:px-5",
        WIDTH_CLASS[width],
        className
      )}
      data-slot="page-frame"
      data-width={width}
      {...props}
    />
  )
}
