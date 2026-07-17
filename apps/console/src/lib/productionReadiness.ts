import type {
  PipelineManifest,
  SettingsDiagnosticCheck,
} from "./generationApi"

export type ProductionReadinessItem = {
  id: string
  label: string
  ok: boolean
  message: string
  settingsKind: "llm" | "generation" | "help"
}

function byId(checks: SettingsDiagnosticCheck[], id: string) {
  return checks.find((check) => check.id === id)
}

function fromCheck(
  checks: SettingsDiagnosticCheck[],
  id: string,
  label: string,
  settingsKind: ProductionReadinessItem["settingsKind"]
): ProductionReadinessItem | null {
  const check = byId(checks, id)
  return check
    ? { id, label, ok: check.ok, message: check.message, settingsKind }
    : null
}

export function appSetupReadiness(
  checks: SettingsDiagnosticCheck[],
  hasContentSpace: boolean
): ProductionReadinessItem[] {
  const imageChecks = [
    "runninghub_config",
    "aliyun_bailian_image",
    "volcengine_ark_image",
    "comfyui_config",
  ]
    .map((id) => byId(checks, id))
    .filter((check): check is SettingsDiagnosticCheck => Boolean(check))
  const imageReady = imageChecks.some((check) => check.ok)
  const items = [
    fromCheck(checks, "llm_config", "连接一个文本 AI 服务", "llm"),
    {
      id: "image_generation",
      label: "连接一种图片生成方式",
      ok: imageReady,
      message: imageReady
        ? "至少一种真实图片生成方式已配置。"
        : "RunningHub、阿里百炼、火山方舟或 ComfyUI 至少配置一种。",
      settingsKind: "generation" as const,
    },
    fromCheck(checks, "ffmpeg", "安装本地视频合成工具", "help"),
    {
      id: "content_space",
      label: "准备内容空间",
      ok: hasContentSpace,
      message: hasContentSpace
        ? "内容、任务和作品已有归属空间。"
        : "请先创建一个内容空间。",
      settingsKind: "help" as const,
    },
  ]
  return items.filter((item): item is ProductionReadinessItem => Boolean(item))
}

export function pipelineReadiness(
  pipeline: PipelineManifest | undefined,
  checks: SettingsDiagnosticCheck[],
  imageProvider: string
): ProductionReadinessItem[] {
  if (!pipeline || checks.length === 0) return []
  const required = new Set(pipeline.required_capabilities)
  const items: Array<ProductionReadinessItem | null> = []
  if (required.has("llm")) {
    items.push(fromCheck(checks, "llm_config", "文本 AI 服务", "llm"))
  }
  if (required.has("ffmpeg")) {
    items.push(fromCheck(checks, "ffmpeg", "视频合成工具", "help"))
  }
  if (required.has("media")) {
    const diagnosticId =
      imageProvider === "aliyun_bailian"
        ? "aliyun_bailian_image"
        : imageProvider === "volcengine_ark"
          ? "volcengine_ark_image"
          : "workflow_image_generation"
    const label =
      diagnosticId === "aliyun_bailian_image"
        ? "阿里百炼图片生成"
        : diagnosticId === "volcengine_ark_image"
          ? "火山方舟图片生成"
          : "Workflow 图片生成"
    if (diagnosticId === "workflow_image_generation") {
      const runningHub = byId(checks, "runninghub_config")
      const comfyUi = byId(checks, "comfyui_config")
      items.push({
        id: diagnosticId,
        label,
        ok: Boolean(runningHub?.ok || comfyUi?.ok),
        message:
          runningHub?.ok || comfyUi?.ok
            ? "至少一个 Workflow 图片生成入口已配置。"
            : "请配置 RunningHub 或 ComfyUI。",
        settingsKind: "generation",
      })
    } else {
      items.push(fromCheck(checks, diagnosticId, label, "generation"))
    }
  }
  return items.filter((item): item is ProductionReadinessItem => Boolean(item))
}
