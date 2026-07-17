import { ChevronDown, Circle, FileText, Film, ListChecks } from "lucide-react"

import { ArtifactPreview } from "@/components/shared/ArtifactPreview"
import { AsyncState } from "@/components/shared/AsyncState"
import { EmptyState } from "@/components/shared/EmptyState"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/format"
import type {
  GenerationResult,
  ProductionTimelineEntry,
} from "@/lib/generationApi"
import { resultArtifactViewModel } from "@/lib/productionRunAdapters"

const ACTOR_LABELS: Record<ProductionTimelineEntry["actor"], string> = {
  user: "你",
  system: "系统",
  agent: "Agent",
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function activitySummary(entry: ProductionTimelineEntry) {
  const message = entry.detail.message
  if (typeof message === "string" && message.trim()) return message
  if (entry.event_type === "task_created") {
    const input = record(entry.detail.input)
    const topic = input.topic ?? input.title ?? input.script
    if (typeof topic === "string" && topic.trim()) {
      return topic.length > 180 ? `${topic.slice(0, 180)}…` : topic
    }
  }
  return null
}

function ScriptOutput({ entry }: { entry: ProductionTimelineEntry }) {
  const payload = record(entry.detail.payload)
  const variants = record(payload.variants)
  return (
    <div className="space-y-4">
      {Object.entries(variants).map(([language, rawVariant]) => {
        const variant = record(rawVariant)
        return (
          <article className="space-y-2" key={language}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{language}</Badge>
              {typeof variant.title === "string" && variant.title ? (
                <h4 className="text-sm font-medium">{variant.title}</h4>
              ) : null}
            </div>
            <p className="text-sm leading-7 whitespace-pre-wrap">
              {typeof variant.script === "string" ? variant.script : ""}
            </p>
          </article>
        )
      })}
    </div>
  )
}

function SceneOutput({ entry }: { entry: ProductionTimelineEntry }) {
  const payload = record(entry.detail.payload)
  const scenes = Array.isArray(payload.scenes) ? payload.scenes : []
  const isPages = entry.stage === "image_pages"
  return (
    <div className="divide-y overflow-hidden rounded-lg border bg-background">
      {scenes.map((rawScene, index) => {
        const scene = record(rawScene)
        return (
          <article
            className="flex min-w-0 gap-3 px-3 py-3"
            key={String(scene.scene_id ?? index)}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground tabular-nums">
              {String(scene.order ?? index + 1)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-muted-foreground">
                第 {String(scene.order ?? index + 1)} {isPages ? "页" : "镜"}
              </div>
              <p className="mt-1 text-sm leading-6 whitespace-pre-wrap">
                {typeof scene.narration === "string" ? scene.narration : ""}
              </p>
              {typeof scene.image_prompt === "string" && scene.image_prompt ? (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  画面：{scene.image_prompt}
                </p>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function OutputContent({
  entry,
  result,
  resultError,
  title,
}: {
  entry: ProductionTimelineEntry
  result: GenerationResult | null | undefined
  resultError: string | null | undefined
  title: string
}) {
  if (entry.event_type === "artifact_produced") {
    if (resultError) {
      return (
        <AsyncState
          description={resultError}
          state="error"
          title="历史产物读取失败"
        />
      )
    }
    if (!result) return <AsyncState state="loading" title="正在读取历史产物" />
    return (
      <ArtifactPreview
        artifact={resultArtifactViewModel(result, null, title)}
      />
    )
  }
  if (entry.stage === "script") return <ScriptOutput entry={entry} />
  return <SceneOutput entry={entry} />
}

export function ProductionTimeline({
  entries,
  results,
  resultErrors,
  title,
}: {
  entries: ProductionTimelineEntry[]
  results: Record<string, GenerationResult | null>
  resultErrors: Record<string, string | null>
  title: string
}) {
  const latestOutputId = entries.find(
    (entry) => entry.category === "output"
  )?.event_id

  if (entries.length === 0) {
    return <EmptyState title="还没有生产记录" />
  }

  return (
    <section aria-labelledby="production-timeline-title">
      <div className="mb-4">
        <h2 className="text-base font-semibold" id="production-timeline-title">
          最新记录
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          按时间倒序展示这次任务的真实产出和操作。
        </p>
      </div>
      <div className="relative ml-3 border-l pl-6">
        {entries.map((entry) => {
          const summary = activitySummary(entry)
          const icon =
            entry.event_type === "artifact_produced" ? (
              <Film className="size-3.5" />
            ) : entry.stage === "script" ? (
              <FileText className="size-3.5" />
            ) : entry.category === "output" ? (
              <ListChecks className="size-3.5" />
            ) : (
              <Circle className="size-2.5 fill-current" />
            )

          if (entry.category === "activity") {
            return (
              <article
                className="relative pb-6 last:pb-0"
                data-event-id={entry.event_id}
                data-event-type={entry.event_type}
                key={entry.event_id}
              >
                <span className="absolute top-0.5 -left-[2.2rem] grid size-5 place-items-center rounded-full border bg-background text-muted-foreground">
                  {icon}
                </span>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium">{entry.title}</h3>
                  <time className="text-xs text-muted-foreground tabular-nums">
                    {formatDate(entry.occurred_at)}
                  </time>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {ACTOR_LABELS[entry.actor]}
                  {entry.stage ? ` · ${entry.stage}` : ""}
                </p>
                {summary ? (
                  <p className="mt-2 text-sm leading-6">{summary}</p>
                ) : null}
              </article>
            )
          }

          return (
            <details
              className="group relative mb-6 rounded-lg border bg-card last:mb-0"
              data-event-id={entry.event_id}
              data-event-type={entry.event_type}
              key={entry.event_id}
              open={entry.event_id === latestOutputId}
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden">
                <span className="absolute top-3.5 -left-[2.65rem] grid size-7 place-items-center rounded-full border bg-background text-primary">
                  {icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {entry.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {ACTOR_LABELS[entry.actor]} ·{" "}
                    {formatDate(entry.occurred_at)}
                  </span>
                </span>
                <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t p-4">
                <OutputContent
                  entry={entry}
                  result={
                    entry.generation_task_id
                      ? results[entry.generation_task_id]
                      : undefined
                  }
                  resultError={
                    entry.generation_task_id
                      ? resultErrors[entry.generation_task_id]
                      : undefined
                  }
                  title={title}
                />
              </div>
            </details>
          )
        })}
      </div>
    </section>
  )
}
