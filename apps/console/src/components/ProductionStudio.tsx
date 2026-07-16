import { useCallback, useEffect, useMemo, useState } from "react"
import {
  FileText,
  Layers,
  Loader2,
  Play,
  RefreshCcw,
  UploadCloud,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
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
import { useToast } from "@/components/ui/toast"
import { InlineError } from "@/components/shared/feedback"
import { readableError, voiceLabel } from "@/lib/format"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TooltipProvider } from "@/components/ui/tooltip"
import { FileDropzone } from "@/components/shared/FileDropzone"
import { ProductionSettingsEditor } from "@/components/shared/ProductionSettingsEditor"
import {
  artifactKindLabel,
  isNonVideoPipeline,
  templateArtifactType,
  type ArtifactKind,
} from "@/lib/artifactKind"
import {
  getBatchPreviewBody,
  getBatchPreviewLineCount,
  getBatchPreviewTitle,
  parseFixedScriptItems,
  removeScriptItem,
  type ParsedScriptItem,
} from "@/lib/batchInput"
import { RecipeSelect } from "@/components/shared/RecipeSelect"
import { PageFrame } from "@/components/shared/PageFrame"
import {
  isActiveProductTemplate,
  pipelineChipLabel,
} from "@/lib/templatePresentation"
import { useExpertMode } from "@/lib/expertMode"
import { navigate } from "@/lib/router"
import { useCurrentProject } from "@/lib/currentProject"
import { useLocalStorageState } from "@/lib/useLocalStorageState"
import { frameTemplateLabel } from "@/lib/templateLabels"
import {
  createGenerationDraft,
  resolveGenerationDraft,
  updateGenerationDraft,
  type GenerationDraft,
} from "@/lib/productViewModels"
import {
  assetDraftForTemplate,
  assetDirtyParamKeys,
  assetOverridesToInput,
  assetParamPatch,
  assetSettingsToParams,
  fallbackAssetSettings as defaultAssetAdvancedSettings,
  fallbackLongFormSettings as defaultLongFormSettings,
  fallbackStandardSettings as defaultAdvancedSettings,
  longFormDraftForTemplate,
  longFormDirtyParamKeys,
  longFormOverridesToInput,
  longFormParamPatch,
  longFormSettingsToParams,
  standardDraftForTemplate,
  standardDirtyParamKeys,
  standardOverridesToInput,
  standardParamPatch,
  standardSettingsToParams,
  type AssetGenerationSettings,
  type LongFormGenerationSettings,
  type StandardGenerationSettings,
} from "@/lib/productionDrafts"
import { resolveGenerateTemplate } from "@/lib/productionTemplateResolution"
import {
  useProductionSettingsResources,
  type ProductionSettingsResources,
} from "@/lib/useProductionSettingsResources"
import {
  apiResourceUrl,
  createGenerationTemplateTask,
  createProductionTask,
  generateMediaPreview,
  getFrameTemplateParams,
  getTask,
  listTemplates,
  renderFramePreview,
  synthesizeTtsPreview,
  uploadGenerationAssets,
  uploadResourceBgm,
  type ProductionTemplate,
  type ResourceBgm,
  type ResourceTemplate,
  type UploadedGenerationAsset,
} from "@/lib/generationApi"
import { cn } from "@/lib/utils"

const sampleScript =
  "母猫配完以后还一直叫，不一定说明没有配上。发情期的激素变化不会马上停止，所以它可能还会持续叫几天。真正判断有没有配上，要看后续有没有再次发情、精神食欲是否正常，以及是否需要在合适时间做检查。"
const sampleTopic = "猫咪夏天饮水少，主人应该怎么判断和处理"

type LoadState = "loading" | "ready" | "error"

type StandardAdvancedSettings = StandardGenerationSettings
type AssetAdvancedSettings = AssetGenerationSettings
type LongFormAdvancedSettings = LongFormGenerationSettings
type StandardPreviewSettings = Pick<
  StandardAdvancedSettings,
  "mediaDuration" | "mediaPreviewPrompt" | "ttsRefAudioName"
>

/** 来源标注 v1（脏值比较）：跟踪的覆盖字段，中文名与模板页零件表对齐。 */
const OVERRIDE_TRACKED: Array<{
  key: keyof StandardAdvancedSettings
  label: string
}> = [
  { key: "scriptTemplateName", label: "写稿提示词" },
  { key: "scriptModel", label: "写稿模型" },
  { key: "languageScriptModels", label: "多语言写稿模型" },
  { key: "splitTemplateName", label: "分镜提示词" },
  { key: "splitModel", label: "分镜模型" },
  { key: "ttsInferenceMode", label: "配音引擎" },
  { key: "ttsVoice", label: "音色" },
  { key: "ttsWorkflow", label: "配音 workflow" },
  { key: "ttsSpeed", label: "语速" },
  { key: "frameTemplate", label: "画面模板" },
  { key: "imageProvider", label: "图片生成方式" },
  { key: "imageModel", label: "图片模型" },
  { key: "mediaWorkflow", label: "图片 Workflow" },
  { key: "mediaWidth", label: "画面宽度" },
  { key: "mediaHeight", label: "画面高度" },
  { key: "promptPrefix", label: "生图提示词前缀" },
  { key: "imagePromptVisualContext", label: "生图视觉风格说明" },
  { key: "imagePromptGenerationRules", label: "生图规则说明" },
  { key: "bgmPath", label: "背景音乐文件" },
  { key: "bgmVolume", label: "背景音乐音量" },
  { key: "bgmMode", label: "背景音乐播放方式" },
]

const ASSET_OVERRIDE_TRACKED: Array<{
  key: keyof AssetAdvancedSettings
  label: string
}> = [
  { key: "bgmPath", label: "背景音乐文件" },
  { key: "bgmVolume", label: "背景音乐音量" },
  { key: "bgmMode", label: "背景音乐播放方式" },
  { key: "voiceId", label: "音色" },
  { key: "ttsSpeed", label: "语速" },
]

function previewContentSections(text: string, artifactKind: ArtifactKind) {
  const trimmed = text.trim()
  if (!trimmed || artifactKind === "video") {
    return []
  }

  const chunks =
    artifactKind === "image_set"
      ? trimmed.split(/\n+/)
      : trimmed.split(/\n\s*\n/)

  return chunks
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 4)
}

function frameOrientationLabel(template?: ResourceTemplate) {
  if (!template) {
    return "画面模板"
  }
  if (template.orientation === "portrait") {
    return "竖版"
  }
  if (template.orientation === "landscape") {
    return "横版"
  }
  return "方形"
}

