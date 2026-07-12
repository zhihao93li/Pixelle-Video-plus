import { frameTemplateLabel } from "./templateLabels.ts"

/**
 * 产线零件清单：把模板按管线步骤拆成零件，标注控制参数、可换性与人话取值。
 * 纯数据 + 纯函数，供 RecipeDetailPage 渲染、CreateGallery 卡片预览共用。
 * 值一律走人话映射，不出现内部 key（PRD §7.2 / §8.4）。
 */

export type PartStep = {
  label: string
  /** 控制该步骤的参数 key；null 表示项目级步骤（写稿）。 */
  controlKey: string | null
  /** 可换时跳转目标。 */
  link: "drafting" | "template"
  /** 产线固定步骤（结构性，不可换）。 */
  fixed?: boolean
  /** effective 无值时的兜底文案。 */
  fallback: string
  /**
   * 附属参数：归属这一步、但不是步骤主控 key 的可覆盖参数
   * （配方详情页折在步骤卡下渲染；渲染时按模板白名单过滤）。
   * 不在任何步骤 subKeys 里的白名单参数仍进「更多可调参数」兜底区。
   */
  subKeys?: string[]
}

export const PIPELINE_PARTS: Record<string, PartStep[]> = {
  standard: [
    {
      label: "写稿",
      controlKey: null,
      link: "drafting",
      fallback: "配方写稿设置（模型 / Prompt）",
    },
    {
      label: "分镜",
      controlKey: "split_mode",
      link: "template",
      fallback: "按段落切",
    },
    {
      label: "配音引擎",
      controlKey: "tts_inference_mode",
      link: "template",
      fallback: "本机 TTS",
      subKeys: ["tts_workflow", "tts_speed"],
    },
    {
      label: "音色",
      controlKey: "tts_voice",
      link: "template",
      fallback: "引擎默认音色",
    },
    {
      label: "每镜画面",
      controlKey: "image_provider",
      link: "template",
      fallback: "AI 生图默认 workflow",
      subKeys: [
        "image_model",
        "media_workflow",
        "frame_template",
        "media_width",
        "media_height",
        "prompt_prefix",
        "image_prompt_visual_context",
        "image_prompt_generation_rules",
      ],
    },
    {
      label: "合成",
      controlKey: "compose_runtime",
      link: "template",
      fallback: "标准合成",
      subKeys: ["bgm_path", "bgm_volume", "bgm_mode"],
    },
  ],
  asset_based: [
    {
      label: "素材来源",
      controlKey: null,
      link: "template",
      fixed: true,
      fallback: "你上传的图片 / 视频",
    },
    {
      label: "配音",
      controlKey: "voice_id",
      link: "template",
      fallback: "默认音色",
      subKeys: ["tts_speed"],
    },
    {
      label: "合成",
      controlKey: "compose_runtime",
      link: "template",
      fallback: "标准合成",
      subKeys: ["bgm_path", "bgm_volume", "bgm_mode"],
    },
    {
      label: "算力",
      controlKey: "source",
      link: "template",
      fallback: "RunningHub 云端",
    },
  ],
  i2v: [
    {
      label: "输入",
      controlKey: null,
      link: "template",
      fixed: true,
      fallback: "一张图片 + 运动提示词",
    },
    {
      label: "运动 workflow",
      controlKey: "workflow_key",
      link: "template",
      fallback: "默认图生视频 workflow",
    },
    {
      label: "算力",
      controlKey: "source",
      link: "template",
      fallback: "RunningHub 云端",
    },
  ],
  action_transfer: [
    {
      label: "输入",
      controlKey: null,
      link: "template",
      fixed: true,
      fallback: "参考视频 + 人物图",
    },
    {
      label: "动作 workflow",
      controlKey: "workflow_key",
      link: "template",
      fallback: "默认动作迁移 workflow",
    },
    {
      label: "算力",
      controlKey: "source",
      link: "template",
      fallback: "RunningHub 云端",
    },
  ],
  digital_human: [
    {
      label: "输入",
      controlKey: null,
      link: "template",
      fixed: true,
      fallback: "人物形象 + 口播文案",
    },
    {
      label: "配音引擎",
      controlKey: "tts_inference_mode",
      link: "template",
      fallback: "默认引擎",
      subKeys: ["tts_workflow", "tts_speed"],
    },
    {
      label: "音色",
      controlKey: "tts_voice",
      link: "template",
      fallback: "默认音色",
    },
    {
      label: "数字人 workflow",
      controlKey: "workflow_key",
      link: "template",
      fallback: "默认数字人 workflow",
    },
  ],
  image_post: [
    {
      label: "写稿",
      controlKey: null,
      link: "drafting",
      fallback: "配方写稿设置（模型 / Prompt）",
    },
    {
      label: "分页",
      controlKey: "split_mode",
      link: "template",
      fallback: "按行分页",
    },
    {
      label: "每页配图",
      controlKey: "image_provider",
      link: "template",
      fallback: "AI 生图默认 workflow",
      subKeys: [
        "image_model",
        "media_workflow",
        "media_width",
        "media_height",
        "prompt_prefix",
        "image_prompt_visual_context",
        "image_prompt_generation_rules",
      ],
    },
    {
      label: "版式",
      controlKey: "frame_template",
      link: "template",
      fallback: "默认图文版式",
    },
    // 排版渲染即成图，无视频合成——合成步骤对图文线不适用（固定）
    {
      label: "成图",
      controlKey: null,
      link: "template",
      fixed: true,
      fallback: "版式渲染出 PNG 图集",
    },
  ],
  long_form: [
    {
      label: "写稿",
      controlKey: null,
      link: "drafting",
      fallback: "配方写稿设置（模型 / Prompt）",
    },
    {
      label: "长文改写",
      controlKey: "long_form_prompt",
      link: "template",
      fallback: "内置中性长文提示词",
    },
    {
      label: "字数",
      controlKey: "word_count",
      link: "template",
      fallback: "1800 字",
    },
    {
      label: "写作模型",
      controlKey: "llm_model",
      link: "template",
      fallback: "系统默认模型",
    },
  ],
}

