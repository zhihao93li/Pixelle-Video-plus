import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { InlineError } from "@/components/shared/feedback"
import { readableError } from "@/lib/format"
import { navigate } from "@/lib/router"
import { settingsLink } from "@/lib/settingsLinks"
import {
  listPromptTemplates,
  type PromptTemplate,
} from "@/lib/generationApi"

/**
 * Prompt 就地查看（只读）：在选提示词的地方看正文，不离开当前页。
 * 编辑动作收敛到设置页——底部「去编辑」deep-link 到项目区，不提供就地编辑。
 */
export function PromptPeekSheet({
  open,
  onOpenChange,
  kind,
  name,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: "script" | "split"
  name: string
}) {
  const [template, setTemplate] = useState<PromptTemplate | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 渲染期重置（open/kind/name 变化时），避免 effect 内同步 setState
  const key = open && name ? `${kind}:${name}` : null
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  if (key !== loadedKey) {
    setLoadedKey(key)
    setTemplate(null)
    setError(null)
    setLoading(key != null)
  }

  useEffect(() => {
    if (!open || !name) {
      return
    }
    let cancelled = false
    void listPromptTemplates()
      .then((response) => {
        if (cancelled) {
          return
        }
        const pool =
          kind === "script"
            ? response.script_templates
            : response.split_templates
        setTemplate(pool.find((item) => item.name === name) ?? null)
      })
      .catch((peekError) => {
        if (!cancelled) {
          setError(readableError(peekError))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, kind, name])

  const isBuiltin = template?.source === "builtin"

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle>{name || "提示词"}</SheetTitle>
            {template && (
              <Badge variant="outline">{isBuiltin ? "内置" : "自定义"}</Badge>
            )}
          </div>
          <SheetDescription className="text-left">
            {kind === "script"
              ? "口播 Prompt：AI 依据它把选题写成完整文案。"
              : "分镜 Prompt：AI 依据它把全文拆成逐条分镜。"}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在读取提示词
            </div>
          )}
          {error && <InlineError title="读取失败" message={error} />}
          {!loading && !error && template && (
            <pre className="max-h-[60vh] overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
              {template.content}
            </pre>
          )}
          {!loading && !error && !template && (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              没找到这个提示词，可能已被改名或删除。
            </div>
          )}
        </div>
        <SheetFooter>
          <Button
            onClick={() => {
              onOpenChange(false)
              navigate(settingsLink({ kind: "projects" }))
            }}
            variant="outline"
          >
            去编辑
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
