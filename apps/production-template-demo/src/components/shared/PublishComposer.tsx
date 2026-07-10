import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCcw,
  Send,
  XCircle,
} from "lucide-react"

import { InlineError } from "@/components/shared/feedback"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatDate } from "@/lib/format"
import type { PublishAttemptViewModel } from "@/lib/productViewModels"
import { cn } from "@/lib/utils"

type ScheduleMode = "queue" | "scheduled"

export type PublishComposerProps = {
  attempts: PublishAttemptViewModel[]
  platforms: Array<{ id: string; label: string }>
  selectedPlatforms: string[]
  title: string
  caption: string
  hashtags: string
  scheduleMode: ScheduleMode
  dueAt: string
  timezone: string
  timezones: string[]
  scheduledDueAt: string | null
  checks: Array<{ name: string; ok: boolean; message: string }>
  error: string | null
  isChecking: boolean
  isPublishing: boolean
  submitDisabled: boolean
  disabledReason?: string | null
  onPlatformsChange: (value: string[]) => void
  onTitleChange: (value: string) => void
  onCaptionChange: (value: string) => void
  onHashtagsChange: (value: string) => void
  onScheduleModeChange: (value: ScheduleMode) => void
  onDueAtChange: (value: string) => void
  onTimezoneChange: (value: string) => void
  onCheck: () => void
  onSubmit: () => void
}

