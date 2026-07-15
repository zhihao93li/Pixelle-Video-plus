import { useEffect, useMemo, useState } from "react"
import { Copy, Plus, Save, Trash2 } from "lucide-react"

import { AsyncState } from "@/components/shared/AsyncState"
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

export function PromptLibraryPanel() {
  const [kind, setKind] = useState<PromptTemplateKind>("script")
  const [templates, setTemplates] = useState<Record<PromptTemplateKind, PromptTemplate[]>>({ script: [], split: [] })
  const [selectedName, setSelectedName] = useState("")
  const [name, setName] = useState("")
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentTemplates = templates[kind]
  const selected = useMemo(
    () => currentTemplates.find((item) => item.name === selectedName),
    [currentTemplates, selectedName]
  )
  const isBuiltin = selected?.source === "builtin"

  function load(preferred?: string) {
    setLoading(true)
    setError(null)
    void listPromptTemplates()
      .then((response) => {
        const next = { script: response.script_templates, split: response.split_templates }
        setTemplates(next)
        const target = preferred || next[kind][0]?.name || ""
        setSelectedName(target)
        const item = next[kind].find((template) => template.name === target)
        setName(item?.name || "")
        setContent(item?.content || "")
      })
      .catch((reason: unknown) => setError(readableError(reason)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    void listPromptTemplates()
      .then((response) => {
        if (cancelled) return
        const next = { script: response.script_templates, split: response.split_templates }
        setTemplates(next)
        const target = next[kind][0]?.name || ""
        setSelectedName(target)
        const item = next[kind].find((template) => template.name === target)
        setName(item?.name || "")
        setContent(item?.content || "")
        setError(null)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(readableError(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [kind])

  function select(template: PromptTemplate) {
    setSelectedName(template.name)
    setName(template.name)
    setContent(template.content)
    setError(null)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const response = selected
        ? await updatePromptTemplate({ kind, name: selected.name, new_name: name, content })
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
      <div className="flex gap-2">
        {(["script", "split"] as const).map((value) => (
          <Button key={value} onClick={() => { setLoading(true); setKind(value) }} variant={kind === value ? "default" : "outline"}>
            {value === "script" ? "写稿提示词" : "分镜提示词"}
          </Button>
        ))}
      </div>
      {loading ? <AsyncState state="loading" title="正在读取提示词" /> : null}
      {!loading ? (
        <div className="grid min-h-[32rem] gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="rounded-lg border p-2">
            <Button
              className="mb-2 w-full justify-start"
              onClick={() => { setSelectedName(""); setName(""); setContent("") }}
              variant="outline"
            >
              <Plus />新建提示词
            </Button>
            <div className="flex flex-col gap-1">
              {currentTemplates.map((template) => (
                <button
                  className={cn("flex items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted", selectedName === template.name && "bg-muted")}
                  key={template.name}
                  onClick={() => select(template)}
                  type="button"
                >
                  <span className="truncate">{template.name}</span>
                  {template.source === "builtin" ? <Badge variant="secondary">内置</Badge> : null}
                </button>
              ))}
            </div>
          </aside>
          <section className="rounded-lg border p-4">
            <div className="flex flex-col gap-4">
              <Input disabled={isBuiltin} onChange={(event) => setName(event.target.value)} placeholder="提示词名称" value={name} />
              <Textarea className="min-h-80 resize-y font-mono text-xs" disabled={isBuiltin} onChange={(event) => setContent(event.target.value)} placeholder="输入提示词正文" value={content} />
              {error ? <InlineError message={error} title="提示词操作失败" /> : null}
              <div className="flex flex-wrap gap-2">
                {isBuiltin ? (
                  <Button
                    onClick={() => { setSelectedName(""); setName(`${selected?.name || "提示词"} 副本`); setContent(selected?.content || "") }}
                    variant="outline"
                  >
                    <Copy />复制并编辑
                  </Button>
                ) : (
                  <Button disabled={saving || !name.trim() || !content.trim()} onClick={() => void save()}>
                    <Save />{selected ? "保存修改" : "保存新提示词"}
                  </Button>
                )}
                {selected && !isBuiltin ? (
                  <Button
                    onClick={() => {
                      if (!window.confirm(`确认删除「${selected.name}」？`)) return
                      setSaving(true)
                      void deletePromptTemplate(kind, selected.name)
                        .then(() => load())
                        .catch((reason: unknown) => setError(readableError(reason)))
                        .finally(() => setSaving(false))
                    }}
                    variant="destructive"
                  >
                    <Trash2 />删除
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