export function GenerateWorkspace({
  templateId,
  remakeTaskId,
}: {
  templateId?: string
  remakeTaskId?: string | null
}) {
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [reloadToken, setReloadToken] = useState(0)
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [template, setTemplate] = useState<ProductionTemplate | null>(null)
  const { projectId } = useCurrentProject()
  const {
    addBgm: addBgmResource,
    error: resourcesError,
    reload: reloadResources,
    resources,
  } = useProductionSettingsResources()
  const draftScope = projectId ?? "unscoped"
  const [script, setScript] = useLocalStorageState(
    `pixelle-draft-script:${draftScope}`,
    ""
  )
  const [topic, setTopic] = useLocalStorageState(
    `pixelle-draft-topic:${draftScope}`,
    ""
  )
  const [standardDraft, setStandardDraft] = useState<
    GenerationDraft<StandardAdvancedSettings>
  >(() => createGenerationDraft(defaultAdvancedSettings))
  const [standardPreviewSettings, setStandardPreviewSettings] =
    useState<StandardPreviewSettings>(() => ({
      mediaDuration: defaultAdvancedSettings.mediaDuration,
      mediaPreviewPrompt: defaultAdvancedSettings.mediaPreviewPrompt,
      ttsRefAudioName: defaultAdvancedSettings.ttsRefAudioName,
    }))
  const [assetFiles, setAssetFiles] = useState<File[]>([])
  const [uploadedAssets, setUploadedAssets] = useState<
    UploadedGenerationAsset[]
  >([])
  const [assetTitle, setAssetTitle] = useState("")
  const [assetIntent, setAssetIntent] = useState(
    "根据这些用户素材制作一条适合小红书发布的 PetWoods 短视频。"
  )
  const [assetDuration, setAssetDuration] = useState(30)
  const [assetDraft, setAssetDraft] = useState<
    GenerationDraft<AssetAdvancedSettings>
  >(() => createGenerationDraft(defaultAssetAdvancedSettings))
  const [longFormDraft, setLongFormDraft] = useState<
    GenerationDraft<LongFormAdvancedSettings>
  >(() => createGenerationDraft(defaultLongFormSettings))
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // 批量提交模式（本页内存态，不持久化）
  const [batchMode, setBatchMode] = useState(false)
  const [batchText, setBatchText] = useState("")
  const toast = useToast()

  useEffect(() => {
    if (!remakeTaskId || !template) return
    let cancelled = false
    void getTask(remakeTaskId)
      .then((previousTask) => {
        if (cancelled) return
        if (!previousTask.request) {
          throw new Error("上一次生产缺少可复用的输入快照。")
        }
        const input = previousTask.request.input
        const finalScript = typeof input.script === "string" ? input.script : ""
        if (finalScript) setScript(finalScript)
        if (typeof input.topic === "string") setTopic(input.topic)
        const previousTemplate = {
          ...template,
          fixed_params: previousTask.request.params,
        }
        setStandardDraft(standardDraftForTemplate(previousTemplate))
        setAssetDraft(assetDraftForTemplate(previousTemplate))
        setLongFormDraft(longFormDraftForTemplate(previousTemplate))
        toast({ title: "已带入上一次实际使用的内容与设置", variant: "success" })
      })
      .catch((error) => setSubmitError(readableError(error)))
    return () => {
      cancelled = true
    }
  }, [remakeTaskId, setScript, setTopic, template, toast])
  const advancedSettings = {
    ...resolveGenerationDraft(standardDraft),
    ...standardPreviewSettings,
  }
  const assetAdvancedSettings = resolveGenerationDraft(assetDraft)

  const changeAdvancedSettings = useCallback(
    (value: StandardAdvancedSettings) => {
      const {
        mediaDuration,
        mediaPreviewPrompt,
        ttsRefAudioName,
        ...productionValue
      } = value
      setStandardPreviewSettings({
        mediaDuration,
        mediaPreviewPrompt,
        ttsRefAudioName,
      })
      setStandardDraft((current) =>
        updateGenerationDraft(current, productionValue)
      )
    },
    []
  )

  const changeAssetAdvancedSettings = useCallback(
    (value: AssetAdvancedSettings) => {
      setAssetDraft((current) => updateGenerationDraft(current, value))
    },
    []
  )

  const trimmedScript = script.trim()
  const trimmedTopic = topic.trim()
  const trimmedAssetTitle = assetTitle.trim()
  const trimmedAssetIntent = assetIntent.trim()
  const templateNeedsAssets = Boolean(
    template?.requires_user_assets ||
    template?.input_requirements.includes("assets")
  )
  const templateNeedsTopic = Boolean(
    template?.input_requirements.includes("topic")
  )
  // 非视频产线（图文线 / 长文线）：无配音/画面/合成视频，隐藏视频专属输入与承诺文案
  const isNonVideo = isNonVideoPipeline(template?.pipeline_id)
  const nonVideoArtifact = templateArtifactType(template?.pipeline_id)
  // 批量是「任何 script 入口模板生成页的一种提交模式」——topic/assets 入口不支持
  const canBatch = Boolean(
    template &&
    template.input_requirements.includes("script") &&
    !templateNeedsAssets &&
    !templateNeedsTopic
  )
  const inBatch = batchMode && canBatch
  const batchItems = useMemo(
    () => parseFixedScriptItems(batchText),
    [batchText]
  )
  // 提交前总结：本次覆盖了哪些模板默认（来源标注 v1，脏值比较）
  const standardOverriddenLabels = OVERRIDE_TRACKED.filter(({ key }) =>
    standardDraft.dirtyKeys.includes(key)
  ).map(({ label }) => label)
  const assetOverriddenLabels = ASSET_OVERRIDE_TRACKED.filter(({ key }) =>
    assetDraft.dirtyKeys.includes(key)
  ).map(({ label }) => label)
  const longFormOverriddenLabels = longFormDraft.dirtyKeys.map((key) =>
    key === "wordCount"
      ? "目标字数"
      : key === "longFormPrompt"
        ? "长文提示词"
        : "写作模型"
  )
  const overriddenLabels = templateNeedsAssets
    ? assetOverriddenLabels
    : nonVideoArtifact === "text"
      ? longFormOverriddenLabels
      : standardOverriddenLabels
  const overrideSummary =
    overriddenLabels.length > 0
      ? `本次覆盖 ${overriddenLabels.length} 项（${overriddenLabels.join("、")}）`
      : "全部沿用模板默认"
  const selectedPipeline = resources.pipelines.find(
    (item) => item.id === template?.pipeline_id
  )
  const confirmationSummary =
    selectedPipeline?.stages
      .filter((stage) => stage.actor === "user")
      .map((stage) => stage.name)
      .join("、") || "无需中间确认"
  const selectedFrameTemplate = resources.frameTemplates.find(
    (item) => item.key === advancedSettings.frameTemplate
  )
  const selectedBgm = resources.bgm.find(
    (item) => item.path === advancedSettings.bgmPath
  )
  const resolvedLongFormSettings = resolveGenerationDraft(longFormDraft)
  const settingsSummary = templateNeedsAssets
    ? `${voiceLabel(assetAdvancedSettings.voiceId) || "模板默认音色"} · ${
        resources.bgm.find(
          (item) => item.path === assetAdvancedSettings.bgmPath
        )?.name || "无背景音乐"
      }`
    : nonVideoArtifact === "text"
      ? `${resolvedLongFormSettings.wordCount} 字 · ${
          resolvedLongFormSettings.llmModel || "系统默认模型"
        }`
      : nonVideoArtifact === "image_set"
        ? `${frameOrientationLabel(selectedFrameTemplate)} · ${frameTemplateLabel(
            selectedFrameTemplate?.key || advancedSettings.frameTemplate
          )}`
        : `${frameOrientationLabel(selectedFrameTemplate)} · ${voiceLabel(
            advancedSettings.ttsVoice
          )} · ${frameTemplateLabel(
            selectedFrameTemplate?.key || advancedSettings.frameTemplate
          )} · ${selectedBgm?.name || "无背景音乐"}`
  const selectedFramePreviewUrl = apiResourceUrl(
    selectedFrameTemplate?.preview_url
  )
  const previewSourceText = templateNeedsAssets
    ? trimmedAssetIntent || trimmedAssetTitle
    : templateNeedsTopic
      ? topic
      : script
  const batchMeasureWord = nonVideoArtifact === "text" ? "篇" : "条"
  const batchOutputNoun =
    nonVideoArtifact === "text"
      ? "长文"
      : nonVideoArtifact === "image_set"
        ? "图文帖"
        : "视频"
  const templateCanSubmit = Boolean(
    template &&
    template.enabled &&
    ((template.input_requirements.includes("script") &&
      !template.requires_user_assets) ||
      template.input_requirements.includes("topic") ||
      template.input_requirements.includes("assets"))
  )
  const hasRequiredTemplateInput = templateNeedsAssets
    ? assetFiles.length > 0
    : templateNeedsTopic
      ? trimmedTopic.length > 0
      : trimmedScript.length > 0
  const canSubmit =
    loadState === "ready" &&
    templateCanSubmit &&
    hasRequiredTemplateInput &&
    !isSubmitting
  const submitDisabledReason = canSubmit
    ? null
    : isSubmitting
      ? null
      : loadState !== "ready"
        ? "正在读取可用模板"
        : !templateCanSubmit
          ? "当前模板暂不支持在此页提交"
          : templateNeedsAssets
            ? "请先选择素材文件"
            : templateNeedsTopic
              ? "请先输入选题"
              : "请先输入文案"

  useEffect(() => {
    let cancelled = false

    async function loadTemplates() {
      setLoadState("loading")
      setTemplatesError(null)
      try {
        // 默认模板 = 项目默认 > 全局（后端按 project 解析 default_template）
        const response = await listTemplates(projectId ?? undefined)
        if (cancelled) {
          return
        }

        const resolution = resolveGenerateTemplate(
          response.templates,
          templateId,
          response.default_template
        )
        if (!resolution.ok) {
          setTemplates(response.templates)
          setTemplate(null)
          setLoadState("error")
          setTemplatesError(resolution.error)
          return
        }

        const selected = resolution.template
        const nextStandardDraft = standardDraftForTemplate(selected)
        setTemplates(response.templates)
        setTemplate(selected)
        setStandardDraft(nextStandardDraft)
        setStandardPreviewSettings({
          mediaDuration: nextStandardDraft.defaults.mediaDuration,
          mediaPreviewPrompt: nextStandardDraft.defaults.mediaPreviewPrompt,
          ttsRefAudioName: nextStandardDraft.defaults.ttsRefAudioName,
        })
        setAssetDraft(assetDraftForTemplate(selected))
        setLongFormDraft(longFormDraftForTemplate(selected))
        setLoadState("ready")
      } catch (error) {
        if (cancelled) {
          return
        }
        setLoadState("error")
        setTemplatesError(readableError(error))
      }
    }

    loadTemplates()

    return () => {
      cancelled = true
    }
  }, [reloadToken, templateId, projectId])

  async function submitTask() {
    if (!template || !canSubmit || !projectId) {
      if (!projectId) setSubmitError("请先选择项目。")
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      let response
      if (templateNeedsAssets) {
        const uploadResponse = await uploadGenerationAssets(assetFiles)
        const uploaded = uploadResponse.assets
        setUploadedAssets(uploaded)
        response = await createGenerationTemplateTask(
          template.id,
          template.pipeline_id,
          {
            assets: uploaded.map((asset) => asset.path),
            video_title: trimmedAssetTitle,
            intent: trimmedAssetIntent || trimmedAssetTitle,
            duration: assetDuration,
          },
          projectId,
          assetOverridesToInput(template, assetDraft.overrides)
        )
      } else {
        const runOverrides = {
          ...standardOverridesToInput(template, standardDraft.overrides),
          ...longFormOverridesToInput(template, longFormDraft.overrides),
        }
        const { title: inputTitle, ...productionOverrides } = runOverrides
        response = await createGenerationTemplateTask(
          template.id,
          template.pipeline_id,
          buildStandardTemplateInput({
            script: trimmedScript,
            template,
            topic: trimmedTopic,
            title: typeof inputTitle === "string" ? inputTitle : "",
          }),
          projectId,
          productionOverrides
        )
      }
      toast({
        title: "生产任务已创建",
        description: response.task.stage_label,
        variant: "success",
      })
      navigate(`/board/tasks/${response.production_task_id}`)
    } catch (error) {
      setSubmitError(readableError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submitBatch() {
    if (!template || !projectId || batchItems.length === 0 || isSubmitting) {
      return
    }
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      // 每条使用自己的 script 与首行标题，其余本次设置作为共享参数。
      const runOverrides = {
        ...standardOverridesToInput(template, standardDraft.overrides),
        ...longFormOverridesToInput(template, longFormDraft.overrides),
      }
      const productionOverrides = { ...runOverrides }
      delete productionOverrides.title
      const items = batchItems.map((item) => ({
        input: buildStandardTemplateInput({
          template,
          script: item.input.script,
          topic: "",
          title: item.input.title,
        }),
        overrides: productionOverrides,
      }))
      const results = await Promise.allSettled(
        items.map((item) =>
          createProductionTask({
            projectId,
            pipelineId: template.pipeline_id,
            recipeId: template.id,
            payload: item.input,
            overrides: item.overrides,
            source: "react",
          })
        )
      )
      const createdCount = results.filter(
        (result) => result.status === "fulfilled"
      ).length
      const failedCount = results.length - createdCount
      if (createdCount === 0) {
        const firstFailure = results.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected"
        )
        throw firstFailure?.reason ?? new Error("批量任务创建失败。")
      }
      toast({
        title: `已创建 ${createdCount} 条独立任务`,
        description: failedCount
          ? `${failedCount} 条未能创建，请单独检查输入。`
          : undefined,
        variant: failedCount ? "default" : "success",
      })
      navigate("/board")
    } catch (error) {
      setSubmitError(readableError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  /**
   * 页头下拉换模板：选择器只列启用的 generate 模板，故直接切换 + 同步 URL，
   * 已输入文案保留（现状行为）。若新模板不支持批量（素材/选题入口），落回单条
   * 模式但保留 batchText 以免丢字。
   */
  function handleSelectTemplate(nextTemplate: ProductionTemplate) {
    const nextCanBatch =
      nextTemplate.input_requirements.includes("script") &&
      !nextTemplate.requires_user_assets &&
      !nextTemplate.input_requirements.includes("assets") &&
      !nextTemplate.input_requirements.includes("topic")
    if (!nextCanBatch) {
      setBatchMode(false)
    }
    setTemplate(nextTemplate)
    setLongFormDraft(longFormDraftForTemplate(nextTemplate))
    navigate(`/create/generate/${nextTemplate.id}`)
  }

  return (
    <TooltipProvider>
      <PageFrame className="gap-0">
        <div className="mb-4 flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <TemplateSummaryBar
              error={templatesError}
              loadState={loadState}
              onReload={() => setReloadToken((token) => token + 1)}
              onSelect={handleSelectTemplate}
              template={template}
              templates={templates}
            />
          </div>
          {loadState === "ready" && template ? (
            <div className="hidden shrink-0 lg:block">
              <GenerationSubmitControl
                batchCount={batchItems.length}
                batchMeasureWord={batchMeasureWord}
                batchOutputNoun={batchOutputNoun}
                canSubmit={canSubmit}
                inBatch={inBatch}
                isSubmitting={isSubmitting}
                onSubmitBatch={submitBatch}
                onSubmitTask={submitTask}
                submitDisabledReason={submitDisabledReason}
                templateNeedsAssets={templateNeedsAssets}
              />
            </div>
          ) : null}
        </div>

        {loadState === "ready" && template ? (
          <>
            <div
              className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,min(42%,720px))] xl:gap-5"
              data-slot="production-workspace"
            >
              <section
                className="flex min-w-0 flex-col gap-5"
                data-slot="production-editor"
              >
                <Card className="min-h-[640px] rounded-lg xl:min-h-[calc(100svh-10.25rem)]">
                  <CardHeader className="border-b">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle>
                          {templateNeedsAssets
                            ? "上传素材"
                            : templateNeedsTopic
                              ? "输入选题"
                              : "填入文案"}
                        </CardTitle>
                        <CardDescription>
                          {templateNeedsAssets
                            ? "上传你的照片或视频，AI 会围绕它们组织旁白和镜头。"
                            : templateNeedsTopic
                              ? "只需一个选题，AI 会自动撰写文案并完成配音、画面和合成。"
                              : nonVideoArtifact === "text"
                                ? "文案将扩写成结构化长文，不配音、不合成视频。"
                                : nonVideoArtifact === "image_set"
                                  ? "文案将逐行排版成图集，不配音、不合成视频。"
                                  : "文案不会被改写，将按原文进行拆分、配音、配画面并合成视频。"}
                        </CardDescription>
                      </div>
                      {canBatch && (
                        <ToggleGroup
                          onValueChange={(value) => {
                            if (value) {
                              setBatchMode(value === "batch")
                            }
                          }}
                          type="single"
                          value={inBatch ? "batch" : "single"}
                          variant="outline"
                        >
                          <ToggleGroupItem value="single">单条</ToggleGroupItem>
                          <ToggleGroupItem value="batch">批量</ToggleGroupItem>
                        </ToggleGroup>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {!templateCanSubmit && loadState === "ready" && (
                      <InlineError
                        title="当前模板暂不支持在此页提交"
                        message="请更换一个可用模板，或前往对应的专用入口。"
                      />
                    )}

                    <div className="mt-5">
                      {templateNeedsAssets ? (
                        <AssetInput
                          assetAdvancedDefaults={assetDraft.defaults}
                          assetAdvancedSettings={assetAdvancedSettings}
                          assetDuration={assetDuration}
                          assetFiles={assetFiles}
                          assetIntent={assetIntent}
                          assetTitle={assetTitle}
                          dirtyKeys={assetDraft.dirtyKeys}
                          onAssetAdvancedSettingsChange={
                            changeAssetAdvancedSettings
                          }
                          onResetAdvancedSettings={() =>
                            setAssetDraft(
                              createGenerationDraft(assetDraft.defaults)
                            )
                          }
                          onBgmUploaded={addBgmResource}
                          onAssetDurationChange={setAssetDuration}
                          onAssetFilesChange={(files) => {
                            setAssetFiles(files)
                            setUploadedAssets([])
                            setSubmitError(null)
                          }}
                          onAssetIntentChange={setAssetIntent}
                          onAssetTitleChange={setAssetTitle}
                          resources={resources}
                          resourcesError={resourcesError}
                          onResourcesReload={reloadResources}
                          template={template}
                          uploadedAssets={uploadedAssets}
                        />
                      ) : templateNeedsTopic ? (
                        <StandardInput
                          advancedDefaults={standardDraft.defaults}
                          advancedDirtyKeys={standardDraft.dirtyKeys}
                          advancedSettings={advancedSettings}
                          inputKind="topic"
                          longFormDraft={longFormDraft}
                          onBgmUploaded={addBgmResource}
                          onAdvancedReset={() =>
                            setStandardDraft(
                              createGenerationDraft(standardDraft.defaults)
                            )
                          }
                          onAdvancedSettingsChange={changeAdvancedSettings}
                          onLongFormDraftChange={setLongFormDraft}
                          onTextChange={setTopic}
                          resources={resources}
                          resourcesError={resourcesError}
                          onResourcesReload={reloadResources}
                          sampleText={sampleTopic}
                          template={template}
                          text={topic}
                        />
                      ) : (
                        <StandardInput
                          advancedDefaults={standardDraft.defaults}
                          advancedDirtyKeys={standardDraft.dirtyKeys}
                          advancedSettings={advancedSettings}
                          artifactKind={nonVideoArtifact}
                          batchItems={batchItems}
                          batchMode={inBatch}
                          batchText={batchText}
                          inputKind="script"
                          isNonVideo={isNonVideo}
                          longFormDraft={longFormDraft}
                          onBatchTextChange={setBatchText}
                          onBgmUploaded={addBgmResource}
                          onAdvancedReset={() =>
                            setStandardDraft(
                              createGenerationDraft(standardDraft.defaults)
                            )
                          }
                          onAdvancedSettingsChange={changeAdvancedSettings}
                          onLongFormDraftChange={setLongFormDraft}
                          onRemoveBatchItem={(index) =>
                            setBatchText((current) =>
                              removeScriptItem(current, index)
                            )
                          }
                          onTextChange={setScript}
                          resources={resources}
                          resourcesError={resourcesError}
                          onResourcesReload={reloadResources}
                          sampleText={sampleScript}
                          template={template}
                          text={script}
                        />
                      )}
                    </div>

                    {submitError && (
                      <InlineError title="提交失败" message={submitError} />
                    )}
                  </CardContent>
                </Card>
              </section>

              {inBatch ? (
                <aside
                  className="flex min-w-0 flex-col gap-5 xl:sticky xl:top-[5.5rem] xl:self-start"
                  data-slot="production-rail"
                >
                  <Card className="flex min-h-[420px] flex-col rounded-lg xl:min-h-[calc(100svh-10.25rem)]">
                    <CardHeader className="border-b">
                      <CardTitle>批量提交</CardTitle>
                      <CardDescription>
                        每条一个独立任务，共享本次设置；提交后统一去工作台查看。
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-1 items-center justify-center text-center">
                      <div className="max-w-sm text-sm leading-6 text-muted-foreground">
                        {batchItems.length > 0
                          ? `已解析 ${batchItems.length} ${batchMeasureWord}`
                          : "在左侧粘贴多条内容开始批量。"}
                      </div>
                    </CardContent>
                  </Card>
                </aside>
              ) : (
                <TaskPanel
                  artifactKind={nonVideoArtifact}
                  confirmationSummary={confirmationSummary}
                  framePreviewUrl={selectedFramePreviewUrl}
                  isSubmitting={isSubmitting}
                  previewText={previewSourceText}
                  overrideSummary={overrideSummary}
                  settingsSummary={settingsSummary}
                  template={template}
                />
              )}
            </div>

            <div className="sticky bottom-[calc(4.25rem+var(--safe-area-bottom))] z-20 mt-4 border-t bg-background/95 px-1 py-3 backdrop-blur lg:hidden">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="truncate">{overrideSummary}</span>
                <span className="shrink-0">
                  {template?.estimated_turnaround || "约 2 分钟"}
                </span>
              </div>
              <GenerationSubmitControl
                batchCount={batchItems.length}
                batchMeasureWord={batchMeasureWord}
                batchOutputNoun={batchOutputNoun}
                canSubmit={canSubmit}
                className="w-full"
                inBatch={inBatch}
                isSubmitting={isSubmitting}
                onSubmitBatch={submitBatch}
                onSubmitTask={submitTask}
                submitDisabledReason={submitDisabledReason}
                templateNeedsAssets={templateNeedsAssets}
              />
            </div>
          </>
        ) : null}
      </PageFrame>
    </TooltipProvider>
  )
}

function GenerationSubmitControl({
  inBatch,
  batchCount,
  batchMeasureWord,
  batchOutputNoun,
  isSubmitting,
  canSubmit,
  templateNeedsAssets,
  submitDisabledReason,
  className,
  onSubmitTask,
  onSubmitBatch,
}: {
  inBatch: boolean
  batchCount: number
  batchMeasureWord: string
  batchOutputNoun: string
  isSubmitting: boolean
  canSubmit: boolean
  templateNeedsAssets: boolean
  submitDisabledReason: string | null
  className?: string
  onSubmitTask: () => Promise<void>
  onSubmitBatch: () => Promise<void>
}) {
  if (inBatch) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            className={className}
            disabled={batchCount === 0 || isSubmitting}
            size="lg"
          >
            {isSubmitting ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Layers data-icon="inline-start" />
            )}
            {isSubmitting
              ? "正在提交…"
              : `批量生成 ${batchCount} ${batchMeasureWord}${batchOutputNoun}`}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              批量生成 {batchCount} {batchMeasureWord}
              {batchOutputNoun}？
            </AlertDialogTitle>
            <AlertDialogDescription>
              每条会占用一次生成额度。提交后可以在当前页面或「任务」中查看进度，失败项目可单独重试。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>再检查一下</AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: "default" }))}
              onClick={() => void onSubmitBatch()}
            >
              确认提交
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        className={className}
        disabled={!canSubmit}
        onClick={() => void onSubmitTask()}
        size="lg"
      >
        {isSubmitting ? (
          <Loader2 className="animate-spin" data-icon="inline-start" />
        ) : templateNeedsAssets ? (
          <UploadCloud data-icon="inline-start" />
        ) : (
          <Play data-icon="inline-start" />
        )}
        {isSubmitting
          ? templateNeedsAssets
            ? "正在上传并提交…"
            : "正在提交…"
          : "开始生成"}
      </Button>
      {submitDisabledReason && (
        <span className="max-w-56 text-right text-xs text-muted-foreground">
          {submitDisabledReason}
        </span>
      )}
    </div>
  )
}

