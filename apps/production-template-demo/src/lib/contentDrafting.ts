import {
  createScriptReviewDraftSet,
  patchContentItem,
  transitionContentItem,
  type ContentItem,
  type ContentVariant,
  type ScriptReviewLanguageDraft,
} from "@/lib/generationApi"

/**
 * 选题 → 草稿的统一编排（添加弹层、看板多选、条目抽屉三处共用）。
 * 动线：标记「起草中」→ 后台 LLM 起草（按语言组合分组建 draft set）→
 * 成功推进到待确认并写入变体；失败退回选题池。
 */

type ToastFn = (toast: {
  title: string
  description?: string
  variant?: "success" | "error" | "default"
}) => void

type DraftSetDraft = {
  index?: number
  topic: string
  language_drafts?: Record<string, ScriptReviewLanguageDraft>
}

async function advanceToReview(
  item: ContentItem,
  drafts: DraftSetDraft[],
  draftSetId: string
): Promise<boolean> {
  const draft = drafts.find((entry) => entry.topic === item.title)
  if (!draft || !draft.language_drafts) {
    return false
  }
  await transitionContentItem(item.item_id, "draft_ready")
  await transitionContentItem(item.item_id, "pending_review")
  const variants: Record<string, Partial<ContentVariant>> = {}
  for (const [language, languageDraft] of Object.entries(draft.language_drafts)) {
    variants[language] = {
      status: "pending",
      title: languageDraft.title,
      script: languageDraft.script,
      narrations: languageDraft.narrations,
    }
  }
  await patchContentItem(item.item_id, {
    links: { draft_set_id: draftSetId, draft_index: draft.index ?? 0 },
    variants,
  })
  return true
}

function languageKey(item: ContentItem) {
  const languages = item.languages?.length ? item.languages : ["Chinese"]
  return [...languages].sort().join("|")
}

async function draftInBackground(
  items: ContentItem[],
  toast: ToastFn,
  onChanged: () => void,
  projectId?: string
) {
  const groups = new Map<string, ContentItem[]>()
  for (const item of items) {
    const key = languageKey(item)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }

  let succeeded = 0
  // 失败原因随条目一起记录，写进退回事件的 detail，抽屉里可直接看到
  const failedItems: Array<{ item: ContentItem; reason: string }> = []
  for (const [key, groupItems] of groups) {
    try {
      const draftSet = await createScriptReviewDraftSet({
        topics: groupItems.map((item) => item.title),
        languages: key.split("|"),
        projectId,
      })
      const errorByTopic = new Map<string, string>()
      for (const entry of draftSet.errors ?? []) {
        const topic = String((entry as { topic?: unknown }).topic ?? "")
        const message = String((entry as { message?: unknown }).message ?? "")
        if (topic && message) {
          errorByTopic.set(topic, message)
        }
      }
      const settled = await Promise.allSettled(
        groupItems.map((item) =>
          advanceToReview(item, draftSet.drafts, draftSet.draft_set_id)
        )
      )
      settled.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value) {
          succeeded += 1
        } else {
          const item = groupItems[index]
          failedItems.push({
            item,
            reason:
              errorByTopic.get(item.title) ??
              (result.status === "rejected"
                ? String(result.reason)
                : "草稿生成失败"),
          })
        }
      })
    } catch (groupError) {
      const reason = String(
        (groupError as Error)?.message ?? groupError ?? "草稿生成失败"
      )
      failedItems.push(
        ...groupItems.map((item) => ({ item, reason }))
      )
    }
  }

  if (failedItems.length > 0) {
    await Promise.allSettled(
      failedItems.map(({ item, reason }) =>
        transitionContentItem(item.item_id, "idea", { reason })
      )
    )
  }

  if (succeeded > 0 && failedItems.length === 0) {
    toast({ title: `${succeeded} 组草稿已生成，待确认`, variant: "success" })
  } else if (succeeded > 0) {
    toast({
      title: `${succeeded} 组草稿已生成，${failedItems.length} 条起草失败已退回选题池`,
      variant: "success",
    })
  } else {
    toast({ title: "草稿生成失败，选题已退回选题池", variant: "error" })
  }
  onChanged()
}

/**
 * 为选题池中的条目生成草稿。立即标记「起草中」并返回；LLM 起草在后台继续，
 * 完成或失败后通过 toast 通知并触发 onChanged 刷新。
 */
export async function generateDraftsForItems(
  items: ContentItem[],
  toast: ToastFn,
  onChanged: () => void,
  options: { projectId?: string } = {}
) {
  const draftable = items.filter(
    (item) => item.kind === "text" && item.status === "idea"
  )
  if (draftable.length === 0) {
    return
  }
  await Promise.all(
    draftable.map((item) => transitionContentItem(item.item_id, "drafting"))
  )
  toast({
    title: `开始为 ${draftable.length} 个选题起草…`,
    description: "起草完成后会自动进入待确认，可先做别的。",
  })
  onChanged()
  void draftInBackground(draftable, toast, onChanged, options.projectId)
}
