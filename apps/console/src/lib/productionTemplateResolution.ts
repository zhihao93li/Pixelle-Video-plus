import type { ProductionTemplate } from "./generationApi.ts"

export type GenerateTemplateResolution =
  { ok: true; template: ProductionTemplate } | { ok: false; error: string }

/**
 * Resolve the exact recipe requested by the route. Explicit recipe identities
 * never fall back; only a route without an id may use the backend default.
 */
export function resolveGenerateTemplate(
  templates: ProductionTemplate[],
  requestedTemplateId: string | undefined,
  defaultTemplateId: string | null
): GenerateTemplateResolution {
  const requestedId = requestedTemplateId?.trim()
  const targetId = requestedId || defaultTemplateId?.trim()
  const targetLabel = requestedId ? "指定配方" : "默认配方"

  if (!targetId) {
    return {
      ok: false,
      error: "当前项目没有配置默认生产配方，请返回快速生产重新选择。",
    }
  }

  const template = templates.find((item) => item.id === targetId)
  if (!template) {
    return {
      ok: false,
      error: `${targetLabel}不存在或当前项目无权使用，请返回快速生产重新选择。`,
    }
  }
  if (!template.enabled) {
    return {
      ok: false,
      error: `${targetLabel}「${template.display_name}」已停用，请返回快速生产选择其他配方。`,
    }
  }
  if (template.retired) {
    return {
      ok: false,
      error: `${targetLabel}「${template.display_name}」已退役，请返回快速生产选择其他配方。`,
    }
  }
  if (template.product_entry !== "generate") {
    return {
      ok: false,
      error: `${targetLabel}「${template.display_name}」属于专用生产模式，不能在当前生成页打开。`,
    }
  }

  return { ok: true, template }
}
