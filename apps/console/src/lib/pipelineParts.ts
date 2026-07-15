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
  title: "成品标题",
  script_template_name: "写稿提示词",
  script_prompt: "写稿提示词正文",
  script_model: "写稿模型",
  script_provider_id: "写稿 LLM 服务",
  language_script_models: "多语言模型覆盖",
  split_template_name: "分镜提示词",
  split_prompt: "分镜提示词正文",
  split_model: "分镜模型",
  split_provider_id: "分镜 LLM 服务",
  split_mode: "内容拆分方式",
  frame_template: "画面模板",
  template_params: "模板排版参数",
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
  voice_id: "声音",
  tts_speed: "语速",
  ref_audio: "参考音频",
  source: "算力执行端",
  workflow_key: "workflow 文件",
  compose_runtime: "合成方式",
  long_form_prompt: "长文提示词",
  word_count: "目标字数",
  llm_model: "写作模型",
  llm_provider_id: "写作 LLM 服务",
}

/** 就地编辑：零件填写提示（不同引擎/格式的填法说明）。 */
export const PART_EDIT_HINTS: Record<string, string> = {
  script_template_name: "提示词决定 AI 如何把主题写成完整文案，可选择已有版本或当场编辑。",
  script_model: "留空使用系统默认模型。",
  language_script_models: "按语言分别选择真实的 LLM 服务和模型。",
  split_template_name: "提示词决定分镜 LLM 如何判断内容转折、画面变化和节奏，可选择已有版本或当场编辑。",
  split_model: "留空使用系统默认模型；分镜数量不需要手动填写。",
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
