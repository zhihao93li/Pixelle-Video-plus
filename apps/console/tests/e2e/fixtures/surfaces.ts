import { fixtureIds } from "./api"

/**
 * 正式 UI surface 的唯一清单。路由可达性、响应式、axe 与视觉回归
 * 共用这份数据，避免每份 spec 各自遗漏新页面或模式。
 */
export type FormalSurface = {
  name: string
  path: string
  heading: string
  mobileVisual?: boolean
}

export const FORMAL_SURFACES: readonly FormalSurface[] = [
  { name: "board-loaded", path: "/board", heading: "工作台" },
  {
    name: "content-detail-confirmed",
    path: `/board/item/${fixtureIds.contentItem}`,
    heading: "内容详情",
    mobileVisual: true,
  },
  {
    name: "create-gallery",
    path: "/create",
    heading: "快速生产",
    mobileVisual: true,
  },
  {
    name: "generate-video-idle",
    path: `/create/generate/${fixtureIds.videoTemplate}`,
    heading: "生成",
    mobileVisual: true,
  },
  {
    name: "generate-topic-video-idle",
    path: `/create/generate/${fixtureIds.topicTemplate}`,
    heading: "生成",
  },
  {
    name: "generate-image-set-idle",
    path: `/create/generate/${fixtureIds.imageTemplate}`,
    heading: "生成",
  },
  {
    name: "generate-text-idle",
    path: `/create/generate/${fixtureIds.textTemplate}`,
    heading: "生成",
  },
  {
    name: "generate-asset-idle",
    path: `/create/generate/${fixtureIds.assetTemplate}`,
    heading: "生成",
  },
  {
    name: "recipe-detail",
    path: `/create/recipes/${fixtureIds.videoTemplate}`,
    heading: "模板详情",
  },
  {
    name: "topic-recipe-detail",
    path: `/create/recipes/${fixtureIds.topicTemplate}`,
    heading: "模板详情",
  },
  {
    name: "special-image-to-video-idle",
    path: `/create/special/image_to_video/${fixtureIds.i2vTemplate}`,
    heading: "特殊视频生成",
  },
  {
    name: "special-action-transfer-idle",
    path: `/create/special/action_transfer/${fixtureIds.actionTemplate}`,
    heading: "特殊视频生成",
  },
  {
    name: "special-digital-human-idle",
    path: `/create/special/digital_human/${fixtureIds.humanTemplate}`,
    heading: "特殊视频生成",
    mobileVisual: true,
  },
  {
    name: "library-loaded-image-set",
    path: `/library?task=${fixtureIds.historyImageTask}`,
    heading: "作品库",
    mobileVisual: true,
  },
  {
    name: "library-loaded-video",
    path: `/library?task=${fixtureIds.historyVideoTask}`,
    heading: "作品库",
  },
  {
    name: "library-loaded-text",
    path: `/library?task=${fixtureIds.historyTextTask}`,
    heading: "作品库",
  },
  {
    name: "settings-overview",
    path: "/settings?view=overview",
    heading: "设置",
    mobileVisual: true,
  },
  {
    name: "settings-projects",
    path: "/settings?view=projects",
    heading: "设置",
  },
  {
    name: "settings-ai-voice",
    path: "/settings?view=ai-voice",
    heading: "设置",
  },
  {
    name: "settings-generation",
    path: "/settings?view=generation",
    heading: "设置",
    mobileVisual: true,
  },
  {
    name: "settings-publish-storage",
    path: "/settings?view=publish-storage",
    heading: "设置",
  },
  {
    name: "settings-recipes",
    path: "/settings?view=recipes",
    heading: "设置",
  },
  {
    name: "settings-help-markdown",
    path: "/settings?view=help",
    heading: "设置",
  },
  {
    name: "project-detail",
    path: `/settings/projects/${fixtureIds.project}`,
    heading: "内容空间详情",
  },
]

export const MOBILE_VISUAL_SURFACES = FORMAL_SURFACES.filter(
  (surface) => surface.mobileVisual
)
