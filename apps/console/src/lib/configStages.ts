export type ProductionSettingMode = "recipe" | "run"
export type ProductionSettingSource = "factory" | "recipe" | "run"

/**
 * 设置来源与编辑状态是两条轴：source 说明当前值来自哪里，pending 只说明
 * 页面上还有未保存/未提交的修改。文案集中在这里，避免两个入口各说一套。
 */
export function settingSourceNote(
  mode: ProductionSettingMode,
  source: ProductionSettingSource,
  pending: boolean
): string {
  if (pending) return "未保存"
  if (mode === "recipe") {
    return source === "factory" ? "出厂默认" : "已自定义"
  }
  return source === "run" ? "本次" : "模板默认"
}
