# 配置文件详解

`config.yaml` 配置文件的详细说明。

---

## 配置结构

```yaml
llm:
  api_key: "your-api-key"
  base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1"
  model: "qwen-plus"

comfyui:
  comfyui_url: "http://127.0.0.1:8188"
  comfyui_api_key: ""  # ComfyUI API 密钥（可选）
  runninghub_api_key: ""
  runninghub_concurrent_limit: 1  # 并发限制 (1-10)
  runninghub_instance_type: ""  # 实例类型（可选，设为 "plus" 使用 48GB 显存）
  
  image:
    default_workflow: "runninghub/image_flux.json"
    prompt_prefix: "Minimalist illustration style"
  
  video:
    default_workflow: "runninghub/video_wan2.1_fusionx.json"
    prompt_prefix: "Minimalist illustration style"
  
  tts:
    inference_mode: "local"  # local, comfyui, fish
    local:
      voice: "zh-CN-YunjianNeural"
      speed: 1.2
    comfyui:
      default_workflow: "selfhost/tts_edge.json"
    fish_audio:
      api_key: ""  # 也可以用 FISH_API_KEY 环境变量
      base_url: "https://api.fish.audio"
      model: "s2-pro"
      reference_id: null
      speed: 1.0
      format: "mp3"

template:
  default_template: "1080x1920/image_default.html"
```

---

## LLM 配置

- `api_key`: API 密钥
- `base_url`: API 服务地址（支持任何 OpenAI 兼容接口）
- `model`: 模型名称

---

## ComfyUI 配置

### 基础配置

- `comfyui_url`: 本地 ComfyUI 地址（默认 `http://127.0.0.1:8188`）
- `comfyui_api_key`: ComfyUI API 密钥（可选，用于 [Comfy Platform](https://platform.comfy.org/profile/api-keys)）

### RunningHub 云端配置

- `runninghub_api_key`: RunningHub API 密钥（使用云端工作流时必填）
- `runninghub_concurrent_limit`: 并发执行限制（1-10，普通会员默认为 1）
- `runninghub_instance_type`: 实例类型（可选）
  - 留空或不设置：使用 24GB 显存机器
  - `"plus"`: 使用 48GB 显存机器（适合大尺寸视频生成）

### 图像配置

- `default_workflow`: 默认图像生成工作流
- `prompt_prefix`: 提示词前缀

### 视频配置

- `default_workflow`: 默认视频生成工作流
  - `runninghub/video_wan2.1_fusionx.json`: 云端工作流（推荐，无需本地环境）
  - `selfhost/video_wan2.1_fusionx.json`: 本地工作流（需要本地 ComfyUI 支持）
- `prompt_prefix`: 视频提示词前缀（用于控制视频生成风格）

### TTS 配置

- `inference_mode`: TTS 合成方式，可选 `local`、`comfyui`、`fish`
- `local.voice`: Edge TTS 音色 ID
- `local.speed`: Edge TTS 语速倍率
- `comfyui.default_workflow`: ComfyUI TTS 工作流
- `fish_audio.api_key`: Fish Audio API Key；留空时读取 `FISH_API_KEY`
- `fish_audio.reference_id`: Fish Audio 声音模型 ID；留空时使用 Fish 默认音色
- `fish_audio.model`: Fish Audio 模型，推荐 `s2-pro`

---

## 模板配置

- `default_template`: 默认帧模板路径（例如 `1080x1920/image_default.html`）

---

## 更多信息

配置文件会自动在首次运行时创建。
