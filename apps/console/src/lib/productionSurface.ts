import { artifactKindLabel, templateArtifactType } from "./artifactKind.ts"
import type { ProductionTemplate } from "./generationApi.ts"

const INPUT_LABELS: Record<string, string> = {
  script: "文案",
  topic: "选题",
  assets: "素材",
  image: "图片",
  video: "视频",
  prompt: "提示词",
  reference_video: "参考动作视频",
  character_assets: "角色图",
  scenes: "Agent 分镜与图片",
}

const LINE_LABELS: Record<string, string> = {
  topic_to_video: "主题口播",
  script_to_video: "文案口播",
  codex_scene_video: "Agent 配图合成",
  asset_based: "素材成片",
  image_post: "图文帖",
  topic_to_image_post: "主题图文",
  topic_to_long_form: "主题长文",
  long_form: "长文",
  i2v: "专用视频",
  action_transfer: "专用视频",
  digital_human: "专用视频",
}

const PIPELINE_DESCRIPTIONS: Record<string, string> = {
  codex_scene_video:
    "Agent 规划分镜并生成图片，Pixelle 完成配音、字幕和视频合成。",
  asset_based: "上传图片或视频素材，整理成带字幕与配音的完整短片。",
  image_post: "把文案排成封面和多页配图，生成可直接发布的图集。",
  topic_to_image_post: "从主题生成适合图文媒介的文案，确认文案和分页后生成图集。",
  topic_to_long_form: "从主题直接生成结构化长文，产出后在作品库检查。",
  long_form: "把确认稿扩写成结构化长文，适合公众号、知乎和长图文。",
  i2v: "上传一张图片并描述运动方式，生成一段动态视频。",
  action_transfer: "上传参考动作视频和目标人物图，生成动作迁移视频。",
  digital_human: "上传角色形象，再使用文案或商品素材生成数字人口播。",
}

/** 精确保留模板身份的生产入口；专用生成页同样携带 template id。 */
export function productionStartRoute(template: ProductionTemplate) {
  if (template.pipeline_id === "i2v")
    return `/create/special/image_to_video/${template.id}`
  if (template.pipeline_id === "action_transfer")
    return `/create/special/action_transfer/${template.id}`
  if (template.pipeline_id === "digital_human")
    return `/create/special/digital_human/${template.id}`
  return `/create/generate/${template.id}`
}

export function productionInputSummary(template: ProductionTemplate) {
  if (template.pipeline_id === "asset_based") {
    return "图片或视频、制作目标"
  }
  if (template.pipeline_id === "i2v") {
    return "图片、运动提示"
  }
  if (template.pipeline_id === "action_transfer") {
    return "参考视频、目标图片、提示词"
  }
  if (template.pipeline_id === "digital_human") {
    return "角色图、文案或商品"
  }
  return template.input_requirements
    .map((item) => INPUT_LABELS[item] ?? item)
    .join("、")
}

export function productionArtifactSummary(template: ProductionTemplate) {
  return artifactKindLabel(templateArtifactType(template.pipeline_id))
}

export function productionDescription(template: ProductionTemplate) {
  const description =
    PIPELINE_DESCRIPTIONS[template.pipeline_id] ?? template.description
  return description
    .replaceAll(/workflow/gi, "生成流程")
    .replaceAll(/ComfyUI/gi, "本地生成")
    .replaceAll(/RunningHub/gi, "云端生成")
    .replaceAll(/FFmpeg/gi, "合成服务")
}

export function productionLineSummary(template: ProductionTemplate) {
  return LINE_LABELS[template.pipeline_id] ?? "内容生产"
}

export function productionSubmissionSummary(template: ProductionTemplate) {
  if (template.access_scope === "agent") {
    return "仅 Agent 发起"
  }
  if (template.pipeline_id === "i2v") {
    return "单条或图片批量"
  }
  const supportsScriptBatch =
    template.input_requirements.includes("script") &&
    !template.requires_user_assets &&
    !template.input_requirements.includes("assets") &&
    !template.input_requirements.includes("topic")
  return supportsScriptBatch ? "单条或文案批量" : "单条"
}
