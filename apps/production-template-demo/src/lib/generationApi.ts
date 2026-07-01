export const API_BASE_URL =
  import.meta.env.VITE_PIXELLE_API_BASE_URL ?? "http://127.0.0.1:8000/api"

export type GenerationStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

export type ProductionTemplate = {
  id: string
  version: string
  display_name: string
  description: string
  project: string | null
  channel: string | null
  use_case: string
  runtime_label: string
  estimated_turnaround: string
  failure_guidance: string
  requires_user_assets: boolean
  advanced_controls_hidden: boolean
  template_tags: string[]
  input_requirements: string[]
  quality_tier: string
  pipeline_id: string
  entry: string
  fixed_params: Record<string, unknown>
  required_capabilities: string[]
  user_selectable_runtime: boolean
  user_selectable_providers: string[]
}

export type TemplateListResponse = {
  default_template: string | null
  templates: ProductionTemplate[]
}

export type GenerationProgress = {
  stage: string
  percentage: number
  message: string
  current: number | null
  total: number | null
  detail: Record<string, unknown>
}

export type GenerationError = {
  layer: string
  message: string
  exception_type: string | null
  detail: Record<string, unknown>
}

export type GenerationTask = {
  task_id: string
  pipeline_id: string
  entry: string
  status: GenerationStatus
  progress: GenerationProgress
  error: GenerationError | null
  created_at: string
  updated_at: string
}

export type GenerationArtifact = {
  kind: string
  path: string
  url: string | null
  media_type: string | null
  role: string | null
  metadata: Record<string, unknown>
}

export type GenerationResult = {
  task_id: string
  pipeline_id: string
  entry: string
  status: "completed"
  artifacts: GenerationArtifact[]
  primary_video: GenerationArtifact
  duration: number | null
  file_size: number | null
  storyboard_path: string | null
  metadata: Record<string, unknown>
}

export type GenerationSubmitResponse = {
  success: boolean
  message: string
  generation_task_id: string
  task: GenerationTask
}

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(message: string, status: number, detail: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.detail = detail
  }
}

export async function listTemplates() {
  return fetchJson<TemplateListResponse>("/generation/templates")
}

export async function createDailyVideoTask(templateId: string, script: string) {
  return fetchJson<GenerationSubmitResponse>(
    `/generation/templates/${templateId}/tasks`,
    {
      method: "POST",
      body: JSON.stringify({
        input: {
          script,
        },
        metadata: {
          source: "react_p0_demo",
        },
      }),
    }
  )
}

export async function getTask(taskId: string) {
  return fetchJson<GenerationTask>(`/generation/tasks/${taskId}`)
}

export async function getTaskResult(taskId: string) {
  return fetchJson<GenerationResult>(`/generation/tasks/${taskId}/result`)
}

export function artifactFileUrl(artifact: GenerationArtifact | null | undefined) {
  if (!artifact) {
    return null
  }

  if (artifact.url) {
    return artifact.url
  }

  const relativePath = outputRelativePath(artifact.path)
  if (!relativePath) {
    return null
  }

  return `${API_BASE_URL.replace(/\/$/, "")}/files/${relativePath}`
}

export function isTerminalStatus(status: GenerationStatus) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    })
  } catch (error) {
    throw new ApiError(
      "无法连接 Pixelle API。请确认 http://127.0.0.1:8000 正在运行。",
      0,
      error instanceof Error ? error.message : error
    )
  }

  const text = await response.text()
  const data = text ? safeJson(text) : null

  if (!response.ok) {
    throw new ApiError(errorMessage(data, response.statusText), response.status, data)
  }

  return data as T
}

function safeJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function errorMessage(data: unknown, fallback: string) {
  if (typeof data === "object" && data && "detail" in data) {
    const detail = (data as { detail?: unknown }).detail
    if (typeof detail === "string") {
      return detail
    }
    return JSON.stringify(detail)
  }

  if (typeof data === "string") {
    return data
  }

  return fallback || "请求失败"
}

function outputRelativePath(path: string) {
  const normalized = path.replaceAll("\\", "/")
  const outputMarker = "/output/"
  const markerIndex = normalized.indexOf(outputMarker)

  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + outputMarker.length)
  }

  if (normalized.startsWith("output/")) {
    return normalized.slice("output/".length)
  }

  return null
}

