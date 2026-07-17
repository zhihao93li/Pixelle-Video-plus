/** 设置二级信息架构与 deep-link 的唯一来源。 */

export const SETTINGS_VIEWS = [
  "overview",
  "projects",
  "llm",
  "visual-generation",
  "tts",
  "publish-storage",
  "recipes",
  "prompts",
  "help",
] as const

export type SettingsView = (typeof SETTINGS_VIEWS)[number]

export type SettingsTarget =
  | { kind: "view"; view: SettingsView }
  | { kind: "projects" }
  | { kind: "template"; id: string }
  | { kind: "llm" }
  | { kind: "tts" }
  | { kind: "generation" }
  | { kind: "publish" }
  | { kind: "help" }

export type ResolvedSettingsLocation = {
  view: SettingsView
  focus: string | null
  template: string | null
  canonicalPath: string
  needsNormalization: boolean
}

const VIEW_SET = new Set<string>(SETTINGS_VIEWS)

export function settingsLink(target: SettingsTarget): string {
  switch (target.kind) {
    case "view":
      return settingsViewPath(target.view)
    case "template":
      return settingsViewPath("recipes", { template: target.id })
    case "projects":
      return settingsViewPath("projects")
    case "llm":
      return settingsViewPath("llm")
    case "tts":
      return settingsViewPath("tts")
    case "generation":
      return settingsViewPath("visual-generation")
    case "publish":
      return settingsViewPath("publish-storage")
    case "help":
      return settingsViewPath("help")
  }
}

export function resolveSettingsLocation(
  query: URLSearchParams
): ResolvedSettingsLocation {
  const explicitView = query.get("view")
  const template = query.get("template")
  const legacyView = normalizeLegacyView(explicitView, query.get("focus"))
  const view = VIEW_SET.has(legacyView)
    ? (legacyView as SettingsView)
    : "overview"
  let focus = query.get("focus")

  focus = normalizeFocus(view, focus)

  const canonicalPath = settingsViewPath(view, {
    focus: focus || undefined,
    template: view === "recipes" ? template || undefined : undefined,
  })
  const canonicalQuery = new URLSearchParams(canonicalPath.split("?")[1] ?? "")
  return {
    view,
    focus,
    template: view === "recipes" ? template : null,
    canonicalPath,
    needsNormalization:
      query.get("view") !== view ||
      serializeQuery(query) !== serializeQuery(canonicalQuery),
  }
}

export function settingsViewPath(
  view: SettingsView,
  options: { focus?: string; template?: string } = {}
) {
  const query = new URLSearchParams()
  query.set("view", view)
  if (options.focus) query.set("focus", options.focus)
  if (options.template) query.set("template", options.template)
  return `/settings?${query.toString()}`
}

function serializeQuery(query: URLSearchParams) {
  const normalized = new URLSearchParams(query)
  normalized.sort()
  return normalized.toString()
}

function normalizeFocus(view: SettingsView, focus: string | null) {
  if (!focus) return null
  if (
    view === "visual-generation" &&
    (focus === "comfyui" ||
      focus === "image-providers" ||
      focus === "runninghub" ||
      focus === "resources")
  ) {
    return focus
  }
  if (view === "publish-storage") {
    if (focus === "buffer" || focus === "cos") return focus
  }
  return null
}

function normalizeLegacyView(view: string | null, focus: string | null) {
  if (view === "ai-voice") return focus === "tts" ? "tts" : "llm"
  if (view === "generation") return "visual-generation"
  return view ?? "overview"
}
