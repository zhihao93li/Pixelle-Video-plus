import { useEffect, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Settings,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  ApiError,
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
  type SettingsDiagnosticCheck,
} from "@/lib/generationApi"

type LoadState = "loading" | "ready" | "error"

const platformLabels = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  x: "X",
  pinterest: "Pinterest",
}

type ActionState = "idle" | "loading" | "testing" | "saving"
type WorkflowKind = "video" | "image" | "tts"

export function SettingsWorkspace() {
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [settings, setSettings] = useState<AppSettingsConfig | null>(null)
  const [configured, setConfigured] = useState(false)
  const [diagnostics, setDiagnostics] = useState<SettingsDiagnosticCheck[]>([])
  const [diagnosticsOk, setDiagnosticsOk] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
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
  const [comfyActionState, setComfyActionState] =
    useState<ActionState>("idle")
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

    async function loadSettings() {
      setLoadState("loading")
      setError(null)
      try {
        const [response, diagnosticsResponse] = await Promise.all([
          getSettingsConfig(),
          getSettingsDiagnostics(),
        ])
        if (cancelled) {
          return
        }
        setSettings(response.config)
        setConfigured(response.configured)
        setDiagnostics(diagnosticsResponse.checks)
        setDiagnosticsOk(diagnosticsResponse.ok)
        setLoadState("ready")
      } catch (loadError) {
        if (!cancelled) {
          setLoadState("error")
          setError(readableError(loadError))
        }
      }
    }

    void loadSettings()

    return () => {
      cancelled = true
    }
  }, [])

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
          templateResult.status === "fulfilled" ? templateResult.value.templates : [],
        mediaWorkflows:
          mediaResult.status === "fulfilled" ? mediaResult.value.workflows : [],
        ttsWorkflows:
          ttsResult.status === "fulfilled" ? ttsResult.value.workflows : [],
      })

      const failures = [bgmResult, templateResult, mediaResult, ttsResult]
        .filter((result) => result.status === "rejected")
        .map((result) => readableError((result as PromiseRejectedResult).reason))
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
    setSettings((current) => (current ? mergeSettings(current, patch) : current))
    setNotice(null)
  }

  async function saveSettings() {
    if (!settings) {
      return
    }
    setIsSaving(true)
    setError(null)
    setNotice(null)
    try {
      const response = await updateSettingsConfig({
        llm: settings.llm,
        comfyui: settings.comfyui,
        publish: settings.publish,
      })
      setSettings(response.config)
      setConfigured(response.configured)
      void refreshDiagnostics()
      setNotice("设置已保存。")
    } catch (saveError) {
      setError(readableError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  async function resetSettings() {
    if (
      !window.confirm(
        "确定要重置系统设置吗？这会恢复默认配置，并影响后续生成、发布和连接测试。"
      )
    ) {
      return
    }

    setIsResetting(true)
    setError(null)
    setNotice(null)
    try {
      const response = await resetSettingsConfig()
      setSettings(response.config)
      setConfigured(response.configured)
      setLlmModels([])
      void refreshDiagnostics()
      setNotice("设置已重置为默认值。")
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
      const response = await testComfyuiConnection(
        settings.comfyui.comfyui_url
      )
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
      const response = await fetchBufferChannels(settings.publish.buffer.api_key)
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
    <main className="mx-auto flex max-w-[1240px] flex-col gap-5 p-4 lg:p-6">
      <Card className="rounded-lg">
        <CardHeader className="border-b">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>系统设置</CardTitle>
              <CardDescription>
                LLM、生成服务、语音、发布服务使用同一份配置。
              </CardDescription>
            </div>
            <Badge variant={configured ? "secondary" : "destructive"}>
              {configured ? "配置可用" : "LLM 未完成"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loadState === "loading" && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在读取设置
            </div>
          )}

          {loadState === "error" && error && (
            <InlineError title="设置读取失败" message={error} />
          )}

          {loadState === "ready" && settings && (
            <div className="flex flex-col gap-5">
              <DiagnosticsPanel checks={diagnostics} ok={diagnosticsOk} />

              <div className="grid gap-5 lg:grid-cols-2">
                <Section title="LLM">
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
                  <Field label="Base URL">
                    <Input disabled value={settings.llm.base_url} />
                  </Field>
                  <Field label="默认模型">
                    {llmModels.length > 0 ? (
                      <select
                        className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                        onChange={(event) =>
                          patchSettings({
                            llm: { ...settings.llm, model: event.target.value },
                          })
                        }
                        value={settings.llm.model}
                      >
                        {llmModels.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
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
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      disabled={llmActionState !== "idle"}
                      onClick={() => void loadModels()}
                      type="button"
                      variant="outline"
                    >
                      {llmActionState === "loading" ? (
                        <Loader2 className="animate-spin" data-icon="inline-start" />
                      ) : (
                        <RefreshCw data-icon="inline-start" />
                      )}
                      加载模型
                    </Button>
                    <Button
                      disabled={llmActionState !== "idle"}
                      onClick={() => void testLlm()}
                      type="button"
                      variant="outline"
                    >
                      {llmActionState === "testing" ? (
                        <Loader2 className="animate-spin" data-icon="inline-start" />
                      ) : (
                        <CheckCircle2 data-icon="inline-start" />
                      )}
                      测试连接
                    </Button>
                  </div>
                  {llmStatus && (
                    <StatusMessage ok={llmStatus.ok} message={llmStatus.message} />
                  )}
                </Section>

                <Section title="ComfyUI / RunningHub">
                  <Field label="ComfyUI URL">
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
                  <Button
                    disabled={comfyActionState !== "idle"}
                    onClick={() => void testComfyui()}
                    type="button"
                    variant="outline"
                  >
                    {comfyActionState === "testing" ? (
                      <Loader2 className="animate-spin" data-icon="inline-start" />
                    ) : (
                      <CheckCircle2 data-icon="inline-start" />
                    )}
                    测试 ComfyUI
                  </Button>
                  {comfyStatus && (
                    <StatusMessage
                      ok={comfyStatus.ok}
                      message={comfyStatus.message}
                    />
                  )}
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
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="并发数">
                      <Input
                        min={1}
                        max={10}
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
                              runninghub_timeout: Number(event.target.value || 600),
                            },
                          })
                        }
                        type="number"
                        value={settings.comfyui.runninghub_timeout ?? 600}
                      />
                    </Field>
                    <Field label="实例类型">
                      <select
                        className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                        onChange={(event) =>
                          patchSettings({
                            comfyui: {
                              ...settings.comfyui,
                              runninghub_instance_type:
                                event.target.value || null,
                            },
                          })
                        }
                        value={settings.comfyui.runninghub_instance_type ?? ""}
                      >
                        <option value="">24G</option>
                        <option value="plus">48G</option>
                      </select>
                    </Field>
                  </div>
                  <Separator />
                  <div className="flex flex-col gap-3">
                    <div>
                      <div className="text-sm font-medium">
                        RunningHub Workflow
                      </div>
                      <div className="text-sm leading-6 text-muted-foreground">
                        注册已有 RunningHub workflow，让生成页和模板配置可以选择它。
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
                      <Field label="类型">
                        <select
                          className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                          onChange={(event) =>
                            setRunninghubDraft((current) => ({
                              ...current,
                              kind: event.target.value as WorkflowKind,
                            }))
                          }
                          value={runninghubDraft.kind}
                        >
                          <option value="video">Video</option>
                          <option value="image">Image</option>
                          <option value="tts">TTS</option>
                        </select>
                      </Field>
                      <Field label="本地名称">
                        <Input
                          onChange={(event) =>
                            setRunninghubDraft((current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                          placeholder="wan2_2_custom"
                          value={runninghubDraft.name}
                        />
                      </Field>
                    </div>
                    <Field label="RunningHub Workflow ID">
                      <Input
                        inputMode="numeric"
                        onChange={(event) =>
                          setRunninghubDraft((current) => ({
                            ...current,
                            workflowId: event.target.value,
                          }))
                        }
                        placeholder="1985909483975188481"
                        value={runninghubDraft.workflowId}
                      />
                    </Field>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        checked={runninghubDraft.overwrite}
                        onChange={(event) =>
                          setRunninghubDraft((current) => ({
                            ...current,
                            overwrite: event.target.checked,
                          }))
                        }
                        type="checkbox"
                      />
                      覆盖同名 workflow
                    </label>
                    <Button
                      disabled={
                        runninghubActionState !== "idle" ||
                        !runninghubDraft.name.trim() ||
                        !runninghubDraft.workflowId.trim()
                      }
                      onClick={() => void addWorkflow()}
                      type="button"
                      variant="outline"
                    >
                      {runninghubActionState === "saving" ? (
                        <Loader2 className="animate-spin" data-icon="inline-start" />
                      ) : (
                        <Plus data-icon="inline-start" />
                      )}
                      添加 Workflow
                    </Button>
                    {runninghubStatus && (
                      <StatusMessage
                        ok={runninghubStatus.ok}
                        message={runninghubStatus.message}
                      />
                    )}
                    {runninghubWorkflows.length > 0 && (
                      <div className="rounded-lg border bg-muted/30 p-3 text-xs leading-5">
                        {runninghubWorkflows.slice(0, 5).map((workflow) => (
                          <div key={workflow.key}>
                            {workflow.key}
                            {" -> "}
                            workflow_id={workflow.workflow_id}
                          </div>
                        ))}
                        {runninghubWorkflows.length > 5 && (
                          <div className="text-muted-foreground">
                            还有 {runninghubWorkflows.length - 5} 个 workflow
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Section>

                <Section title="Fish Audio">
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
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="模型">
                      <select
                        className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                        onChange={(event) =>
                          patchSettings({
                            comfyui: {
                              ...settings.comfyui,
                              tts: {
                                ...settings.comfyui.tts,
                                fish_audio: {
                                  ...settings.comfyui.tts.fish_audio,
                                  model: event.target.value as "s1" | "s2-pro",
                                },
                              },
                            },
                          })
                        }
                        value={settings.comfyui.tts.fish_audio.model}
                      >
                        <option value="s2-pro">s2-pro</option>
                        <option value="s1">s1</option>
                      </select>
                    </Field>
                    <Field label="Reference ID">
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
                  <Field label="Base URL">
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

                <Section title="资源清单">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ResourceMetric
                      label="BGM"
                      value={resourceState.bgm.length}
                    />
                    <ResourceMetric
                      label="Frame templates"
                      value={resourceState.frameTemplates.length}
                    />
                    <ResourceMetric
                      label="Media workflows"
                      value={resourceState.mediaWorkflows.length}
                    />
                    <ResourceMetric
                      label="TTS workflows"
                      value={resourceState.ttsWorkflows.length}
                    />
                  </div>
                  {resourceError && (
                    <InlineError title="资源读取失败" message={resourceError} />
                  )}
                  <div className="rounded-lg bg-muted/40 p-3 text-sm leading-6 text-muted-foreground">
                    这些资源来自后端 `/api/resources/*`，供生成页和模板配置使用；provider
                    选择仍然不进入普通生成主流程。
                  </div>
                </Section>

                <Section title="发布">
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
                    type="button"
                    variant="outline"
                  >
                    {bufferActionState === "loading" ? (
                      <Loader2 className="animate-spin" data-icon="inline-start" />
                    ) : (
                      <RefreshCw data-icon="inline-start" />
                    )}
                    拉取 Buffer Channels
                  </Button>
                  {bufferStatus && (
                    <StatusMessage
                      ok={bufferStatus.ok}
                      message={bufferStatus.message}
                    />
                  )}
                  {bufferChannels.length > 0 && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-xs leading-5">
                      {bufferChannels.slice(0, 5).map((channel) => (
                        <div key={channel.id ?? channel.displayName ?? channel.name}>
                          {formatBufferChannel(channel)}
                        </div>
                      ))}
                      {bufferChannels.length > 5 && (
                        <div className="text-muted-foreground">
                          还有 {bufferChannels.length - 5} 个 channel
                        </div>
                      )}
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries(platformLabels).map(([platform, label]) => (
                      <Field key={platform} label={`${label} Channel ID`}>
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
                  <Separator />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="COS Region">
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
                    <Field label="COS Bucket">
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
                    <Field label="COS SecretId">
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
                    <Field label="COS SecretKey">
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
                  <Field label="COS Public Base URL">
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
                  <Field label="COS Endpoint URL">
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

              {error && <InlineError title="设置保存失败" message={error} />}
              {notice && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-primary">
                  {notice}
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  disabled={isSaving || isResetting}
                  onClick={() => void resetSettings()}
                  size="lg"
                  type="button"
                  variant="destructive"
                >
                  {isResetting ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <RefreshCw data-icon="inline-start" />
                  )}
                  重置设置
                </Button>
                <Button
                  disabled={isSaving || isResetting}
                  onClick={() => void saveSettings()}
                  size="lg"
                >
                  {isSaving ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Save data-icon="inline-start" />
                  )}
                  保存设置
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <Settings className="size-4" />
        {title}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}

function ResourceMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
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
    <div className="rounded-lg border bg-background p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold">生产前置检查</div>
          <div className="mt-1 text-sm leading-6 text-muted-foreground">
            这些检查帮助判断 React 生成、语音、合成和发布链路是否具备生产前置条件。
          </div>
        </div>
        <Badge variant={ok ? "secondary" : "destructive"}>
          {ok ? "关键配置可用" : `${errorCount} 项阻塞`}
        </Badge>
      </div>

      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        {checks.map((check) => (
          <div
            className="rounded-lg border bg-muted/20 p-3 text-sm"
            key={check.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="font-medium">{check.label}</div>
              <Badge variant={diagnosticBadgeVariant(check)}>
                {diagnosticBadgeLabel(check)}
              </Badge>
            </div>
            <div className="mt-2 leading-6 text-muted-foreground">
              {check.message}
            </div>
          </div>
        ))}
      </div>

      {warningCount > 0 && (
        <div className="mt-3 text-sm text-muted-foreground">
          还有 {warningCount} 项不会阻塞页面使用，但会影响部分生成或发布能力。
        </div>
      )}
    </div>
  )
}

function StatusMessage({ ok, message }: { ok: boolean; message: string }) {
  return (
    <div
      className={
        ok
          ? "rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-primary"
          : "rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
      }
    >
      {message}
    </div>
  )
}

function InlineError({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <div>
          <div className="font-medium">{title}</div>
          <div className="mt-1 leading-6">{message}</div>
        </div>
      </div>
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

function readableError(error: unknown) {
  if (error instanceof ApiError) {
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
