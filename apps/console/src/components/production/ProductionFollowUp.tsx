import { LoaderCircle } from "lucide-react"
import { useState } from "react"

import { InlineError } from "@/components/shared/feedback"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatDate, readableError } from "@/lib/format"
import {
  markContentPublished,
  recordContentMetrics,
  transitionContentItem,
  type ContentItem,
} from "@/lib/generationApi"

export function ProductionFollowUp({
  item,
  productionTaskId,
  onChanged,
}: {
  item: ContentItem
  productionTaskId: string
  onChanged: () => Promise<void> | void
}) {
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [publicationOpen, setPublicationOpen] = useState(false)
  const [publication, setPublication] = useState({
    platform: "xiaohongshu",
    publishedAt: new Date().toISOString().slice(0, 16),
    url: "",
    note: "",
  })
  const [metrics, setMetrics] = useState({
    publicationId: "",
    likes: "",
    favorites: "",
    comments: "",
    note: "",
  })

  async function run(label: string, action: () => Promise<unknown>) {
    setBusyAction(label)
    setError(null)
    try {
      await action()
      await onChanged()
    } catch (actionError) {
      setError(readableError(actionError))
    } finally {
      setBusyAction(null)
    }
  }

  if (item.status === "measured") {
    return (
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
        本轮发布数据已记录，任务已完成复盘。
      </div>
    )
  }

  if (item.status === "published") {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">记录发布数据</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            填写真实数据后，这次生产会完成闭环。
          </p>
        </div>
        {item.publications.length > 1 ? (
          <Field>
            <FieldLabel>对应发布记录</FieldLabel>
            <Select
              onValueChange={(publicationId) =>
                setMetrics((current) => ({ ...current, publicationId }))
              }
              value={metrics.publicationId}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择发布记录" />
              </SelectTrigger>
              <SelectContent>
                {item.publications.map((entry) => (
                  <SelectItem
                    key={entry.publication_id}
                    value={entry.publication_id}
                  >
                    {entry.platform} · {formatDate(entry.published_at)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(
            [
              ["likes", "赞"],
              ["favorites", "收藏"],
              ["comments", "评论"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key}>
              <FieldLabel htmlFor={`task-metrics-${key}`}>{label}</FieldLabel>
              <Input
                id={`task-metrics-${key}`}
                inputMode="numeric"
                min="0"
                onChange={(event) =>
                  setMetrics((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
                type="number"
                value={metrics[key]}
              />
            </Field>
          ))}
        </FieldGroup>
        <Field>
          <FieldLabel htmlFor="task-metrics-note">复盘备注</FieldLabel>
          <Textarea
            id="task-metrics-note"
            onChange={(event) =>
              setMetrics((current) => ({
                ...current,
                note: event.target.value,
              }))
            }
            placeholder="记录有效信号或后续调整…"
            rows={3}
            value={metrics.note}
          />
        </Field>
        {error ? <InlineError message={error} title="数据保存失败" /> : null}
        <div className="flex justify-end">
          <Button
            disabled={
              busyAction != null ||
              (!metrics.likes.trim() &&
                !metrics.favorites.trim() &&
                !metrics.comments.trim() &&
                !metrics.note.trim()) ||
              (item.publications.length > 1 && !metrics.publicationId)
            }
            onClick={() =>
              void run("metrics", () =>
                recordContentMetrics({
                  itemId: item.item_id,
                  productionTaskId,
                  likes: metrics.likes ? Number(metrics.likes) : undefined,
                  favorites: metrics.favorites
                    ? Number(metrics.favorites)
                    : undefined,
                  comments: metrics.comments
                    ? Number(metrics.comments)
                    : undefined,
                  note: metrics.note.trim() || undefined,
                  publicationId:
                    metrics.publicationId ||
                    item.publications[0]?.publication_id,
                })
              )
            }
            size="sm"
          >
            {busyAction === "metrics" ? (
              <LoaderCircle className="animate-spin" />
            ) : null}
            保存复盘数据
          </Button>
        </div>
      </div>
    )
  }

  if (!["produced", "scheduled"].includes(item.status)) return null

  if (!publicationOpen) {
    return (
      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-medium">发布记录</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            视频实际排期或发布后，再补充平台、时间和发布证据。
          </p>
        </div>
        <Button
          className="shrink-0"
          onClick={() => setPublicationOpen(true)}
          size="sm"
          variant="outline"
        >
          记录发布
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium">记录发布</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            实际发布后再登记；没有链接时可以填写人工证据。
          </p>
        </div>
        <Button
          disabled={busyAction != null}
          onClick={() => setPublicationOpen(false)}
          size="sm"
          variant="ghost"
        >
          收起
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel>平台</FieldLabel>
          <Select
            onValueChange={(platform) =>
              setPublication((current) => ({ ...current, platform }))
            }
            value={publication.platform}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="xiaohongshu">小红书</SelectItem>
              <SelectItem value="youtube">YouTube</SelectItem>
              <SelectItem value="tiktok">TikTok</SelectItem>
              <SelectItem value="instagram">Instagram</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="task-published-at">发布时间</FieldLabel>
          <Input
            id="task-published-at"
            onChange={(event) =>
              setPublication((current) => ({
                ...current,
                publishedAt: event.target.value,
              }))
            }
            type="datetime-local"
            value={publication.publishedAt}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="task-publish-url">发布链接</FieldLabel>
          <Input
            id="task-publish-url"
            onChange={(event) =>
              setPublication((current) => ({
                ...current,
                url: event.target.value,
              }))
            }
            placeholder="https://…"
            value={publication.url}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="task-publish-note">人工证据备注</FieldLabel>
          <Input
            id="task-publish-note"
            onChange={(event) =>
              setPublication((current) => ({
                ...current,
                note: event.target.value,
              }))
            }
            placeholder="没有链接时填写发布记录"
            value={publication.note}
          />
        </Field>
      </div>
      {error ? <InlineError message={error} title="发布记录保存失败" /> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {item.status === "produced" ? (
          <Button
            disabled={busyAction != null}
            onClick={() =>
              void run("schedule", () =>
                transitionContentItem(item.item_id, "scheduled")
              )
            }
            size="sm"
            variant="outline"
          >
            {busyAction === "schedule" ? (
              <LoaderCircle className="animate-spin" />
            ) : null}
            标记已排期
          </Button>
        ) : null}
        <Button
          disabled={
            busyAction != null ||
            (!publication.url.trim() && !publication.note.trim())
          }
          onClick={() =>
            void run("publish", () =>
              markContentPublished({
                itemId: item.item_id,
                productionTaskId,
                platform: publication.platform,
                publishedAt: new Date(publication.publishedAt).toISOString(),
                publishUrl: publication.url.trim() || undefined,
                manualEvidence: publication.note.trim() || undefined,
              })
            )
          }
          size="sm"
        >
          {busyAction === "publish" ? (
            <LoaderCircle className="animate-spin" />
          ) : null}
          标记已发布
        </Button>
      </div>
    </div>
  )
}
