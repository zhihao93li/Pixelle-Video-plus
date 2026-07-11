/** 多语言常量的唯一来源（审核流与内容工作台共用）。 */

export const PRESET_LANGUAGES = [
  "Chinese",
  "English",
  "Japanese",
  "Korean",
  "Spanish",
  "Traditional Chinese",
]

export const LANGUAGE_LABELS: Record<string, string> = {
  Chinese: "中文",
  English: "English",
  Japanese: "日本語",
  Korean: "한국어",
  Spanish: "Español",
  "Traditional Chinese": "繁體中文",
}

export function languageLabel(language: string) {
  return LANGUAGE_LABELS[language] ?? language
}
