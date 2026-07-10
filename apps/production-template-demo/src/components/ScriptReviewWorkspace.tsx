import { useEffect, useMemo, useState } from "react"
import { Eye, FileText, Loader2, Save, Send, Wand2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { AdvancedGroup } from "@/components/shared/AdvancedGroup"
import { AsyncState } from "@/components/shared/AsyncState"
import { BatchStatusCard } from "@/components/shared/BatchStatusCard"
import { EmptyState } from "@/components/shared/EmptyState"
import { InlineError, InlineNotice } from "@/components/shared/feedback"
import { PageFrame } from "@/components/shared/PageFrame"
import {
  ProductionSubmitPanel,
  type ProductionOverrides,
} from "@/components/shared/ProductionSubmitPanel"
import { PromptPeekSheet } from "@/components/shared/PromptPeekSheet"
import { SourceChip } from "@/components/shared/SourceChip"
import { WorkspaceHeader } from "@/components/shared/WorkspaceHeader"
import { WorkspacePanel } from "@/components/shared/WorkspacePanel"
import { DraftReviewEditor } from "@/components/script-review/DraftReviewEditor"
import {
  RecentDraftsRecovery,
  type DraftRecoveryState,
} from "@/components/script-review/RecentDraftsRecovery"
import {
  ReviewFlowStepper,
  StepActionBar,
  type ReviewStep,
} from "@/components/script-review/ReviewFlow"
import { routeHref } from "@/lib/router"
import { settingsLink } from "@/lib/settingsLinks"
import { useCurrentProject } from "@/lib/currentProject"
import { useTaskCenter } from "@/lib/taskCenter"
import { readableError } from "@/lib/format"
import {
  getGenerationBatch,
  getSettingsConfig,
  getTask,
  listScriptReviewDraftSets,
  listDraftingProfiles,
  listScriptReviewTemplates,
  listTemplates,
  createScriptReviewDraftSet,
  retryGenerationBatchItem,
  submitScriptReviewDraftSetTasks,
  updateScriptReviewDraftSet,
  type DraftingProfile,
  type GenerationBatch,
  type ProductionTemplate,
  type ScriptReviewDraft,
  type ScriptReviewDraftSet,
  type ScriptReviewLanguageDraft,
  type ScriptReviewTemplateListResponse,
} from "@/lib/generationApi"
import { isNonVideoPipeline, templateArtifactType } from "@/lib/artifactKind"
import { buildScriptReviewDraftFeedback } from "@/lib/scriptReviewDraftFeedback"
import { LANGUAGE_LABELS, PRESET_LANGUAGES } from "@/lib/languages"

const BAZI_TEMPLATE_NAME = "Bazi Storyboard Oral Script"
const BAZI_ENGLISH_TEMPLATE_NAME = "Bazi Storyboard Oral Script English"

function validateDraftContent(draft: ScriptReviewDraft): string[] {
  if (draft.selected_for_generation === false) {
    return []
  }
  const errors: string[] = []
  for (const language of draft.selected_languages ?? []) {
    const languageDraft = draft.language_drafts?.[language]
    if (!(languageDraft?.script ?? "").trim()) {
      errors.push(`${draft.topic} / ${language}：完整文案为空`)
    }
    if ((languageDraft?.narrations ?? []).length === 0) {
      errors.push(`${draft.topic} / ${language}：分镜文案为空`)
    }
  }
  return errors
}

function dedupeLanguages(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean))
  )
}

