import type { ProductionTemplate } from "@/lib/generationApi"

/**
 * 模板展示辅助：把内部 pipeline_id/enabled 映射成面向用户的说法。
 * 面向用户文案禁止出现 pipeline_id/enabled 等内部字样（PRD §8.4）。
 */

/** 管线归属 chip 文案：标准线 / 素材线 / Workflow 直跑。 */
const PIPELINE_CHIP_LABELS: Record<string, string> = {
  standard: "标准线",
  codex_scene_video: "Codex 配图合成",
  asset_based: "素材线",
  image_post: "图文线",
  long_form: "长文线",
  i2v: "Workflow 直跑",
  action_transfer: "Workflow 直跑",
  digital_human: "Workflow 直跑",
}

export function pipelineChipLabel(pipelineId: string): string {
  return PIPELINE_CHIP_LABELS[pipelineId] ?? "产线"
}

/** 面向用户的成品导向模板（骨架 + 用户自定义），排除专用流程入口。 */
export function isProductTemplate(template: ProductionTemplate): boolean {
  return template.product_entry === "generate"
}

export function isCodexOnlyTemplate(template: ProductionTemplate): boolean {
  return template.access_scope === "codex"
}

/** 专用流程入口（多语言审核出片；批量已改为生成页提交模式，不再是入口）。 */
export function isDedicatedEntry(template: ProductionTemplate): boolean {
  return template.product_entry !== "generate"
}

/** 已退役的内置预设：只读、不可复活、归入「已退役」分组。 */
export function isRetiredTemplate(template: ProductionTemplate): boolean {
  return template.retired
}

/** 当前可用的成品模板（已启用、非退役、非专用入口）。 */
export function isActiveProductTemplate(template: ProductionTemplate): boolean {
  return template.enabled && !template.retired && isProductTemplate(template)
}