const VALUE_LABELS: Record<string, string> = {
  html_ffmpeg: "标准合成",
  hyperframes: "高质量动效合成",
  paragraph: "按段落切",
  line: "按行直出",
  selfhost: "本机 ComfyUI",
  runninghub: "RunningHub 云端",
  local: "本机 TTS",
  fish: "Fish Audio",
  comfyui: "ComfyUI TTS",
  loop: "循环播放",
  once: "播放一次",
}

export function humanizePartValue(value: unknown, fallback: string): string {
  if (value == null || value === "") {
    return fallback
  }
  const text = String(value)
  if (text.endsWith(".html")) {
    return frameTemplateLabel(text)
  }
  return VALUE_LABELS[text] ?? text
}

/** 该管线的零件步骤标签（用于卡片上的一行预览）。 */
export function pipelinePartsPreview(pipelineId: string): string {
  const steps = PIPELINE_PARTS[pipelineId]
  if (!steps) {
    return ""
  }
  return steps.map((step) => step.label).join(" · ")
}

/** 就地编辑：已知枚举零件的选项（value 为内部值，label 为人话）。 */
export const PART_EDIT_OPTIONS: Record<
  string,
  { value: string; label: string }[]
> = {
  split_mode: [
    { value: "paragraph", label: "按段落切" },
    { value: "line", label: "按行直出" },
  ],
  source: [
    { value: "selfhost", label: "本机 ComfyUI" },
    { value: "runninghub", label: "RunningHub 云端" },
  ],
  tts_inference_mode: [
    { value: "local", label: "本机 TTS" },
    { value: "fish", label: "Fish Audio" },
    { value: "comfyui", label: "ComfyUI TTS" },
  ],
  compose_runtime: [
    { value: "html_ffmpeg", label: "标准合成" },
    { value: "hyperframes", label: "高质量动效合成" },
  ],
  bgm_mode: [
    { value: "loop", label: "循环播放" },
    { value: "once", label: "播放一次" },
  ],
}

/** 全部可覆盖参数的人话名——「更多可调参数」兜底区用（凡白名单有而产线图没画的，自动出现在那里，杜绝漏登记）。 */
export const PART_KEY_LABELS: Record<string, string> = {
  split_mode: "内容拆分方式",
  frame_template: "画面模板",
  media_workflow: "每镜画面 workflow",
  image_provider: "图片 Provider",
  image_model: "图片模型",
  media_width: "画面宽度",
  media_height: "画面高度",
  prompt_prefix: "生图提示词前缀",
  image_prompt_visual_context: "生图视觉风格说明",
  image_prompt_generation_rules: "生图规则说明",
  bgm_path: "背景音乐文件",
  bgm_volume: "背景音乐音量",
  bgm_mode: "背景音乐播放方式",
  tts_inference_mode: "配音引擎",
  tts_workflow: "配音 workflow",
  tts_voice: "音色",
  tts_speed: "语速",
  source: "算力执行端",
  workflow_key: "workflow 文件",
  compose_runtime: "合成方式",
  long_form_prompt: "长文提示词",
  word_count: "目标字数",
  llm_model: "写作模型",
}

/** 就地编辑：零件填写提示（不同引擎/格式的填法说明）。 */
export const PART_EDIT_HINTS: Record<string, string> = {
  tts_voice:
    "本机 TTS 填系统音色名（如 zh-CN-YunjianNeural）；Fish Audio 填你的 reference_id。",
  media_workflow: "填 workflow 文件相对路径；runninghub/ 开头表示走云端。",
  image_provider: "选择 RunningHub / ComfyUI、阿里百炼或火山方舟。",
  image_model: "由所选图片 Provider 提供的模型标识。",
  workflow_key: "填 workflows/ 目录下的相对路径；填错会提示可用文件列表。",
  compose_runtime:
    "动效合成（hyperframes）依赖本机 Node 环境（npx），渲染更慢但动效更丰富；本机没装 Node 时保存会被拦下。",
  long_form_prompt:
    "多行提示词。占位符：{script}（必需，注入确认稿）、{title}、{language}、{word_count}。缺 {script} 保存会被拦下。",
}

/** 就地编辑：多行文本参数（用 Textarea 而非单行 Input 编辑）。 */
export const PART_LONG_TEXT_KEYS = new Set([
  "long_form_prompt",
  "prompt_prefix",
  "image_prompt_visual_context",
  "image_prompt_generation_rules",
])

/** 就地编辑：数值型零件（保存前转 Number）。 */
export const PART_NUMBER_KEYS = new Set([
  "tts_speed",
  "bgm_volume",
  "media_width",
  "media_height",
  "word_count",
])
