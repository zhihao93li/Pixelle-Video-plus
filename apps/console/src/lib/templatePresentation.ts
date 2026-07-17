import type { ProductionTemplate } from "@/lib/generationApi"

/**
 * 模板展示辅助：把内部 pipeline_id/enabled 映射成面向用户的说法。
 * 面向用户文案禁止出现 pipeline_id/enabled 等内部字样（PRD §8.4）。
 */

/** 管线归属 chip 文案：标准线 / 素材线 / Workflow 直跑。 */
const PIPELINE_CHIP_LABELS: Record<string, string> = {
  topic_to_video: "主题到视频",
  script_to_video: "文案到视频",
  line_script_to_video: "逐行分镜到视频",
  codex_scene_video: "Agent 配图合成",
  asset_based: "素材线",
  image_post: "图文线",
  topic_to_image_post: "主题图文线",
  topic_to_long_form: "主题长文线",
  long_form: "长文线",
  i2v: "Workflow 直跑",
  action_transfer: "Workflow 直跑",
  digital_human: "Workflow 直跑",
}

export function pipelineChipLabel(pipelineId: string): string {
  return PIPELINE_CHIP_LABELS[pipelineId] ?? "产线"
}

/** 面向用户的成品导向模板（骨架 + 用户自定义）。 */
export function isProductTemplate(template: ProductionTemplate): boolean {
  return template.access_scope === "public"
}

export function isCodexOnlyTemplate(template: ProductionTemplate): boolean {
  return template.access_scope === "agent"
}

/** 需要专用素材表单的生产路线。 */
export function isSpecialPipelineTemplate(
  template: ProductionTemplate
): boolean {
  return ["i2v", "action_transfer", "digital_human"].includes(
    template.pipeline_id
  )
}

/** 当前可用的成品模板（已启用、非专用入口）。 */
export function isActiveProductTemplate(template: ProductionTemplate): boolean {
  return (
    template.enabled &&
    isProductTemplate(template) &&
    !isSpecialPipelineTemplate(template)
  )
}