function TemplateSummaryBar({
  loadState,
  template,
  templates,
  error,
  onReload,
  onSelect,
}: {
  loadState: LoadState
  template: ProductionTemplate | null
  templates: ProductionTemplate[]
  error: string | null
  onReload: () => void
  onSelect: (template: ProductionTemplate) => void
}) {
  if (loadState === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在读取可用模板
      </div>
    )
  }

  if (loadState === "error") {
    return (
      <div className="flex flex-col gap-3">
        <InlineError title="模板读取失败" message={error || "未知错误"} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={onReload} variant="outline">
            <RefreshCcw data-icon="inline-start" />
            重试
          </Button>
          <Button onClick={() => navigate("/create")} variant="ghost">
            返回快速生产
          </Button>
        </div>
      </div>
    )
  }

  if (!template) {
    return null
  }

  // 只列启用、非退役、可使用通用生成页的模板。
  // 兜底：当前模板即便被过滤掉（异常态）也保留在可选项，避免下拉空白。
  const selectable = templates.filter(isActiveProductTemplate)
  const options = selectable.some((item) => item.id === template.id)
    ? selectable
    : [template, ...selectable]

  return (
    <div className="flex flex-col gap-2 border-b pb-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <RecipeSelect
            onChange={onSelect}
            templates={options}
            triggerClassName="w-full sm:w-[260px]"
            value={template.id}
          />
          <Badge variant="outline">
            {pipelineChipLabel(template.pipeline_id)} ·{" "}
            {artifactKindLabel(templateArtifactType(template.pipeline_id))}
          </Badge>
          <Badge variant="outline">预计 {template.estimated_turnaround}</Badge>
        </div>
        <button
          className="shrink-0 self-start text-xs text-primary transition-colors hover:underline sm:self-auto"
          onClick={() => navigate(`/create/recipes/${template.id}`)}
          type="button"
        >
          调整默认模板
        </button>
      </div>
      <p className="line-clamp-1 text-xs leading-5 text-muted-foreground">
        {template.description}
      </p>
    </div>
  )
}

