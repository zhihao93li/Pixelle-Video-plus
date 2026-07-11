import { useState } from "react"
import {
  CheckCircle2,
  ChevronRight,
  FilePenLine,
  Languages,
} from "lucide-react"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"

import { EmptyState } from "@/components/shared/EmptyState"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { WorkspacePanel } from "@/components/shared/WorkspacePanel"
import { InlineError } from "@/components/shared/feedback"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { draftSetProvenance } from "@/lib/format"
import type {
  ScriptReviewDraft,
  ScriptReviewDraftSet,
  ScriptReviewLanguageDraft,
} from "@/lib/generationApi"
import { buildScriptReviewDraftFeedback } from "@/lib/scriptReviewDraftFeedback"
import { cn } from "@/lib/utils"

export function DraftReviewEditor({
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
    <WorkspacePanel
      contentClassName="p-0"
      description="按选题展开，再逐种语言确认标题、全文和分镜。所有选择都会随草稿集保存。"
      title="逐条审核草稿"
    >
      {!draftSet ? (
        <EmptyState
          className="m-4"
          description="先返回第一步生成草稿，或从最近草稿中恢复。"
          headingLevel={3}
          icon={FilePenLine}
          title="没有选中的审核草稿"
        />
      ) : (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <StatusBadge status={draftSet.status} />
            <Badge variant="outline">{draftSet.drafts.length} 个选题</Badge>
            <Badge variant="outline">
              {selectedJobCount(draftSet.drafts)} 条待生产内容
            </Badge>
            {provenance ? (
              <span className="text-xs text-muted-foreground">
                由 {provenance} 生成
              </span>
            ) : null}
          </div>

          {feedback?.errorMessage ? (
            <div className="px-4 pb-1">
              <InlineError
                message={feedback.errorMessage}
                title={feedback.errorTitle ?? "草稿生成失败"}
              />
            </div>
          ) : null}

          {draftSet.drafts.length === 0 ? (
            <EmptyState
              className="m-4"
              description="后端返回的草稿集中没有可编辑内容，当前不能进入生产提交。"
              headingLevel={3}
              icon={FilePenLine}
              title="草稿集没有可审核内容"
            />
          ) : (
            <div className="flex flex-col">
              {draftSet.drafts.map((draft, draftIndex) => (
                <TopicDraftEditor
                  draft={draft}
                  draftIndex={draftIndex}
                  key={`${draft.index ?? draftIndex}-${draft.topic}`}
                  onPatchDraft={onPatchDraft}
                  onPatchLanguageDraft={onPatchLanguageDraft}
                  onToggleLanguage={onToggleLanguage}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </WorkspacePanel>
  )
}

function TopicDraftEditor({
  draft,
  draftIndex,
  onPatchDraft,
  onPatchLanguageDraft,
  onToggleLanguage,
}: {
  draft: ScriptReviewDraft
  draftIndex: number
  onPatchDraft: (draftIndex: number, patch: Partial<ScriptReviewDraft>) => void
  onPatchLanguageDraft: (
    draftIndex: number,
    language: string,
    patch: Partial<ScriptReviewLanguageDraft>
  ) => void
  onToggleLanguage: (draftIndex: number, language: string) => void
}) {
  const [open, setOpen] = useState(draftIndex === 0)
  const languageDrafts = Object.entries(draft.language_drafts ?? {})
  const selectedLanguages = new Set(draft.selected_languages ?? [])
  const selectedForGeneration = draft.selected_for_generation !== false

  return (
    <CollapsiblePrimitive.Root
      className="border-b last:border-b-0"
      onOpenChange={setOpen}
      open={open}
    >
      <div className="flex min-w-0 items-center gap-2 px-2 py-1 sm:px-3">
        <CollapsiblePrimitive.Trigger className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50">
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
              open && "rotate-90"
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {draft.topic}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {languageDrafts.length} 种语言 · {selectedLanguages.size}{" "}
              种参与生产
            </span>
          </span>
        </CollapsiblePrimitive.Trigger>
        <Button
          aria-pressed={selectedForGeneration}
          className="min-h-11 shrink-0 sm:min-h-7"
          onClick={() =>
            onPatchDraft(draftIndex, {
              selected_for_generation: !selectedForGeneration,
            })
          }
          size="sm"
          type="button"
          variant={selectedForGeneration ? "secondary" : "outline"}
        >
          {selectedForGeneration ? "参与生成" : "已跳过"}
        </Button>
      </div>

      <CollapsiblePrimitive.Content>
        <div className="border-t bg-muted/20 px-3 py-3 sm:px-4">
          {languageDrafts.length === 0 ? (
            <EmptyState
              className="min-h-40"
              description="该选题没有返回语言草稿，当前不能提交生成。"
              headingLevel={3}
              icon={Languages}
              title="没有语言草稿"
            />
          ) : (
            <div className="flex flex-col gap-2">
              {languageDrafts.map(
                ([language, languageDraft], languageIndex) => (
                  <LanguageDraftEditor
                    draftIndex={draftIndex}
                    isSelected={selectedLanguages.has(language)}
                    key={language}
                    language={language}
                    languageDraft={languageDraft}
                    languageIndex={languageIndex}
                    onPatchLanguageDraft={onPatchLanguageDraft}
                    onToggleLanguage={onToggleLanguage}
                  />
                )
              )}
            </div>
          )}
        </div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  )
}

function LanguageDraftEditor({
  draftIndex,
  isSelected,
  language,
  languageDraft,
  languageIndex,
  onPatchLanguageDraft,
  onToggleLanguage,
}: {
  draftIndex: number
  isSelected: boolean
  language: string
  languageDraft: ScriptReviewLanguageDraft
  languageIndex: number
  onPatchLanguageDraft: (
    draftIndex: number,
    language: string,
    patch: Partial<ScriptReviewLanguageDraft>
  ) => void
  onToggleLanguage: (draftIndex: number, language: string) => void
}) {
  const [open, setOpen] = useState(languageIndex === 0)
  const titleId = `review-${draftIndex}-${languageIndex}-title`
  const scriptId = `review-${draftIndex}-${languageIndex}-script`
  const narrationsId = `review-${draftIndex}-${languageIndex}-narrations`
  const scriptMissing = isSelected && !(languageDraft.script ?? "").trim()
  const narrationsMissing =
    isSelected && (languageDraft.narrations ?? []).length === 0

  return (
    <CollapsiblePrimitive.Root
      className="overflow-hidden rounded-lg border bg-background"
      onOpenChange={setOpen}
      open={open}
    >
      <div className="flex min-w-0 items-center gap-2 p-1.5">
        <CollapsiblePrimitive.Trigger className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50">
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
              open && "rotate-90"
            )}
          />
          <span className="truncate text-sm font-medium">{language}</span>
          {isSelected ? (
            <CheckCircle2
              aria-label="已选择生成"
              className="size-4 shrink-0 text-success"
            />
          ) : null}
          {scriptMissing || narrationsMissing ? (
            <Badge variant="destructive">待补全</Badge>
          ) : null}
        </CollapsiblePrimitive.Trigger>
        <Button
          aria-pressed={isSelected}
          className="min-h-11 shrink-0 sm:min-h-7"
          onClick={() => onToggleLanguage(draftIndex, language)}
          size="sm"
          type="button"
          variant={isSelected ? "secondary" : "outline"}
        >
          {isSelected ? "生成" : "不生成"}
        </Button>
      </div>

      <CollapsiblePrimitive.Content>
        <FieldGroup className="border-t p-3 sm:p-4">
          <Field>
            <FieldLabel htmlFor={titleId}>标题</FieldLabel>
            <Input
              autoComplete="off"
              id={titleId}
              name={titleId}
              onChange={(event) =>
                onPatchLanguageDraft(draftIndex, language, {
                  title: event.target.value,
                })
              }
              value={languageDraft.title ?? ""}
            />
          </Field>

          <Field data-invalid={scriptMissing || undefined}>
            <FieldLabel htmlFor={scriptId}>完整文案</FieldLabel>
            <Textarea
              aria-invalid={scriptMissing || undefined}
              className="min-h-40 resize-y"
              id={scriptId}
              name={scriptId}
              onChange={(event) =>
                onPatchLanguageDraft(draftIndex, language, {
                  script: event.target.value,
                })
              }
              value={languageDraft.script ?? ""}
            />
            {scriptMissing ? (
              <FieldError>已选择生成，但完整文案为空。</FieldError>
            ) : null}
          </Field>

          <Field data-invalid={narrationsMissing || undefined}>
            <FieldLabel htmlFor={narrationsId}>分镜文案</FieldLabel>
            <Textarea
              aria-invalid={narrationsMissing || undefined}
              className="min-h-40 resize-y"
              id={narrationsId}
              name={narrationsId}
              onChange={(event) =>
                onPatchLanguageDraft(draftIndex, language, {
                  narrations: parseLines(event.target.value),
                })
              }
              value={(languageDraft.narrations ?? []).join("\n")}
            />
            <FieldDescription>
              一行一个分镜，共 {(languageDraft.narrations ?? []).length} 个。
            </FieldDescription>
            {narrationsMissing ? (
              <FieldError>已选择生成，但分镜文案为空。</FieldError>
            ) : null}
          </Field>
        </FieldGroup>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  )
}

function parseLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function selectedJobCount(drafts: ScriptReviewDraft[]) {
  return drafts
    .filter((draft) => draft.selected_for_generation !== false)
    .reduce(
      (count, draft) => count + (draft.selected_languages?.length ?? 0),
      0
    )
}
