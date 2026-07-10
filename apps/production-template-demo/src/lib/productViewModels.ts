import type { ArtifactKind } from "@/lib/artifactKind"

/**
 * UI-only run states. Backend statuses are adapted at the API boundary; page
 * components should not branch on pipeline-specific status strings.
 */
export type RunState =
  | "idle"
  | "uploading"
  | "submitting"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelling"
  | "cancelled"
  | "interrupted"

export type StatusAdapterResult<T extends string> =
  | { kind: "known"; value: T; rawStatus: string }
  | { kind: "unknown"; rawStatus: string | null }

export type AdaptedRunState = StatusAdapterResult<RunState>

const ACTIVE_RUN_STATES: readonly RunState[] = [
  "uploading",
  "submitting",
  "queued",
  "running",
  "cancelling",
]

const CANCELLABLE_RUN_STATES: readonly RunState[] = [
  "uploading",
  "submitting",
  "queued",
  "running",
]

export function adaptRunStatus(status: unknown): AdaptedRunState {
  const rawStatus = normalizeStatus(status)
  switch (rawStatus) {
    case "idle":
    case "uploading":
    case "submitting":
    case "queued":
    case "running":
    case "completed":
    case "failed":
    case "cancelling":
    case "cancelled":
    case "interrupted":
      return knownStatus(rawStatus, rawStatus)
    case "pending":
    case "submitted":
      return knownStatus("queued", rawStatus)
    case "processing":
      return knownStatus("running", rawStatus)
    case "partial_failed":
    case "error":
      return knownStatus("failed", rawStatus)
    default:
      return { kind: "unknown", rawStatus: rawStatus || null }
  }
}

export function statusIs<T extends string>(
  result: StatusAdapterResult<T>,
  expected: T
) {
  return result.kind === "known" && result.value === expected
}

export function runStatusIsActive(result: AdaptedRunState) {
  return ACTIVE_RUN_STATES.some((state) => statusIs(result, state))
}

export function runStatusIsCancellable(result: AdaptedRunState) {
  return CANCELLABLE_RUN_STATES.some((state) => statusIs(result, state))
}

export function knownStatus<T extends string>(
  value: T,
  rawStatus: string = value
): StatusAdapterResult<T> {
  return { kind: "known", value, rawStatus }
}

export type GenerationDraft<T extends Record<string, unknown>> = {
  defaults: T
  overrides: Partial<T>
  dirtyKeys: Array<keyof T>
}

export function createGenerationDraft<T extends Record<string, unknown>>(
  defaults: T
): GenerationDraft<T> {
  return { defaults, overrides: {}, dirtyKeys: [] }
}

export function updateGenerationDraft<T extends Record<string, unknown>>(
  draft: GenerationDraft<T>,
  patch: Partial<T>
): GenerationDraft<T> {
  const overrides = { ...draft.overrides }

  for (const rawKey of Object.keys(patch)) {
    const key = rawKey as keyof T
    const value = patch[key]
    if (Object.is(value, draft.defaults[key])) {
      delete overrides[key]
    } else {
      overrides[key] = value
    }
  }

  return {
    defaults: draft.defaults,
    overrides,
    dirtyKeys: Object.keys(overrides) as Array<keyof T>,
  }
}

export function resolveGenerationDraft<T extends Record<string, unknown>>(
  draft: GenerationDraft<T>
): T {
  return { ...draft.defaults, ...draft.overrides }
}

type ArtifactBase = {
  id: string
  title: string
  createdAt?: string | null
}

export type VideoArtifactViewModel = ArtifactBase & {
  kind: "video"
  src: string
  downloadUrl: string
  poster?: string | null
  duration?: number | null
  fileSize?: number | null
}

export type ImageSetArtifactViewModel = ArtifactBase & {
  kind: "image_set"
  images: Array<{ id: string; url: string; label: string }>
  caption?: string | null
}

export type TextArtifactViewModel = ArtifactBase & {
  kind: "text"
  article: string
}

export type ArtifactViewModel =
  VideoArtifactViewModel | ImageSetArtifactViewModel | TextArtifactViewModel

export type ProductionRunChildViewModel = {
  id: string
  label: string
  state: AdaptedRunState
  progress: number
  message?: string | null
  error?: string | null
  artifact?: ArtifactViewModel | null
  canRetry: boolean
}

export type ProductionRunViewModel = {
  id: string
  title: string
  artifactKind: ArtifactKind
  state: AdaptedRunState
  progress: number
  message?: string | null
  error?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  children: ProductionRunChildViewModel[]
  artifact?: ArtifactViewModel | null
  canCancel: boolean
  canRetry: boolean
}

export type PublishAttemptState =
  "idle" | "scheduled" | "publishing" | "published" | "failed"

export type AdaptedPublishAttemptState =
  StatusAdapterResult<PublishAttemptState>

export function adaptPublishStatus(
  status: unknown
): AdaptedPublishAttemptState {
  const rawStatus = normalizeStatus(status)
  switch (rawStatus) {
    case "idle":
      return knownStatus("idle", rawStatus)
    case "scheduled":
    case "queued":
    case "pending":
      return knownStatus("scheduled", rawStatus)
    case "publishing":
    case "processing":
    case "running":
      return knownStatus("publishing", rawStatus)
    case "published":
    case "completed":
    case "success":
      return knownStatus("published", rawStatus)
    case "failed":
    case "error":
      return knownStatus("failed", rawStatus)
    default:
      return { kind: "unknown", rawStatus: rawStatus || null }
  }
}

export type PublishAttemptViewModel = {
  id: string
  platformId: string
  platformLabel: string
  state: AdaptedPublishAttemptState
  scheduledAt?: string | null
  publishedAt?: string | null
  publicUrl?: string | null
  error?: string | null
  canRetry: boolean
}

function normalizeStatus(status: unknown) {
  if (typeof status === "string" || typeof status === "number") {
    return String(status).trim().toLowerCase()
  }
  return ""
}
