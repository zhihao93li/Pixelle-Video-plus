import { Download, FileText, Images, Video } from "lucide-react"

import { ImageSetView } from "@/components/shared/ImageSetView"
import { TextArticleView } from "@/components/shared/TextArticleView"
import { Button } from "@/components/ui/button"
import type { ArtifactViewModel } from "@/lib/productViewModels"
import { downloadFilename } from "@/lib/downloadFilename"
import { cn } from "@/lib/utils"

/**
 * Operations 产物预览的唯一展示层。组件只消费判别联合，不解释 API 原始字段。
 */
export function ArtifactPreview({
  artifact,
  className,
}: {
  artifact: ArtifactViewModel | null
  className?: string
}) {
  if (!artifact) {
    return (
      <div
        className={cn(
          "flex min-h-56 items-center justify-center rounded-lg border bg-muted/30 p-6 text-center",
          className
        )}
        data-state="empty"
      >
        <div className="flex max-w-xs flex-col items-center gap-2 text-muted-foreground">
          <Video aria-hidden="true" className="size-5" />
          <p className="text-sm">产物尚未就绪</p>
          <p className="text-xs">任务完成后，可在这里预览与下载。</p>
        </div>
      </div>
    )
  }

  if (artifact.kind === "image_set") {
    return (
      <section
        aria-label={`${artifact.title}图集预览`}
        className={cn("min-w-0", className)}
      >
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Images aria-hidden="true" className="size-4 text-muted-foreground" />
          <span>图集预览</span>
          <span className="font-normal text-muted-foreground">
            {artifact.images.length} 张
          </span>
        </div>
        <ImageSetView
          caption={artifact.caption}
          items={artifact.images}
          title={artifact.title}
        />
      </section>
    )
  }

  if (artifact.kind === "text") {
    return (
      <section
        aria-label={`${artifact.title}长文预览`}
        className={cn("min-w-0", className)}
      >
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <FileText
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
          <span>长文预览</span>
        </div>
        <TextArticleView article={artifact.article} title={artifact.title} />
      </section>
    )
  }

  return (
    <figure className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="overflow-hidden rounded-lg border bg-black">
        <video
          aria-label={`${artifact.title}视频预览`}
          className="aspect-[9/16] max-h-[680px] w-full bg-black object-contain"
          controls
          poster={artifact.poster ?? undefined}
          preload="metadata"
          src={artifact.src}
        />
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <Video aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">视频文件</span>
        </div>
        <Button asChild size="sm" variant="outline">
          <a
            download={downloadFilename(artifact.title, "mp4", "未命名视频")}
            href={artifact.downloadUrl}
          >
            <Download data-icon="inline-start" />
            下载视频
          </a>
        </Button>
      </figcaption>
    </figure>
  )
}
