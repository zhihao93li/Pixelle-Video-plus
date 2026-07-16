import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { languageLabel } from "@/lib/languages"
import type { ContentVariant, PendingReviewSession } from "@/lib/generationApi"

function editableVariants(variants: Record<string, ContentVariant>) {
  return Object.fromEntries(
    Object.entries(variants).map(([language, variant]) => [
      language,
      { ...variant },
    ])
  )
}

export function ScriptReviewEditor({
  busy,
  review,
  onConfirm,
  onRewrite,
  onSave,
}: {
  busy: boolean
  review: PendingReviewSession
  onConfirm: (variants: Record<string, ContentVariant>) => Promise<void>
  onRewrite: () => Promise<void>
  onSave: (variants: Record<string, ContentVariant>) => Promise<void>
}) {
  const payload =
    review.payload.kind === "script"
      ? review.payload
      : { kind: "script" as const, variants: {} }
  const [variants, setVariants] = useState(() =>
    editableVariants(payload.variants)
  )
  const languages = useMemo(() => Object.keys(variants), [variants])
  const [activeLanguage, setActiveLanguage] = useState(languages[0] ?? "")
  const current = variants[activeLanguage]
  const invalid =
    languages.length === 0 ||
    languages.some((language) => !variants[language]?.script.trim())

  function patchCurrent(patch: Partial<ContentVariant>) {
    if (!current) return
    setVariants((existing) => ({
      ...existing,
      [activeLanguage]: { ...current, ...patch },
    }))
  }

  if (review.payload.kind !== "script") return null

  if (!current) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        当前没有可确认的文案版本。
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">确认文案</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          这里是当前唯一需要确认的内容。可直接修改、保存，或让系统整稿重写。
        </p>
      </div>

      <Tabs onValueChange={setActiveLanguage} value={activeLanguage}>
        {languages.length > 1 ? (
          <div className="overflow-x-auto">
            <TabsList
              aria-label="待确认语言版本"
              className="h-11 w-max min-w-full justify-start"
              variant="line"
            >
              {languages.map((language) => (
                <TabsTrigger
                  className="h-11 shrink-0 px-3"
                  key={language}
                  value={language}
                >
                  {languageLabel(language)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        ) : null}

        <TabsContent className="mt-4" value={activeLanguage}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`review-title-${activeLanguage}`}>
                标题
              </FieldLabel>
              <Input
                autoComplete="off"
                id={`review-title-${activeLanguage}`}
                onChange={(event) =>
                  patchCurrent({ title: event.target.value })
                }
                value={current.title}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`review-script-${activeLanguage}`}>
                正文
              </FieldLabel>
              <Textarea
                autoComplete="off"
                className="min-h-56 resize-y leading-7"
                id={`review-script-${activeLanguage}`}
                onChange={(event) =>
                  patchCurrent({ script: event.target.value })
                }
                value={current.script}
              />
            </Field>
          </FieldGroup>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
        <Button
          disabled={busy}
          onClick={() => void onRewrite()}
          variant="ghost"
        >
          让系统重写
        </Button>
        <Button
          disabled={busy || invalid}
          onClick={() => void onSave(variants)}
          variant="outline"
        >
          保存修改
        </Button>
        <Button
          disabled={busy || invalid}
          onClick={() => void onConfirm(variants)}
        >
          确认文案并继续
        </Button>
      </div>
    </div>
  )
}
