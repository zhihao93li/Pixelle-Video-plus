import { useEffect, useMemo, useState } from "react"
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react"

import { SearchableSelect } from "@/components/shared/SearchableSelect"
import { InlineError } from "@/components/shared/feedback"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { readableError } from "@/lib/format"
import {
  deleteLlmProvider,
  getLlmModelCatalog,
  getLlmProviderPresets,
  setDefaultLlmProvider,
  updateLlmProvider,
  type AppSettingsConfig,
  type LlmModelProvider,
  type LlmProviderConfig,
  type LlmProviderPreset,
} from "@/lib/generationApi"
import { cn } from "@/lib/utils"

const emptyProvider: LlmProviderConfig = {
  name: "",
  provider_type: "custom_openai",
  enabled: true,
  api_key: "",
  base_url: "",
  default_model: "",
}

export function LlmProviderSettings({
  settings,
  onSettingsChanged,
}: {
  settings: AppSettingsConfig
  onSettingsChanged: (settings: AppSettingsConfig) => void
}) {
  const providers = settings.llm.providers ?? {}
  const initialId = Object.keys(providers)[0] ?? ""
  const [isAdding, setIsAdding] = useState(false)
  const [selectedId, setSelectedId] = useState(initialId)
  const [draftId, setDraftId] = useState(initialId)
  const [draft, setDraft] = useState<LlmProviderConfig>(() =>
    providers[initialId]
      ? { ...providers[initialId], api_key: "", clear_api_key: false }
      : emptyProvider
  )
  const [catalog, setCatalog] = useState<LlmModelProvider[]>([])
  const [presets, setPresets] = useState<LlmProviderPreset[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = !isAdding && selectedId ? providers[selectedId] : undefined
  const models = useMemo(
    () => catalog.find((provider) => provider.id === selectedId)?.models ?? [],
    [catalog, selectedId]
  )
  const catalogEntry = catalog.find((provider) => provider.id === selectedId)

  function nextProviderId(providerType: LlmProviderConfig["provider_type"]) {
    const baseId = providerType.replaceAll("_", "-")
    if (!providers[baseId]) return baseId
    let suffix = 2
    while (providers[`${baseId}-${suffix}`]) suffix += 1
    return `${baseId}-${suffix}`
  }

  function beginAddProvider() {
    setIsAdding(true)
    setSelectedId("")
    setDraftId(nextProviderId(emptyProvider.provider_type))
    setDraft({ ...emptyProvider })
  }

  function loadCatalog() {
    setError(null)
    void getLlmModelCatalog()
      .then((response) => setCatalog(response.providers))
      .catch((reason: unknown) => setError(readableError(reason)))
  }

  useEffect(() => {
    void getLlmModelCatalog()
      .then((response) => setCatalog(response.providers))
      .catch(() => setCatalog([]))
  }, [settings.llm.providers])

  useEffect(() => {
    void getLlmProviderPresets()
      .then((response) => setPresets(response.providers))
      .catch((reason: unknown) => setError(readableError(reason)))
  }, [])

  async function saveProvider() {
    setBusy(true)
    setError(null)
    try {
      const response = await updateLlmProvider(draftId.trim(), draft)
      onSettingsChanged(response.config)
      setIsAdding(false)
      setSelectedId(draftId.trim())
      loadCatalog()
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="rounded-lg border p-2">
        <Button
          className="mb-2 w-full justify-start"
          onClick={beginAddProvider}
          variant="outline"
        >
          <Plus />
          添加 LLM 服务
        </Button>
        {Object.entries(providers).map(([id, provider]) => (
          <button
            className={cn(
              "mb-1 flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted",
              selectedId === id && "bg-muted"
            )}
            key={id}
            onClick={() => {
              setIsAdding(false)
              setSelectedId(id)
              setDraftId(id)
              setDraft({ ...provider, api_key: "", clear_api_key: false })
            }}
            type="button"
          >
            <span className="min-w-0 truncate">{provider.name || id}</span>
            {settings.llm.default_provider_id === id ? (
              <Badge variant="secondary">默认</Badge>
            ) : null}
          </button>
        ))}
      </aside>
      <div className="flex flex-col gap-4 rounded-lg border p-4">
        {catalogEntry?.error ? (
          <InlineError message={catalogEntry.error} title="模型目录读取失败" />
        ) : null}
        <label className="grid gap-1.5 text-sm">
          服务名称
          <Input
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="例如 OpenAI 工作账号"
            value={draft.name}
          />
        </label>
        <div className="grid gap-1.5 text-sm">
          <label htmlFor="llm-provider-platform">接入平台</label>
          <select
            aria-describedby="llm-provider-platform-help"
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            id="llm-provider-platform"
            onChange={(event) => {
              const providerType = event.target
                .value as LlmProviderConfig["provider_type"]
              const definition = presets.find(
                (item) => item.id === providerType
              )
              setDraft((current) => {
                const previousDefinition = presets.find(
                  (item) => item.id === current.provider_type
                )
                const shouldUsePlatformName =
                  !current.name.trim() ||
                  current.name.trim() === previousDefinition?.label
                return {
                  ...current,
                  provider_type: providerType,
                  name: shouldUsePlatformName
                    ? definition?.label || ""
                    : current.name,
                  base_url: definition ? definition.base_url : current.base_url,
                }
              })
              if (!selected) setDraftId(nextProviderId(providerType))
            }}
            value={draft.provider_type}
          >
            {presets.length ? null : (
              <option value={draft.provider_type}>读取接入平台…</option>
            )}
            {presets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <span
            className="text-xs text-muted-foreground"
            id="llm-provider-platform-help"
          >
            选择平台后会按该平台保存，并自动填写官方 API
            地址；只有自定义兼容服务需要自行填写地址。
          </span>
        </div>
        <label className="grid gap-1.5 text-sm">
          API 地址
          <Input
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                base_url: event.target.value,
              }))
            }
            value={draft.base_url}
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          API Key
          <Input
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                api_key: event.target.value,
                clear_api_key: false,
              }))
            }
            placeholder={
              draft.api_key_configured ? "已保存；留空保持不变" : "输入 API Key"
            }
            type="password"
            value={draft.api_key}
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          默认模型
          {models.length ? (
            <SearchableSelect
              onValueChange={(value) =>
                setDraft((current) => ({ ...current, default_model: value }))
              }
              options={models.map((model) => ({
                label: model.label,
                value: model.id,
              }))}
              value={draft.default_model}
            />
          ) : (
            <Input
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  default_model: event.target.value,
                }))
              }
              placeholder="保存并读取模型后可搜索选择"
              value={draft.default_model}
            />
          )}
        </label>
        <label className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
          启用这条服务
          <Switch
            checked={draft.enabled}
            onCheckedChange={(enabled) =>
              setDraft((current) => ({ ...current, enabled }))
            }
          />
        </label>
        {error ? (
          <InlineError message={error} title="LLM 服务操作失败" />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              busy ||
              !draftId.trim() ||
              !draft.name.trim() ||
              !draft.base_url.trim()
            }
            onClick={() => void saveProvider()}
          >
            <Save />
            保存服务
          </Button>
          <Button
            disabled={!selected || busy}
            onClick={loadCatalog}
            variant="outline"
          >
            <RefreshCw />
            读取模型
          </Button>
          {selected && settings.llm.default_provider_id !== selectedId ? (
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void setDefaultLlmProvider(selectedId)
                  .then((response) => onSettingsChanged(response.config))
                  .catch((reason: unknown) => setError(readableError(reason)))
                  .finally(() => setBusy(false))
              }}
              variant="outline"
            >
              设为系统默认
            </Button>
          ) : null}
          {selected ? (
            <Button
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    `确认删除「${selected.name || selectedId}」？`
                  )
                )
                  return
                setBusy(true)
                void deleteLlmProvider(selectedId)
                  .then((response) => {
                    onSettingsChanged(response.config)
                    setIsAdding(false)
                    const nextProviders = response.config.llm.providers ?? {}
                    const nextId = Object.keys(nextProviders)[0] ?? ""
                    setSelectedId(nextId)
                    setDraftId(nextId)
                    setDraft(
                      nextProviders[nextId]
                        ? {
                            ...nextProviders[nextId],
                            api_key: "",
                            clear_api_key: false,
                          }
                        : emptyProvider
                    )
                  })
                  .catch((reason: unknown) => setError(readableError(reason)))
                  .finally(() => setBusy(false))
              }}
              variant="destructive"
            >
              <Trash2 />
              删除
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
