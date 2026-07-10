/**
 * 设置页 deep-link 的唯一来源。全站「去设置」一律经 settingsLink(...)，
 * 禁止再写裸 navigate("/settings")。
 *
 * URL 约定：/settings?tab=<general|templates|help>&section=<id>，可选 template=<模板id>。
 * 设置页据此切换 tab、滚动到目标区块并一次性高亮。
 */

export type SettingsTarget =
  | { kind: "projects" }
  | { kind: "template"; id: string }
  | { kind: "llm" }
  | { kind: "tts" }

export function settingsLink(target: SettingsTarget): string {
  switch (target.kind) {
    case "template":
      return `/settings?tab=templates&template=${encodeURIComponent(target.id)}`
    case "projects":
      return "/settings?tab=general&section=projects"
    case "llm":
      return "/settings?tab=general&section=llm"
    case "tts":
      return "/settings?tab=general&section=tts"
  }
}
