import { useEffect, useState } from "react"
import { CheckCircle2, Loader2, Save } from "lucide-react"

import { InlineError } from "@/components/shared/feedback"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/toast"
import { readableError } from "@/lib/format"
import {
  listImageProviders,
  testImageProvider,
  updateImageProvider,
  type ImageProviderSetting,
  type ImageProviderUpdate,
} from "@/lib/generationApi"

const PROVIDER_LABELS = {
  aliyun_bailian: "阿里云百炼",
  volcengine_ark: "火山方舟",
}

function ProviderCard({
  provider,
  onUpdated,
}: {
  provider: ImageProviderSetting
  onUpdated: (providers: ImageProviderSetting[]) => void
}) {
  const toast = useToast()
  const [draft, setDraft] = useState<ImageProviderSetting>(provider)
  const [apiKey, setApiKey] = useState("")
  const [action, setAction] = useState<"idle" | "saving" | "testing">("idle")
  const [error, setError] = useState<string | null>(null)

  function patch(values: Partial<ImageProviderSetting>) {
    setDraft((current) => ({ ...current, ...values }))
    setError(null)
  }

  async function save() {
    setAction("saving")
    setError(null)
    const updates: ImageProviderUpdate = {
      enabled: draft.enabled,
      base_url: draft.base_url,
      default_model: draft.default_model,
      timeout: draft.timeout,
      concurrency_limit: draft.concurrency_limit,
      ...(draft.region ? { region: draft.region } : {}),
      ...(draft.workspace_id !== undefined
        ? { workspace_id: draft.workspace_id }
        : {}),
      ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
    }
    try {
      const response = await updateImageProvider(provider.id, updates)
      const saved = response.providers.find((item) => item.id === provider.id)
      if (saved) setDraft(saved)
      onUpdated(response.providers)
      setApiKey("")
      toast({
        title: `${PROVIDER_LABELS[provider.id]}设置已保存`,
        variant: "success",
      })
    } catch (saveError) {
      setError(readableError(saveError))
    } finally {
      setAction("idle")
    }
  }

  async function test() {
    setAction("testing")
    setError(null)
    try {
      await testImageProvider(provider.id)
      toast({
        title: `${PROVIDER_LABELS[provider.id]}测试图生成成功`,
        description: "这次测试会产生一次图片生成费用。",
        variant: "success",
      })
    } catch (testError) {
      setError(readableError(testError))
    } finally {
      setAction("idle")
    }
  }

  return (
    <article className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{PROVIDER_LABELS[provider.id]}</h3>
            <Badge variant={draft.configured ? "success" : "outline"}>
              {draft.configured ? "已配置" : "未配置"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            凭证只保存在后端；留空不会覆盖已经保存的 API Key。
          </p>
        </div>
        <Switch
          aria-label={`启用${PROVIDER_LABELS[provider.id]}`}
          checked={draft.enabled}
          onCheckedChange={(enabled) => patch({ enabled })}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          API Key
          <Input
            className="mt-1.5"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              draft.configured ? "已保存；填写新值可替换" : "请输入 API Key"
            }
            type="password"
            value={apiKey}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          默认模型
          <Select
            onValueChange={(default_model) => patch({ default_model })}
            value={draft.default_model}
          >
            <SelectTrigger className="mt-1.5 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {draft.models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {provider.id === "aliyun_bailian" ? (
          <>
            <label className="text-xs text-muted-foreground">
              地域
              <Select
                onValueChange={(region) =>
                  patch({ region: region as ImageProviderSetting["region"] })
                }
                value={draft.region}
              >
                <SelectTrigger className="mt-1.5 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cn-beijing">北京</SelectItem>
                  <SelectItem value="ap-southeast-1">新加坡</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="text-xs text-muted-foreground">
              Workspace ID
              <Input
                className="mt-1.5"
                onChange={(event) =>
                  patch({ workspace_id: event.target.value })
                }
                value={draft.workspace_id ?? ""}
              />
            </label>
          </>
        ) : (
          <label className="text-xs text-muted-foreground sm:col-span-2">
            API 地址
            <Input
              className="mt-1.5"
              onChange={(event) => patch({ base_url: event.target.value })}
              value={draft.base_url}
            />
          </label>
        )}
        <label className="text-xs text-muted-foreground">
          并发数
          <Input
            className="mt-1.5"
            max={10}
            min={1}
            onChange={(event) =>
              patch({ concurrency_limit: Number(event.target.value || 1) })
            }
            type="number"
            value={draft.concurrency_limit}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          超时秒数
          <Input
            className="mt-1.5"
            min={30}
            onChange={(event) =>
              patch({ timeout: Number(event.target.value || 300) })
            }
            type="number"
            value={draft.timeout}
          />
        </label>
      </div>

      {error ? (
        <div className="mt-4">
          <InlineError message={error} title="Provider 操作失败" />
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
        <Button
          disabled={action !== "idle"}
          onClick={() => void save()}
          size="sm"
        >
          {action === "saving" ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <Save data-icon="inline-start" />
          )}
          保存
        </Button>
        <Button
          disabled={action !== "idle" || !draft.configured || !draft.enabled}
          onClick={() => void test()}
          size="sm"
          variant="outline"
        >
          {action === "testing" ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <CheckCircle2 data-icon="inline-start" />
          )}
          生成测试图（会计费）
        </Button>
      </div>
    </article>
  )
}

export function ImageProviderSettings() {
  const [providers, setProviders] = useState<ImageProviderSetting[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void listImageProviders()
      .then((response) => {
        if (!cancelled) setProviders(response.providers)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(readableError(loadError))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error)
    return <InlineError message={error} title="图片 Provider 读取失败" />
  if (providers.length === 0)
    return (
      <p className="text-sm text-muted-foreground">正在读取图片 Provider…</p>
    )

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {providers.map((provider) => (
        <ProviderCard
          key={provider.id}
          onUpdated={setProviders}
          provider={provider}
        />
      ))}
    </div>
  )
}
