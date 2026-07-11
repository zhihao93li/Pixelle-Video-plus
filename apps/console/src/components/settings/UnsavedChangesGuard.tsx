import { useEffect, useRef, useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { navigate, parsePath } from "@/lib/router"

export function UnsavedChangesGuard({
  currentPath,
  dirty,
  allowSettingsViews = false,
}: {
  currentPath: string
  dirty: boolean
  allowSettingsViews?: boolean
}) {
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const safePathRef = useRef(currentPath)
  const allowNextRef = useRef(false)
  const restoringRef = useRef(false)

  useEffect(() => {
    if (!dirty || isAllowedDestination(currentPath, allowSettingsViews)) {
      safePathRef.current = currentPath
    }
  }, [allowSettingsViews, currentPath, dirty])

  useEffect(() => {
    if (!dirty) return

    function requestLeave(path: string) {
      setPendingPath(path)
      setOpen(true)
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ""
    }

    function handleDocumentClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest<HTMLAnchorElement>("a[href]")
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      ) {
        return
      }
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin || !url.hash.startsWith("#/")) {
        return
      }
      const nextPath = url.hash.slice(1)
      if (isAllowedDestination(nextPath, allowSettingsViews)) return
      event.preventDefault()
      requestLeave(nextPath)
    }

    function handleHashChange() {
      if (restoringRef.current) return
      const nextPath = window.location.hash.replace(/^#/, "") || "/create"
      if (allowNextRef.current) {
        allowNextRef.current = false
        safePathRef.current = nextPath
        return
      }
      if (isAllowedDestination(nextPath, allowSettingsViews)) {
        safePathRef.current = nextPath
        return
      }

      const safePath = safePathRef.current
      restoringRef.current = true
      window.history.replaceState(null, "", `#${safePath}`)
      window.dispatchEvent(new HashChangeEvent("hashchange"))
      restoringRef.current = false
      requestLeave(nextPath)
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    window.addEventListener("hashchange", handleHashChange)
    document.addEventListener("click", handleDocumentClick, true)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
      window.removeEventListener("hashchange", handleHashChange)
      document.removeEventListener("click", handleDocumentClick, true)
    }
  }, [allowSettingsViews, dirty])

  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setPendingPath(null)
      }}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>离开并放弃未保存的更改？</AlertDialogTitle>
          <AlertDialogDescription>
            当前分区还有未保存内容。继续离开会丢失这些更改，已保存内容不受影响。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>留在此页</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (!pendingPath) return
              allowNextRef.current = true
              setOpen(false)
              navigate(pendingPath)
            }}
          >
            放弃更改并离开
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function isAllowedDestination(path: string, allowSettingsViews: boolean) {
  if (!allowSettingsViews) return false
  return parsePath(path).pathname === "/settings"
}
