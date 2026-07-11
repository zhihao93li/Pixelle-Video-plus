import { Copy, Download } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"

/**
 * 长文（text 产物）展示：等宽纯文本滚动区 + 字数 +「复制全文」+「下载 .md」。
 * 本期不做 markdown 渲染（开放项）；模式与 ImageSetView 接入一致。
 */

export function TextArticleView({
  title,
  article,
}: {
  title?: string | null
  article: string
}) {
  const toast = useToast()

  function copyAll() {
    void navigator.clipboard
      .writeText(article)
      .then(() => toast({ title: "已复制全文", variant: "success" }))
      .catch(() =>
        toast({
          title: "复制失败",
          description: "浏览器拒绝了剪贴板访问，请手动选中复制。",
          variant: "error",
        })
      )
  }

  function downloadMd() {
    const blob = new Blob([article], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    const safeName =
      (title || "long-form").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) ||
      "long-form"
    anchor.href = url
    anchor.download = `${safeName}.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-2">
      <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-mono text-xs leading-5">
        {article}
      </pre>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {article.length} 字
        </span>
        <div className="flex gap-2">
          <Button onClick={copyAll} size="sm" variant="outline">
            <Copy data-icon="inline-start" />
            复制全文
          </Button>
          <Button onClick={downloadMd} size="sm" variant="outline">
            <Download data-icon="inline-start" />
            下载 .md
          </Button>
        </div>
      </div>
    </div>
  )
}
