import type { ContentItem, ContentVariantStatus } from "@/lib/generationApi"

const STATUS_LABELS: Record<string, string> = {
  idea: "选题",
  drafting: "起草中",
  draft_ready: "草稿完成",
  pending_review: "待确认",
  confirmed: "已确认",
  producing: "生产中",
  produced: "已出片",
  production_failed: "生产未完成",
  scheduled: "已排期",
  published: "已发布",
  measured: "已复盘",
  archived: "已归档",
}

export function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status
}

export const VARIANT_STATUS_LABELS: Record<ContentVariantStatus, string> = {
  pending: "待确认",
  confirmed: "已确认",
  rejected: "已打回",
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  created: "创建",
  status_changed: "状态变更",
  draft_generated: "草稿生成",
  confirmed: "已确认",
  produced: "已出片",
  scheduled: "已排期",
  published: "已发布",
  metrics_recorded: "数据录入",
  note: "备注",
}

export function eventTypeLabel(type: string) {
  return EVENT_TYPE_LABELS[type] ?? type
}

export function contentProductionFailure(item: ContentItem): string | null {
  const failure = item.automation.production_failure
  if (!failure || typeof failure !== "object") {
    return null
  }
  const message = (failure as Record<string, unknown>).message
  return typeof message === "string" && message.trim() ? message.trim() : null
}

export const ACTOR_LABELS: Record<string, string> = {
  user: "我",
  agent: "AI",
  system: "系统",
}
