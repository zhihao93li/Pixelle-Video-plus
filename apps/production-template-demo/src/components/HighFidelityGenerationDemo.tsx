import { useEffect, useMemo, useState } from "react"
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  FolderOpen,
  Info,
  LayoutDashboard,
  List,
  Loader2,
  Music2,
  Play,
  RefreshCcw,
  Scissors,
  Settings,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Video,
  WandSparkles,
} from "lucide-react"

import { InlineError } from "@/components/shared/feedback"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Slider } from "@/components/ui/slider"
import { useToast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { readableError, voiceLabel } from "@/lib/format"
import {
  createGenerationTemplateTask,
  getTemplateGenerationConfig,
  isTerminalStatus,
  listResourceBgm,
  listTemplates,
  type ProductionTemplate,
  type ResourceBgm,
} from "@/lib/generationApi"
import { useCurrentProject } from "@/lib/currentProject"
import { useLocalStorageState } from "@/lib/useLocalStorageState"
import { useTaskCenter } from "@/lib/taskCenter"
import { cn } from "@/lib/utils"

const DEFAULT_TEMPLATE_ID = "pipeline_standard_base_v1"

const SAMPLE_SCRIPT = `你有没有发现，猫咪一闻到猫薄荷就会兴奋、打滚、流口水？

其实这是因为猫薄荷中含有一种叫荆芥内酯的成分，它会刺激猫咪鼻腔里的受体，并通过神经传递到大脑的“快乐中枢”，让猫咪产生愉悦反应。

这种反应通常会持续 5–15 分钟，之后猫咪会进入一段“冷却期”，短时间内对猫薄荷不再敏感。并不是所有猫都会有反应，大约三成猫天生对它不感兴趣，这属于正常现象。

给猫咪使用猫薄荷时要注意适量：可以在猫抓板、玩具或睡垫上撒一点，每周 2–3 次即可，避免频繁使用导致效果减弱。

另外，幼猫、怀孕或患有呼吸道疾病的猫咪不建议使用。猫薄荷可以为猫咪的生活增添乐趣，但更重要的是，陪伴和互动才是它们真正需要的快乐来源。`

type LoadState = "loading" | "ready" | "error"
type SplitMode = "paragraph" | "line" | "sentence"

type DemoSettings = {
  title: string
  splitMode: SplitMode
  frameTemplate: string
  ttsVoice: string
  ttsSpeed: number
  bgmPath: string
  bgmVolume: number
  bgmMode: "loop" | "once"
}

const DEFAULT_SETTINGS: DemoSettings = {
  title: "",
  splitMode: "paragraph",
  frameTemplate: "1080x1920/image_default.html",
  ttsVoice: "zh-CN-YunjianNeural",
  ttsSpeed: 1,
  bgmPath: "",
  bgmVolume: 0.2,
  bgmMode: "loop",
}

const FRAME_STYLE_LABELS: Record<string, string> = {
  "1080x1920/image_default.html": "清爽图文",
  "1080x1920/image_healing.html": "治愈留白",
  "1080x1920/image_blur_card.html": "杂志卡片",
}

const VOICE_OPTIONS = [
  { value: "zh-CN-YunjianNeural", label: "云健" },
  { value: "zh-CN-XiaoxiaoNeural", label: "晓晓" },
  { value: "zh-CN-YunxiNeural", label: "云希" },
]

const SCENE_ASSETS = [
  "/demo/cat-catnip.jpg",
  "/demo/catnip-flower.jpg",
  "/demo/relaxed-cat.jpg",
]

const SCENE_FALLBACKS = [
  "猫咪闻到猫薄荷后出现打滚、蹭脸等愉悦反应。",
  "介绍猫薄荷的成分与作用原理，以及反应持续时间。",
  "讲解安全使用建议与频率，强调陪伴和互动更重要。",
]

const NAV_ITEMS = [
  { href: "#/board", label: "工作台", icon: LayoutDashboard },
  { href: "#/demo/studio", label: "制作视频", icon: WandSparkles },
  { href: "#/library", label: "作品库", icon: FolderOpen },
  { href: "#/settings", label: "设置", icon: Settings },
]

function activeVideoTemplates(templates: ProductionTemplate[]) {
  return templates.filter(
    (template) =>
      template.enabled &&
      !template.retired &&
      template.product_entry === "generate" &&
      template.input_requirements.includes("script") &&
      !template.requires_user_assets &&
      template.pipeline_id === "standard"
  )
}

function stringSetting(value: unknown, fallback: string) {
  return typeof value === "string" && value ? value : fallback
}

function numberSetting(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function applyEffectiveSettings(
  current: DemoSettings,
  effective: Record<string, unknown>
): DemoSettings {
  const splitMode = effective.split_mode
  return {
    ...current,
    splitMode:
      splitMode === "line" || splitMode === "sentence" || splitMode === "paragraph"
        ? splitMode
        : current.splitMode,
    frameTemplate: stringSetting(effective.frame_template, current.frameTemplate),
    ttsVoice: stringSetting(effective.tts_voice, current.ttsVoice),
    ttsSpeed: numberSetting(effective.tts_speed, current.ttsSpeed),
    bgmPath: stringSetting(effective.bgm_path, current.bgmPath),
    bgmVolume: numberSetting(effective.bgm_volume, current.bgmVolume),
    bgmMode: effective.bgm_mode === "once" ? "once" : "loop",
  }
}

function buildTaskInput(script: string, settings: DemoSettings) {
  return Object.fromEntries(
    Object.entries({
      script: script.trim(),
      title: settings.title.trim() || undefined,
      split_mode: settings.splitMode,
      frame_template: settings.frameTemplate,
      tts_inference_mode: "local",
      tts_voice: settings.ttsVoice.trim(),
      tts_speed: settings.ttsSpeed,
      bgm_path: settings.bgmPath || undefined,
      bgm_volume: settings.bgmVolume,
      bgm_mode: settings.bgmMode,
    }).filter(([, value]) => value !== "" && value != null)
  )
}

function splitPreviewText(text: string, mode: SplitMode) {
  const trimmed = text.trim()
  if (!trimmed) {
    return SCENE_FALLBACKS
  }

  const chunks =
    mode === "paragraph"
      ? trimmed.split(/\n\s*\n/)
      : mode === "line"
        ? trimmed.split(/\n+/)
        : trimmed.split(/(?<=[。！？!?])/)

  const useful = chunks
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
  const selected = useful.length >= 3 ? useful : [...useful, ...SCENE_FALLBACKS]
  return selected.slice(0, 3)
}

function frameStyleLabel(frameTemplate: string) {
  return FRAME_STYLE_LABELS[frameTemplate] ?? "自定义画面"
}

export function HighFidelityGenerationDemo() {
  const toast = useToast()
  const taskCenter = useTaskCenter()
  const { project, projectId, projects, setProjectId } = useCurrentProject()
  const [script, setScript] = useLocalStorageState(
    "pixelle-hifi-demo-script",
    SAMPLE_SCRIPT
  )
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState("")
  const [bgmOptions, setBgmOptions] = useState<ResourceBgm[]>([])
  const [settings, setSettings] = useState<DemoSettings>(DEFAULT_SETTINGS)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [styleOpen, setStyleOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)

  const selectableTemplates = useMemo(() => activeVideoTemplates(templates), [templates])
  const selectedTemplate =
    selectableTemplates.find((template) => template.id === selectedTemplateId) ??
    null
  const trackedTask = currentTaskId
    ? (taskCenter.getTask(currentTaskId)?.task ?? null)
    : null
  const taskRunning = Boolean(trackedTask && !isTerminalStatus(trackedTask.status))
  const scenes = useMemo(
    () => splitPreviewText(script, settings.splitMode),
    [script, settings.splitMode]
  )

  useEffect(() => {
    let cancelled = false

    void Promise.all([listTemplates(projectId ?? undefined), listResourceBgm()])
      .then(([templateResponse, bgmResponse]) => {
        if (cancelled) {
          return
        }
        const available = activeVideoTemplates(templateResponse.templates)
        const defaultId =
          available.find((item) => item.id === templateResponse.default_template)?.id ??
          available.find((item) => item.id === DEFAULT_TEMPLATE_ID)?.id ??
          available[0]?.id ??
          ""
        setTemplates(templateResponse.templates)
        setSelectedTemplateId((current) =>
          available.some((item) => item.id === current) ? current : defaultId
        )
        setBgmOptions(bgmResponse.bgm_files)
        setLoadError(null)
        setLoadState("ready")
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(readableError(error))
          setLoadState("error")
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    if (!selectedTemplateId) {
      return
    }
    let cancelled = false
    void getTemplateGenerationConfig(selectedTemplateId)
      .then((response) => {
        if (!cancelled) {
          setSettings((current) =>
            applyEffectiveSettings(current, response.effective_params)
          )
        }
      })
      .catch(() => {
        // 配方默认读取失败不阻断 Demo；提交仍使用界面当前值。
      })
    return () => {
      cancelled = true
    }
  }, [selectedTemplateId])

  async function submitGeneration() {
    if (!selectedTemplate || !script.trim() || isSubmitting || taskRunning) {
      return
    }
    if (trackedTask?.status === "completed") {
      window.location.hash = `/library?task=${trackedTask.task_id}`
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const response = await createGenerationTemplateTask(
        selectedTemplate.id,
        buildTaskInput(script, settings),
        {
          source: "react_hifi_demo",
          template_use_case: selectedTemplate.use_case,
        },
        projectId ?? undefined
      )
      taskCenter.trackTask(response.task, selectedTemplate.display_name)
      setCurrentTaskId(response.task.task_id)
      toast({
        title: "生成任务已创建",
        description: "可以留在这里查看进度，也可以前往任务页。",
        variant: "success",
      })
    } catch (error) {
      setSubmitError(readableError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const activeProjects = projects.filter((item) => item.status === "active")
  const styleSummary = `竖版 9:16 · ${voiceLabel(settings.ttsVoice)}配音 · ${frameStyleLabel(
    settings.frameTemplate
  )}`
  const progress = trackedTask?.progress.percentage ?? 0
  const buttonLabel = isSubmitting
    ? "正在提交…"
    : trackedTask?.status === "completed"
      ? "查看作品"
      : taskRunning
        ? `生成中 ${Math.round(progress)}%`
        : "生成视频"

  return (
    <div className="min-h-svh bg-background text-foreground">
      <div className="flex min-h-svh">
        <aside className="sticky top-0 hidden h-svh w-56 shrink-0 flex-col border-r bg-sidebar md:flex">
          <div className="flex h-[68px] items-center gap-2 px-5 text-lg font-semibold">
            <Video className="size-5 text-primary" />
            <span>Pixelle</span>
          </div>

          <div className="px-3 pb-5">
            <Select
              onValueChange={setProjectId}
              value={projectId ?? undefined}
            >
              <SelectTrigger aria-label="切换项目" className="h-10 w-full bg-background px-3">
                <SelectValue placeholder="选择项目">
                  {project?.name ?? "选择项目"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {activeProjects.map((item) => (
                  <SelectItem key={item.project_id} value={item.project_id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <nav aria-label="Demo 主导航" className="flex flex-col gap-1 px-2">
            {NAV_ITEMS.map((item) => {
              const active = item.href === "#/demo/studio"
              return (
                <a
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                  href={item.href}
                  key={item.href}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </a>
              )
            })}
          </nav>

          <div className="mt-auto border-t px-4 py-4">
            <div className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <UserRound className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">创作者</span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur md:static">
            <div className="flex min-h-[68px] flex-wrap items-center gap-3 px-4 py-3 lg:px-5">
              <div className="flex items-center gap-2 md:hidden">
                <Video className="size-5 text-primary" />
                <span className="font-semibold">Pixelle</span>
              </div>
              <h1 className="mr-1 text-xl font-semibold tracking-tight md:text-2xl">
                制作视频
              </h1>
              <Select
                disabled={loadState !== "ready"}
                onValueChange={(value) => {
                  setSelectedTemplateId(value)
                  setSubmitError(null)
                  setCurrentTaskId(null)
                }}
                value={selectedTemplateId || undefined}
              >
                <SelectTrigger aria-label="选择配方" className="h-10 w-[210px] px-3">
                  <SelectValue placeholder="读取配方中…" />
                </SelectTrigger>
                <SelectContent>
                  {selectableTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="ml-auto flex items-center gap-3">
                <div className="hidden text-sm text-muted-foreground lg:block">
                  {taskRunning
                    ? trackedTask?.progress.message || "正在生成"
                    : `预计 ${selectedTemplate?.estimated_turnaround || "约 2 分钟"}`}
                </div>
                <Button
                  className="h-10 min-w-28 px-5"
                  disabled={
                    !script.trim() ||
                    !selectedTemplate ||
                    isSubmitting ||
                    taskRunning
                  }
                  onClick={() => void submitGeneration()}
                  size="lg"
                >
                  {isSubmitting || taskRunning ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : trackedTask?.status === "completed" ? (
                    <Check data-icon="inline-start" />
                  ) : (
                    <Play data-icon="inline-start" />
                  )}
                  {buttonLabel}
                </Button>
              </div>
            </div>
            {taskRunning && <Progress value={progress} />}
          </header>

          <main className="grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.82fr)] lg:gap-5 lg:p-5">
            <section className="flex min-w-0 flex-col gap-3">
              {loadError && <InlineError title="配方读取失败" message={loadError} />}
              {submitError && <InlineError title="提交失败" message={submitError} />}

              <div className="flex min-h-[650px] flex-1 flex-col overflow-hidden rounded-lg border bg-background">
                <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
                  <h2 className="text-sm font-semibold">视频文案</h2>
                  <span className="text-xs text-muted-foreground">自动保存</span>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                  <ToggleGroup
                    aria-label="文案拆分方式"
                    onValueChange={(value) => {
                      if (value) {
                        setSettings((current) => ({
                          ...current,
                          splitMode: value as SplitMode,
                        }))
                      }
                    }}
                    spacing={0}
                    type="single"
                    value={settings.splitMode}
                    variant="outline"
                  >
                    <ToggleGroupItem aria-label="按段落拆分" value="paragraph">
                      <FileText />
                      按段落
                    </ToggleGroupItem>
                    <ToggleGroupItem aria-label="按行拆分" value="line">
                      <List />
                      按行
                    </ToggleGroupItem>
                    <ToggleGroupItem aria-label="按句子拆分" value="sentence">
                      <Scissors />
                      按句子
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      onClick={() => setScript(SAMPLE_SCRIPT)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Sparkles data-icon="inline-start" />
                      填入示例
                    </Button>
                    <Button
                      aria-label="清空文案"
                      onClick={() => setScript("")}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <RefreshCcw />
                    </Button>
                  </div>
                </div>

                <div className="relative flex min-h-0 flex-1 flex-col p-4">
                  <label className="sr-only" htmlFor="hifi-demo-script">
                    视频文案
                  </label>
                  <textarea
                    autoComplete="off"
                    className="min-h-[490px] flex-1 resize-none bg-transparent text-[15px] leading-8 text-foreground outline-none placeholder:text-muted-foreground"
                    id="hifi-demo-script"
                    maxLength={5000}
                    onChange={(event) => setScript(event.target.value)}
                    placeholder="粘贴或输入完整视频文案…"
                    value={script}
                  />
                  <span className="mt-2 self-end text-xs tabular-nums text-muted-foreground">
                    {script.length}/5000
                  </span>
                </div>
              </div>

              <button
                className="flex min-h-14 items-center gap-3 rounded-lg border bg-background px-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => setStyleOpen(true)}
                type="button"
              >
                <SlidersHorizontal className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{styleSummary}</span>
                <span className="text-sm font-medium text-primary">调整</span>
                <ChevronRight className="size-4 text-primary" />
              </button>

              <div className="rounded-lg border bg-background">
                <button
                  aria-expanded={advancedOpen}
                  className="flex min-h-12 w-full items-center justify-between px-4 text-left text-sm font-medium transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
                  onClick={() => setAdvancedOpen((current) => !current)}
                  type="button"
                >
                  高级设置
                  <ChevronDown
                    className={cn(
                      "size-4 text-muted-foreground transition-transform",
                      advancedOpen && "rotate-180"
                    )}
                  />
                </button>
                {advancedOpen && (
                  <div className="grid gap-4 border-t p-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1.5 text-sm font-medium">
                      标题
                      <Input
                        autoComplete="off"
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            title: event.target.value,
                          }))
                        }
                        placeholder="留空自动使用文案首行…"
                        value={settings.title}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-sm font-medium">
                      背景音乐播放方式
                      <Select
                        onValueChange={(value) =>
                          setSettings((current) => ({
                            ...current,
                            bgmMode: value as "loop" | "once",
                          }))
                        }
                        value={settings.bgmMode}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="loop">循环播放</SelectItem>
                          <SelectItem value="once">播放一次</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                )}
              </div>
            </section>

            <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-background">
              <div className="flex min-h-12 items-center justify-between border-b px-4">
                <h2 className="text-sm font-semibold">分镜预览</h2>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Info className="size-3.5" />
                  生成后可能调整
                </div>
              </div>

              <div className="flex flex-1 flex-col px-4">
                {scenes.map((scene, index) => (
                  <article
                    className="grid flex-1 grid-cols-[minmax(150px,0.92fr)_minmax(0,1fr)] gap-4 border-b py-4 last:border-0 xl:grid-cols-[minmax(190px,0.95fr)_minmax(0,1fr)]"
                    key={SCENE_ASSETS[index]}
                  >
                    <img
                      alt={
                        index === 0
                          ? "猫咪闻猫薄荷的预估分镜"
                          : index === 1
                            ? "猫薄荷植株特写的预估分镜"
                            : "居家猫咪的预估分镜"
                      }
                      className="aspect-[4/3] h-full max-h-56 w-full rounded-lg object-cover"
                      height={1086}
                      loading={index === 0 ? "eager" : "lazy"}
                      src={SCENE_ASSETS[index]}
                      width={1448}
                    />
                    <div className="flex min-w-0 flex-col py-1">
                      <h3 className="text-sm font-semibold">场景 {index + 1}</h3>
                      <p className="mt-3 line-clamp-4 text-sm leading-7 text-muted-foreground">
                        {scene}
                      </p>
                      <div className="mt-auto flex items-center gap-1.5 pt-3 text-xs text-muted-foreground">
                        <Clock3 className="size-3.5" />
                        约 15 秒
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </main>

          <nav
            aria-label="移动端 Demo 导航"
            className="sticky bottom-0 z-30 grid grid-cols-4 border-t bg-background/95 px-2 py-1 backdrop-blur md:hidden"
          >
            {NAV_ITEMS.map((item) => (
              <a
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg py-2 text-xs",
                  item.href === "#/demo/studio"
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
                href={item.href}
                key={item.href}
              >
                <item.icon className="size-4" />
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </div>

      <Sheet onOpenChange={setStyleOpen} open={styleOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>调整本次风格</SheetTitle>
            <SheetDescription>
              这些设置只影响这一次生成，不会修改配方默认值。
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-6 px-4">
            <label className="flex flex-col gap-2 text-sm font-medium">
              画面风格
              <Select
                onValueChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    frameTemplate: value,
                  }))
                }
                value={settings.frameTemplate}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FRAME_STYLE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium">
              配音
              <Select
                onValueChange={(value) =>
                  setSettings((current) => ({ ...current, ttsVoice: value }))
                }
                value={settings.ttsVoice}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_OPTIONS.map((voice) => (
                    <SelectItem key={voice.value} value={voice.value}>
                      {voice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium">
              <span className="flex items-center justify-between">
                <span>语速</span>
                <span className="font-normal tabular-nums text-muted-foreground">
                  {settings.ttsSpeed.toFixed(1)}x
                </span>
              </span>
              <Slider
                max={1.5}
                min={0.7}
                onValueChange={([value]) =>
                  setSettings((current) => ({
                    ...current,
                    ttsSpeed: value ?? 1,
                  }))
                }
                step={0.1}
                value={[settings.ttsSpeed]}
              />
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium">
              <span className="flex items-center gap-2">
                <Music2 className="size-4 text-muted-foreground" />
                背景音乐
              </span>
              <Select
                onValueChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    bgmPath: value === "__none__" ? "" : value,
                  }))
                }
                value={settings.bgmPath || "__none__"}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不使用背景音乐</SelectItem>
                  {bgmOptions.map((bgm) => (
                    <SelectItem key={bgm.path} value={bgm.path}>
                      {bgm.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <SheetFooter>
            <Button onClick={() => setStyleOpen(false)}>应用本次设置</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