function StandardInput({
  inputKind,
  text,
  advancedDefaults,
  advancedDirtyKeys,
  advancedSettings,
  resources,
  resourcesError,
  sampleText,
  template,
  isNonVideo = false,
  artifactKind = "video",
  batchMode = false,
  batchText = "",
  batchItems = [],
  longFormDraft,
  onBatchTextChange,
  onRemoveBatchItem,
  onTextChange,
  onAdvancedReset,
  onAdvancedSettingsChange,
  onBgmUploaded,
  onLongFormDraftChange,
  onResourcesReload,
}: {
  inputKind: "script" | "topic"
  text: string
  advancedDefaults: StandardAdvancedSettings
  advancedDirtyKeys: Array<keyof StandardAdvancedSettings>
  advancedSettings: StandardAdvancedSettings
  resources: ProductionSettingsResources
  resourcesError: string | null
  onResourcesReload: () => void
  sampleText?: string
  template: ProductionTemplate
  isNonVideo?: boolean
  artifactKind?: ArtifactKind
  batchMode?: boolean
  batchText?: string
  batchItems?: ParsedScriptItem[]
  longFormDraft: GenerationDraft<LongFormAdvancedSettings>
  onBatchTextChange?: (value: string) => void
  onRemoveBatchItem?: (index: number) => void
  onTextChange: (value: string) => void
  onAdvancedReset: () => void
  onAdvancedSettingsChange: (value: StandardAdvancedSettings) => void
  onBgmUploaded: (bgm: ResourceBgm) => void
  onLongFormDraftChange: (
    draft: GenerationDraft<LongFormAdvancedSettings>
  ) => void
}) {
  const trimmedText = text.trim()
  const inputId = inputKind === "topic" ? "topic" : "script"
  const title =
    inputKind === "topic" ? "选题或内容方向" : isNonVideo ? "文案" : "视频文案"
  const description =
    inputKind === "topic"
      ? "AI 会先撰写文案，再继续拆分、配音、画面生成和合成。"
      : artifactKind === "text"
        ? "这段文字会扩写成结构化长文，不配音、不合成视频。"
        : artifactKind === "image_set"
          ? "这段文字会逐行排版成图集，不配音、不合成视频。"
          : "这段文字会按原文拆分、配音、配画面并合成视频。"
  const batchListLabel = artifactKind === "text" ? "稿件列表" : "文案列表"
  const batchListHint =
    artifactKind === "text"
      ? "每篇会按模板的长文提示词扩写成结构化 markdown，换行不影响结果。"
      : artifactKind === "image_set"
        ? "用 --- 单独一行分隔多条；每条首行作标题。图文线按行分页，注意换行即分页。"
        : "用 --- 单独一行分隔多条；每条首行作标题。"
  const expertMode = useExpertMode()
  const previewText =
    previewCopy(inputKind, text, advancedSettings.title) ||
    "这是一段用于预览画面与声音的示例文案。"
  const standardValues = standardSettingsToParams(advancedSettings)
  const standardDefaults = standardSettingsToParams(advancedDefaults)
  const longValues = longFormSettingsToParams(
    resolveGenerationDraft(longFormDraft)
  )
  const longDefaults = longFormSettingsToParams(longFormDraft.defaults)
  const isLongForm = artifactKind === "text"
  const values = isLongForm
    ? { ...standardValues, ...longValues }
    : standardValues
  const inheritedValues = isLongForm
    ? { ...standardDefaults, ...longDefaults }
    : standardDefaults
  const settingsDirtyKeys = [
    ...standardDirtyParamKeys(advancedDirtyKeys),
    ...(isLongForm ? longFormDirtyParamKeys(longFormDraft.dirtyKeys) : []),
  ]
  const keys = template.allowed_user_params.filter(
    (key) => !(batchMode && key === "title")
  )

  function patchAdvanced(patch: Partial<StandardAdvancedSettings>) {
    onAdvancedSettingsChange({ ...advancedSettings, ...patch })
  }

  function changeSetting(key: string, value: unknown) {
    const standardPatch = standardParamPatch(key, value)
    if (Object.keys(standardPatch).length > 0) {
      patchAdvanced(standardPatch)
      return
    }
    const longPatch = longFormParamPatch(key, value)
    if (Object.keys(longPatch).length > 0) {
      onLongFormDraftChange(updateGenerationDraft(longFormDraft, longPatch))
    }
  }

  function resetSetting(key: string) {
    const standardDefault = standardDefaults[key]
    const standardPatch = standardParamPatch(key, standardDefault)
    if (Object.keys(standardPatch).length > 0) {
      patchAdvanced(standardPatch)
      return
    }
    const longPatch = longFormParamPatch(key, longDefaults[key])
    if (Object.keys(longPatch).length > 0) {
      onLongFormDraftChange(updateGenerationDraft(longFormDraft, longPatch))
    }
  }

  function changeSettings(changes: Record<string, unknown>) {
    let standardPatch: Partial<StandardAdvancedSettings> = {}
    let longPatch: Partial<LongFormAdvancedSettings> = {}
    for (const [key, value] of Object.entries(changes)) {
      standardPatch = { ...standardPatch, ...standardParamPatch(key, value) }
      longPatch = { ...longPatch, ...longFormParamPatch(key, value) }
    }
    if (Object.keys(standardPatch).length > 0) {
      onAdvancedSettingsChange({ ...advancedSettings, ...standardPatch })
    }
    if (Object.keys(longPatch).length > 0) {
      onLongFormDraftChange(updateGenerationDraft(longFormDraft, longPatch))
    }
  }

  const actions = useMemo(
    () => ({
      previewText,
      renderFrame: renderFramePreview,
      synthesizeTts: synthesizeTtsPreview,
      generateMedia: generateMediaPreview,
      getTemplateParams: getFrameTemplateParams,
      uploadBgm: async (file: File) => (await uploadResourceBgm(file)).bgm_file,
      uploadAudio: async (file: File) => {
        const asset = (await uploadGenerationAssets([file])).assets[0]
        if (!asset || asset.kind !== "audio") {
          throw new Error("上传的文件不是可用的音频。")
        }
        return asset
      },
      onBgmUploaded,
    }),
    [onBgmUploaded, previewText]
  )

  function resetAll() {
    onAdvancedReset()
    if (isLongForm) {
      onLongFormDraftChange(createGenerationDraft(longFormDraft.defaults))
    }
  }

  function resetSettings(keysToReset: string[]) {
    changeSettings(
      Object.fromEntries(keysToReset.map((key) => [key, inheritedValues[key]]))
    )
  }

  return (
    <FieldGroup>
      {batchMode ? (
        <BatchScriptInput
          artifactKind={artifactKind}
          hint={batchListHint}
          items={batchItems}
          label={batchListLabel}
          onRemoveItem={onRemoveBatchItem}
          onTextChange={onBatchTextChange}
          text={batchText}
        />
      ) : (
        <Field data-invalid={!trimmedText && text.length > 0}>
          <FieldLabel htmlFor={inputId}>{title}</FieldLabel>
          <Textarea
            aria-invalid={!trimmedText && text.length > 0}
            className="min-h-64 resize-y text-base leading-7 lg:min-h-[22rem]"
            id={inputId}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder={
              inputKind === "topic"
                ? "例如：猫咪夏天饮水少，主人应该怎么判断和处理"
                : artifactKind === "text"
                  ? "粘贴或输入需要扩写的长文素材…"
                  : artifactKind === "image_set"
                    ? "粘贴或输入图文文案；换行可作为分页依据…"
                    : "粘贴或输入完整视频文案…"
            }
            value={text}
          />
          <FieldDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{description}</span>
            {sampleText && !trimmedText ? (
              <Button
                onClick={() => onTextChange(sampleText)}
                size="xs"
                type="button"
                variant="ghost"
              >
                填入示例
              </Button>
            ) : null}
          </FieldDescription>
        </Field>
      )}

      <ProductionSettingsEditor
        actions={actions}
        dirtyKeys={settingsDirtyKeys}
        expertMode={expertMode}
        inheritedValues={inheritedValues}
        keys={keys}
        mode="run"
        onChange={changeSetting}
        onChangeMany={changeSettings}
        onReset={resetSetting}
        onResetAll={resetAll}
        onResetMany={resetSettings}
        onResourcesReload={onResourcesReload}
        presentation="quick"
        resources={resources}
        resourcesError={resourcesError}
        savedOverrides={{}}
        template={template}
        values={values}
      />
    </FieldGroup>
  )
}

