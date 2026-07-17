import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  FolderKanban,
  Gauge,
  Images,
  Loader2,
  Mic2,
  PanelsTopLeft,
  FileText,
  Plus,
  RefreshCw,
  Save,
  Send,
} from "lucide-react"

import { HelpWorkspace } from "@/components/HelpWorkspace"
import { ProjectsPanel } from "@/components/ProjectsPanel"
import { UnsavedChangesGuard } from "@/components/settings/UnsavedChangesGuard"
import { ImageProviderSettings } from "@/components/settings/ImageProviderSettings"
import { PromptLibraryPanel } from "@/components/settings/PromptLibraryPanel"
import { LlmProviderSettings } from "@/components/settings/LlmProviderSettings"
import { AsyncState } from "@/components/shared/AsyncState"
import { InlineError } from "@/components/shared/feedback"
import { PageFrame } from "@/components/shared/PageFrame"
import { WorkspaceHeader } from "@/components/shared/WorkspaceHeader"
import { TemplateStatusPanel } from "@/components/TemplateStatusPanel"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/toast"
import { setExpertMode, useExpertMode } from "@/lib/expertMode"
import { readableError } from "@/lib/format"
import { parsePath, routeHref, usePath } from "@/lib/router"
import {
  resolveSettingsLocation,
  settingsLink,
  type SettingsView,
} from "@/lib/settingsLinks"
import { cn } from "@/lib/utils"
import {
  addRunninghubWorkflow,
  fetchBufferChannels,
  getSettingsDiagnostics,
  getSettingsConfig,
  listRunninghubWorkflows,
  listResourceBgm,
  listResourceMediaWorkflows,
  listResourceTemplates,
  listResourceTtsWorkflows,
  resetSettingsConfig,
  testComfyuiConnection,
  updateSettingsConfig,
  type AppSettingsConfig,
  type BufferChannel,
  type ResourceBgm,
  type ResourceTemplate,
  type ResourceWorkflow,
  type RunninghubWorkflow,
  type SettingsConfigUpdate,
  type SettingsDiagnosticCheck,
} from "@/lib/generationApi"

type LoadState = "loading" | "ready" | "error" | "stale"

const platformLabels = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  x: "X",
  pinterest: "Pinterest",
}

type ActionState = "idle" | "loading" | "testing" | "saving"
type WorkflowKind = "video" | "image" | "tts"
type SaveSection = "visual-generation" | "tts" | "publish-storage"

type SettingsNavItem = {
  view: SettingsView
  label: string
  description: string
  icon: typeof Gauge
}

const SETTINGS_NAV_GROUPS: Array<{
  label: string
  items: SettingsNavItem[]
}> = [
  {
    label: "准备情况",
    items: [
      {
        view: "overview",
        label: "概览",
        description: "缺什么、去哪里处理",
        icon: Gauge,
      },
    ],
  },
  {
    label: "工作空间",
    items: [
      {
        view: "projects",
        label: "内容空间",
        description: "账号、品牌与内容方向",
        icon: FolderKanban,
      },
    ],
  },
  {
    label: "服务连接",
    items: [
      {
        view: "llm",
        label: "AI 大模型",
        description: "写稿、分镜与内容理解",
        icon: Bot,
      },
      {
        view: "visual-generation",
        label: "图片与视频生成",
        description: "画面服务、工作流与算力",
        icon: Images,
      },
      {
        view: "tts",
        label: "语音生成（TTS）",
        description: "配音服务、模型与音色",
        icon: Mic2,
      },
      {
        view: "publish-storage",
        label: "发布与存储",
        description: "平台账号与文件存储",
        icon: Send,
      },
    ],
  },
  {
    label: "生产规则",
    items: [
      {
        view: "recipes",
        label: "模板",
        description: "长期生产默认设置",
        icon: PanelsTopLeft,
      },
      {
        view: "prompts",
        label: "提示词库",
        description: "写稿与分镜规则",
        icon: FileText,
      },
    ],
  },
  {
    label: "支持",
    items: [
      {
        view: "help",
        label: "帮助与诊断",
        description: "操作说明与故障恢复",
        icon: CircleHelp,
      },
    ],
  },
]

