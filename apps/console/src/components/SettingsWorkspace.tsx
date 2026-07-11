import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  Bot,
  CheckCircle2,
  CircleHelp,
  FolderKanban,
  Gauge,
  Loader2,
  PanelsTopLeft,
  Plus,
  RefreshCw,
  Save,
  Send,
  WandSparkles,
} from "lucide-react"

import { HelpWorkspace } from "@/components/HelpWorkspace"
import { ProjectsPanel } from "@/components/ProjectsPanel"
import { UnsavedChangesGuard } from "@/components/settings/UnsavedChangesGuard"
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
  loadLlmModels,
  resetSettingsConfig,
  testComfyuiConnection,
  testLlmConnection,
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
type SaveSection = "ai-voice" | "generation" | "publish-storage"

const SETTINGS_NAV: Array<{
  view: SettingsView
  label: string
  description: string
  icon: typeof Gauge
}> = [
  {
    view: "overview",
    label: "概览",
    description: "状态与专家模式",
    icon: Gauge,
  },
  {
    view: "projects",
    label: "项目",
    description: "品牌与内容线",
    icon: FolderKanban,
  },
  {
    view: "ai-voice",
    label: "AI 与语音",
    description: "模型、密钥与音色",
    icon: Bot,
  },
  {
    view: "generation",
    label: "生成引擎",
    description: "算力与资源清单",
    icon: WandSparkles,
  },
  {
    view: "publish-storage",
    label: "发布与存储",
    description: "平台渠道与云存储",
    icon: Send,
  },
  {
    view: "recipes",
    label: "配方",
    description: "启停与克隆",
    icon: PanelsTopLeft,
  },
  {
    view: "help",
    label: "帮助",
    description: "说明与故障恢复",
    icon: CircleHelp,
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
  const [llmModels, setLlmModels] = useState<string[]>([])
  const [llmActionState, setLlmActionState] = useState<ActionState>("idle")
  const [llmStatus, setLlmStatus] = useState<{
    ok: boolean
    message: string
  } | null>(null)
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
      "ai-voice": isSettingsSectionDirty("ai-voice", settings, savedSettings),
      generation: isSettingsSectionDirty("generation", settings, savedSettings),
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
      setLlmModels([])
      void refreshDiagnostics()
      setNotice("设置已重置为默认值。")
      toast({ title: "系统设置已重置", variant: "success" })
    } catch (resetError) {
      setError(readableError(resetError))
    } finally {
      setIsResetting(false)
    }
  }

  async function loadModels() {
    if (!settings) {
      return
    }
    setLlmActionState("loading")
    setLlmStatus(null)
    try {
      const response = await loadLlmModels(
        settings.llm.api_key,
        settings.llm.base_url
      )
      setLlmModels(response.models)
      setLlmStatus({
        ok: true,
        message: `已加载 ${response.models.length} 个模型。`,
      })
    } catch (loadError) {
      setLlmStatus({ ok: false, message: readableError(loadError) })
    } finally {
      setLlmActionState("idle")
    }
  }

  async function testLlm() {
    if (!settings) {
      return
    }
    setLlmActionState("testing")
    setLlmStatus(null)
    try {
      const response = await testLlmConnection(
        settings.llm.api_key,
        settings.llm.base_url
      )
      setLlmStatus({
        ok: response.ok,
        message: response.ok
          ? `连接成功，可用模型 ${response.model_count} 个。`
          : response.message,
      })
    } catch (testError) {
      setLlmStatus({ ok: false, message: readableError(testError) })
    } finally {
      setLlmActionState("idle")
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
              {configured ? "关键配置可用" : "AI 配置未完成"}
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
        description="管理项目、模型、生成引擎、发布与配方。每个分区独立保存。"
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
          className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
        >
          {SETTINGS_NAV.map((item) => {
            const Icon = item.icon
            const active = item.view === activeView
            const dirty =
              item.view === "ai-voice" ||
              item.view === "generation" ||
              item.view === "publish-storage"
                ? dirtySections[item.view]
                : false
            return (
              <a
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 w-48 shrink-0 snap-start items-center gap-3 rounded-lg px-3 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 lg:w-full",
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
                description="检查关键连接，控制专家选项并进入各配置分区。"
                title="系统概览"
              />
              <DiagnosticsPanel checks={diagnostics} ok={diagnosticsOk} />
              <ExpertModeSection />
              <div className="divide-y border-y">
                <OverviewLink
                  description="模型、密钥、语音服务与默认音色"
                  label="AI 与语音"
                  view="ai-voice"
                />
                <OverviewLink
                  description="生成节点、并发限制与资源清单"
                  label="生成引擎"
                  view="generation"
                />
                <OverviewLink
                  description="社媒渠道映射与云存储"
                  label="发布与存储"
                  view="publish-storage"
                />
              </div>
              <ResetSettingsDialog
                isResetting={isResetting}
                onReset={() => void resetSettings()}
              />
            </div>
          ) : null}

          {activeView === "projects" ? <ProjectsPanel /> : null}

          {activeView === "ai-voice" && settings ? (
            <div className="flex flex-col gap-5">
              <SettingsViewHeader
                description="配置内容起草模型与 Fish Audio 语音服务。"
                dirty={dirtySections["ai-voice"]}
                onSave={() => void saveSettings("ai-voice")}
                saving={savingSection === "ai-voice"}
                title="AI 与语音"
              />
              <Section id="llm" title="内容起草模型">
                <Field label="AiHubMix API Key">
                  <Input
                    onChange={(event) =>
                      patchSettings({
                        llm: { ...settings.llm, api_key: event.target.value },
                      })
                    }
                    type="password"
                    value={settings.llm.api_key}
                  />
                </Field>
                <Field label="服务地址">
                  <Input
                    onChange={(event) =>
                      patchSettings({
                        llm: { ...settings.llm, base_url: event.target.value },
                      })
                    }
                    value={settings.llm.base_url}
                  />
                </Field>
                <Field label="默认模型">
                  {llmModels.length > 0 ? (
                    <Select
                      onValueChange={(value) =>
                        patchSettings({
                          llm: { ...settings.llm, model: value },
                        })
                      }
                      value={settings.llm.model}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {llmModels.map((model) => (
                            <SelectItem key={model} value={model}>
                              {model}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      onChange={(event) =>
                        patchSettings({
                          llm: { ...settings.llm, model: event.target.value },
                        })
                      }
                      value={settings.llm.model}
                    />
                  )}
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={llmActionState !== "idle"}
                    onClick={() => void loadModels()}
                    variant="outline"
                  >
                    {llmActionState === "loading" ? (
                      <Loader2
                        className="animate-spin"
                        data-icon="inline-start"
                      />
                    ) : (
                      <RefreshCw data-icon="inline-start" />
                    )}
                    加载模型
                  </Button>
                  <Button
                    disabled={llmActionState !== "idle"}
                    onClick={() => void testLlm()}
                    variant="outline"
                  >
                    {llmActionState === "testing" ? (
                      <Loader2
                        className="animate-spin"
                        data-icon="inline-start"
                      />
                    ) : (
                      <CheckCircle2 data-icon="inline-start" />
                    )}
                    测试连接
                  </Button>
                </div>
                {llmStatus ? (
                  <StatusMessage
                    message={llmStatus.message}
                    ok={llmStatus.ok}
                  />
                ) : null}
              </Section>

              <Section id="tts" title="Fish Audio">
                <Field label="API Key">
                  <Input
                    onChange={(event) =>
                      patchSettings({
                        comfyui: {
                          ...settings.comfyui,
                          tts: {
                            ...settings.comfyui.tts,
                            fish_audio: {
                              ...settings.comfyui.tts.fish_audio,
                              api_key: event.target.value,
                            },
                          },
                        },
                      })
                    }
                    type="password"
                    value={settings.comfyui.tts.fish_audio.api_key}
                  />
                </Field>
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

          {activeView === "generation" && settings ? (
            <div className="flex flex-col gap-5">
              <SettingsViewHeader
                description="配置生成节点、算力限制与可用资源。"
                dirty={dirtySections.generation}
                onSave={() => void saveSettings("generation")}
                saving={savingSection === "generation"}
                title="生成引擎"
              />
              <Section id="comfyui" title="生成节点">
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
                  <Field label="ComfyUI API Key">
                    <Input
                      onChange={(event) =>
                        patchSettings({
                          comfyui: {
                            ...settings.comfyui,
                            comfyui_api_key: event.target.value,
                          },
                        })
                      }
                      type="password"
                      value={settings.comfyui.comfyui_api_key ?? ""}
                    />
                  </Field>
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
                  <Field label="RunningHub API Key">
                    <Input
                      onChange={(event) =>
                        patchSettings({
                          comfyui: {
                            ...settings.comfyui,
                            runninghub_api_key: event.target.value,
                          },
                        })
                      }
                      type="password"
                      value={settings.comfyui.runninghub_api_key ?? ""}
                    />
                  </Field>
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
                  <Field label="并发数">
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

              <Section id="resources" title="资源清单">
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
                  <InlineError message={resourceError} title="资源读取失败" />
                ) : null}
              </Section>
            </div>
          ) : null}

          {activeView === "publish-storage" && settings ? (
            <div className="flex flex-col gap-5">
              <SettingsViewHeader
                description="配置发布渠道映射与腾讯云对象存储。"
                dirty={dirtySections["publish-storage"]}
                onSave={() => void saveSettings("publish-storage")}
                saving={savingSection === "publish-storage"}
                title="发布与存储"
              />
              <Section id="buffer" title="社媒发布">
                <Field label="Buffer API Key">
                  <Input
                    onChange={(event) =>
                      patchSettings({
                        publish: {
                          ...settings.publish,
                          buffer: {
                            ...settings.publish.buffer,
                            api_key: event.target.value,
                          },
                        },
                      })
                    }
                    type="password"
                    value={settings.publish.buffer.api_key}
                  />
                </Field>
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
                {bufferChannels.length > 0 ? (
                  <div className="divide-y border-y text-xs">
                    {bufferChannels.slice(0, 5).map((channel) => (
                      <div
                        className="py-2"
                        key={channel.id ?? channel.displayName ?? channel.name}
                      >
                        {formatBufferChannel(channel)}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
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
                        value={settings.publish.buffer.channels[platform] ?? ""}
                      />
                    </Field>
                  ))}
                </div>
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
                  <Field label="Secret ID">
                    <Input
                      onChange={(event) =>
                        patchSettings({
                          publish: {
                            ...settings.publish,
                            cos: {
                              ...settings.publish.cos,
                              secret_id: event.target.value,
                            },
                          },
                        })
                      }
                      type="password"
                      value={settings.publish.cos.secret_id}
                    />
                  </Field>
                  <Field label="Secret Key">
                    <Input
                      onChange={(event) =>
                        patchSettings({
                          publish: {
                            ...settings.publish,
                            cos: {
                              ...settings.publish.cos,
                              secret_key: event.target.value,
                            },
                          },
                        })
                      }
                      type="password"
                      value={settings.publish.cos.secret_key}
                    />
                  </Field>
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
        <h2 className="text-lg font-medium">{title}</h2>
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

function OverviewLink({
  label,
  description,
  view,
}: {
  label: string
  description: string
  view: SettingsView
}) {
  return (
    <a
      className="flex min-h-16 items-center justify-between gap-4 py-3 outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
      href={routeHref(settingsLink({ kind: "view", view }))}
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <span className="shrink-0 text-sm text-primary">打开</span>
    </a>
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
          <h3 className="text-sm font-medium">恢复系统默认值</h3>
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
                AI、语音、生成服务、发布渠道与存储配置会恢复默认值。项目、配方和作品不会删除，此操作无法撤销。
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
          开启后显示生成流程、底层覆盖项与配方默认配置。日常生产建议保持关闭。
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
      <h3 className="mb-4 text-sm font-medium">{title}</h3>
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

function formatBufferChannel(channel: BufferChannel) {
  const service = channel.service || "unknown"
  const name = channel.displayName || channel.name || channel.id || "unnamed"
  return `${service}: ${name} (${channel.id || "no id"})`
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
    view === "ai-voice" ||
    view === "generation" ||
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
  if (section === "ai-voice") {
    return { llm: settings.llm, tts: settings.comfyui.tts }
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
  if (section === "ai-voice") {
    return { llm: settings.llm, comfyui: { tts: settings.comfyui.tts } }
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
  if (section === "ai-voice") {
    return {
      ...current,
      llm: server.llm,
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
  if (section === "ai-voice") return "AI 与语音"
  if (section === "generation") return "生成引擎"
  return "发布与存储"
}

function replaceHashPath(path: string) {
  window.history.replaceState(null, "", `#${path}`)
  window.dispatchEvent(new HashChangeEvent("hashchange"))
}
