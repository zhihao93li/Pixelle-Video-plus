import { useEffect, useMemo, useState } from "react"
import { Copy, Plus, Save, Search, Trash2 } from "lucide-react"

import { AsyncState } from "@/components/shared/AsyncState"
import { EmptyState } from "@/components/shared/EmptyState"
import { InlineError } from "@/components/shared/feedback"
import { WorkspaceHeader } from "@/components/shared/WorkspaceHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { readableError } from "@/lib/format"
import {
  createPromptTemplate,
  deletePromptTemplate,
  listPromptTemplates,
  updatePromptTemplate,
  type PromptTemplate,
  type PromptTemplateKind,
} from "@/lib/generationApi"
import { cn } from "@/lib/utils"

type PromptGroups = Record<PromptTemplateKind, PromptTemplate[]>

const EMPTY_GROUPS: PromptGroups = { script: [], split: [] }

export function PromptLibraryPanel() {
  const [kind, setKind] = useState<PromptTemplateKind>("script")
  const [templates, setTemplates] = useState<PromptGroups>(EMPTY_GROUPS)
  const [selectedName, setSelectedName] = useState("")
  const [name, setName] = useState("")
  const [content, setContent] = useState("")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentTemplates = templates[kind]
  const selected = useMemo(
    () => currentTemplates.find((item) => item.name === selectedName),
    [currentTemplates, selectedName]
  )
  const visibleTemplates = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return currentTemplates
    return currentTemplates.filter((template) =>
      template.name.toLocaleLowerCase().includes(normalizedQuery)
    )
  }, [currentTemplates, query])
  const isBuiltin = selected?.source === "builtin"
  const dirty = selected
    ? name !== selected.name || content !== selected.content
    : Boolean(name.trim() || content.trim())

  function applySelection(groups: PromptGroups, preferred?: string) {
    const candidates = groups[kind]
    const target = preferred || candidates[0]?.name || ""
    const item = candidates.find((template) => template.name === target)
    setSelectedName(item?.name || "")
    setName(item?.name || "")
    setContent(item?.content || "")
  }

  function load(preferred?: string) {
    setLoading(true)
    setError(null)
    void listPromptTemplates()
      .then((response) => {
        const next = {
          script: response.script_templates,
          split: response.split_templates,
        }
        setTemplates(next)
        applySelection(next, preferred)
      })
      .catch((reason: unknown) => setError(readableError(reason)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    void listPromptTemplates()
      .then((response) => {
        if (cancelled) return
        const next = {
          script: response.script_templates,
          split: response.split_templates,
        }
        setTemplates(next)
        applySelection(next)
        setError(null)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(readableError(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // kind changes which prompt family is selected after the shared list loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  function select(template: PromptTemplate) {
    setSelectedName(template.name)
    setName(template.name)
    setContent(template.content)
    setError(null)
  }

  function createNew() {
    setSelectedName("")
    setName("")
    setContent("")
    setError(null)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const response = selected
        ? await updatePromptTemplate({
            kind,
            name: selected.name,
            new_name: name,
            content,
          })
        : await createPromptTemplate({ kind, name, content })
      load(response.name)
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <WorkspaceHeader
        description="集中管理可复用的写稿和分镜提示词；制作时仍然可以直接展开修改。"
        title="提示词库"
      />
      <div aria-label="提示词类型" className="flex gap-2" role="tablist">
        {(["script", "split"] as const).map((value) => (
          <Button
            aria-selected={kind === value}
            key={value}
            onClick={() => {
              if (value === kind) return
              setLoading(true)
              setKind(value)
            }}
            role="tab"
            variant={kind === value ? "default" : "outline"}
          >
            {value === "script" ? "写稿提示词" : "分镜提示词"}
          </Button>
        ))}
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        修改已保存的提示词会影响继续引用它的模板；已经改成自定义正文的模板不会自动跟随。
      </p>

      {loading ? <AsyncState state="loading" title="正在读取提示词" /> : null}
      {!loading ? (
        <div className="grid min-h-[32rem] gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col rounded-lg border bg-muted/10 p-2">
            <Button
              className="mb-2 w-full justify-start"
              onClick={createNew}
              variant="outline"
            >
              <Plus data-icon="inline-start" />
              新建提示词
            </Button>
            <label className="relative mb-2">
              <span className="sr-only">搜索提示词</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索名称"
                value={query}
              />
            </label>
            {visibleTemplates.length === 0 ? (
              <EmptyState
                className="min-h-40"
                description="换一个关键词试试。"
                icon={Search}
                title="没有匹配项"
              />
            ) : (
              <div className="flex flex-col gap-1 overflow-y-auto">
                {visibleTemplates.map((template) => (
                  <button
                    className={cn(
                      "flex min-h-10 items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                      selectedName === template.name && "bg-muted"
                    )}
                    key={template.name}
                    onClick={() => select(template)}
                    type="button"
                  >
                    <span className="truncate">{template.name}</span>
                    {template.source === "builtin" ? (
                      <Badge variant="secondary">内置</Badge>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
            <div className="flex flex-1 flex-col gap-4 p-4">
              <Input
                aria-label="提示词名称"
                disabled={isBuiltin}
                onChange={(event) => setName(event.target.value)}
                placeholder="提示词名称"
                value={name}
              />
              <Textarea
                aria-label="提示词正文"
                className="min-h-80 flex-1 resize-y font-mono text-xs"
                disabled={isBuiltin}
                onChange={(event) => setContent(event.target.value)}
                placeholder="输入提示词正文"
                value={content}
              />
              {error ? (
                <InlineError message={error} title="提示词操作失败" />
              ) : null}
            </div>

            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 p-4 backdrop-blur">
              <span className="text-xs text-muted-foreground">
                {isBuiltin
                  ? "内置提示词不可直接修改，可复制后编辑。"
                  : dirty
                    ? "有未保存更改"
                    : "所有更改已保存"}
              </span>
              <div className="flex flex-wrap gap-2">
                {isBuiltin ? (
                  <Button
                    onClick={() => {
                      setSelectedName("")
                      setName(`${selected?.name || "提示词"} 副本`)
                      setContent(selected?.content || "")
                    }}
                    variant="outline"
                  >
                    <Copy data-icon="inline-start" />
                    复制并编辑
                  </Button>
                ) : (
                  <Button
                    disabled={
                      saving || !dirty || !name.trim() || !content.trim()
                    }
                    onClick={() => void save()}
                  >
                    <Save data-icon="inline-start" />
                    {selected ? "保存修改" : "保存新提示词"}
                  </Button>
                )}
                {selected && !isBuiltin ? (
                  <Button
                    onClick={() => {
                      if (!window.confirm(`确认删除「${selected.name}」？`))
                        return
                      setSaving(true)
                      void deletePromptTemplate(kind, selected.name)
                        .then(() => load())
                        .catch((reason: unknown) =>
                          setError(readableError(reason))
                        )
                        .finally(() => setSaving(false))
                    }}
                    variant="destructive"
                  >
                    <Trash2 data-icon="inline-start" />
                    删除
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