export function SettingsWorkspace() {
  const toast = useToast()
  const expertMode = useExpertMode()
  const path = usePath()
  const { query } = parsePath(path)
  const location = resolveSettingsLocation(query)
  const activeView = location.view
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [settings, setSettings] = useState<AppSettingsConfig | null>(null)
  const [savedSettings, setSavedSettings] = useState<AppSettingsConfig | null>(
    null
  )
  const [configured, setConfigured] = useState(false)
  const [diagnostics, setDiagnostics] = useState<SettingsDiagnosticCheck[]>([])
  const [diagnosticsOk, setDiagnosticsOk] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [savingSection, setSavingSection] = useState<SaveSection | null>(null)
  const [isResetting, setIsResetting] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(true)
  const [resourceState, setResourceState] = useState<{
    bgm: ResourceBgm[]
    frameTemplates: ResourceTemplate[]
    mediaWorkflows: ResourceWorkflow[]
    ttsWorkflows: ResourceWorkflow[]
  }>({
    bgm: [],
    frameTemplates: [],
    mediaWorkflows: [],
    ttsWorkflows: [],
  })
  const [resourceError, setResourceError] = useState<string | null>(null)
  const [comfyActionState, setComfyActionState] = useState<ActionState>("idle")
  const [comfyStatus, setComfyStatus] = useState<{
    ok: boolean
    message: string
  } | null>(null)
  const [runninghubWorkflows, setRunninghubWorkflows] = useState<
    RunninghubWorkflow[]
  >([])
  const [runninghubDraft, setRunninghubDraft] = useState<{
    kind: WorkflowKind
    name: string
    workflowId: string
    overwrite: boolean
  }>({
    kind: "video",
    name: "",
    workflowId: "",
    overwrite: false,
  })
  const [runninghubActionState, setRunninghubActionState] =
    useState<ActionState>("idle")
  const [runninghubStatus, setRunninghubStatus] = useState<{
    ok: boolean
    message: string
  } | null>(null)
  const [bufferActionState, setBufferActionState] =
    useState<ActionState>("idle")
  const [bufferStatus, setBufferStatus] = useState<{
    ok: boolean
    message: string
  } | null>(null)
  const [bufferChannels, setBufferChannels] = useState<BufferChannel[]>([])

  useEffect(() => {
    if (location.needsNormalization && path !== location.canonicalPath) {
      replaceHashPath(location.canonicalPath)
    }
  }, [location.canonicalPath, location.needsNormalization, path])

  useEffect(() => {
    const targetId =
      activeView === "recipes" ? location.template : location.focus
    if (!targetId) {
      return
    }
    let cancelled = false
    let timer: number | undefined
    let attempts = 0
    const HIGHLIGHT = ["ring-2", "ring-primary/40"]
    function attempt() {
      if (cancelled) {
        return
      }
      const element = document.getElementById(targetId as string)
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" })
        element.classList.add(...HIGHLIGHT)
        timer = window.setTimeout(
          () => element.classList.remove(...HIGHLIGHT),
          1500
        )
        return
      }
      attempts += 1
      if (attempts < 15) {
        // 目标可能还在异步加载（设置/模板列表），短暂重试
        timer = window.setTimeout(attempt, 200)
      }
    }
    timer = window.setTimeout(attempt, 80)
    return () => {
      cancelled = true
      if (timer) {
        window.clearTimeout(timer)
      }
    }
  }, [activeView, location.focus, location.template])

  async function refreshDiagnostics() {
    try {
      const response = await getSettingsDiagnostics()
      setDiagnostics(response.checks)
      setDiagnosticsOk(response.ok)
    } catch (diagnosticsError) {
      setDiagnosticsOk(false)
      setDiagnostics([
        {
          id: "settings_diagnostics",
          label: "设置诊断",
          ok: false,
          severity: "error",
          message: readableError(diagnosticsError),
        },
      ])
    }
  }

  useEffect(() => {
    let cancelled = false
    const hasSettings = settings !== null
    void Promise.allSettled([getSettingsConfig(), getSettingsDiagnostics()])
      .then(([settingsResult, diagnosticsResult]) => {
        if (cancelled) {
          return
        }
        if (settingsResult.status === "rejected") {
          throw settingsResult.reason
        }
        const response = settingsResult.value
        setSettings(response.config)
        setSavedSettings(response.config)
        setConfigured(response.configured)
        if (diagnosticsResult.status === "fulfilled") {
          setDiagnostics(diagnosticsResult.value.checks)
          setDiagnosticsOk(diagnosticsResult.value.ok)
        } else {
          setDiagnosticsOk(false)
          setDiagnostics([
            {
              id: "settings_diagnostics",
              label: "设置诊断",
              ok: false,
              severity: "error",
              message: readableError(diagnosticsResult.reason),
            },
          ])
        }
        setError(null)
        setLoadState("ready")
      })
      .catch((loadError) => {
        if (cancelled) {
          return
        }
        setLoadState(hasSettings ? "stale" : "error")
        setError(readableError(loadError))
      })
      .finally(() => {
        if (!cancelled) {
          setIsRefreshing(false)
        }
      })

    return () => {
      cancelled = true
    }
    // reloadToken 是显式刷新信号；settings 只用于区分 error 与 stale。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken])

  useEffect(() => {
    let cancelled = false

    async function loadRunninghubWorkflows() {
      try {
        const response = await listRunninghubWorkflows()
        if (!cancelled) {
          setRunninghubWorkflows(response.workflows)
        }
      } catch (loadError) {
        if (!cancelled) {
          setRunninghubStatus({
            ok: false,
            message: readableError(loadError),
          })
        }
      }
    }

    void loadRunninghubWorkflows()

    return () => {
      cancelled = true
    }
  }, [])

  const dirtySections = useMemo(
    () => ({
      tts: isSettingsSectionDirty("tts", settings, savedSettings),
      "visual-generation": isSettingsSectionDirty(
        "visual-generation",
        settings,
        savedSettings
      ),
      "publish-storage": isSettingsSectionDirty(
        "publish-storage",
        settings,
        savedSettings
      ),
    }),
    [savedSettings, settings]
  )
  const hasDirtySettings = Object.values(dirtySections).some(Boolean)

  useEffect(() => {
    let cancelled = false

    async function loadResources() {
      setResourceError(null)
      const [bgmResult, templateResult, mediaResult, ttsResult] =
        await Promise.allSettled([
          listResourceBgm(),
          listResourceTemplates(),
          listResourceMediaWorkflows(),
          listResourceTtsWorkflows(),
        ])
      if (cancelled) {
        return
      }

      setResourceState({
        bgm: bgmResult.status === "fulfilled" ? bgmResult.value.bgm_files : [],
        frameTemplates:
          templateResult.status === "fulfilled"
            ? templateResult.value.templates
            : [],
        mediaWorkflows:
          mediaResult.status === "fulfilled" ? mediaResult.value.workflows : [],
        ttsWorkflows:
          ttsResult.status === "fulfilled" ? ttsResult.value.workflows : [],
      })

      const failures = [bgmResult, templateResult, mediaResult, ttsResult]
        .filter((result) => result.status === "rejected")
        .map((result) =>
          readableError((result as PromiseRejectedResult).reason)
        )
      if (failures.length > 0) {
        setResourceError(failures.join("；"))
      }
    }

    void loadResources()

    return () => {
      cancelled = true
    }
  }, [])

  function patchSettings(patch: Partial<AppSettingsConfig>) {
    setSettings((current) =>
      current ? mergeSettings(current, patch) : current
    )
    setNotice(null)
  }

  async function saveSettings(section: SaveSection) {
    if (!settings) {
      return
    }
    setSavingSection(section)
    setError(null)
    setNotice(null)
    try {
      const response = await updateSettingsConfig(
        settingsUpdateForSection(section, settings)
      )
      setSettings((current) =>
        current
          ? reconcileSavedSection(section, response.config, current)
          : response.config
      )
      setSavedSettings(response.config)
      setConfigured(response.configured)
      void refreshDiagnostics()
      setNotice(`${settingsSectionLabel(section)}已保存。`)
      toast({
        title: `${settingsSectionLabel(section)}已保存`,
        variant: "success",
      })
    } catch (saveError) {
      setError(readableError(saveError))
    } finally {
      setSavingSection(null)
    }
  }

  async function resetSettings() {
    setIsResetting(true)
    setError(null)
    setNotice(null)
    try {
      const response = await resetSettingsConfig()
      setSettings(response.config)
      setSavedSettings(response.config)
      setConfigured(response.configured)
      void refreshDiagnostics()
      setNotice("设置已重置为默认值。")
      toast({ title: "系统设置已重置", variant: "success" })
    } catch (resetError) {
      setError(readableError(resetError))
    } finally {
      setIsResetting(false)
    }
  }

  async function testComfyui() {
    if (!settings) {
      return
    }
    setComfyActionState("testing")
    setComfyStatus(null)
    try {
      const response = await testComfyuiConnection(settings.comfyui.comfyui_url)
      setComfyStatus({ ok: response.ok, message: response.message })
    } catch (testError) {
      setComfyStatus({ ok: false, message: readableError(testError) })
    } finally {
      setComfyActionState("idle")
    }
  }

  async function addWorkflow() {
    setRunninghubActionState("saving")
    setRunninghubStatus(null)
    try {
      const response = await addRunninghubWorkflow(runninghubDraft)
      setRunninghubWorkflows(response.workflows)
      setRunninghubDraft((current) => ({
        ...current,
        name: "",
        workflowId: "",
        overwrite: false,
      }))
      setRunninghubStatus({
        ok: true,
        message: `已添加 ${response.workflow.key}。`,
      })
    } catch (addError) {
      setRunninghubStatus({ ok: false, message: readableError(addError) })
    } finally {
      setRunninghubActionState("idle")
    }
  }

  async function fetchChannels() {
    if (!settings) {
      return
    }
    setBufferActionState("loading")
    setBufferStatus(null)
    try {
      const response = await fetchBufferChannels(
        settings.publish.buffer.api_key
      )
      setBufferChannels(response.channels)
      const detectedChannels = response.detected_channels
      const detectedPlatforms = Object.keys(detectedChannels)
      if (detectedPlatforms.length > 0) {
        patchSettings({
          publish: {
            ...settings.publish,
            buffer: {
              ...settings.publish.buffer,
              channels: {
                ...settings.publish.buffer.channels,
                ...detectedChannels,
              },
            },
          },
        })
      }
      setBufferStatus({
        ok: detectedPlatforms.length > 0,
        message:
          detectedPlatforms.length > 0
            ? `已填入 ${detectedPlatforms.join(", ")}。`
            : "已拉取 Buffer Channels，但没有识别到支持的平台。",
      })
    } catch (fetchError) {
      setBufferStatus({ ok: false, message: readableError(fetchError) })
    } finally {
      setBufferActionState("idle")
    }
  }

  return (
    <PageFrame>
      <WorkspaceHeader
        actions={
          <>
            <Badge variant={configured ? "secondary" : "destructive"}>
              {configured ? "基础配置完整" : "AI 大模型待配置"}
            </Badge>
            <Button
              aria-label="刷新系统设置"
              disabled={isRefreshing}
              onClick={() => {
                setIsRefreshing(true)
                setReloadToken((token) => token + 1)
              }}
              size="icon-sm"
              variant="outline"
            >
              <RefreshCw className={cn(isRefreshing && "animate-spin")} />
            </Button>
          </>
        }
        description="按用途管理内容空间、外部服务连接和长期生产规则。"
        title="设置中心"
      />

      {loadState === "stale" ? (
        <AsyncState
          action={
            <Button
              onClick={() => {
                setIsRefreshing(true)
                setReloadToken((token) => token + 1)
              }}
              size="sm"
              variant="outline"
            >
              重新读取
            </Button>
          }
          description={error}
          state="stale"
          title="系统设置可能不是最新状态"
        />
      ) : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav
          aria-label="设置分区"
          className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
        >
          {SETTINGS_NAV_GROUPS.map((group) => (
            <div className="contents lg:block" key={group.label}>
              <div className="hidden px-3 pt-2 pb-1 text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase lg:block">
                {group.label}
              </div>
              {group.items.map((item) => {
                const Icon = item.icon
                const active = item.view === activeView
                const dirty =
                  item.view === "tts" ||
                  item.view === "visual-generation" ||
                  item.view === "publish-storage"
                    ? dirtySections[item.view]
                    : false
                return (
                  <a
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-14 w-52 shrink-0 snap-start items-center gap-3 rounded-lg px-3 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 lg:w-full",
                      active && "bg-muted"
                    )}
                    href={routeHref(
                      settingsLink({ kind: "view", view: item.view })
                    )}
                    key={item.view}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {item.label}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                    {dirty ? (
                      <span
                        aria-label="有未保存更改"
                        className="size-2 rounded-full bg-warning"
                      />
                    ) : null}
                  </a>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          {loadState === "loading" && requiresSettings(activeView) ? (
            <AsyncState
              description="正在同步配置与运行检查。"
              state="loading"
              title="正在读取系统设置"
            />
          ) : null}
          {loadState === "error" && requiresSettings(activeView) ? (
            <AsyncState
              action={
                <Button
                  onClick={() => {
                    setIsRefreshing(true)
                    setReloadToken((token) => token + 1)
                  }}
                  size="sm"
                  variant="outline"
                >
                  重试
                </Button>
              }
              description={error}
              state="error"
              title="系统设置读取失败"
            />
          ) : null}

          {activeView === "overview" && settings ? (
            <div className="flex flex-col gap-5">
              <SettingsViewHeader
                description="先看哪些配置需要处理，再直接进入对应页面。"
                title="生产准备情况"
              />
              <SettingsReadinessPanel
                checks={diagnostics}
                configured={configured}
                ok={diagnosticsOk}
              />
              <ServiceShortcutGrid />
              <details className="group rounded-lg border bg-muted/15">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  高级与诊断
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                </summary>
                <div className="flex flex-col gap-5 border-t p-4">
                  <p className="text-sm leading-6 text-muted-foreground">
                    下面展示底层前置检查。它反映配置是否齐全，不代表外部服务已经实时连通。
                  </p>
                  <DiagnosticsPanel checks={diagnostics} ok={diagnosticsOk} />
                  <ExpertModeSection />
                  <ResetSettingsDialog
                    isResetting={isResetting}
                    onReset={() => void resetSettings()}
                  />
                </div>
              </details>
            </div>
          ) : null}

          {activeView === "projects" ? <ProjectsPanel /> : null}

          {activeView === "llm" && settings ? (
            <div className="flex flex-col gap-5">
              <SettingsViewHeader
                description="连接写稿、分镜和内容理解所使用的大模型服务。每个服务独立保存。"
                title="AI 大模型"
              />
              <Section id="llm" title="已连接服务">
                <LlmProviderSettings
                  onSettingsChanged={(next) => {
                    setSettings((current) =>
                      current ? { ...current, llm: next.llm } : next
                    )
                    setSavedSettings((current) =>
                      current ? { ...current, llm: next.llm } : next
                    )
                  }}
                  settings={settings}
                />
              </Section>
            </div>
          ) : null}

          {activeView === "tts" && settings ? (
            <div className="flex flex-col gap-5">
              <SettingsViewHeader
                description="选择新任务默认使用的配音服务，并配置对应模型和音色。"
                dirty={dirtySections.tts}
                onSave={() => void saveSettings("tts")}
                saving={savingSection === "tts"}
                title="语音生成（TTS）"
              />
              <Section id="tts" title="默认配音服务">
                <Field label="选择服务">
                  <Select
                    onValueChange={(value) =>
                      patchSettings({
                        comfyui: {
                          ...settings.comfyui,
                          tts: {
                            ...settings.comfyui.tts,
                            inference_mode: value as
                              "local" | "comfyui" | "fish",
                          },
                        },
                      })
                    }
                    value={settings.comfyui.tts.inference_mode ?? "local"}
                  >
                    <SelectTrigger
                      aria-label="选择默认配音服务"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="local">
                          Microsoft Edge 在线语音
                        </SelectItem>
                        <SelectItem value="fish">Fish Audio</SelectItem>
                        <SelectItem value="comfyui">ComfyUI TTS</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <p className="text-xs leading-5 text-muted-foreground">
                  新建任务默认使用这里选择的服务；模板明确指定其他服务时才会覆盖。
                </p>
                <div className="border-t pt-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">Fish Audio</h3>
                    <Badge
                      variant={
                        settings.comfyui.tts.inference_mode === "fish"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {settings.comfyui.tts.inference_mode === "fish"
                        ? "当前默认"
                        : "备用配置"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    选择 Fish Audio
                    为默认服务时，任务会使用下面的模型和默认音色。
                  </p>
                </div>
                <SecretSettingField
                  configured={Boolean(
                    settings.comfyui.tts.fish_audio.api_key_configured
                  )}
                  label="API Key"
                  onChange={(value) =>
                    patchSettings({
                      comfyui: {
                        ...settings.comfyui,
                        tts: {
                          ...settings.comfyui.tts,
                          fish_audio: {
                            ...settings.comfyui.tts.fish_audio,
                            api_key: value,
                            clear_api_key: false,
                          },
                        },
                      },
                    })
                  }
                  onClear={() =>
                    patchSettings({
                      comfyui: {
                        ...settings.comfyui,
                        tts: {
                          ...settings.comfyui.tts,
                          fish_audio: {
                            ...settings.comfyui.tts.fish_audio,
                            api_key: "",
                            api_key_configured: false,
                            clear_api_key: true,
                          },
                        },
                      },
                    })
                  }
                  value={settings.comfyui.tts.fish_audio.api_key}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="模型">
                    <Select
                      onValueChange={(value) =>
                        patchSettings({
                          comfyui: {
                            ...settings.comfyui,
                            tts: {
                              ...settings.comfyui.tts,
                              fish_audio: {
                                ...settings.comfyui.tts.fish_audio,
                                model: value as "s1" | "s2-pro",
                              },
                            },
                          },
                        })
                      }
                      value={settings.comfyui.tts.fish_audio.model}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="s2-pro">S2 Pro</SelectItem>
                          <SelectItem value="s1">S1</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="默认音色 ID">
                    <Input
                      onChange={(event) =>
                        patchSettings({
                          comfyui: {
                            ...settings.comfyui,
                            tts: {
                              ...settings.comfyui.tts,
                              fish_audio: {
                                ...settings.comfyui.tts.fish_audio,
                                reference_id: event.target.value,
                              },
                            },
                          },
                        })
                      }
                      value={settings.comfyui.tts.fish_audio.reference_id ?? ""}
                    />
                  </Field>
                </div>
                <Field label="服务地址">
                  <Input
                    onChange={(event) =>
                      patchSettings({
                        comfyui: {
                          ...settings.comfyui,
                          tts: {
                            ...settings.comfyui.tts,
                            fish_audio: {
                              ...settings.comfyui.tts.fish_audio,
                              base_url: event.target.value,
                            },
                          },
                        },
                      })
                    }
                    value={settings.comfyui.tts.fish_audio.base_url}
                  />
                </Field>
              </Section>
            </div>
          ) : null}

          {activeView === "visual-generation" && settings ? (
            <div className="flex flex-col gap-5">
              <SettingsViewHeader
                description="连接图片和视频生成服务，并管理工作流执行的并发与超时。"
                title="图片与视频生成"
              />
              <Section id="comfyui" title="Workflow 执行服务">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="ComfyUI 地址">
                    <Input
                      onChange={(event) =>
                        patchSettings({
                          comfyui: {
                            ...settings.comfyui,
                            comfyui_url: event.target.value,
                          },
                        })
                      }
                      value={settings.comfyui.comfyui_url}
                    />
                  </Field>
                  <SecretSettingField
                    configured={Boolean(
                      settings.comfyui.comfyui_api_key_configured
                    )}
                    label="ComfyUI API Key"
                    onChange={(value) =>
                      patchSettings({
                        comfyui: {
                          ...settings.comfyui,
                          comfyui_api_key: value,
                          clear_comfyui_api_key: false,
                        },
                      })
                    }
                    onClear={() =>
                      patchSettings({
                        comfyui: {
                          ...settings.comfyui,
                          comfyui_api_key: "",
                          comfyui_api_key_configured: false,
                          clear_comfyui_api_key: true,
                        },
                      })
                    }
                    value={settings.comfyui.comfyui_api_key ?? ""}
                  />
                </div>
                <Button
                  disabled={comfyActionState !== "idle"}
                  onClick={() => void testComfyui()}
                  variant="outline"
                >
                  {comfyActionState === "testing" ? (
                    <Loader2
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <CheckCircle2 data-icon="inline-start" />
                  )}
                  测试连接
                </Button>
                {comfyStatus ? (
                  <StatusMessage
                    message={comfyStatus.message}
                    ok={comfyStatus.ok}
                  />
                ) : null}
                <Separator />
                <div className="grid gap-4 sm:grid-cols-2">
                  <SecretSettingField
                    configured={Boolean(
                      settings.comfyui.runninghub_api_key_configured
                    )}
                    label="RunningHub API Key"
                    onChange={(value) =>
                      patchSettings({
                        comfyui: {
                          ...settings.comfyui,
                          runninghub_api_key: value,
                          clear_runninghub_api_key: false,
                        },
                      })
                    }
                    onClear={() =>
                      patchSettings({
                        comfyui: {
                          ...settings.comfyui,
                          runninghub_api_key: "",
                          runninghub_api_key_configured: false,
                          clear_runninghub_api_key: true,
                        },
                      })
                    }
                    value={settings.comfyui.runninghub_api_key ?? ""}
                  />
                  <Field label="实例规格">
                    <Select
                      onValueChange={(value) =>
                        patchSettings({
                          comfyui: {
                            ...settings.comfyui,
                            runninghub_instance_type:
                              value === "standard" ? null : value,
                          },
                        })
                      }
                      value={
                        settings.comfyui.runninghub_instance_type || "standard"
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="standard">24 GB</SelectItem>
                          <SelectItem value="plus">48 GB</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="全局并发数">
                    <div className="space-y-1.5">
                      <Input
                        max={10}
                        min={1}
                        onChange={(event) =>
                          patchSettings({
                            comfyui: {
                              ...settings.comfyui,
                              runninghub_concurrent_limit: Number(
                                event.target.value || 1
                              ),
                            },
                          })
                        }
                        type="number"
                        value={settings.comfyui.runninghub_concurrent_limit}
                      />
                      <p className="text-xs leading-5 text-muted-foreground">
                        所有视频、图集和批量任务共用同一队列；当前账号只有 1
                        路并发时请填 1。
                      </p>
                    </div>
                  </Field>
                  <Field label="超时秒数">
                    <Input
                      min={30}
                      onChange={(event) =>
                        patchSettings({
                          comfyui: {
                            ...settings.comfyui,
                            runninghub_timeout: Number(
                              event.target.value || 600
                            ),
                          },
                        })
                      }
                      type="number"
                      value={settings.comfyui.runninghub_timeout ?? 600}
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <p className="max-w-xl text-xs leading-5 text-muted-foreground">
                    RunningHub
                    显示“已配置”只代表凭证已保存；真实可用性以任务执行结果为准。
                  </p>
                  <Button
                    disabled={
                      !dirtySections["visual-generation"] ||
                      savingSection === "visual-generation"
                    }
                    onClick={() => void saveSettings("visual-generation")}
                  >
                    {savingSection === "visual-generation" ? (
                      <Loader2
                        className="animate-spin"
                        data-icon="inline-start"
                      />
                    ) : (
                      <Save data-icon="inline-start" />
                    )}
                    保存 Workflow 服务
                  </Button>
                </div>
              </Section>

              <Section id="image-providers" title="独立图片生成服务">
                <p className="text-xs leading-5 text-muted-foreground">
                  每个服务独立启用和保存，不会被上面的 Workflow
                  服务保存按钮覆盖。
                </p>
                <ImageProviderSettings />
              </Section>

              {expertMode ? (
                <Section id="runninghub" title="专家：注册生成流程">
                  <div className="grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
                    <Field label="产物类型">
                      <Select
                        onValueChange={(value) =>
                          setRunninghubDraft((current) => ({
                            ...current,
                            kind: value as WorkflowKind,
                          }))
                        }
                        value={runninghubDraft.kind}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="video">视频</SelectItem>
                            <SelectItem value="image">图片</SelectItem>
                            <SelectItem value="tts">语音</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="显示名称">
                      <Input
                        onChange={(event) =>
                          setRunninghubDraft((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        value={runninghubDraft.name}
                      />
                    </Field>
                  </div>
                  <Field label="流程 ID">
                    <Input
                      inputMode="numeric"
                      onChange={(event) =>
                        setRunninghubDraft((current) => ({
                          ...current,
                          workflowId: event.target.value,
                        }))
                      }
                      value={runninghubDraft.workflowId}
                    />
                  </Field>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      checked={runninghubDraft.overwrite}
                      className="size-4 accent-primary"
                      onChange={(event) =>
                        setRunninghubDraft((current) => ({
                          ...current,
                          overwrite: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    覆盖同名流程
                  </label>
                  <Button
                    disabled={
                      runninghubActionState !== "idle" ||
                      !runninghubDraft.name.trim() ||
                      !runninghubDraft.workflowId.trim()
                    }
                    onClick={() => void addWorkflow()}
                    variant="outline"
                  >
                    {runninghubActionState === "saving" ? (
                      <Loader2
                        className="animate-spin"
                        data-icon="inline-start"
                      />
                    ) : (
                      <Plus data-icon="inline-start" />
                    )}
                    添加流程
                  </Button>
                  {runninghubStatus ? (
                    <StatusMessage
                      message={runninghubStatus.message}
                      ok={runninghubStatus.ok}
                    />
                  ) : null}
                  {runninghubWorkflows.length > 0 ? (
                    <div className="divide-y border-y font-mono text-xs">
                      {runninghubWorkflows.slice(0, 5).map((workflow) => (
                        <div className="py-2" key={workflow.key}>
                          {workflow.key} · {workflow.workflow_id}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </Section>
              ) : null}

              <details
                className="group scroll-mt-20 rounded-lg border bg-muted/15"
                id="resources"
              >
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  查看本地资源清单
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                </summary>
                <div className="border-t p-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <ResourceMetric
                      label="背景音乐"
                      value={resourceState.bgm.length}
                    />
                    <ResourceMetric
                      label="画面模板"
                      value={resourceState.frameTemplates.length}
                    />
                    <ResourceMetric
                      label="媒体流程"
                      value={resourceState.mediaWorkflows.length}
                    />
                    <ResourceMetric
                      label="语音流程"
                      value={resourceState.ttsWorkflows.length}
                    />
                  </div>
                  {resourceError ? (
                    <div className="mt-4">
                      <InlineError
                        message={resourceError}
                        title="资源读取失败"
                      />
                    </div>
                  ) : null}
                </div>
              </details>
            </div>
          ) : null}

          {activeView === "publish-storage" && settings ? (
            <div className="flex flex-col gap-5">
              <SettingsViewHeader
                description="连接发布账号与云存储；发布渠道可自动读取，原始 ID 只用于高级排查。"
                dirty={dirtySections["publish-storage"]}
                onSave={() => void saveSettings("publish-storage")}
                saving={savingSection === "publish-storage"}
                title="发布与存储"
              />
              <Section id="buffer" title="社媒发布">
                <SecretSettingField
                  configured={Boolean(
                    settings.publish.buffer.api_key_configured
                  )}
                  label="Buffer API Key"
                  onChange={(value) =>
                    patchSettings({
                      publish: {
                        ...settings.publish,
                        buffer: {
                          ...settings.publish.buffer,
                          api_key: value,
                          clear_api_key: false,
                        },
                      },
                    })
                  }
                  onClear={() =>
                    patchSettings({
                      publish: {
                        ...settings.publish,
                        buffer: {
                          ...settings.publish.buffer,
                          api_key: "",
                          api_key_configured: false,
                          clear_api_key: true,
                        },
                      },
                    })
                  }
                  value={settings.publish.buffer.api_key}
                />
                <Button
                  disabled={bufferActionState !== "idle"}
                  onClick={() => void fetchChannels()}
                  variant="outline"
                >
                  {bufferActionState === "loading" ? (
                    <Loader2
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <RefreshCw data-icon="inline-start" />
                  )}
                  读取发布渠道
                </Button>
                {bufferStatus ? (
                  <StatusMessage
                    message={bufferStatus.message}
                    ok={bufferStatus.ok}
                  />
                ) : null}
                <BufferChannelSummary
                  channels={settings.publish.buffer.channels}
                  fetchedChannels={bufferChannels}
                />
                <details className="group rounded-lg border bg-muted/15">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                    高级：手动调整渠道 ID
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                  </summary>
                  <div className="grid gap-4 border-t p-3 sm:grid-cols-2">
                    {Object.entries(platformLabels).map(([platform, label]) => (
                      <Field key={platform} label={`${label} 渠道 ID`}>
                        <Input
                          onChange={(event) =>
                            patchSettings({
                              publish: {
                                ...settings.publish,
                                buffer: {
                                  ...settings.publish.buffer,
                                  channels: {
                                    ...settings.publish.buffer.channels,
                                    [platform]: event.target.value,
                                  },
                                },
                              },
                            })
                          }
                          value={
                            settings.publish.buffer.channels[platform] ?? ""
                          }
                        />
                      </Field>
                    ))}
                  </div>
                </details>
              </Section>

              <Section id="cos" title="云存储">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="地域">
                    <Input
                      onChange={(event) =>
                        patchSettings({
                          publish: {
                            ...settings.publish,
                            cos: {
                              ...settings.publish.cos,
                              region: event.target.value,
                            },
                          },
                        })
                      }
                      value={settings.publish.cos.region}
                    />
                  </Field>
                  <Field label="存储桶">
                    <Input
                      onChange={(event) =>
                        patchSettings({
                          publish: {
                            ...settings.publish,
                            cos: {
                              ...settings.publish.cos,
                              bucket: event.target.value,
                            },
                          },
                        })
                      }
                      value={settings.publish.cos.bucket}
                    />
                  </Field>
                  <SecretSettingField
                    configured={Boolean(
                      settings.publish.cos.secret_id_configured
                    )}
                    label="Secret ID"
                    onChange={(value) =>
                      patchSettings({
                        publish: {
                          ...settings.publish,
                          cos: {
                            ...settings.publish.cos,
                            secret_id: value,
                            clear_secret_id: false,
                          },
                        },
                      })
                    }
                    onClear={() =>
                      patchSettings({
                        publish: {
                          ...settings.publish,
                          cos: {
                            ...settings.publish.cos,
                            secret_id: "",
                            secret_id_configured: false,
                            clear_secret_id: true,
                          },
                        },
                      })
                    }
                    value={settings.publish.cos.secret_id}
                  />
                  <SecretSettingField
                    configured={Boolean(
                      settings.publish.cos.secret_key_configured
                    )}
                    label="Secret Key"
                    onChange={(value) =>
                      patchSettings({
                        publish: {
                          ...settings.publish,
                          cos: {
                            ...settings.publish.cos,
                            secret_key: value,
                            clear_secret_key: false,
                          },
                        },
                      })
                    }
                    onClear={() =>
                      patchSettings({
                        publish: {
                          ...settings.publish,
                          cos: {
                            ...settings.publish.cos,
                            secret_key: "",
                            secret_key_configured: false,
                            clear_secret_key: true,
                          },
                        },
                      })
                    }
                    value={settings.publish.cos.secret_key}
                  />
                </div>
                <Field label="公开访问地址">
                  <Input
                    onChange={(event) =>
                      patchSettings({
                        publish: {
                          ...settings.publish,
                          cos: {
                            ...settings.publish.cos,
                            public_base_url: event.target.value,
                          },
                        },
                      })
                    }
                    value={settings.publish.cos.public_base_url}
                  />
                </Field>
                <Field label="自定义接入地址（可选）">
                  <Input
                    onChange={(event) =>
                      patchSettings({
                        publish: {
                          ...settings.publish,
                          cos: {
                            ...settings.publish.cos,
                            endpoint_url: event.target.value,
                          },
                        },
                      })
                    }
                    value={settings.publish.cos.endpoint_url ?? ""}
                  />
                </Field>
              </Section>
            </div>
          ) : null}

          {activeView === "recipes" ? <TemplateStatusPanel /> : null}
          {activeView === "prompts" ? <PromptLibraryPanel /> : null}
          {activeView === "help" ? <HelpWorkspace /> : null}

          {error && settings && requiresSettings(activeView) ? (
            <div className="mt-5">
              <InlineError message={error} title="设置保存失败" />
            </div>
          ) : null}
          {notice ? (
            <div
              className="mt-5 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success"
              role="status"
            >
              {notice}
            </div>
          ) : null}
        </div>
      </div>

      <UnsavedChangesGuard
        allowSettingsViews
        currentPath={path}
        dirty={hasDirtySettings}
      />
    </PageFrame>
  )
}

function SettingsViewHeader({
  title,
  description,
  dirty = false,
  saving = false,
  onSave,
}: {
  title: string
  description: string
  dirty?: boolean
  saving?: boolean
  onSave?: () => void
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
      <div>
        <h2 className="text-xl leading-7 font-semibold tracking-tight">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {onSave ? (
        <div className="flex flex-col items-end gap-1.5">
          <Button disabled={!dirty || saving} onClick={onSave}>
            {saving ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Save data-icon="inline-start" />
            )}
            保存本分区
          </Button>
          <span className="text-xs text-muted-foreground">
            {dirty ? "有未保存更改" : "没有未保存更改"}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function SettingsReadinessPanel({
  checks,
  configured,
  ok,
}: {
  checks: SettingsDiagnosticCheck[]
  configured: boolean
  ok: boolean
}) {
  const blocking = checks.filter(
    (check) => !check.ok && check.severity === "error"
  )
  const optional = checks.filter(
    (check) => !check.ok && check.severity !== "error"
  )
  const ready = configured && ok && blocking.length === 0

  return (
    <section
      className={cn(
        "rounded-xl border p-5",
        ready
          ? "border-success/30 bg-success/5"
          : "border-destructive/30 bg-destructive/5"
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Badge variant={ready ? "success" : "destructive"}>
            {ready ? "基础配置完整" : `${blocking.length || 1} 项需要处理`}
          </Badge>
          <h3 className="mt-3 text-base font-semibold">
            {ready ? "可以开始生产" : "先完成必要连接"}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            {ready
              ? "必要字段已经配置。外部服务是否实时在线，仍以连接测试和真实任务结果为准。"
              : "下面只列出会阻塞核心生产的配置，并提供直接处理入口。"}
          </p>
        </div>
        {ready ? (
          <Button asChild>
            <a href={routeHref("/create")}>去快速生产</a>
          </Button>
        ) : null}
      </div>

      {blocking.length > 0 ? (
        <div className="mt-5 grid gap-3">
          {blocking.map((check) => (
            <ActionableDiagnostic key={check.id} check={check} />
          ))}
        </div>
      ) : null}

      {optional.length > 0 ? (
        <details className="group mt-5 border-t pt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            按需补充的能力（{optional.length}）
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
          </summary>
          <div className="mt-3 grid gap-2">
            {optional.map((check) => (
              <ActionableDiagnostic compact key={check.id} check={check} />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}

function ActionableDiagnostic({
  check,
  compact = false,
}: {
  check: SettingsDiagnosticCheck
  compact?: boolean
}) {
  const destination = diagnosticDestination(check.id)
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background",
        compact ? "px-3 py-2.5" : "p-4"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{check.label}</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">
          {check.message}
        </div>
      </div>
      <Button asChild size="sm" variant="outline">
        <a href={routeHref(settingsLink({ kind: "view", view: destination }))}>
          {destination === "help" ? "查看帮助" : "去设置"}
          <ChevronRight data-icon="inline-end" />
        </a>
      </Button>
    </div>
  )
}

function ServiceShortcutGrid() {
  const items: SettingsNavItem[] = [
    {
      view: "llm",
      label: "AI 大模型",
      description: "写稿、分镜与内容理解",
      icon: Bot,
    },
    {
      view: "visual-generation",
      label: "图片与视频生成",
      description: "画面服务、工作流与算力",
      icon: Images,
    },
    {
      view: "tts",
      label: "语音生成（TTS）",
      description: "配音服务、模型与音色",
      icon: Mic2,
    },
    {
      view: "publish-storage",
      label: "发布与存储",
      description: "平台账号与文件存储",
      icon: Send,
    },
  ]
  return (
    <section>
      <h3 className="text-base font-semibold">服务连接</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        按要配置的能力进入，不需要理解底层模块名称。
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <a
              className="group flex min-h-24 items-center gap-3 rounded-xl border bg-background p-4 transition-colors outline-none hover:border-primary/40 hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/50"
              href={routeHref(settingsLink({ kind: "view", view: item.view }))}
              key={item.view}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-primary">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {item.description}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </a>
          )
        })}
      </div>
    </section>
  )
}

function ResetSettingsDialog({
  isResetting,
  onReset,
}: {
  isResetting: boolean
  onReset: () => void
}) {
  return (
    <section className="border-t pt-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">恢复系统默认值</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            重置 AI、语音、生成、发布与存储配置。项目和已生成作品不会被删除。
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={isResetting} variant="destructive">
              {isResetting ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              重置系统设置
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>重置所有系统设置？</AlertDialogTitle>
              <AlertDialogDescription>
                AI、语音、生成服务、发布渠道与存储配置会恢复默认值。项目、模板和作品不会删除，此操作无法撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={onReset}>
                重置系统设置
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  )
}

function ExpertModeSection() {
  const expertMode = useExpertMode()
  return (
    <Section title="专家模式">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm leading-6 text-muted-foreground">
          开启后显示生成流程、底层覆盖项与模板默认配置。日常生产建议保持关闭。
        </p>
        <Switch
          aria-label="专家模式"
          checked={expertMode}
          onCheckedChange={setExpertMode}
        />
      </div>
    </Section>
  )
}

function Section({
  title,
  children,
  id,
}: {
  title: string
  children: ReactNode
  id?: string
}) {
  return (
    <section className="scroll-mt-20 border-b pb-5" id={id}>
      <h3 className="mb-4 text-base font-semibold tracking-tight">{title}</h3>
      <div className="flex max-w-3xl flex-col gap-4">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}

function SecretSettingField({
  configured,
  label,
  onChange,
  onClear,
  value,
}: {
  configured: boolean
  label: string
  onChange: (value: string) => void
  onClear: () => void
  value: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        {configured ? <Badge variant="secondary">已配置</Badge> : null}
      </div>
      <div className="flex gap-2">
        <Input
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
          placeholder={configured ? "已安全保存；输入新值可替换" : "请输入密钥"}
          type="password"
          value={value}
        />
        {configured ? (
          <Button onClick={onClear} type="button" variant="outline">
            清除
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function ResourceMetric({ label, value }: { label: string; value: number }) {
  return (
    <dl>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-medium">{value}</dd>
    </dl>
  )
}

function DiagnosticsPanel({
  checks,
  ok,
}: {
  checks: SettingsDiagnosticCheck[]
  ok: boolean
}) {
  const errorCount = checks.filter(
    (check) => !check.ok && check.severity === "error"
  ).length
  const warningCount = checks.filter(
    (check) => !check.ok && check.severity !== "error"
  ).length

  return (
    <section className="border-b pb-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold">生产前置检查</div>
          <div className="mt-1 text-sm leading-6 text-muted-foreground">
            检查内容生成、语音、合成和发布是否具备运行条件。
          </div>
        </div>
        <Badge variant={ok ? "secondary" : "destructive"}>
          {ok ? "关键配置可用" : `${errorCount} 项阻塞`}
        </Badge>
      </div>

      <div className="mt-4 divide-y border-y">
        {checks.map((check) => (
          <div
            className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm"
            key={check.id}
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium">{check.label}</div>
              <div className="mt-1 leading-6 text-muted-foreground">
                {check.message}
              </div>
            </div>
            <Badge variant={diagnosticBadgeVariant(check)}>
              {diagnosticBadgeLabel(check)}
            </Badge>
          </div>
        ))}
      </div>

      {warningCount > 0 && (
        <div className="mt-3 text-sm text-muted-foreground">
          还有 {warningCount} 项不会阻塞页面使用，但会影响部分生成或发布能力。
        </div>
      )}
    </section>
  )
}

function StatusMessage({ ok, message }: { ok: boolean; message: string }) {
  return (
    <div
      aria-atomic="true"
      aria-live={ok ? "polite" : "assertive"}
      className={
        ok
          ? "rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success"
          : "rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
      }
      role={ok ? "status" : "alert"}
    >
      {message}
    </div>
  )
}

function BufferChannelSummary({
  channels,
  fetchedChannels,
}: {
  channels: Record<string, string | undefined>
  fetchedChannels: BufferChannel[]
}) {
  const configuredChannels = Object.entries(platformLabels).filter(
    ([platform]) => Boolean(channels[platform])
  )
  if (configuredChannels.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        尚未关联发布账号。配置 Buffer API Key
        后点击“读取发布渠道”，系统会自动填入支持的平台。
      </div>
    )
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {configuredChannels.map(([platform, label]) => {
        const channelId = channels[platform]
        const channel = fetchedChannels.find((item) => item.id === channelId)
        return (
          <div
            className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5"
            key={platform}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">{label}</div>
              <div className="truncate text-xs text-muted-foreground">
                {channel?.displayName || channel?.name || "已关联发布账号"}
              </div>
            </div>
            <Badge variant="secondary">已关联</Badge>
          </div>
        )
      })}
    </div>
  )
}

function diagnosticDestination(checkId: string): SettingsView {
  if (checkId === "llm_config") return "llm"
  if (checkId === "fish_audio_config") return "tts"
  if (checkId === "buffer_publish" || checkId === "cos_publish") {
    return "publish-storage"
  }
  if (checkId === "ffmpeg" || checkId === "hyperframes") return "help"
  if (checkId === "settings_diagnostics") return "help"
  return "visual-generation"
}

function diagnosticBadgeVariant(check: SettingsDiagnosticCheck) {
  if (check.ok) {
    return "secondary"
  }

  return check.severity === "error" ? "destructive" : "outline"
}

function diagnosticBadgeLabel(check: SettingsDiagnosticCheck) {
  if (check.ok) {
    return "已就绪"
  }

  if (check.severity === "error") {
    return "阻塞"
  }

  return check.severity === "warning" ? "待补齐" : "提示"
}

function mergeSettings(
  current: AppSettingsConfig,
  patch: Partial<AppSettingsConfig>
): AppSettingsConfig {
  return {
    ...current,
    ...patch,
    llm: { ...current.llm, ...patch.llm },
    comfyui: { ...current.comfyui, ...patch.comfyui },
    publish: { ...current.publish, ...patch.publish },
  }
}

function requiresSettings(view: SettingsView) {
  return (
    view === "overview" ||
    view === "llm" ||
    view === "visual-generation" ||
    view === "tts" ||
    view === "publish-storage"
  )
}

function isSettingsSectionDirty(
  section: SaveSection,
  settings: AppSettingsConfig | null,
  savedSettings: AppSettingsConfig | null
) {
  if (!settings || !savedSettings) return false
  return (
    JSON.stringify(settingsSectionSnapshot(section, settings)) !==
    JSON.stringify(settingsSectionSnapshot(section, savedSettings))
  )
}

function settingsSectionSnapshot(
  section: SaveSection,
  settings: AppSettingsConfig
) {
  if (section === "tts") {
    return settings.comfyui.tts
  }
  if (section === "publish-storage") {
    return settings.publish
  }
  const { tts, ...generation } = settings.comfyui
  void tts
  return generation
}

function settingsUpdateForSection(
  section: SaveSection,
  settings: AppSettingsConfig
): SettingsConfigUpdate {
  if (section === "tts") {
    return { comfyui: { tts: settings.comfyui.tts } }
  }
  if (section === "publish-storage") {
    return { publish: settings.publish }
  }
  const { tts, ...generation } = settings.comfyui
  void tts
  return { comfyui: generation }
}

function reconcileSavedSection(
  section: SaveSection,
  server: AppSettingsConfig,
  current: AppSettingsConfig
): AppSettingsConfig {
  if (section === "tts") {
    return {
      ...current,
      comfyui: { ...current.comfyui, tts: server.comfyui.tts },
    }
  }
  if (section === "publish-storage") {
    return { ...current, publish: server.publish }
  }
  return {
    ...current,
    comfyui: { ...server.comfyui, tts: current.comfyui.tts },
  }
}

function settingsSectionLabel(section: SaveSection) {
  if (section === "tts") return "语音生成"
  if (section === "visual-generation") return "图片与视频生成"
  return "发布与存储"
}

function replaceHashPath(path: string) {
  window.history.replaceState(null, "", `#${path}`)
  window.dispatchEvent(new HashChangeEvent("hashchange"))
}
