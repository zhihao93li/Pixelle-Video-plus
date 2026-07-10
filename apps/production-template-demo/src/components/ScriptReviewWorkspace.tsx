import { useEffect, useMemo, useState } from "react"
import {
  CheckCircle2,
  Eye,
  Loader2,
  RefreshCcw,
  Save,
  Send,
  Wand2,
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
import { InlineError, InlineNotice } from "@/components/shared/feedback"
import {
  ProductionSubmitPanel,
  type ProductionOverrides,
} from "@/components/shared/ProductionSubmitPanel"
import { PromptPeekSheet } from "@/components/shared/PromptPeekSheet"
import { SourceChip } from "@/components/shared/SourceChip"
import { navigate } from "@/lib/router"
import { settingsLink } from "@/lib/settingsLinks"
import { useCurrentProject } from "@/lib/currentProject"
import { useTaskCenter } from "@/lib/taskCenter"
import { draftSetProvenance, readableError } from "@/lib/format"
import {
  getGenerationBatch,
  getSettingsConfig,
  getTask,
  listScriptReviewDraftSets,
  listDraftingProfiles,
  listScriptReviewTemplates,
  listTemplates,
  createScriptReviewDraftSet,
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
import {
  isNonVideoPipeline,
  templateArtifactType,
} from "@/lib/artifactKind"
import { buildScriptReviewDraftFeedback } from "@/lib/scriptReviewDraftFeedback"
import { cn } from "@/lib/utils"
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
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

const BAZI_LANGUAGE_SCRIPT_MODEL_DEFAULTS: Record<string, string> = {
  Chinese: "doubao-seed-2-0-lite-260428",
  English: "gemini-3.5-flash",
}
export function ScriptReviewWorkspace() {
  const { projectId, project } = useCurrentProject()
  const [sourceProfile, setSourceProfile] = useState<DraftingProfile | null>(null)
  const [peek, setPeek] = useState<{ kind: "script" | "split"; name: string } | null>(
    null
  )
  const [templates, setTemplates] =
    useState<ScriptReviewTemplateListResponse | null>(null)
  const [draftSets, setDraftSets] = useState<ScriptReviewDraftSet[]>([])
  const [draftSet, setDraftSet] = useState<ScriptReviewDraftSet | null>(null)
  const [topicsText, setTopicsText] = useState("")
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [presetLanguages, setPresetLanguages] = useState<string[]>([
    "Chinese",
    "English",
  ])
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
  const [ttsVoiceByLanguage, setTtsVoiceByLanguage] = useState<Record<string, string>>({})
  const [ttsSpeedByLanguage, setTtsSpeedByLanguage] = useState<Record<string, number>>({})
  const [submittedBatch, setSubmittedBatch] = useState<GenerationBatch | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshingDrafts, setIsRefreshingDrafts] = useState(false)
  const [isCreatingDrafts, setIsCreatingDrafts] = useState(false)
  const [isSavingDrafts, setIsSavingDrafts] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const taskCenter = useTaskCenter()

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
  const selectedTemplatePipeline = productionTemplates.find(
    (template) => template.id === productionTemplateId
  )?.pipeline_id
  const isNonVideoTemplate = isNonVideoPipeline(selectedTemplatePipeline)
  const nonVideoOutputLabel =
    templateArtifactType(selectedTemplatePipeline) === "text" ? "长文" : "图文帖"
  const canSubmit =
    Boolean(draftSet) &&
    Boolean(productionTemplateId) &&
    jobCount > 0 &&
    draftValidationErrors.length === 0 &&
    selectedLanguages.length > 0 &&
    (isNonVideoTemplate ||
      selectedLanguages.every((language) =>
        (ttsVoiceByLanguage[language] || "").trim()
      )) &&
    !isSubmitting

  // 生产模板列表（仅用来判断选中模板是不是图文帖，决定是否显示音色区）
  useEffect(() => {
    let cancelled = false
    void listTemplates()
      .then((response) => {
        if (!cancelled) {
          setProductionTemplates(response.templates)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    listScriptReviewTemplates()
      .then((templateResponse) => {
        if (cancelled) {
          return
        }
        setTemplates(templateResponse)
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(readableError(loadError))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsInitialLoading(false)
        }
      })

    void Promise.allSettled([getSettingsConfig()]).then(
      ([settingsResult]) => {
      if (cancelled) {
        return
      }
      if (settingsResult.status === "fulfilled") {
        const defaultReferenceId = (
          settingsResult.value.config?.comfyui?.tts?.fish_audio
            ?.reference_id ?? ""
        ).trim()
        if (defaultReferenceId) {
          // 与旧版一致：中文默认带入设置里的 Fish reference_id
          setTtsVoiceByLanguage((current) =>
            current.Chinese ? current : { ...current, Chinese: defaultReferenceId }
          )
        }
      }
      }
    )

    return () => {
      cancelled = true
    }
  }, [])

  // 项目作用域：草稿集列表随项目切换刷新；首步默认配方/语言/每语言音色取项目默认。
  useEffect(() => {
    let cancelled = false

    void listScriptReviewDraftSets(projectId ?? undefined)
      .then((response) => {
        if (cancelled) {
          return
        }
        setDraftSets(response.draft_sets)
        // 切换项目时重置选中草稿，避免看到别的项目的草稿
        setDraftSet(response.draft_sets[0] ?? null)
      })
      .catch(() => {
        // 列表读取失败不阻塞页面
      })

    void listDraftingProfiles()
      .then((response) => {
        if (cancelled) {
          return
        }
        // 起草配置与项目 1:1：取当前项目的配置
        const profile =
          response.profiles.find((item) => item.project_id === projectId) ?? null
        setSourceProfile(profile)
        if (profile) {
          setScriptTemplateName((current) => current || profile.script_template_name)
          setSplitTemplateName((current) => current || profile.split_template_name)
          setScriptModel((current) => current || profile.script_model)
          setSplitModel((current) => current || profile.split_model)
          if (Object.keys(profile.language_script_models).length > 0) {
            setLanguageScriptModels((current) => ({
              ...profile.language_script_models,
              ...current,
            }))
          }
        }
        // 语言归项目管
        if (project?.languages?.length) {
          setPresetLanguages(project.languages)
        }
        // 每语言音色预填项目默认（项目 > 设置全局）
        if (project && Object.keys(project.tts_voice_by_language).length > 0) {
          setTtsVoiceByLanguage((current) => ({
            ...current,
            ...project.tts_voice_by_language,
          }))
        }
      })
      .catch(() => {
        // 配方读取失败不阻塞页面
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (!submittedBatch || isTerminalBatchStatus(submittedBatch.status)) {
      return
    }
    const timer = window.setInterval(() => {
      void getGenerationBatch(submittedBatch.batch_id)
        .then(setSubmittedBatch)
        .catch((pollError) => setError(readableError(pollError)))
    }, 2000)
    return () => window.clearInterval(timer)
  }, [submittedBatch])

  async function refreshDraftSets() {
    setIsRefreshingDrafts(true)
    setError(null)
    try {
      const response = await listScriptReviewDraftSets(projectId ?? undefined)
      setDraftSets(response.draft_sets)
      setDraftSet((current) => current ?? response.draft_sets[0] ?? null)
    } catch (refreshError) {
      setError(readableError(refreshError))
    } finally {
      setIsRefreshingDrafts(false)
    }
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
        ...current.filter((item) => item.draft_set_id !== response.draft_set_id),
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
        ...current.filter((item) => item.draft_set_id !== response.draft_set_id),
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
    try {
      const response = await submitScriptReviewDraftSetTasks(draftSet.draft_set_id, {
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
      })
      setDraftSet(response.draft_set)
      setSubmittedBatch(response.batch)
      setNotice(
        `已提交 ${response.batch.submitted_count} 个生成任务，可在「任务」页跟踪进度。`
      )
      void trackSubmittedTasks(response.batch)
    } catch (submitError) {
      setError(readableError(submitError))
    } finally {
      setIsSubmitting(false)
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

  function patchDraft(nextDraftIndex: number, patch: Partial<ScriptReviewDraft>) {
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

  return (
    <main className="flex max-w-[960px] flex-col gap-5 p-4 lg:p-6">
      <ReviewStepper
        current={step}
        hasDraft={Boolean(draftSet)}
        onStepChange={setStep}
      />

      {step === 1 && (
      <section className="flex min-w-0 flex-col gap-5">
        <Card className="rounded-lg">
          <CardHeader className="border-b">
            <CardTitle>多语言审核出片</CardTitle>
            <CardDescription>
              先生成多语言草稿，人工确认标题、全文和分镜，再提交真实视频任务。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              {sourceProfile && (
                <div className="text-xs text-muted-foreground">
                  默认值来自项目
                  <SettingsTextLink to={settingsLink({ kind: "projects" })}>
                    「{project?.name ?? "当前项目"}」
                  </SettingsTextLink>
                  的起草配置
                  {defaultsModified && "，部分字段已修改"}
                </div>
              )}
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">选题</span>
                <Textarea
                  className="min-h-28 resize-y"
                  onChange={(event) => setTopicsText(event.target.value)}
                  placeholder={"一行一个选题\n猫咪夏天饮水少怎么办"}
                  value={topicsText}
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">语言</span>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_LANGUAGES.map((language) => {
                      const active = presetLanguages.includes(language)
                      return (
                        <Button
                          key={language}
                          onClick={() =>
                            setPresetLanguages((current) =>
                              current.includes(language)
                                ? current.filter((item) => item !== language)
                                : [...current, language]
                            )
                          }
                          size="sm"
                          type="button"
                          variant={active ? "secondary" : "outline"}
                        >
                          {LANGUAGE_LABELS[language] ?? language}
                        </Button>
                      )
                    })}
                  </div>
                  <Input
                    onChange={(event) =>
                      setCustomLanguagesText(event.target.value)
                    }
                    placeholder="自定义语言，逗号分隔，例如：French, German"
                    value={customLanguagesText}
                  />
                </div>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">脚本模型</span>
                  <Input
                    onChange={(event) => setScriptModel(event.target.value)}
                    placeholder="留空使用当前默认模型"
                    value={scriptModel}
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <TemplateSelect
                  label="脚本 Prompt"
                  onChange={setScriptTemplateName}
                  onPeek={() =>
                    setPeek({ kind: "script", name: currentScriptTemplateName })
                  }
                  templates={(templates?.script_templates ?? []).filter(
                    (template) => template.name !== BAZI_ENGLISH_TEMPLATE_NAME
                  )}
                  value={currentScriptTemplateName}
                />
                <TemplateSelect
                  label="分镜 Prompt"
                  onChange={setSplitTemplateName}
                  onPeek={() =>
                    setPeek({ kind: "split", name: currentSplitTemplateName })
                  }
                  templates={templates?.split_templates ?? []}
                  value={currentSplitTemplateName}
                />
              </div>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">分镜模型</span>
                <Input
                  onChange={(event) => setSplitModel(event.target.value)}
                  placeholder="留空使用当前默认模型"
                  value={splitModel}
                />
              </label>

              {languages.length > 0 && (
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div className="text-sm font-medium">每语言脚本模型</div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    旧 Streamlit 支持按语言覆盖脚本模型；留空时使用脚本模型或模板默认值。
                  </p>
                  {currentScriptTemplateName === BAZI_TEMPLATE_NAME && (
                    <div className="mt-3 rounded-lg bg-background p-3 text-xs leading-5 text-muted-foreground">
                      Bazi 模板会沿用旧版映射：Chinese 使用 Doubao，English 使用 Gemini，并自动使用英文脚本 Prompt。
                    </div>
                  )}
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {languages.map((language) => (
                      <label
                        className="flex flex-col gap-1.5 text-sm"
                        key={language}
                      >
                        <span className="font-medium">{language}</span>
                        <Input
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
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {error && <InlineError title="操作失败" message={error} />}
              {notice && <InlineNotice message={notice} />}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                  {isInitialLoading
                    ? "正在读取审核模板"
                    : `已识别 ${topics.length} 个选题，${languages.length} 种语言`}
                </div>
                <Button disabled={!canCreateDrafts} onClick={() => void createDrafts()}>
                  {isCreatingDrafts ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Wand2 data-icon="inline-start" />
                  )}
                  生成审核草稿
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>最近审核草稿</CardTitle>
                <CardDescription>从后端持久化 draft set 读取。</CardDescription>
              </div>
              <Button
                disabled={isRefreshingDrafts}
                onClick={() => void refreshDraftSets()}
                size="icon-sm"
                variant="outline"
              >
                <RefreshCcw
                  className={cn(isRefreshingDrafts && "animate-spin")}
                />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {draftSets.length === 0 ? (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                还没有审核草稿。
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {draftSets.slice(0, 8).map((item) => (
                  <div
                    className={cn(
                      "rounded-lg border bg-background p-3 text-sm",
                      draftSet?.draft_set_id === item.draft_set_id &&
                        "border-primary bg-primary/5"
                    )}
                    key={item.draft_set_id}
                  >
                    <button
                      className="w-full text-left transition-opacity hover:opacity-80"
                      onClick={() => {
                        setDraftSet(item)
                        setStep(2)
                      }}
                      type="button"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-xs">
                          {item.draft_set_id}
                        </span>
                        <Badge variant="secondary">{item.status}</Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {item.topics.length} 个选题，{item.languages.join(", ")}
                      </div>
                    </button>
                    {item.status === "submitted" && (
                      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
                        <span className="text-xs text-muted-foreground">
                          已出片 {item.submissions.length} 次
                        </span>
                        <Button
                          onClick={() => {
                            setDraftSet(item)
                            setStep(3)
                          }}
                          size="sm"
                          variant="outline"
                        >
                          再次出片
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
      )}

      {step === 2 && (
        <section className="flex min-w-0 flex-col gap-5">
          <DraftEditor
            draftSet={draftSet}
            onPatchDraft={patchDraft}
            onPatchLanguageDraft={patchLanguageDraft}
            onToggleLanguage={toggleLanguage}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button onClick={() => setStep(1)} variant="outline">
              上一步
            </Button>
            <div className="flex items-center gap-2">
              <Button
                disabled={!draftSet || isSavingDrafts}
                onClick={() => void saveDrafts()}
                variant="outline"
              >
                {isSavingDrafts ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : (
                  <Save data-icon="inline-start" />
                )}
                保存审核修改
              </Button>
              <Button
                disabled={!draftSet || draftValidationErrors.length > 0}
                onClick={() => setStep(3)}
              >
                下一步：确认与提交
              </Button>
            </div>
          </div>
        </section>
      )}

      {step === 3 && (
      <aside className="flex min-w-0 flex-col gap-5">
        <Card className="rounded-lg">
          <CardHeader className="border-b">
            <CardTitle>确认与提交</CardTitle>
            <CardDescription>提交后进入统一 generation batch 和 History。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              {draftSet?.status === "submitted" && (
                <InlineNotice
                  message={`这批确认稿已出过 ${draftSet.submissions.length} 次片，可换模板再次提交。`}
                />
              )}
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
                <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                  {nonVideoOutputLabel}没有配音，无需填写每语言音色。
                </div>
              ) : (
              <div className="flex flex-col gap-3">
                <div className="text-sm font-medium">每语言 Fish TTS</div>
                {selectedLanguages.length === 0 ? (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                    先在草稿里选择至少一种语言。
                  </div>
                ) : (
                  selectedLanguages.map((language) => (
                    <div className="rounded-lg border bg-background p-3" key={language}>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{language}</span>
                        <Badge variant="secondary">Fish</Badge>
                      </div>
                      <label className="flex flex-col gap-1.5 text-sm">
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          Fish reference_id
                          {project?.tts_voice_by_language?.[language] &&
                            (ttsVoiceByLanguage[language] ?? "") ===
                              project.tts_voice_by_language[language] && (
                              <SourceChip
                                source="project"
                                to={settingsLink({ kind: "projects" })}
                              />
                            )}
                        </span>
                        <Input
                          onChange={(event) =>
                            setTtsVoiceByLanguage((current) => ({
                              ...current,
                              [language]: event.target.value,
                            }))
                          }
                          placeholder={`${language} reference_id`}
                          value={ttsVoiceByLanguage[language] ?? ""}
                        />
                      </label>
                      {!(ttsVoiceByLanguage[language] ?? "").trim() && (
                        <div className="mt-1 text-xs text-destructive">
                          该语言需要填写 Fish reference_id
                        </div>
                      )}
                      <label className="mt-3 flex flex-col gap-1.5 text-sm">
                        <span className="text-xs text-muted-foreground">
                          语速 · {(ttsSpeedByLanguage[language] ?? 1).toFixed(1)}x
                        </span>
                        <Slider
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
                      </label>
                    </div>
                  ))
                )}
              </div>
              )}

              {draftValidationErrors.length > 0 && (
                <InlineError
                  title="草稿还有问题"
                  message={draftValidationErrors.join("；")}
                />
              )}

              <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                将生成 {jobCount} 条
                {isNonVideoTemplate ? nonVideoOutputLabel : "视频"}
                （已审核选题 × 勾选语言）。
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  disabled={!draftSet || isSavingDrafts}
                  onClick={() => void saveDrafts()}
                  variant="outline"
                >
                  {isSavingDrafts ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Save data-icon="inline-start" />
                  )}
                  保存审核修改
                </Button>
                <Button disabled={!canSubmit} onClick={() => void submitReviewedDrafts()}>
                  {isSubmitting ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Send data-icon="inline-start" />
                  )}
                  提交生成视频
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <BatchStatusCard batch={submittedBatch} />

        <div className="flex items-center justify-between gap-3">
          <Button onClick={() => setStep(2)} variant="outline">
            上一步
          </Button>
          {submittedBatch && (
            <Button onClick={() => navigate("/tasks")}>
              前往任务中心
            </Button>
          )}
        </div>
      </aside>
      )}

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
    </main>
  )
}

function ReviewStepper({
  current,
  hasDraft,
  onStepChange,
}: {
  current: 1 | 2 | 3
  hasDraft: boolean
  onStepChange: (step: 1 | 2 | 3) => void
}) {
  const steps: Array<{ step: 1 | 2 | 3; label: string; enabled: boolean }> = [
    { step: 1, label: "生成草稿", enabled: true },
    { step: 2, label: "逐条审核", enabled: hasDraft },
    { step: 3, label: "提交生成", enabled: hasDraft },
  ]
  return (
    <nav
      aria-label="审核流程步骤"
      className="flex items-center gap-2 rounded-lg border bg-background p-2"
    >
      {steps.map((item, index) => (
        <div className="flex flex-1 items-center gap-2" key={item.step}>
          <button
            aria-current={current === item.step ? "step" : undefined}
            className={cn(
              "flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
              current === item.step
                ? "bg-primary text-primary-foreground"
                : item.enabled
                  ? "text-foreground hover:bg-muted"
                  : "cursor-not-allowed text-muted-foreground/60"
            )}
            disabled={!item.enabled}
            onClick={() => onStepChange(item.step)}
            type="button"
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border text-xs",
                current === item.step
                  ? "border-primary-foreground/40"
                  : "border-border"
              )}
            >
              {item.step}
            </span>
            <span className="truncate">{item.label}</span>
          </button>
          {index < steps.length - 1 && (
            <span aria-hidden className="h-px w-4 shrink-0 bg-border" />
          )}
        </div>
      ))}
    </nav>
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
    <button
      className="text-primary transition-colors hover:underline"
      onClick={() => navigate(to)}
      type="button"
    >
      {children}
    </button>
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
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-1.5">
        <Select onValueChange={onChange} value={value}>
          <SelectTrigger className="w-full">
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
            onClick={onPeek}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Eye />
          </Button>
        )}
      </div>
    </label>
  )
}

function DraftEditor({
  draftSet,
  onPatchDraft,
  onPatchLanguageDraft,
  onToggleLanguage,
}: {
  draftSet: ScriptReviewDraftSet | null
  onPatchDraft: (draftIndex: number, patch: Partial<ScriptReviewDraft>) => void
  onPatchLanguageDraft: (
    draftIndex: number,
    language: string,
    patch: Partial<ScriptReviewLanguageDraft>
  ) => void
  onToggleLanguage: (draftIndex: number, language: string) => void
}) {
  const feedback = draftSet ? buildScriptReviewDraftFeedback(draftSet) : null
  const provenance = draftSet ? draftSetProvenance(draftSet) : null

  return (
    <Card className="rounded-lg">
      <CardHeader className="border-b">
        <CardTitle>审核草稿</CardTitle>
        <CardDescription>确认每条视频要生成的语言、标题、全文和分镜。</CardDescription>
        {provenance && (
          <div className="mt-1 text-xs text-muted-foreground">由 {provenance} 生成</div>
        )}
      </CardHeader>
      <CardContent>
        {!draftSet ? (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            先生成或选择一个审核草稿。
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{draftSet.status}</Badge>
              <Badge variant="outline">{draftSet.drafts.length} 组草稿</Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {draftSet.draft_set_id}
              </span>
            </div>
            {feedback?.errorMessage && (
              <InlineError
                title={feedback.errorTitle ?? "草稿生成失败"}
                message={feedback.errorMessage}
              />
            )}
            {draftSet.drafts.map((draft, draftIndex) => {
              const languageDrafts = draft.language_drafts ?? {}
              const selectedLanguages = new Set(draft.selected_languages ?? [])
              return (
                <div className="rounded-lg border bg-background p-4" key={draftIndex}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{draft.topic}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {Object.keys(languageDrafts).length} 种语言
                      </div>
                    </div>
                    <Button
                      onClick={() =>
                        onPatchDraft(draftIndex, {
                          selected_for_generation:
                            !draft.selected_for_generation,
                        })
                      }
                      size="sm"
                      variant={
                        draft.selected_for_generation === false
                          ? "outline"
                          : "secondary"
                      }
                    >
                      {draft.selected_for_generation === false
                        ? "跳过"
                        : "参与生成"}
                    </Button>
                  </div>
                  <div className="flex flex-col gap-4">
                    {Object.entries(languageDrafts).map(([language, languageDraft]) => (
                      <div
                        className="rounded-lg border bg-muted/20 p-3"
                        key={language}
                      >
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{language}</Badge>
                            {selectedLanguages.has(language) && (
                              <CheckCircle2 data-icon="inline-start" />
                            )}
                          </div>
                          <Button
                            onClick={() => onToggleLanguage(draftIndex, language)}
                            size="sm"
                            variant={
                              selectedLanguages.has(language)
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {selectedLanguages.has(language) ? "生成" : "不生成"}
                          </Button>
                        </div>
                        <label className="flex flex-col gap-1.5 text-sm">
                          <span className="font-medium">标题</span>
                          <Input
                            onChange={(event) =>
                              onPatchLanguageDraft(draftIndex, language, {
                                title: event.target.value,
                              })
                            }
                            value={languageDraft.title ?? ""}
                          />
                        </label>
                        <label className="mt-3 flex flex-col gap-1.5 text-sm">
                          <span className="font-medium">完整文案</span>
                          <Textarea
                            className="min-h-32 resize-y"
                            onChange={(event) =>
                              onPatchLanguageDraft(draftIndex, language, {
                                script: event.target.value,
                              })
                            }
                            value={languageDraft.script ?? ""}
                          />
                        </label>
                        <label className="mt-3 flex flex-col gap-1.5 text-sm">
                          <span className="font-medium">分镜文案</span>
                          <Textarea
                            className="min-h-32 resize-y"
                            onChange={(event) =>
                              onPatchLanguageDraft(draftIndex, language, {
                                narrations: parseLines(event.target.value),
                              })
                            }
                            value={(languageDraft.narrations ?? []).join("\n")}
                          />
                          <span className="text-xs text-muted-foreground">
                            一行一个分镜（{(languageDraft.narrations ?? []).length} 个）
                          </span>
                        </label>
                        {selectedLanguages.has(language) &&
                          (languageDraft.narrations ?? []).length === 0 && (
                            <div className="mt-1 text-xs text-destructive">
                              已勾选生成，但分镜文案为空
                            </div>
                          )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function BatchStatusCard({ batch }: { batch: GenerationBatch | null }) {
  return (
    <Card className="rounded-lg">
      <CardHeader className="border-b">
        <CardTitle>提交批次</CardTitle>
        <CardDescription>显示真实 generation task 状态。</CardDescription>
      </CardHeader>
      <CardContent>
        {!batch ? (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            审核通过并提交后会显示批次。
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={batch.status === "failed" ? "destructive" : "secondary"}>
                {batch.status}
              </Badge>
              <Badge variant="outline">{batch.submitted_count} 个任务</Badge>
              <Badge variant="outline">失败 {batch.failed_count}</Badge>
            </div>
            <div className="font-mono text-xs text-muted-foreground">
              {batch.batch_id}
            </div>
            <div className="flex flex-col gap-2">
              {batch.items.map((item) => (
                <div className="rounded-lg border bg-background p-3" key={item.index}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {item.task_id || "未创建 task"}
                    </span>
                    <Badge variant="secondary">{item.status}</Badge>
                  </div>
                  {item.progress && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {item.progress.stage} · {item.progress.percentage}%
                    </div>
                  )}
                  {item.error && (
                    <div className="mt-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
                      {item.error.layer}: {item.error.message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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
        (overrides[language] || defaultLanguageScriptModel(
          language,
          scriptTemplateName,
          scriptModel
        )).trim(),
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
  return status === "completed" || status === "failed" || status === "partial_failed"
}
