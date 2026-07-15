import { useMemo, useRef, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type Option = { label: string; value: string }

export function SearchableSelect({
  id,
  ariaLabel,
  disabled = false,
  onValueChange,
  options,
  placeholder = "选择模型",
  value,
}: {
  id?: string
  ariaLabel?: string
  disabled?: boolean
  onValueChange: (value: string) => void
  options: Option[]
  placeholder?: string
  value: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const optionsRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle
      ? options.filter((option) =>
          `${option.label} ${option.value}`.toLowerCase().includes(needle)
        )
      : options
  }, [options, query])

  return (
    <PopoverPrimitive.Root
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setQuery("")
      }}
      open={open}
    >
      <PopoverPrimitive.Trigger asChild>
        <Button
          aria-expanded={open}
          aria-label={ariaLabel}
          className="w-full justify-between font-normal"
          disabled={disabled}
          id={id}
          role="combobox"
          type="button"
          variant="outline"
        >
          <span
            className={cn(
              "truncate",
              !selected && !value && "text-muted-foreground"
            )}
          >
            {selected?.label || value || placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          className="z-50 w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1.5rem)] min-w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
          collisionPadding={12}
          sideOffset={4}
        >
          <Input
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false)
              if (event.key === "ArrowDown") {
                event.preventDefault()
                optionsRef.current
                  ?.querySelector<HTMLButtonElement>('[role="option"]')
                  ?.focus()
              }
            }}
            placeholder="搜索模型名称"
            value={query}
          />
          <div
            className="mt-2 max-h-[min(15rem,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain"
            ref={optionsRef}
            role="listbox"
          >
            {filtered.length ? (
              filtered.map((option, index) => (
                <button
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                  key={option.value}
                  onClick={() => {
                    onValueChange(option.value)
                    setOpen(false)
                    setQuery("")
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
                      return
                    }
                    event.preventDefault()
                    const options = Array.from(
                      optionsRef.current?.querySelectorAll<HTMLButtonElement>(
                        '[role="option"]'
                      ) ?? []
                    )
                    const nextIndex =
                      event.key === "ArrowDown"
                        ? Math.min(index + 1, options.length - 1)
                        : Math.max(index - 1, 0)
                    options[nextIndex]?.focus()
                  }}
                  role="option"
                  aria-selected={option.value === value}
                  type="button"
                >
                  <Check
                    className={cn(
                      "size-4",
                      option.value !== value && "opacity-0"
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </button>
              ))
            ) : (
              <div className="px-2 py-3 text-sm text-muted-foreground">
                没有匹配的模型
              </div>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