const BAZI_LANGUAGE_SCRIPT_MODEL_DEFAULTS: Record<string, string> = {
  Chinese: "doubao-seed-2-0-lite-260428",
  English: "gemini-3.5-flash",
}
export function ScriptReviewWorkspace() {
  const { projectId, project } = useCurrentProject()
  const [sourceProfile, setSourceProfile] = useState<DraftingProfile | null>(
    null
  )
  const [peek, setPeek] = useState<{
    kind: "script" | "split"
    name: string
  } | null>(null)
  const [templates, setTemplates] =
    useState<ScriptReviewTemplateListResponse | null>(null)
  const [draftSets, setDraftSets] = useState<ScriptReviewDraftSet[]>([])
  const [draftSet, setDraftSet] = useState<ScriptReviewDraftSet | null>(null)
  const [topicsText, setTopicsText] = useState("")
  const [step, setStep] = useState<ReviewStep>(1)
  const [presetLanguages, setPresetLanguages] = useState<string[]>(() =>
    project?.languages?.length ? [...project.languages] : ["Chinese", "English"]
  )
  const [customLanguagesText, setCustomLanguagesText] = useState("")
  const [scriptTemplateName, setScriptTemplateName] = useState("")
  const [splitTemplateName, setSplitTemplateName] = useState("")
  const [scriptModel, setScriptModel] = useState("")
  const [splitModel, setSplitModel] = useState("")
  const [languageScriptModels, setLanguageScriptModels] = useState<
    Record<string, string>
  >({})
  const [productionTemplateId, setProductionTemplateId] = useState("")
  const [productionTemplates, setProductionTemplates] = useState<
    ProductionTemplate[]
  >([])
  const [productionOverrides, setProductionOverrides] =
    useState<ProductionOverrides>({})
  const [ttsVoiceByLanguage, setTtsVoiceByLanguage] = useState<
    Record<string, string>
  >(() => ({ ...(project?.tts_voice_by_language ?? {}) }))
  const [ttsSpeedByLanguage, setTtsSpeedByLanguage] = useState<
    Record<string, number>
  >({})
  const [submittedBatch, setSubmittedBatch] = useState<GenerationBatch | null>(
    null
  )
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isProductionCatalogLoading, setIsProductionCatalogLoading] =
    useState(true)
  const [isRefreshingDrafts, setIsRefreshingDrafts] = useState(false)
  const [isCreatingDrafts, setIsCreatingDrafts] = useState(false)
  const [isSavingDrafts, setIsSavingDrafts] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [retryingBatchItemIndex, setRetryingBatchItemIndex] = useState<
    number | null
  >(null)
  const [batchPollingError, setBatchPollingError] = useState<string | null>(
    null
  )
  const [templateReloadToken, setTemplateReloadToken] = useState(0)
  const [productionCatalogReloadToken, setProductionCatalogReloadToken] =
    useState(0)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [draftListError, setDraftListError] = useState<string | null>(null)
  const [draftListState, setDraftListState] =
    useState<DraftRecoveryState>("loading")
  const [productionCatalogError, setProductionCatalogError] = useState<
    string | null
  >(null)
  const [settingsTtsReferenceId, setSettingsTtsReferenceId] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [activeProjectId, setActiveProjectId] = useState(projectId)
  const taskCenter = useTaskCenter()

  if (activeProjectId !== projectId) {
    setActiveProjectId(projectId)
    setSourceProfile(null)
    setDraftSets([])
    setDraftSet(null)
    setDraftListError(null)
    setDraftListState("loading")
    setTopicsText("")
    setStep(1)
    setPresetLanguages(project?.languages?.length ? [...project.languages] : [])
    setCustomLanguagesText("")
    setScriptTemplateName("")
    setSplitTemplateName("")
    setScriptModel("")
    setSplitModel("")
    setLanguageScriptModels({})
    setProductionTemplateId("")
    setProductionTemplates([])
    setProductionCatalogError(null)
    setIsProductionCatalogLoading(true)
    setProductionOverrides({})
    setTtsVoiceByLanguage(
      Object.keys(project?.tts_voice_by_language ?? {}).length > 0
        ? { ...(project?.tts_voice_by_language ?? {}) }
        : settingsTtsReferenceId
          ? { Chinese: settingsTtsReferenceId }
          : {}
    )
    setTtsSpeedByLanguage({})
    setSubmittedBatch(null)
    setRetryingBatchItemIndex(null)
    setBatchPollingError(null)
    setError(null)
    setNotice(null)
  }

  const topics = useMemo(() => parseLines(topicsText), [topicsText])
  const languages = useMemo(
    () =>
      dedupeLanguages([
        ...presetLanguages,
        ...parseLanguages(customLanguagesText),
      ]),
    [presetLanguages, customLanguagesText]
  )
  const currentScriptTemplateName =
    scriptTemplateName || templates?.script_templates[0]?.name || ""
  const currentSplitTemplateName =
    splitTemplateName || templates?.split_templates[0]?.name || ""
  // 首步默认值是否被用户改过（脚本/分镜模板名 + 两个模型；语言不参与，语言归项目）
  const defaultsModified =
    sourceProfile != null &&
    (currentScriptTemplateName !== sourceProfile.script_template_name ||
      currentSplitTemplateName !== sourceProfile.split_template_name ||
      scriptModel !== sourceProfile.script_model ||
      splitModel !== sourceProfile.split_model)
  const selectedLanguages = useMemo(
    () => draftSetSelectedLanguages(draftSet),
    [draftSet]
  )
  const canCreateDrafts =
    topics.length > 0 &&
    languages.length > 0 &&
    Boolean(currentScriptTemplateName) &&
    Boolean(currentSplitTemplateName) &&
    !isInitialLoading &&
    !templateError &&
    !isCreatingDrafts
  const draftValidationErrors = useMemo(
    () => (draftSet?.drafts ?? []).flatMap(validateDraftContent),
    [draftSet]
  )
  const jobCount = useMemo(
    () =>
      (draftSet?.drafts ?? [])
        .filter((draft) => draft.selected_for_generation !== false)
        .reduce(
          (count, draft) => count + (draft.selected_languages?.length ?? 0),
          0
        ),
    [draftSet]
  )
  // 非视频模板（图文帖 / 长文）无配音；提交时不要求每语言音色，也不显示音色区
  const selectedProductionTemplate = productionTemplates.find(
    (template) => template.id === productionTemplateId
  )
  const selectedTemplatePipeline = selectedProductionTemplate?.pipeline_id
  const isNonVideoTemplate = isNonVideoPipeline(selectedTemplatePipeline)
  const nonVideoOutputLabel =
    templateArtifactType(selectedTemplatePipeline) === "text"
      ? "长文"
      : "图文帖"
  const canSubmit =
    Boolean(draftSet) &&
    Boolean(productionTemplateId) &&
    Boolean(selectedProductionTemplate) &&
    !isProductionCatalogLoading &&
    !productionCatalogError &&
    jobCount > 0 &&
    draftValidationErrors.length === 0 &&
    selectedLanguages.length > 0 &&
    (isNonVideoTemplate ||
      selectedLanguages.every((language) =>
        (ttsVoiceByLanguage[language] || "").trim()
      )) &&
    !isSubmitting

  // 生产模板列表仅用于确认产物类型与本步校验；真实提交仍由 draft-set API 完成。
  useEffect(() => {
    let cancelled = false
    void listTemplates(projectId ?? undefined)
      .then((response) => {
        if (!cancelled) {
          setProductionTemplates(response.templates)
          setProductionCatalogError(null)
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setProductionCatalogError(readableError(loadError))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsProductionCatalogLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [productionCatalogReloadToken, projectId])

  useEffect(() => {
    let cancelled = false

    listScriptReviewTemplates()
      .then((templateResponse) => {
        if (cancelled) {
          return
        }
        setTemplates(templateResponse)
        setTemplateError(null)
      })
      .catch((loadError) => {
        if (!cancelled) {
          setTemplateError(readableError(loadError))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsInitialLoading(false)
        }
      })

    void Promise.allSettled([getSettingsConfig()]).then(([settingsResult]) => {
      if (cancelled) {
        return
      }
      if (settingsResult.status === "fulfilled") {
        const defaultReferenceId = (
          settingsResult.value.config?.comfyui?.tts?.fish_audio?.reference_id ??
          ""
        ).trim()
        if (defaultReferenceId) {
          setSettingsTtsReferenceId(defaultReferenceId)
          // 与旧版一致：中文默认带入设置里的 Fish reference_id
          setTtsVoiceByLanguage((current) =>
            Object.keys(current).length > 0
              ? current
              : { Chinese: defaultReferenceId }
          )
        }
      }
    })

    return () => {
      cancelled = true
    }
  }, [templateReloadToken])

  // 项目作用域：草稿集列表随项目切换刷新；首步默认配方/语言/每语言音色取项目默认。
  useEffect(() => {
    let cancelled = false

    void listScriptReviewDraftSets(projectId ?? undefined)
      .then((response) => {
        if (cancelled) {
          return
        }
        setDraftSets(response.draft_sets)
        setDraftListError(null)
        setDraftListState("ready")
        // 最近草稿只作为恢复入口，不默认抢占当前流程。
        setDraftSet(null)
      })
      .catch((loadError) => {
        if (!cancelled) {
          setDraftListError(readableError(loadError))
          setDraftListState("error")
        }
      })

    void listDraftingProfiles()
      .then((response) => {
        if (cancelled) {
          return
        }
        // 起草配置与项目 1:1：取当前项目的配置
        const profile =
          response.profiles.find((item) => item.project_id === projectId) ??
          null
        setSourceProfile(profile)
        if (profile) {
          setScriptTemplateName(
            (current) => current || profile.script_template_name
          )
          setSplitTemplateName(
            (current) => current || profile.split_template_name
          )
          setScriptModel((current) => current || profile.script_model)
          setSplitModel((current) => current || profile.split_model)
          if (Object.keys(profile.language_script_models).length > 0) {
            setLanguageScriptModels((current) => ({
              ...profile.language_script_models,
              ...current,
            }))
          }
        }
      })
      .catch(() => {
        // 配方读取失败不阻塞页面
      })

    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    if (!submittedBatch || isTerminalBatchStatus(submittedBatch.status)) {
      return
    }
    const timer = window.setInterval(() => {
      void getGenerationBatch(submittedBatch.batch_id)
        .then((response) => {
          setSubmittedBatch(response)
          setBatchPollingError(null)
        })
        .catch((pollError) => setBatchPollingError(readableError(pollError)))
    }, 2000)
    return () => window.clearInterval(timer)
  }, [submittedBatch])

  async function refreshDraftSets() {
    setIsRefreshingDrafts(true)
    setDraftListError(null)
    try {
      const response = await listScriptReviewDraftSets(projectId ?? undefined)
      setDraftSets(response.draft_sets)
      setDraftSet((current) =>
        current
          ? (response.draft_sets.find(
              (candidate) => candidate.draft_set_id === current.draft_set_id
            ) ?? null)
          : null
      )
      setDraftListState("ready")
    } catch (refreshError) {
      setDraftListError(readableError(refreshError))
      setDraftListState(draftSets.length > 0 ? "stale" : "error")
    } finally {
      setIsRefreshingDrafts(false)
    }
  }

  function retryTemplateLoad() {
    setIsInitialLoading(true)
    setTemplateError(null)
    setTemplateReloadToken((token) => token + 1)
  }

  function retryProductionCatalogLoad() {
    setIsProductionCatalogLoading(true)
    setProductionCatalogError(null)
    setProductionCatalogReloadToken((token) => token + 1)
  }

  async function createDrafts() {
    if (!canCreateDrafts) {
      return
    }
    setIsCreatingDrafts(true)
    setError(null)
    setNotice(null)
    try {
      const response = await createScriptReviewDraftSet({
        topics,
        languages,
        projectId: projectId ?? undefined,
        scriptTemplateName: currentScriptTemplateName,
        splitTemplateName: currentSplitTemplateName,
        scriptModel: scriptModel.trim() || undefined,
        splitModel: splitModel.trim() || undefined,
        languageScriptTemplates: languageScriptTemplateOverrides(
          currentScriptTemplateName,
          templates
        ),
        languageScriptModels: effectiveLanguageScriptModels(
          languages,
          currentScriptTemplateName,
          scriptModel,
          languageScriptModels
        ),
        metadata: { source: "react_script_review" },
      })
      setDraftSet(response)
      setStep(2)
      setDraftSets((current) => [
        response,
        ...current.filter(
          (item) => item.draft_set_id !== response.draft_set_id
        ),
      ])
      const feedback = buildScriptReviewDraftFeedback(response)
      setNotice(feedback.notice)
      setError(feedback.errorMessage)
    } catch (createError) {
      setError(readableError(createError))
    } finally {
      setIsCreatingDrafts(false)
    }
  }

  async function saveDrafts() {
    if (!draftSet) {
      return
    }
    setIsSavingDrafts(true)
    setError(null)
    setNotice(null)
    try {
      const response = await updateScriptReviewDraftSet(draftSet.draft_set_id, {
        drafts: draftSet.drafts,
        metadata: { reviewed_in: "react_script_review" },
      })
      setDraftSet(response)
      setDraftSets((current) => [
        response,
        ...current.filter(
          (item) => item.draft_set_id !== response.draft_set_id
        ),
      ])
      setNotice("审核修改已保存。")
    } catch (saveError) {
      setError(readableError(saveError))
    } finally {
      setIsSavingDrafts(false)
    }
  }

  async function submitReviewedDrafts() {
    if (!draftSet || !canSubmit) {
      return
    }
    setIsSubmitting(true)
    setError(null)
    setNotice(null)
    setBatchPollingError(null)
    try {
      const response = await submitScriptReviewDraftSetTasks(
        draftSet.draft_set_id,
        {
          drafts: draftSet.drafts,
          templateId: productionTemplateId,
          baseParams: {
            // 流程强制项：审核稿按行对应分镜；TTS 由每语言 Fish 覆盖
            split_mode: "line",
            tts_inference_mode: "fish",
            ...productionOverrides,
          },
          languageTtsOverrides: Object.fromEntries(
            selectedLanguages.map((language) => [
              language,
              {
                tts_inference_mode: "fish",
                tts_voice: (ttsVoiceByLanguage[language] || "").trim(),
                tts_speed: ttsSpeedByLanguage[language] ?? 1,
              },
            ])
          ),
          metadata: { source: "react_script_review_submit" },
        }
      )
      setDraftSet(response.draft_set)
      setSubmittedBatch(response.batch)
      if (
        response.batch.submitted_count <= 0 ||
        response.batch.status === "failed"
      ) {
        setError(
          "后端已返回批次，但没有确认创建成功的生成任务。请查看下方真实批次状态，当前不视为提交成功。"
        )
      } else if (response.batch.failed_count > 0) {
        setError(
          `批次已创建 ${response.batch.submitted_count} 个任务，其中 ${response.batch.failed_count} 个失败。请在下方查看失败项并重试。`
        )
      } else {
        setNotice(
          `已创建 ${response.batch.submitted_count} 个生成任务，可在「任务」页跟踪进度。`
        )
      }
      void trackSubmittedTasks(response.batch)
    } catch (submitError) {
      setError(readableError(submitError))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function retryBatchItem(itemIndex: number) {
    if (!submittedBatch) {
      return
    }
    setRetryingBatchItemIndex(itemIndex)
    setError(null)
    setNotice(null)
    setBatchPollingError(null)
    try {
      const response = await retryGenerationBatchItem(
        submittedBatch.batch_id,
        itemIndex
      )
      setSubmittedBatch(response)
      const retriedItem = response.items.find(
        (item) => item.index === itemIndex
      )
      if (!retriedItem || retriedItem.status === "failed") {
        setError("重试请求已返回，但该任务仍未进入可跟踪状态。")
      } else {
        setNotice(`已重试批次中的第 ${itemIndex} 条任务。`)
      }
    } catch (retryError) {
      setError(readableError(retryError))
    } finally {
      setRetryingBatchItemIndex(null)
    }
  }

  async function trackSubmittedTasks(batch: GenerationBatch) {
    const entries = batch.items
      .filter((item) => item.task_id)
      .map((item) => ({
        taskId: item.task_id as string,
        label: [item.input?.topic, item.input?.language]
          .filter(Boolean)
          .join(" · "),
      }))
    const results = await Promise.allSettled(
      entries.map((entry) => getTask(entry.taskId))
    )
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        taskCenter.trackTask(
          result.value,
          entries[index].label
            ? `文案审核 · ${entries[index].label}`
            : "文案审核出片"
        )
      }
    })
  }

  async function refreshSubmittedBatch() {
    if (!submittedBatch) {
      return
    }
    setBatchPollingError(null)
    try {
      setSubmittedBatch(await getGenerationBatch(submittedBatch.batch_id))
    } catch (refreshError) {
      setBatchPollingError(readableError(refreshError))
    }
  }

  function patchDraft(
    nextDraftIndex: number,
    patch: Partial<ScriptReviewDraft>
  ) {
    if (!draftSet) {
      return
    }
    setDraftSet({
      ...draftSet,
      drafts: draftSet.drafts.map((draft, index) =>
        index === nextDraftIndex ? { ...draft, ...patch } : draft
      ),
    })
  }

  function patchLanguageDraft(
    draftIndex: number,
    language: string,
    patch: Partial<ScriptReviewLanguageDraft>
  ) {
    if (!draftSet) {
      return
    }
    const draft = draftSet.drafts[draftIndex]
    const languageDrafts = { ...(draft.language_drafts ?? {}) }
    languageDrafts[language] = {
      title: languageDrafts[language]?.title ?? "",
      script: languageDrafts[language]?.script ?? "",
      narrations: languageDrafts[language]?.narrations ?? [],
      ...patch,
    }
    patchDraft(draftIndex, { language_drafts: languageDrafts })
  }

  function toggleLanguage(draftIndex: number, language: string) {
    if (!draftSet) {
      return
    }
    const draft = draftSet.drafts[draftIndex]
    const selected = new Set(draft.selected_languages ?? [])
    if (selected.has(language)) {
      selected.delete(language)
    } else {
      selected.add(language)
    }
    patchDraft(draftIndex, { selected_languages: Array.from(selected) })
  }

  function changeStep(nextStep: ReviewStep) {
    setError(null)
    setNotice(null)
    setStep(nextStep)
  }

  function openRecoveredDraft(
    recoveredDraftSet: ScriptReviewDraftSet,
    nextStep: 2 | 3
  ) {
    setDraftSet(recoveredDraftSet)
    setSubmittedBatch(null)
    setBatchPollingError(null)
    setError(null)
    setNotice(null)
    setStep(nextStep)
  }

  return (
    <PageFrame width="narrow">
      <WorkspaceHeader
        description="先确定选题与语言，再逐条审核真实草稿，最后提交到统一生产批次。"
        title="多语言审核出片"
      />

      <ReviewFlowStepper
        current={step}
        hasDraft={Boolean(draftSet)}
        onStepChange={changeStep}
      />

      {step === 1 ? (
        <section
          aria-label="选择选题与语言"
          className="flex min-w-0 flex-col gap-4"
        >
          {isInitialLoading && !templates ? (
            <AsyncState
              description="正在读取脚本与分镜 Prompt，最近草稿仍可单独恢复。"
              state="loading"
              title="正在准备审核流程"
            />
          ) : null}

          {!isInitialLoading && templateError && !templates ? (
            <AsyncState
              action={
                <Button
                  onClick={retryTemplateLoad}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  重试
                </Button>
              }
              description={templateError}
              state="error"
              title="无法读取审核模板"
            />
          ) : null}

          {templates ? (
            <>
              {isInitialLoading ? (
                <AsyncState
                  description="保留当前表单，正在重新读取审核模板。"
                  state="loading"
                  title="正在更新审核模板"
                />
              ) : null}

              {templateError ? (
                <AsyncState
                  action={
                    <Button
                      onClick={retryTemplateLoad}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      重新读取
                    </Button>
                  }
                  description={templateError}
                  state="stale"
                  title="审核模板可能不是最新状态"
                />
              ) : null}

              <WorkspacePanel
                description="默认只需填写本批选题并确认语言；模型和 Prompt 沿用当前项目配置。"
                title="选择内容范围"
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="script-review-topics">选题</FieldLabel>
                    <Textarea
                      autoComplete="off"
                      className="min-h-32 resize-y"
                      id="script-review-topics"
                      name="script-review-topics"
                      onChange={(event) => setTopicsText(event.target.value)}
                      placeholder={"一行一个选题\n猫咪夏天饮水少怎么办"}
                      value={topicsText}
                    />
                    <FieldDescription>
                      一行一个选题，当前识别 {topics.length} 个。
                    </FieldDescription>
                  </Field>

                  <Field data-invalid={languages.length === 0 || undefined}>
                    <FieldLabel>语言</FieldLabel>
                    <ToggleGroup
                      aria-label="选择草稿语言"
                      className="w-full flex-wrap justify-start"
                      onValueChange={setPresetLanguages}
                      type="multiple"
                      value={presetLanguages}
                      variant="outline"
                    >
                      {PRESET_LANGUAGES.map((language) => (
                        <ToggleGroupItem
                          className="min-h-11 px-3 sm:min-h-8"
                          key={language}
                          value={language}
                        >
                          {LANGUAGE_LABELS[language] ?? language}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    {languages.length === 0 ? (
                      <FieldError>至少选择或填写一种语言。</FieldError>
                    ) : null}
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="script-review-custom-languages">
                      其他语言
                    </FieldLabel>
                    <Input
                      autoComplete="off"
                      id="script-review-custom-languages"
                      name="script-review-custom-languages"
                      onChange={(event) =>
                        setCustomLanguagesText(event.target.value)
                      }
                      placeholder="逗号分隔，例如 French, German"
                      value={customLanguagesText}
                    />
                    <FieldDescription>
                      当前将生成 {languages.length} 种语言的审核草稿。
                    </FieldDescription>
                  </Field>

                  <AdvancedGroup
                    description="沿用项目默认即可，只有本批需要覆盖时再修改"
                    id="script-review-drafting-options"
                    title="起草模型与 Prompt"
                  >
                    {sourceProfile ? (
                      <p className="text-sm leading-6 text-muted-foreground">
                        默认值来自项目
                        <SettingsTextLink
                          to={settingsLink({ kind: "projects" })}
                        >
                          「{project?.name ?? "当前项目"}」
                        </SettingsTextLink>
                        的起草配置
                        {defaultsModified ? "，本批已有覆盖" : "。"}
                      </p>
                    ) : null}

                    <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <TemplateSelect
                        label="脚本 Prompt"
                        onChange={setScriptTemplateName}
                        onPeek={() =>
                          setPeek({
                            kind: "script",
                            name: currentScriptTemplateName,
                          })
                        }
                        templates={(templates.script_templates ?? []).filter(
                          (template) =>
                            template.name !== BAZI_ENGLISH_TEMPLATE_NAME
                        )}
                        value={currentScriptTemplateName}
                      />
                      <Field>
                        <FieldLabel htmlFor="script-review-script-model">
                          脚本模型
                        </FieldLabel>
                        <Input
                          autoComplete="off"
                          id="script-review-script-model"
                          name="script-review-script-model"
                          onChange={(event) =>
                            setScriptModel(event.target.value)
                          }
                          placeholder="留空使用项目默认模型"
                          value={scriptModel}
                        />
                      </Field>
                      <TemplateSelect
                        label="分镜 Prompt"
                        onChange={setSplitTemplateName}
                        onPeek={() =>
                          setPeek({
                            kind: "split",
                            name: currentSplitTemplateName,
                          })
                        }
                        templates={templates.split_templates ?? []}
                        value={currentSplitTemplateName}
                      />
                      <Field>
                        <FieldLabel htmlFor="script-review-split-model">
                          分镜模型
                        </FieldLabel>
                        <Input
                          autoComplete="off"
                          id="script-review-split-model"
                          name="script-review-split-model"
                          onChange={(event) =>
                            setSplitModel(event.target.value)
                          }
                          placeholder="留空使用项目默认模型"
                          value={splitModel}
                        />
                      </Field>
                    </FieldGroup>

                    {currentScriptTemplateName === BAZI_TEMPLATE_NAME ? (
                      <Alert variant="info">
                        <AlertTitle>Bazi 语言映射</AlertTitle>
                        <AlertDescription>
                          Chinese 使用 Doubao，English 使用
                          Gemini，并自动使用英文脚本 Prompt。
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {languages.length > 0 ? (
                      <FieldSet>
                        <FieldLegend variant="label">
                          每语言脚本模型
                        </FieldLegend>
                        <FieldDescription>
                          留空时使用脚本模型或模板默认值。
                        </FieldDescription>
                        <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          {languages.map((language, languageIndex) => {
                            const modelId = `script-review-model-${languageIndex}`
                            return (
                              <Field key={language}>
                                <FieldLabel htmlFor={modelId}>
                                  {LANGUAGE_LABELS[language] ?? language}
                                </FieldLabel>
                                <Input
                                  autoComplete="off"
                                  id={modelId}
                                  name={modelId}
                                  onChange={(event) =>
                                    setLanguageScriptModels((current) => ({
                                      ...current,
                                      [language]: event.target.value,
                                    }))
                                  }
                                  placeholder={
                                    defaultLanguageScriptModel(
                                      language,
                                      currentScriptTemplateName,
                                      scriptModel
                                    ) || "使用脚本模型"
                                  }
                                  value={languageScriptModels[language] ?? ""}
                                />
                              </Field>
                            )
                          })}
                        </FieldGroup>
                      </FieldSet>
                    ) : null}
                  </AdvancedGroup>
                </FieldGroup>
              </WorkspacePanel>

              {error ? (
                <InlineError message={error} title="草稿生成失败" />
              ) : null}
              {notice ? <InlineNotice message={notice} /> : null}
            </>
          ) : null}

          <RecentDraftsRecovery
            draftSets={draftSets}
            error={draftListError}
            isRefreshing={isRefreshingDrafts}
            onOpenDraft={openRecoveredDraft}
            onRefresh={() => void refreshDraftSets()}
            selectedDraftSetId={draftSet?.draft_set_id}
            state={draftListState}
          />

          {templates ? (
            <StepActionBar
              primaryAction={
                <Button
                  className="min-h-11 w-full sm:min-h-8 sm:w-auto"
                  disabled={!canCreateDrafts}
                  onClick={() => void createDrafts()}
                  type="button"
                >
                  {isCreatingDrafts ? (
                    <Loader2
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <Wand2 data-icon="inline-start" />
                  )}
                  生成审核草稿
                </Button>
              }
              summary={`${topics.length} 个选题 · ${languages.length} 种语言`}
            />
          ) : null}
        </section>
      ) : null}

      {step === 2 ? (
        <section
          aria-label="逐条审核草稿"
          className="flex min-w-0 flex-col gap-4"
        >
          <DraftReviewEditor
            draftSet={draftSet}
            onPatchDraft={patchDraft}
            onPatchLanguageDraft={patchLanguageDraft}
            onToggleLanguage={toggleLanguage}
          />

          {error ? <InlineError message={error} title="审核保存失败" /> : null}
          {notice ? <InlineNotice message={notice} /> : null}

          <StepActionBar
            backLabel="返回选题"
            onBack={() => changeStep(1)}
            primaryAction={
              <Button
                className="min-h-11 w-full sm:min-h-8 sm:w-auto"
                disabled={
                  !draftSet ||
                  jobCount === 0 ||
                  draftValidationErrors.length > 0
                }
                onClick={() => changeStep(3)}
                type="button"
              >
                下一步：确认提交
              </Button>
            }
            secondaryAction={
              <Button
                className="min-h-11 w-full sm:min-h-8 sm:w-auto"
                disabled={!draftSet || isSavingDrafts}
                onClick={() => void saveDrafts()}
                type="button"
                variant="outline"
              >
                {isSavingDrafts ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : (
                  <Save data-icon="inline-start" />
                )}
                保存修改
              </Button>
            }
            summary={`${jobCount} 条内容待提交`}
          />
        </section>
      ) : null}

      {step === 3 ? (
        <section
          aria-label="确认并提交生产"
          className="flex min-w-0 flex-col gap-4"
        >
          {!draftSet ? (
            <EmptyState
              actions={
                <Button
                  onClick={() => changeStep(1)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  返回选择选题
                </Button>
              }
              description="先生成或恢复一个真实审核草稿，才能配置生产任务。"
              icon={FileText}
              title="没有可提交的审核草稿"
            />
          ) : (
            <>
              <WorkspacePanel
                description="选择生产模板并核对本批参数；提交后会创建真实 generation batch。"
                title="确认生产设置"
              >
                <div className="flex flex-col gap-4">
                  {draftSet.status === "submitted" ? (
                    <InlineNotice
                      message={`这批确认稿已提交过 ${draftSet.submissions.length} 次，可更换模板再次出片。`}
                    />
                  ) : null}

                  {isProductionCatalogLoading ? (
                    <AsyncState
                      className="max-w-none"
                      description="正在确认所选模板的产物类型与提交约束。"
                      state="loading"
                      title="正在读取生产模板"
                    />
                  ) : null}

                  {productionCatalogError ? (
                    <AsyncState
                      action={
                        <Button
                          onClick={retryProductionCatalogLoad}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          重试
                        </Button>
                      }
                      className="max-w-none"
                      description={productionCatalogError}
                      state={productionTemplates.length > 0 ? "stale" : "error"}
                      title={
                        productionTemplates.length > 0
                          ? "生产模板合同可能已过期"
                          : "无法确认生产模板合同"
                      }
                    />
                  ) : null}

                  <ProductionSubmitPanel
                    lockedSummary={
                      isNonVideoTemplate
                        ? `流程强制项：分镜按行拆分；${nonVideoOutputLabel}无配音。`
                        : "流程强制项：分镜按行拆分；配音使用下方每语言 Fish 音色。"
                    }
                    onOverridesChange={setProductionOverrides}
                    onTemplateChange={setProductionTemplateId}
                    overrides={productionOverrides}
                    projectId={projectId ?? undefined}
                    requiredInput="script"
                    templateId={productionTemplateId}
                  />

                  {isNonVideoTemplate ? (
                    <Alert variant="info">
                      <AlertTitle>{nonVideoOutputLabel}无需配音</AlertTitle>
                      <AlertDescription>
                        当前模板不会创建 TTS 任务，因此无需填写每语言音色。
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <FieldSet>
                      <FieldLegend variant="label">每语言 Fish TTS</FieldLegend>
                      <FieldDescription>
                        每种参与生产的语言都必须绑定真实 Fish reference_id。
                      </FieldDescription>
                      {selectedLanguages.length === 0 ? (
                        <EmptyState
                          className="min-h-40"
                          description="返回审核步骤，为至少一种语言打开“生成”。"
                          headingLevel={3}
                          title="还没有参与生产的语言"
                        />
                      ) : (
                        <FieldGroup>
                          {selectedLanguages.map((language, languageIndex) => {
                            const voiceId = `script-review-voice-${languageIndex}`
                            const speedId = `script-review-speed-${languageIndex}`
                            const voiceMissing = !(
                              ttsVoiceByLanguage[language] ?? ""
                            ).trim()

                            return (
                              <div
                                className="grid min-w-0 gap-4 border-b pb-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.65fr)]"
                                key={language}
                              >
                                <Field data-invalid={voiceMissing || undefined}>
                                  <FieldLabel htmlFor={voiceId}>
                                    <span>
                                      {LANGUAGE_LABELS[language] ?? language} ·
                                      Fish reference_id
                                    </span>
                                    {project?.tts_voice_by_language?.[
                                      language
                                    ] &&
                                    (ttsVoiceByLanguage[language] ?? "") ===
                                      project.tts_voice_by_language[
                                        language
                                      ] ? (
                                      <SourceChip
                                        source="project"
                                        to={settingsLink({ kind: "projects" })}
                                      />
                                    ) : null}
                                  </FieldLabel>
                                  <Input
                                    aria-invalid={voiceMissing || undefined}
                                    autoComplete="off"
                                    id={voiceId}
                                    name={voiceId}
                                    onChange={(event) =>
                                      setTtsVoiceByLanguage((current) => ({
                                        ...current,
                                        [language]: event.target.value,
                                      }))
                                    }
                                    placeholder={`${language} reference_id`}
                                    value={ttsVoiceByLanguage[language] ?? ""}
                                  />
                                  {voiceMissing ? (
                                    <FieldError>
                                      该语言需要填写真实 Fish reference_id。
                                    </FieldError>
                                  ) : null}
                                </Field>
                                <Field>
                                  <FieldLabel htmlFor={speedId}>
                                    语速 ·{" "}
                                    {(
                                      ttsSpeedByLanguage[language] ?? 1
                                    ).toFixed(1)}
                                    x
                                  </FieldLabel>
                                  <Slider
                                    aria-label={`${language} 语速`}
                                    id={speedId}
                                    max={2}
                                    min={0.5}
                                    onValueChange={([value]) =>
                                      setTtsSpeedByLanguage((current) => ({
                                        ...current,
                                        [language]: value ?? 1,
                                      }))
                                    }
                                    step={0.1}
                                    value={[ttsSpeedByLanguage[language] ?? 1]}
                                  />
                                </Field>
                              </div>
                            )
                          })}
                        </FieldGroup>
                      )}
                    </FieldSet>
                  )}

                  {draftValidationErrors.length > 0 ? (
                    <InlineError
                      message={draftValidationErrors.join("；")}
                      title="草稿还不能提交"
                    />
                  ) : null}

                  <Alert>
                    <AlertTitle>
                      将创建 {jobCount} 条
                      {isNonVideoTemplate ? nonVideoOutputLabel : "视频"}任务
                    </AlertTitle>
                    <AlertDescription>
                      数量来自参与生成的选题与已选择语言；实际结果以下方真实批次为准。
                    </AlertDescription>
                  </Alert>
                </div>
              </WorkspacePanel>

              {error ? (
                <InlineError message={error} title="生产操作未完成" />
              ) : null}
              {notice ? <InlineNotice message={notice} /> : null}

              {batchPollingError ? (
                <AsyncState
                  action={
                    <Button
                      onClick={() => void refreshSubmittedBatch()}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      重新读取
                    </Button>
                  }
                  className="max-w-none"
                  description={batchPollingError}
                  state="stale"
                  title="批次状态可能不是最新结果"
                />
              ) : null}

              <BatchStatusCard
                artifactLabel={
                  selectedTemplatePipeline
                    ? isNonVideoTemplate
                      ? nonVideoOutputLabel
                      : "视频"
                    : null
                }
                batch={submittedBatch}
                onRetryItem={(itemIndex) => void retryBatchItem(itemIndex)}
                retryingItemIndex={retryingBatchItemIndex}
              />

              {submittedBatch ? (
                <div className="flex justify-end">
                  <Button asChild size="sm" variant="outline">
                    <a href={routeHref("/tasks")}>前往任务中心</a>
                  </Button>
                </div>
              ) : null}

              <StepActionBar
                backLabel="返回审核"
                onBack={() => changeStep(2)}
                primaryAction={
                  <Button
                    className="min-h-11 w-full sm:min-h-8 sm:w-auto"
                    disabled={!canSubmit}
                    onClick={() => void submitReviewedDrafts()}
                    type="button"
                  >
                    {isSubmitting ? (
                      <Loader2
                        className="animate-spin"
                        data-icon="inline-start"
                      />
                    ) : (
                      <Send data-icon="inline-start" />
                    )}
                    提交{isNonVideoTemplate ? nonVideoOutputLabel : "生成视频"}
                  </Button>
                }
                secondaryAction={
                  <Button
                    className="min-h-11 w-full sm:min-h-8 sm:w-auto"
                    disabled={!draftSet || isSavingDrafts}
                    onClick={() => void saveDrafts()}
                    type="button"
                    variant="outline"
                  >
                    {isSavingDrafts ? (
                      <Loader2
                        className="animate-spin"
                        data-icon="inline-start"
                      />
                    ) : (
                      <Save data-icon="inline-start" />
                    )}
                    保存审核稿
                  </Button>
                }
                summary={`${jobCount} 条内容 · ${selectedLanguages.length} 种语言`}
              />
            </>
          )}
        </section>
      ) : null}

      <PromptPeekSheet
        kind={peek?.kind ?? "script"}
        name={peek?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) {
            setPeek(null)
          }
        }}
        open={peek != null}
      />
    </PageFrame>
  )
}

function SettingsTextLink({
  to,
  children,
}: {
  to: string
  children: React.ReactNode
}) {
  return (
    <a
      className="text-primary transition-colors hover:underline"
      href={routeHref(to)}
    >
      {children}
    </a>
  )
}

function TemplateSelect({
  label,
  templates,
  value,
  onChange,
  onPeek,
}: {
  label: string
  templates: Array<{ name: string; source: string }>
  value: string
  onChange: (value: string) => void
  onPeek?: () => void
}) {
  const selectId =
    label === "脚本 Prompt"
      ? "script-review-script-template"
      : "script-review-split-template"
  const isEmpty = templates.length === 0

  return (
    <Field data-invalid={isEmpty || undefined}>
      <FieldLabel htmlFor={selectId}>{label}</FieldLabel>
      <div className="flex items-center gap-1.5">
        <Select disabled={isEmpty} onValueChange={onChange} value={value}>
          <SelectTrigger
            aria-invalid={isEmpty || undefined}
            className="w-full"
            id={selectId}
          >
            <SelectValue placeholder="选择 Prompt 模板" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {templates.map((template) => (
                <SelectItem key={template.name} value={template.name}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {onPeek && (
          <Button
            aria-label="查看提示词"
            className="min-h-11 min-w-11 sm:min-h-7 sm:min-w-7"
            disabled={!value}
            onClick={onPeek}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Eye />
          </Button>
        )}
      </div>
      {isEmpty ? <FieldError>没有可用的 {label}。</FieldError> : null}
    </Field>
  )
}

function parseLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseLanguages(text: string) {
  return text
    .replaceAll("，", ",")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function defaultLanguageScriptModel(
  language: string,
  scriptTemplateName: string,
  scriptModel: string
) {
  if (scriptTemplateName === BAZI_TEMPLATE_NAME) {
    return BAZI_LANGUAGE_SCRIPT_MODEL_DEFAULTS[language] ?? scriptModel.trim()
  }
  return scriptModel.trim()
}

function effectiveLanguageScriptModels(
  languages: string[],
  scriptTemplateName: string,
  scriptModel: string,
  overrides: Record<string, string>
) {
  return Object.fromEntries(
    languages
      .map((language) => [
        language,
        (
          overrides[language] ||
          defaultLanguageScriptModel(language, scriptTemplateName, scriptModel)
        ).trim(),
      ])
      .filter(([, model]) => model)
  )
}

function languageScriptTemplateOverrides(
  scriptTemplateName: string,
  templates: ScriptReviewTemplateListResponse | null
): Record<string, string> {
  if (scriptTemplateName !== BAZI_TEMPLATE_NAME) {
    return {}
  }
  const englishTemplate = templates?.script_templates.find(
    (template) => template.name === BAZI_ENGLISH_TEMPLATE_NAME
  )
  return englishTemplate ? { English: englishTemplate.content } : {}
}

function draftSetSelectedLanguages(draftSet: ScriptReviewDraftSet | null) {
  const selected = new Set<string>()
  for (const draft of draftSet?.drafts ?? []) {
    if (draft.selected_for_generation === false) {
      continue
    }
    for (const language of draft.selected_languages ?? []) {
      selected.add(language)
    }
  }
  return Array.from(selected)
}

function isTerminalBatchStatus(status: string) {
  return (
    status === "completed" || status === "failed" || status === "partial_failed"
  )
}
