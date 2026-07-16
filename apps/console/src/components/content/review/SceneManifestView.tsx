import { contentSceneImageUrl, type ContentItem } from "@/lib/generationApi"

export function SceneManifestView({ item }: { item: ContentItem }) {
  const manifest = item.scene_manifest
  if (!manifest) return null

  const isPages = manifest.review_kind === "image_pages"
  const isAgentImages = manifest.review_kind === "agent_image_scenes"

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">
          {isPages ? "图文分页" : "视频分镜"} · {manifest.scenes.length}
          {isPages ? " 页" : " 镜"}
        </h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {manifest.confirmed ? "已确认" : "等待确认"}
        </p>
      </div>

      <div className="divide-y overflow-hidden rounded-lg border bg-background">
        {manifest.scenes.map((scene) => (
          <article
            className="flex min-w-0 gap-3 px-3 py-3"
            key={scene.scene_id}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground tabular-nums">
              {scene.order}
            </span>
            {isAgentImages && scene.asset_id ? (
              <img
                alt={`第 ${scene.order} 镜`}
                className="h-16 w-24 shrink-0 rounded-md object-cover"
                loading="lazy"
                src={contentSceneImageUrl(item.item_id, scene.scene_id)}
              />
            ) : null}
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                第 {scene.order} {isPages ? "页" : "镜"}
                {scene.duration ? ` · 约 ${scene.duration} 秒` : ""}
              </p>
              <p className="text-sm leading-6 whitespace-pre-wrap">
                {scene.narration}
              </p>
              {isAgentImages ? (
                <p className="pt-1 text-xs leading-5 text-muted-foreground">
                  画面：{scene.image_prompt}
                </p>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
