import { useCallback, useState } from "react"
import { LoaderCircle } from "lucide-react"

import { SceneReviewEditor } from "@/components/content/review/SceneReviewEditor"
import { ScriptReviewEditor } from "@/components/content/review/ScriptReviewEditor"
import { InlineError } from "@/components/shared/feedback"
import { Progress } from "@/components/ui/progress"
import { useToast } from "@/components/ui/toast"
import {
  confirmContentItem,
  getPendingContentReview,
  reviseContentReview,
  type ContentVariant,
  type PendingReviewSession,
  type SceneDraft,
} from "@/lib/generationApi"
import { readableError } from "@/lib/format"

/**
 * A route-agnostic review station. Both the production task and the content
 * ledger mount this component, so there is only one implementation of the
 * human confirmation contract and one editor for the current stage.
 */
export function CurrentReviewWorkspace({
  itemId,
  review,
  onChanged,
}: {
  itemId: string
  review: PendingReviewSession
  onChanged: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setBusy(true)
      setBusyLabel(label)
      setError(null)
      try {
        await action()
        onChanged()
      } catch (actionError) {
        setError(readableError(actionError))
      } finally {
        setBusy(false)
        setBusyLabel(null)
      }
    },
    [onChanged]
  )

  async function saveScript(variants: Record<string, ContentVariant>) {
    await reviseContentReview({
      itemId,
      action: "direct_edit",
      reviewId: review.review_id,
      contentVersion: review.version,
      variants,
    })
    toast({ title: "文案修改已保存", variant: "success" })
  }

  async function confirmScript(variants: Record<string, ContentVariant>) {
    let target = review
    if (
      review.payload.kind === "script" &&
      JSON.stringify(variants) !== JSON.stringify(review.payload.variants)
    ) {
      await reviseContentReview({
        itemId,
        action: "direct_edit",
        reviewId: review.review_id,
        contentVersion: review.version,
        variants,
      })
      const context = await getPendingContentReview(itemId)
      if (!context.review) throw new Error("保存后没有找到可确认的文案版本。")
      target = context.review
    }
    await confirmContentItem(itemId, {
      reviewId: target.review_id,
      contentVersion: target.version,
    })
  }

  async function rewriteScript() {
    await reviseContentReview({
      itemId,
      action: "rewrite_script",
      reviewId: review.review_id,
      contentVersion: review.version,
    })
    toast({ title: "文案重写已开始", variant: "success" })
  }

  async function saveScenes(scenes: SceneDraft[]) {
    if (review.payload.kind === "script") return
    await reviseContentReview({
      itemId,
      action: "direct_edit",
      reviewId: review.review_id,
      contentVersion: review.version,
      sceneManifest: {
        ...review.payload.scene_manifest,
        confirmed: false,
        scenes,
      },
    })
    toast({ title: "修改已保存，等待确认", variant: "success" })
  }

  async function confirmScenes(scenes: SceneDraft[]) {
    if (review.payload.kind === "script") return
    let target = review
    if (
      JSON.stringify(scenes) !==
      JSON.stringify(review.payload.scene_manifest.scenes)
    ) {
      await reviseContentReview({
        itemId,
        action: "direct_edit",
        reviewId: review.review_id,
        contentVersion: review.version,
        sceneManifest: {
          ...review.payload.scene_manifest,
          confirmed: false,
          scenes,
        },
      })
      const context = await getPendingContentReview(itemId)
      if (!context.review) throw new Error("保存后没有找到可确认的分镜版本。")
      target = context.review
    }
    await confirmContentItem(itemId, {
      reviewId: target.review_id,
      contentVersion: target.version,
    })
  }

  async function regenerateScenes(
    action: "regenerate_selected" | "regenerate_all",
    selectedSceneIds: string[],
    instruction: string
  ) {
    await reviseContentReview({
      itemId,
      action,
      reviewId: review.review_id,
      contentVersion: review.version,
      selectedSceneIds,
      instruction,
    })
    toast({
      title:
        action === "regenerate_all"
          ? "整套重新生成已开始"
          : "选中内容重新生成已开始",
      variant: "success",
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <InlineError title="操作失败" message={error} /> : null}
      {busyLabel ? (
        <div
          aria-live="polite"
          className="rounded-lg border border-primary/20 bg-primary/5 p-3"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <LoaderCircle className="size-4 animate-spin" />
            {busyLabel}
          </div>
          <Progress aria-label={busyLabel} className="mt-3" indeterminate />
        </div>
      ) : null}
      {review.payload.kind === "script" ? (
        <ScriptReviewEditor
          busy={busy}
          key={`${review.review_id}:${review.version}`}
          onConfirm={(variants) =>
            run("正在确认文案并进入下一步…", () => confirmScript(variants))
          }
          onRewrite={() => run("正在重写文案…", rewriteScript)}
          onSave={(variants) =>
            run("正在保存文案修改…", () => saveScript(variants))
          }
          review={review}
        />
      ) : (
        <SceneReviewEditor
          busy={busy}
          key={`${review.review_id}:${review.version}`}
          onConfirm={(scenes) =>
            run("正在确认并进入生产…", () => confirmScenes(scenes))
          }
          onRegenerate={(action, selectedIds, instruction) =>
            run(
              action === "regenerate_all"
                ? "正在重新生成整套内容…"
                : "正在重新生成选中内容…",
              () => regenerateScenes(action, selectedIds, instruction)
            )
          }
          onSave={(scenes) => run("正在保存修改…", () => saveScenes(scenes))}
          review={review}
        />
      )}
    </div>
  )
}
