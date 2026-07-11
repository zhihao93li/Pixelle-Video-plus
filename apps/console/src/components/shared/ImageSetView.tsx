import { Download } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * 图文帖图集展示：封面在首的缩略图网格（点开看原图）+「下载图集去发布」。
 * 复用现有图片打开方式（新标签页），不新增弹层类型（DESIGN.md §2.5）。
 */

export type ImageSetItem = { url: string; label: string }

export function ImageSetView({
  items,
  caption,
}: {
  items: ImageSetItem[]
  caption?: string | null
}) {
  if (items.length === 0) {
    return (
      <div className="flex h-16 items-center justify-center rounded-md bg-muted/40 text-xs text-muted-foreground">
        图集尚未就绪
      </div>
    )
  }

  function downloadAll() {
    items.forEach((item, index) => {
      // 交错触发，减少浏览器多下载拦截；跨域时浏览器会改为在新标签打开供保存
      window.setTimeout(() => {
        const anchor = document.createElement("a")
        anchor.href = item.url
        anchor.download = ""
        anchor.target = "_blank"
        anchor.rel = "noopener"
        anchor.click()
      }, index * 150)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => (
          <a
            className="relative block overflow-hidden rounded-md border"
            href={item.url}
            key={item.url}
            rel="noopener"
            target="_blank"
          >
            <img
              alt={item.label}
              className="aspect-[3/4] w-full object-cover"
              src={item.url}
            />
            <span className="absolute left-1 top-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
              {item.label}
            </span>
          </a>
        ))}
      </div>
      {caption && (
        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs leading-5 text-muted-foreground">
          {caption}
        </p>
      )}
      <Button onClick={downloadAll} size="sm" variant="outline">
        <Download data-icon="inline-start" />
        下载图集去发布
      </Button>
    </div>
  )
}
