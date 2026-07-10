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
  | VideoArtifactViewModel
  | ImageSetArtifactViewModel
  | TextArtifactViewModel

export type ProductionRunChildViewModel = {
  id: string
  label: string
  state: RunState
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
  state: RunState
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
  | "idle"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"

export type PublishAttemptViewModel = {
  id: string
  platformId: string
  platformLabel: string
  state: PublishAttemptState
  scheduledAt?: string | null
  publishedAt?: string | null
  publicUrl?: string | null
  error?: string | null
  canRetry: boolean
}
