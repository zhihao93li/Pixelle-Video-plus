/** 图集图片的人话标签：封面 / 第 N 页（首图默认封面）。 */
export function imageSetLabel(indexInList: number, role?: string | null): string {
  if (role === "cover" || indexInList === 0) {
    return "封面"
  }
  return `第 ${indexInList} 页`
}