/** 发布编辑器只消费用户态 PublishAttemptViewModel，不解释渠道原始状态。 */
export function PublishComposer({
  attempts,
  platforms,
  selectedPlatforms,
  title,
  caption,
  hashtags,
  scheduleMode,
  dueAt,
  timezone,
  timezones,
  scheduledDueAt,
  checks,
  error,
  isChecking,
  isPublishing,
  submitDisabled,
  disabledReason,
  onPlatformsChange,
  onTitleChange,
  onCaptionChange,
  onHashtagsChange,
  onScheduleModeChange,
  onDueAtChange,
  onTimezoneChange,
  onCheck,
  onSubmit,
}: PublishComposerProps) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {attempts.length > 0 ? (
        <section aria-labelledby="publish-attempts-heading">
          <h3 className="text-sm font-medium" id="publish-attempts-heading">
            最近发布
          </h3>
          <PublishAttemptList attempts={attempts} className="mt-2" />
        </section>
      ) : null}

      <FieldGroup>
        <FieldSet>
          <FieldLegend variant="label">发布平台</FieldLegend>
          <div className="grid gap-2 sm:grid-cols-2">
            {platforms.map((platform) => {
              const checked = selectedPlatforms.includes(platform.id)
              return (
                <label
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
                    checked && "border-primary/40 bg-primary/5"
                  )}
                  key={platform.id}
                >
                  <input
                    checked={checked}
                    className="size-4 accent-primary"
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...selectedPlatforms, platform.id]
                        : selectedPlatforms.filter((id) => id !== platform.id)
                      onPlatformsChange(next)
                    }}
                    type="checkbox"
                  />
                  <span>{platform.label}</span>
                </label>
              )
            })}
          </div>
          {platforms.length === 0 ? (
            <FieldDescription>
              暂时没有可用平台，请先在设置中完成渠道配置。
            </FieldDescription>
          ) : null}
        </FieldSet>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="publish-title">标题</FieldLabel>
            <Input
              id="publish-title"
              onChange={(event) => onTitleChange(event.target.value)}
              value={title}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="publish-hashtags">话题标签</FieldLabel>
            <Input
              id="publish-hashtags"
              onChange={(event) => onHashtagsChange(event.target.value)}
              placeholder="#宠物护理 #短视频"
              value={hashtags}
            />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="publish-caption">发布文案</FieldLabel>
          <Textarea
            className="min-h-32 resize-y"
            id="publish-caption"
            onChange={(event) => onCaptionChange(event.target.value)}
            value={caption}
          />
        </Field>

        <FieldSet>
          <FieldLegend variant="label">发布时间</FieldLegend>
          <ToggleGroup
            aria-label="选择发布时间"
            onValueChange={(value) => {
              if (value === "queue" || value === "scheduled") {
                onScheduleModeChange(value)
              }
            }}
            type="single"
            value={scheduleMode}
            variant="outline"
          >
            <ToggleGroupItem value="queue">加入发布队列</ToggleGroupItem>
            <ToggleGroupItem value="scheduled">指定时间</ToggleGroupItem>
          </ToggleGroup>

          {scheduleMode === "scheduled" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="publish-due-at">日期与时间</FieldLabel>
                <Input
                  id="publish-due-at"
                  onChange={(event) => onDueAtChange(event.target.value)}
                  type="datetime-local"
                  value={dueAt}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="publish-timezone">时区</FieldLabel>
                <Select onValueChange={onTimezoneChange} value={timezone}>
                  <SelectTrigger id="publish-timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {timezones.map((timezoneOption) => (
                        <SelectItem key={timezoneOption} value={timezoneOption}>
                          {timezoneOption}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <FieldDescription className="sm:col-span-2">
                排期时间：{scheduledDueAt || "请选择完整的日期与时间"}
              </FieldDescription>
            </div>
          ) : null}
        </FieldSet>
      </FieldGroup>

      {error ? <InlineError message={error} title="发布操作失败" /> : null}

      {checks.length > 0 ? (
        <section aria-labelledby="publish-checks-heading">
          <h3 className="text-sm font-medium" id="publish-checks-heading">
            渠道检查
          </h3>
          <div className="mt-2 divide-y border-y">
            {checks.map((check, index) => (
              <div
                className="flex items-start gap-2 py-2.5 text-sm"
                key={`${check.name}-${index}`}
              >
                {check.ok ? (
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-success"
                  />
                ) : (
                  <XCircle
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-destructive"
                  />
                )}
                <div className="min-w-0">
                  <div className="font-medium">{check.name}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {check.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="sticky bottom-0 -mx-4 mt-auto border-t bg-popover/95 px-4 pt-4 pb-[max(1rem,var(--safe-area-bottom))] backdrop-blur-sm">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button
            disabled={isChecking || selectedPlatforms.length === 0}
            onClick={onCheck}
            variant="outline"
          >
            {isChecking ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <RefreshCcw data-icon="inline-start" />
            )}
            检查渠道连接
          </Button>
          <Button disabled={submitDisabled} onClick={onSubmit}>
            {isPublishing ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Send data-icon="inline-start" />
            )}
            {attempts.length > 0 ? "再次提交发布" : "提交发布"}
          </Button>
        </div>
        {submitDisabled && disabledReason ? (
          <p className="mt-2 text-right text-xs text-muted-foreground">
            {disabledReason}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function PublishAttemptList({
  attempts,
  className,
  compact = false,
}: {
  attempts: PublishAttemptViewModel[]
  className?: string
  compact?: boolean
}) {
  return (
    <div className={cn("divide-y border-y", className)}>
      {attempts.map((attempt) => (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5",
            !compact && "min-h-12"
          )}
          key={attempt.id}
        >
          <div className="min-w-0">
            <div className="text-sm font-medium">{attempt.platformLabel}</div>
            {!compact ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {publishAttemptMeta(attempt)}
              </p>
            ) : null}
            {attempt.error ? (
              <p className="mt-1 text-xs text-destructive">{attempt.error}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge status={attempt.state} />
            {attempt.publicUrl ? (
              <Button asChild size="icon-sm" variant="ghost">
                <a
                  aria-label={`打开 ${attempt.platformLabel} 发布内容`}
                  href={attempt.publicUrl}
                  rel="noopener"
                  target="_blank"
                >
                  <ExternalLink />
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function publishAttemptMeta(attempt: PublishAttemptViewModel) {
  if (attempt.state === "scheduled" && attempt.scheduledAt) {
    return `计划于 ${formatDate(attempt.scheduledAt)}`
  }
  if (attempt.state === "published" && attempt.publishedAt) {
    return `发布于 ${formatDate(attempt.publishedAt)}`
  }
  if (attempt.state === "failed") {
    return "可调整内容或渠道设置后再次提交。"
  }
  if (attempt.state === "publishing") {
    return "平台正在处理。"
  }
  return "等待提交。"
}
