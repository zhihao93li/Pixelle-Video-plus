import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
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
import {
  ApiError,
  getGenerationBatch,
  listScriptReviewDraftSets,
  listScriptReviewTemplates,
  createScriptReviewDraftSet,
  submitScriptReviewDraftSetTasks,
  updateScriptReviewDraftSet,
  type GenerationBatch,
  type ScriptReviewDraft,
  type ScriptReviewDraftSet,
  type ScriptReviewLanguageDraft,
  type ScriptReviewTemplateListResponse,
} from "@/lib/generationApi"
import { buildScriptReviewDraftFeedback } from "@/lib/scriptReviewDraftFeedback"
import { cn } from "@/lib/utils"

const DEFAULT_FRAME_TEMPLATE = "1080x1920/image_default.html"
const BAZI_TEMPLATE_NAME = "Bazi Storyboard Oral Script"
const BAZI_ENGLISH_TEMPLATE_NAME = "Bazi Storyboard Oral Script English"
const BAZI_LANGUAGE_SCRIPT_MODEL_DEFAULTS: Record<string, string> = {
  Chinese: "doubao-seed-2-0-lite-260428",
  English: "gemini-3.5-flash",
}

export function ScriptReviewWorkspace() {
  const [templates, setTemplates] =
    useState<ScriptReviewTemplateListResponse | null>(null)
  const [draftSets, setDraftSets] = useState<ScriptReviewDraftSet[]>([])
  const [draftSet, setDraftSet] = useState<ScriptReviewDraftSet | null>(null)
  const [topicsText, setTopicsText] = useState("猫咪夏天饮水少怎么办")
  const [languagesText, setLanguagesText] = useState("Chinese, English")
  const [scriptTemplateName, setScriptTemplateName] = useState("")
  const [splitTemplateName, setSplitTemplateName] = useState("")
  const [scriptModel, setScriptModel] = useState("")
  const [splitModel, setSplitModel] = useState("")
  const [languageScriptModels, setLanguageScriptModels] = useState<
    Record<string, string>
  >({})
  const [frameTemplate, setFrameTemplate] = useState(DEFAULT_FRAME_TEMPLATE)
  const [promptPrefix, setPromptPrefix] = useState("")
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

  const topics = useMemo(() => parseLines(topicsText), [topicsText])
  const languages = useMemo(() => parseLanguages(languagesText), [languagesText])
  const currentScriptTemplateName =
    scriptTemplateName || templates?.script_templates[0]?.name || ""
  const currentSplitTemplateName =
    splitTemplateName || templates?.split_templates[0]?.name || ""
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
  const canSubmit =
    Boolean(draftSet) &&
    selectedLanguages.length > 0 &&
    selectedLanguages.every((language) => (ttsVoiceByLanguage[language] || "").trim()) &&
    !isSubmitting

  useEffect(() => {
    let cancelled = false

    Promise.all([listScriptReviewTemplates(), listScriptReviewDraftSets()])
      .then(([templateResponse, draftSetResponse]) => {
        if (cancelled) {
          return
        }
        setTemplates(templateResponse)
        setDraftSets(draftSetResponse.draft_sets)
        setDraftSet((current) => current ?? draftSetResponse.draft_sets[0] ?? null)
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

    return () => {
      cancelled = true
    }
  }, [])

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
      const response = await listScriptReviewDraftSets()
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
        baseParams: {
          frame_template: frameTemplate,
          split_mode: "line",
          prompt_prefix: promptPrefix.trim(),
          tts_inference_mode: "fish",
          bgm_volume: 0.2,
          bgm_mode: "loop",
          compose_runtime: "html_ffmpeg",
          quality_profile: "basic",
          allow_silent: false,
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
      setNotice(`已提交 ${response.batch.submitted_count} 个真实生成任务。`)
    } catch (submitError) {
      setError(readableError(submitError))
    } finally {
      setIsSubmitting(false)
    }
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
    <main className="mx-auto grid max-w-[1240px] gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_420px] lg:p-6">
      <section className="flex min-w-0 flex-col gap-5">
        <Card className="rounded-lg">
          <CardHeader className="border-b">
            <CardTitle>文案审核后生成</CardTitle>
            <CardDescription>
              先生成多语言草稿，人工确认标题、全文和分镜，再提交真实视频任务。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
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
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">语言</span>
                  <Input
                    onChange={(event) => setLanguagesText(event.target.value)}
                    placeholder="Chinese, English"
                    value={languagesText}
                  />
                </label>
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
                  templates={templates?.script_templates ?? []}
                  value={currentScriptTemplateName}
                />
                <TemplateSelect
                  label="分镜 Prompt"
                  onChange={setSplitTemplateName}
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

        <DraftEditor
          draftSet={draftSet}
          onPatchDraft={patchDraft}
          onPatchLanguageDraft={patchLanguageDraft}
          onToggleLanguage={toggleLanguage}
        />
      </section>

      <aside className="flex min-w-0 flex-col gap-5">
        <Card className="rounded-lg">
          <CardHeader className="border-b">
            <CardTitle>确认与提交</CardTitle>
            <CardDescription>提交后进入统一 generation batch 和 History。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">画面模板</span>
                <Input
                  onChange={(event) => setFrameTemplate(event.target.value)}
                  value={frameTemplate}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">图片提示词前缀</span>
                <Textarea
                  className="min-h-24 resize-y"
                  onChange={(event) => setPromptPrefix(event.target.value)}
                  placeholder="可选，用于约束画面风格"
                  value={promptPrefix}
                />
              </label>

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
                      <Input
                        className="mt-2"
                        min={0.5}
                        max={2}
                        onChange={(event) =>
                          setTtsSpeedByLanguage((current) => ({
                            ...current,
                            [language]: Number(event.target.value) || 1,
                          }))
                        }
                        step={0.1}
                        type="number"
                        value={ttsSpeedByLanguage[language] ?? 1}
                      />
                    </div>
                  ))
                )}
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
                  <button
                    className={cn(
                      "rounded-lg border bg-background p-3 text-left text-sm hover:bg-muted/40",
                      draftSet?.draft_set_id === item.draft_set_id &&
                        "border-primary bg-primary/5"
                    )}
                    key={item.draft_set_id}
                    onClick={() => setDraftSet(item)}
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
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </aside>
    </main>
  )
}

function TemplateSelect({
  label,
  templates,
  value,
  onChange,
}: {
  label: string
  templates: Array<{ name: string; source: string }>
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
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

  return (
    <Card className="rounded-lg">
      <CardHeader className="border-b">
        <CardTitle>审核草稿</CardTitle>
        <CardDescription>确认每条视频要生成的语言、标题、全文和分镜。</CardDescription>
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
                        </label>
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

function InlineError({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <div>
          <div className="font-medium">{title}</div>
          <div className="mt-1 whitespace-pre-line leading-6">{message}</div>
        </div>
      </div>
    </div>
  )
}

function InlineNotice({ message }: { message: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
      {message}
    </div>
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

function readableError(error: unknown) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
