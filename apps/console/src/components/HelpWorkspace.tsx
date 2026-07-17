import { useEffect, useState } from "react"
import { CircleHelp, Gauge, Play, RefreshCw } from "lucide-react"

import { SafeMarkdown } from "@/components/settings/SafeMarkdown"
import { AsyncState } from "@/components/shared/AsyncState"
import { EmptyState } from "@/components/shared/EmptyState"
import { Button } from "@/components/ui/button"
import { readableError } from "@/lib/format"
import { getHelpFaq, type FaqSection } from "@/lib/generationApi"
import { routeHref } from "@/lib/router"
import { settingsLink } from "@/lib/settingsLinks"

type LoadState = "loading" | "ready" | "error" | "stale"

export function HelpWorkspace() {
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [sections, setSections] = useState<FaqSection[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(true)

  useEffect(() => {
    let cancelled = false
    const hasContent = sections.length > 0
    void getHelpFaq("zh_CN")
      .then((response) => {
        if (cancelled) return
        setSections(response.sections)
        setError(null)
        setLoadState("ready")
      })
      .catch((loadError) => {
        if (cancelled) return
        setError(readableError(loadError))
        setLoadState(hasContent ? "stale" : "error")
      })
      .finally(() => {
        if (!cancelled) setIsRefreshing(false)
      })
    return () => {
      cancelled = true
    }
    // reloadToken 是显式刷新信号；hasContent 仅用于区分 error 与 stale。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken])

  function reload() {
    setIsRefreshing(true)
    setReloadToken((token) => token + 1)
  }

  return (
    <section aria-labelledby="help-heading" className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div>
          <h2
            className="text-xl leading-7 font-semibold tracking-tight"
            id="help-heading"
          >
            帮助与诊断
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            按实际任务查找操作方法；遇到问题时先查看生产准备情况和任务错误。
          </p>
        </div>
        <Button
          aria-label="刷新帮助内容"
          disabled={isRefreshing}
          onClick={reload}
          size="icon-sm"
          variant="outline"
        >
          <RefreshCw className={isRefreshing ? "animate-spin" : undefined} />
        </Button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <a
          className="flex min-h-16 items-center gap-3 rounded-lg border bg-background px-4 outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
          href={routeHref(settingsLink({ kind: "view", view: "overview" }))}
        >
          <Gauge className="size-4 text-primary" />
          <span>
            <span className="block text-sm font-medium">查看生产准备情况</span>
            <span className="block text-xs text-muted-foreground">
              找出阻塞生产的必要配置
            </span>
          </span>
        </a>
        <a
          className="flex min-h-16 items-center gap-3 rounded-lg border bg-background px-4 outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
          href={routeHref("/create")}
        >
          <Play className="size-4 text-primary" />
          <span>
            <span className="block text-sm font-medium">进入快速生产</span>
            <span className="block text-xs text-muted-foreground">
              选择模板并发起一条任务
            </span>
          </span>
        </a>
      </div>

      {loadState === "loading" ? (
        <AsyncState
          className="mt-5"
          description="正在同步常见问题与操作说明。"
          state="loading"
          title="正在读取帮助内容"
        />
      ) : null}

      {loadState === "error" ? (
        <AsyncState
          action={
            <Button onClick={reload} size="sm" variant="outline">
              重新读取
            </Button>
          }
          className="mt-5"
          description={error}
          state="error"
          title="帮助内容读取失败"
        />
      ) : null}

      {loadState === "stale" ? (
        <AsyncState
          action={
            <Button onClick={reload} size="sm" variant="outline">
              重新读取
            </Button>
          }
          className="mt-5"
          description={error}
          state="stale"
          title="帮助内容可能已过期"
        />
      ) : null}

      {loadState === "ready" && sections.length === 0 ? (
        <EmptyState
          className="mt-5"
          description="当前服务没有返回帮助条目。"
          icon={CircleHelp}
          title="暂无帮助内容"
        />
      ) : null}

      {sections.length > 0 ? (
        <div className="divide-y" role="list">
          {sections.map((section, index) => (
            <article
              className="grid gap-3 py-5 sm:grid-cols-[minmax(180px,260px)_minmax(0,1fr)]"
              key={`${section.question}-${index}`}
              role="listitem"
            >
              <h3 className="text-base font-semibold">{section.question}</h3>
              <SafeMarkdown headingOffset={3}>{section.answer}</SafeMarkdown>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
