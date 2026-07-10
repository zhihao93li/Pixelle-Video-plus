import * as React from "react"
import { CheckCircle2, X, XCircle } from "lucide-react"
import { Toast as ToastPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

type ToastVariant = "success" | "error" | "default"

type ToastItem = {
  id: number
  title: string
  description?: string
  variant: ToastVariant
}

type ToastInput = {
  title: string
  description?: string
  variant?: ToastVariant
}

const ToastContext = React.createContext<((toast: ToastInput) => void) | null>(
  null
)

/** 操作结果通知（成功/失败/后台完成）。表单校验错误请用 InlineError。 */
export function useToast() {
  const push = React.useContext(ToastContext)
  if (!push) {
    throw new Error("useToast 必须在 ToastProvider 内使用")
  }
  return push
}

let nextToastId = 1

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])

  const push = React.useCallback((input: ToastInput) => {
    const id = nextToastId++
    setToasts((current) => [
      ...current.slice(-3),
      { id, variant: "default", ...input },
    ])
  }, [])

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={push}>
      <ToastPrimitive.Provider duration={4000} swipeDirection="right">
        {children}
        {toasts.map((toast) => (
          <ToastPrimitive.Root
            className={cn(
              "flex items-start gap-3 rounded-lg border bg-background p-4 shadow-lg duration-[var(--motion-duration-default)] data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-2",
              toast.variant === "success" && "border-success/30",
              toast.variant === "error" && "border-danger/30"
            )}
            key={toast.id}
            onOpenChange={(open) => {
              if (!open) {
                dismiss(toast.id)
              }
            }}
          >
            {toast.variant === "success" && (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            )}
            {toast.variant === "error" && (
              <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
            )}
            <div className="min-w-0 flex-1">
              <ToastPrimitive.Title className="text-sm font-medium">
                {toast.title}
              </ToastPrimitive.Title>
              {toast.description && (
                <ToastPrimitive.Description className="mt-1 text-sm leading-5 text-muted-foreground">
                  {toast.description}
                </ToastPrimitive.Description>
              )}
            </div>
            <ToastPrimitive.Close
              aria-label="关闭通知"
              className="rounded-md p-0.5 text-muted-foreground transition-colors duration-[var(--motion-duration-fast)] hover:text-foreground"
            >
              <X className="size-3.5" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed right-[max(1rem,var(--safe-area-right))] bottom-[max(1rem,var(--safe-area-bottom))] z-[100] flex w-full max-w-sm flex-col gap-2 outline-none max-sm:left-[max(1rem,var(--safe-area-left))] max-sm:w-auto" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}
