import { useState } from "react"
import { Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  contentSceneImageUrl,
  type PendingReviewSession,
  type SceneDraft,
} from "@/lib/generationApi"
import { mergeSceneIntoPrevious } from "@/lib/sceneReview"

export function SceneReviewEditor({
  busy,
  review,
  onConfirm,
  onRegenerate,
  onSave,
}: {
  busy: boolean
  review: PendingReviewSession
  onConfirm: (scenes: SceneDraft[]) => Promise<void>
  onRegenerate: (instruction: string) => Promise<void>
  onSave: (scenes: SceneDraft[]) => Promise<void>
}) {
  const manifest =
    review.payload.kind === "script" ? null : review.payload.scene_manifest
  const isPages = review.payload.kind === "image_pages"
  const isAgentImages = review.payload.kind === "agent_image_scenes"
  const [scenes, setScenes] = useState(() =>
    (manifest?.scenes ?? []).map((scene) => ({ ...scene }))
  )
  const [instruction, setInstruction] = useState("")
  const invalid =
    scenes.length === 0 ||
    scenes.some(
      (scene) =>
        !scene.narration.trim() || (isAgentImages && !scene.image_prompt.trim())
    )

  if (!manifest) return null

  function patchScene(index: number, patch: Partial<SceneDraft>) {
    setScenes((current) =>
      current.map((scene, sceneIndex) =>
        sceneIndex === index ? { ...scene, ...patch } : scene
      )
    )
  }

  function removeScene(index: number) {
    if (index === 0) return
    setScenes((current) => mergeSceneIntoPrevious(current, index))
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">
          {isPages ? "确认分页" : "确认分镜"} · {scenes.length}
          {isPages ? " 页" : " 镜"}
        </h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {isPages
            ? "逐页检查内容；确认后原生产任务会继续生成配图和图集。"
            : isAgentImages
              ? "逐镜检查口播和画面提示词；确认后 Agent 才会生成图片。"
              : "逐镜检查内容；确认后原生产任务会继续生成画面、配音和视频。"}
        </p>
      </div>

      <div className="divide-y overflow-hidden rounded-lg border bg-background">
        {scenes.map((scene, index) => (
          <article
            className={
              isPages || isAgentImages
                ? "flex min-w-0 gap-3 px-3 py-3"
                : "flex min-w-0 items-center gap-3 px-3 py-2"
            }
            key={scene.scene_id}
          >
            <div className="flex shrink-0 flex-col items-center gap-2">
              <span className="grid size-8 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground tabular-nums">
                {scene.order}
              </span>
              {isAgentImages && scene.asset_id ? (
                <img
                  alt={`第 ${scene.order} 镜`}
                  className="size-12 rounded-md object-cover"
                  loading="lazy"
                  src={contentSceneImageUrl(review.item_id, scene.scene_id)}
                />
              ) : null}
            </div>
            {!isPages && !isAgentImages ? (
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Input
                  aria-label={`第 ${scene.order} 镜文案`}
                  className="min-w-0 flex-1"
                  onChange={(event) =>
                    patchScene(index, { narration: event.target.value })
                  }
                  value={scene.narration}
                />
                {scene.duration ? (
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                    约 {scene.duration} 秒
                  </span>
                ) : null}
                <Button
                  aria-label={`删除第 ${scene.order} 镜并合并到上一镜`}
                  disabled={busy || index === 0}
                  onClick={() => removeScene(index)}
                  size="icon-sm"
                  title={index === 0 ? "第一镜没有上一镜，不能删除" : undefined}
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
              </div>
            ) : (
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex min-h-8 items-center justify-between gap-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    第 {scene.order} {isPages ? "页" : "镜"}
                    {scene.duration ? ` · 约 ${scene.duration} 秒` : ""}
                  </span>
                  <Button
                    aria-label={`删除第 ${scene.order} ${isPages ? "页" : "镜"}并合并到上一${isPages ? "页" : "镜"}`}
                    disabled={busy || index === 0}
                    onClick={() => removeScene(index)}
                    size="icon-sm"
                    title={
                      index === 0
                        ? `第一${isPages ? "页" : "镜"}没有上一项，不能删除`
                        : undefined
                    }
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </div>
                <Textarea
                  aria-label={`第 ${scene.order} ${isPages ? "页" : "镜"}文案`}
                  className="min-h-16 resize-y px-3 py-2 text-sm leading-6"
                  onChange={(event) =>
                    patchScene(index, { narration: event.target.value })
                  }
                  value={scene.narration}
                />
                {isAgentImages ? (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">
                      画面提示词
                    </span>
                    <Textarea
                      aria-label={`第 ${scene.order} 镜画面提示词`}
                      className="min-h-16 resize-y px-3 py-2 text-xs leading-5"
                      onChange={(event) =>
                        patchScene(index, { image_prompt: event.target.value })
                      }
                      value={scene.image_prompt}
                    />
                  </div>
                ) : null}
              </div>
            )}
          </article>
        ))}
      </div>

      <Textarea
        aria-label="重新生成修改意见"
        className="min-h-20 resize-y"
        onChange={(event) => setInstruction(event.target.value)}
        placeholder="整套重新生成的修改方向（选填）"
        value={instruction}
      />

      <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
        <Button
          disabled={busy}
          onClick={() => void onRegenerate(instruction)}
          variant="ghost"
        >
          整套重新生成
        </Button>
        <Button
          disabled={busy || invalid}
          onClick={() => void onSave(scenes)}
          variant="outline"
        >
          保存修改
        </Button>
        <Button
          disabled={busy || invalid}
          onClick={() => void onConfirm(scenes)}
        >
          {isPages ? "确认分页并继续" : "确认分镜并继续"}
        </Button>
      </div>

      {review.reference ? (
        <details className="rounded-lg border bg-muted/10 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium select-none">
            查看原始文案
          </summary>
          <div className="mt-3 space-y-3 border-t pt-3">
            {review.reference.title ? (
              <p className="text-sm font-medium">{review.reference.title}</p>
            ) : null}
            {Object.entries(review.reference.variants).map(
              ([language, variant]) => (
                <div key={language}>
                  <p className="text-xs text-muted-foreground">{language}</p>
                  <p className="mt-1 text-sm leading-7 whitespace-pre-wrap">
                    {variant.script || "（暂无文案）"}
                  </p>
                </div>
              )
            )}
          </div>
        </details>
      ) : null}
    </div>
  )
}
