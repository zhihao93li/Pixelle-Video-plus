export type TemplateStatus = "ready" | "needs-input" | "preview"

export type ProductionTemplate = {
  id: string
  name: string
  shortName: string
  description: string
  useCase: string
  entry: string
  status: TemplateStatus
  statusLabel: string
  estimatedTime: string
  qualityPolicy: string
  version: string
  requiresAssets: boolean
  assetRequirement: string
  inputRequirements: string[]
  fixedSettings: string[]
  expectedOutputs: string[]
}

export const productionTemplates: ProductionTemplate[] = [
  {
    id: "daily",
    name: "PetWoods 小红书日常短视频",
    shortName: "日常更新",
    description: "适合每天稳定发布。输入一个选题，系统自动补齐文案、字幕、配音和画面。",
    useCase: "日常更新、快速试题、稳定账号节奏",
    entry: "选题 / 文案 / 分镜",
    status: "ready",
    statusLabel: "可用",
    estimatedTime: "3-5 分钟",
    qualityPolicy: "基础质检",
    version: "v1.0",
    requiresAssets: false,
    assetRequirement: "不需要用户素材",
    inputRequirements: ["选题或文案", "账号语气", "目标平台"],
    fixedSettings: ["固定声音", "9:16 画幅", "自动字幕", "默认 BGM"],
    expectedOutputs: ["final.mp4", "旁白音频", "字幕文件", "素材清单"],
  },
  {
    id: "explainer",
    name: "PetWoods 高质量解释视频",
    shortName: "重点解释",
    description: "适合更重要的内容。系统会更重视结构、节奏和画面表现。",
    useCase: "重点科普、长尾内容、转化型解释",
    entry: "文案 / 分镜",
    status: "preview",
    statusLabel: "试点",
    estimatedTime: "8-12 分钟",
    qualityPolicy: "严格质检",
    version: "v0.3",
    requiresAssets: false,
    assetRequirement: "可选补充素材",
    inputRequirements: ["完整文案", "镜头重点", "目标时长"],
    fixedSettings: ["高质量合成", "严格黑屏检查", "字幕节奏增强", "重点词动画"],
    expectedOutputs: ["final.mp4", "合成报告", "质检摘要", "素材清单"],
  },
  {
    id: "asset",
    name: "PetWoods 素材增强视频",
    shortName: "用素材做",
    description: "已经有图片或视频时使用。系统负责组织素材、加字幕和包装成片。",
    useCase: "已有素材包装、商品/宠物素材复用",
    entry: "素材 + 文案",
    status: "needs-input",
    statusLabel: "需素材",
    estimatedTime: "5-8 分钟",
    qualityPolicy: "基础质检",
    version: "v0.2",
    requiresAssets: true,
    assetRequirement: "至少 1 张图片或 1 段视频",
    inputRequirements: ["用户素材", "文案或卖点", "素材用途"],
    fixedSettings: ["素材优先", "自动补字幕", "轻量剪辑计划", "统一画幅"],
    expectedOutputs: ["final.mp4", "素材使用清单", "旁白音频", "字幕文件"],
  },
  {
    id: "montage",
    name: "PetWoods 真实素材混剪",
    shortName: "真实素材混剪",
    description: "适合更真实的素材感视频。第一版优先使用你上传的真实素材。",
    useCase: "真实感内容、素材混剪、场景化科普",
    entry: "素材 + 主题",
    status: "needs-input",
    statusLabel: "需素材",
    estimatedTime: "6-10 分钟",
    qualityPolicy: "基础质检 + 素材追踪",
    version: "v0.1",
    requiresAssets: true,
    assetRequirement: "建议 3 段以上真实素材",
    inputRequirements: ["真实素材", "主题", "镜头顺序偏好"],
    fixedSettings: ["素材清单", "镜头计划", "BGM 包装", "转场规则"],
    expectedOutputs: ["final.mp4", "剪辑计划", "素材来源记录", "质检摘要"],
  },
]

export const seedAssets = [
  {
    name: "cat_behavior_clip_01.mp4",
    type: "source_video",
    duration: "00:12",
    status: "已校验",
  },
  {
    name: "petwoods_cover_frame.png",
    type: "source_image",
    duration: "封面",
    status: "已校验",
  },
  {
    name: "brand_bgm_soft_loop.wav",
    type: "bgm",
    duration: "00:45",
    status: "可用",
  },
]

export const recentTasks = [
  {
    title: "母猫配完还叫，是不是没配上？",
    template: "日常短视频",
    status: "已完成",
    quality: "通过",
    manifestCount: 7,
    finishedAt: "12 分钟前",
  },
  {
    title: "猫咪突然不吃饭，先看这 3 点",
    template: "高质量解释",
    status: "质检警告",
    quality: "需复查",
    manifestCount: 9,
    finishedAt: "昨天",
  },
]