function AssetInput({
  assetFiles,
  uploadedAssets,
  assetTitle,
  assetIntent,
  assetDuration,
  assetAdvancedDefaults,
  assetAdvancedSettings,
  dirtyKeys,
  resources,
  resourcesError,
  template,
  onAssetFilesChange,
  onAssetTitleChange,
  onAssetIntentChange,
  onAssetDurationChange,
  onAssetAdvancedSettingsChange,
  onResetAdvancedSettings,
  onBgmUploaded,
  onResourcesReload,
}: {
  assetFiles: File[]
  uploadedAssets: UploadedGenerationAsset[]
  assetTitle: string
  assetIntent: string
  assetDuration: number
  assetAdvancedDefaults: AssetAdvancedSettings
  assetAdvancedSettings: AssetAdvancedSettings
  dirtyKeys: Array<keyof AssetAdvancedSettings>
  resources: ProductionSettingsResources
  resourcesError: string | null
  onResourcesReload: () => void
  template: ProductionTemplate
  onAssetFilesChange: (files: File[]) => void
  onAssetTitleChange: (value: string) => void
  onAssetIntentChange: (value: string) => void
  onAssetDurationChange: (value: number) => void
  onAssetAdvancedSettingsChange: (value: AssetAdvancedSettings) => void
  onResetAdvancedSettings: () => void
  onBgmUploaded: (bgm: ResourceBgm) => void
}) {
  const expertMode = useExpertMode()
  const values = assetSettingsToParams(assetAdvancedSettings)
  const inheritedValues = assetSettingsToParams(assetAdvancedDefaults)
  const settingDirtyKeys = assetDirtyParamKeys(dirtyKeys)
  const actions = useMemo(
    () => ({
      previewText:
        assetIntent.trim() ||
        assetTitle.trim() ||
        "这是一段用于预览声音的示例文案。",
      synthesizeTts: synthesizeTtsPreview,
      uploadBgm: async (file: File) => (await uploadResourceBgm(file)).bgm_file,
      onBgmUploaded,
    }),
    [assetIntent, assetTitle, onBgmUploaded]
  )

  function patchAssetAdvanced(patch: Partial<AssetAdvancedSettings>) {
    onAssetAdvancedSettingsChange({ ...assetAdvancedSettings, ...patch })
  }

  function changeSetting(key: string, value: unknown) {
    patchAssetAdvanced(assetParamPatch(key, value))
  }

  function resetSetting(key: string) {
    patchAssetAdvanced(assetParamPatch(key, inheritedValues[key]))
  }

  function resetSettings(keysToReset: string[]) {
    let patch: Partial<AssetAdvancedSettings> = {}
    keysToReset.forEach((key) => {
      patch = { ...patch, ...assetParamPatch(key, inheritedValues[key]) }
    })
    patchAssetAdvanced(patch)
  }

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="assets">图片或视频素材</FieldLabel>
        <FileDropzone
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm"
          files={assetFiles}
          hint="支持图片和视频，可多选"
          id="assets"
          onFilesChange={onAssetFilesChange}
        />
        <FieldDescription>提交时会先上传素材，再开始生成。</FieldDescription>
      </Field>

      {uploadedAssets.length > 0 ? (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-primary">
          已上传 {uploadedAssets.length} 个素材，并提交给当前生成任务。
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
        <Field>
          <FieldLabel htmlFor="asset-title">视频标题</FieldLabel>
          <Input
            id="asset-title"
            onChange={(event) => onAssetTitleChange(event.target.value)}
            placeholder="可选，例如：猫咪玩具日常"
            value={assetTitle}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="asset-duration">目标时长</FieldLabel>
          <Input
            id="asset-duration"
            max={120}
            min={15}
            onChange={(event) =>
              onAssetDurationChange(Number(event.target.value || 30))
            }
            step={5}
            type="number"
            value={assetDuration}
          />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="asset-intent">制作目标</FieldLabel>
        <Textarea
          className="min-h-28 resize-y leading-6"
          id="asset-intent"
          onChange={(event) => onAssetIntentChange(event.target.value)}
          value={assetIntent}
        />
        <FieldDescription>
          这段说明会帮助系统组织素材、生成旁白并安排镜头顺序。
        </FieldDescription>
      </Field>

      <ProductionSettingsEditor
        actions={actions}
        dirtyKeys={settingDirtyKeys}
        expertMode={expertMode}
        inheritedValues={inheritedValues}
        keys={template.allowed_user_params}
        mode="run"
        onChange={changeSetting}
        onReset={resetSetting}
        onResetAll={onResetAdvancedSettings}
        onResetMany={resetSettings}
        onResourcesReload={onResourcesReload}
        presentation="quick"
        resources={resources}
        resourcesError={resourcesError}
        savedOverrides={{}}
        template={template}
        values={values}
      />
    </FieldGroup>
  )
}

function StoryboardPreviewPanel({
  artifactKind,
  confirmationSummary,
  framePreviewUrl,
  overrideSummary,
  scenes,
  settingsSummary,
  template,
}: {
  artifactKind: ArtifactKind
  confirmationSummary: string
  framePreviewUrl: string | null
  overrideSummary: string
  scenes: string[]
  settingsSummary: string
  template: ProductionTemplate | null
}) {
  if (artifactKind === "video") {
    const startsFromTopic = template?.input_requirements.includes("topic")
    return (
      <aside
        className="min-w-0 xl:sticky xl:top-[5.5rem] xl:self-start"
        data-slot="production-rail"
      >
        <Card className="rounded-lg">
          <CardHeader className="border-b">
            <CardTitle>本次生产概览</CardTitle>
            <CardDescription>
              这里只展示已确定的路线和设置；真实文案、分镜和进度会在任务页出现。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            <ol className="space-y-3" aria-label="本次生产路线">
              {(startsFromTopic
                ? [
                    "输入主题",
                    "AI 生成文案",
                    "确认文案",
                    "AI 规划分镜",
                    "确认分镜",
                    "生成视频",
                  ]
                : ["输入文案", "AI 规划分镜", "确认分镜", "生成视频"]
              ).map((step, index, steps) => (
                <li className="flex gap-3" key={step}>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
                    {index + 1}
                  </span>
                  <div
                    className={cn(
                      "min-w-0 flex-1 text-sm",
                      index < steps.length - 1 && "border-b pb-3"
                    )}
                  >
                    {step}
                    {index < steps.length - 1 ? (
                      <span className="sr-only">然后</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>

            <dl className="grid grid-cols-2 gap-4 border-t pt-4">
              <div>
                <dt className="text-xs text-muted-foreground">当前模板</dt>
                <dd className="mt-1 text-sm font-medium">
                  {template?.display_name || "当前模板"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">预计耗时</dt>
                <dd className="mt-1 text-sm font-medium">
                  {template?.estimated_turnaround || "约 2 分钟"}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">人工确认站</dt>
                <dd className="mt-1 text-sm font-medium">
                  {confirmationSummary}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">本次设置</dt>
                <dd className="mt-1 text-sm leading-6">{settingsSummary}</dd>
                <dd className="mt-1 text-xs text-muted-foreground">
                  {overrideSummary}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </aside>
    )
  }

  const title = artifactKind === "text" ? "长文结构预览" : "图集分页预览"
  const description =
    artifactKind === "text"
      ? "根据当前文案预估文章结构，正式生成时可能调整。"
      : "根据当前换行预估图集页面，正式生成时可能调整。"

  return (
    <aside
      className="min-w-0 xl:sticky xl:top-[5.5rem] xl:self-start"
      data-slot="production-rail"
    >
      <Card className="flex min-h-[420px] flex-col overflow-hidden rounded-lg xl:h-[calc(100svh-10.25rem)] xl:min-h-[640px]">
        <CardHeader className="border-b">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          {scenes.length === 0 ? (
            <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <FileText className="size-6 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">输入内容后显示预估</div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  这里会跟随内容更新，不会创建真实任务。
                </p>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-4">
              {scenes.map((scene, index) => (
                <article
                  className="grid gap-3 border-b py-4 last:border-b-0 sm:grid-cols-[minmax(116px,0.72fr)_minmax(0,1fr)]"
                  key={`${index}-${scene.slice(0, 24)}`}
                >
                  {artifactKind !== "text" && framePreviewUrl && (
                    <img
                      alt={`当前画面模板的场景 ${index + 1} 预览`}
                      className="aspect-[4/3] w-full rounded-lg border object-cover"
                      height={300}
                      loading={index === 0 ? "eager" : "lazy"}
                      src={framePreviewUrl}
                      width={400}
                    />
                  )}
                  <div className="flex min-w-0 flex-col py-1">
                    <h3 className="text-sm font-medium">
                      {artifactKind === "text"
                        ? `段落 ${index + 1}`
                        : `页面 ${index + 1}`}
                    </h3>
                    <p className="mt-2 line-clamp-4 text-sm leading-6 text-muted-foreground">
                      {scene}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="border-t bg-muted/20 p-4">
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-xs text-muted-foreground">当前模板</dt>
                <dd className="mt-1 truncate text-sm font-medium">
                  {template?.display_name || "当前模板"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">预计耗时</dt>
                <dd className="mt-1 text-sm font-medium">
                  {template?.estimated_turnaround || "约 2 分钟"}
                </dd>
              </div>
              <div className="col-span-2 border-t pt-4">
                <dt className="text-xs text-muted-foreground">人工确认站</dt>
                <dd className="mt-1 text-sm font-medium">
                  {confirmationSummary}
                </dd>
              </div>
            </dl>
            <div className="mt-4 border-t pt-4">
              <div className="text-xs text-muted-foreground">本次设置</div>
              <p className="mt-1 text-sm leading-6">{settingsSummary}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {overrideSummary}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </aside>
  )
}

function TaskPanel({
  artifactKind,
  confirmationSummary,
  framePreviewUrl,
  isSubmitting,
  previewText,
  overrideSummary,
  settingsSummary,
  template,
}: {
  artifactKind: ArtifactKind
  confirmationSummary: string
  framePreviewUrl: string | null
  isSubmitting: boolean
  previewText: string
  overrideSummary: string
  settingsSummary: string
  template: ProductionTemplate | null
}) {
  const previewScenes = previewContentSections(previewText, artifactKind)

  if (!isSubmitting) {
    return (
      <StoryboardPreviewPanel
        artifactKind={artifactKind}
        confirmationSummary={confirmationSummary}
        framePreviewUrl={framePreviewUrl}
        overrideSummary={overrideSummary}
        scenes={previewScenes}
        settingsSummary={settingsSummary}
        template={template}
      />
    )
  }

  return (
    <aside
      className="min-w-0 xl:sticky xl:top-[5.5rem] xl:self-start"
      data-slot="production-rail"
    >
      <Card className="rounded-lg border-primary/20 bg-primary/5">
        <CardContent className="space-y-4 p-5" aria-live="polite">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-primary" />
            <div>
              <div className="text-sm font-medium">正在创建生产任务</div>
              <p className="mt-1 text-xs text-muted-foreground">
                任务建立后会立即打开任务详情。
              </p>
            </div>
          </div>
          <Progress aria-label="正在创建生产任务" indeterminate />
        </CardContent>
      </Card>
    </aside>
  )
}
function previewCopy(
  inputKind: "script" | "topic",
  text: string,
  title: string
) {
  const cleaned = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
  const source =
    inputKind === "topic"
      ? [title.trim(), cleaned].filter(Boolean).join("：")
      : cleaned
  return source.slice(0, 180)
}

function BatchScriptInput({
  text,
  label,
  hint,
  items,
  artifactKind,
  onTextChange,
  onRemoveItem,
}: {
  text: string
  label: string
  hint: string
  items: ParsedScriptItem[]
  artifactKind: ArtifactKind
  onTextChange?: (value: string) => void
  onRemoveItem?: (index: number) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="batch-text">{label}</FieldLabel>
        <Textarea
          className="min-h-64 resize-y text-base leading-7"
          id="batch-text"
          onChange={(event) => onTextChange?.(event.target.value)}
          placeholder={
            "第一条标题\n第一条完整文案...\n\n---\n\n第二条标题\n第二条完整文案..."
          }
          value={text}
        />
        <FieldDescription>{hint}</FieldDescription>
      </Field>
      {items.length > 0 ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-sm font-medium">
            解析预览 · {items.length} 条
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {items.map((item, index) => {
              const itemTitle = getBatchPreviewTitle(item.input, index)
              const chars = getBatchPreviewBody(item.input).length
              const lines = getBatchPreviewLineCount(item.input)
              const meta =
                artifactKind === "text"
                  ? `素材 ${chars} 字`
                  : artifactKind === "image_set"
                    ? `${chars} 字 · ${lines} 行`
                    : `${chars} 字`
              return (
                <div
                  className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm"
                  key={`${index}-${itemTitle}`}
                >
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{itemTitle}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {meta}
                  </span>
                  <Button
                    aria-label={`移除第 ${index + 1} 条`}
                    onClick={() => onRemoveItem?.(index)}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <X />
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          在上面粘贴多条内容，这里会实时显示解析出的条目。
        </div>
      )}
    </div>
  )
}

function buildStandardTemplateInput({
  template,
  script,
  topic,
  title,
}: {
  template: ProductionTemplate
  script: string
  topic: string
  title: string
}) {
  const baseInput = template.input_requirements.includes("topic")
    ? { topic }
    : { script }
  return title ? { ...baseInput, title } : baseInput
}
