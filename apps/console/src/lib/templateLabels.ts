const FRAME_TEMPLATE_LABELS: Record<string, string> = {
  image_minimal_framed: "极简画框",
  image_post_cover: "图文封面",
  image_post_default: "图文正文",
  asset_default: "素材优先",
  image_blur_card: "毛玻璃卡片",
  image_book: "书页排版",
  image_cartoon: "卡通插画",
  image_default: "经典留白",
  image_elegant: "雅致排版",
  image_excerpt: "摘录卡片",
  image_fashion_vintage: "复古时尚",
  image_full: "全屏画面",
  image_healing: "治愈氛围",
  image_health_preservation: "健康科普",
  image_life_insights: "生活感悟",
  image_life_insights_light: "浅色感悟",
  image_long_text: "长文卡片",
  image_modern: "现代简约",
  image_neon: "霓虹氛围",
  image_psychology_card: "心理卡片",
  image_purple: "紫色氛围",
  image_satirical_cartoon: "讽刺漫画",
  image_simple_black: "黑白极简",
  image_simple_line_drawing: "极简线稿",
  static_default: "静态字幕",
  static_excerpt: "静态摘录",
  video_default: "视频背景",
  video_healing: "治愈视频",
  image_film: "电影质感",
  image_ultrawide_minimal: "超宽极简",
  image_wide_darktech: "暗黑科技",
}

export function frameTemplateStem(value: string) {
  const file = value.split("/").pop() || value
  return file.replace(/\.html$/, "")
}

/** Normal-mode label: never exposes a filesystem-like template key. */
export function frameTemplateLabel(value: string) {
  const stem = frameTemplateStem(value)
  return (
    FRAME_TEMPLATE_LABELS[stem] ??
    stem
      .replace(/^(image|video|static)_/, "")
      .replaceAll("_", " ")
      .replace(/^./, (character) => character.toUpperCase())
  )
}
