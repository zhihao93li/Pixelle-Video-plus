import { useEffect, useState } from "react"
import { AlertCircle, HelpCircle, Loader2, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ApiError, getHelpFaq, type FaqSection } from "@/lib/generationApi"

type LoadState = "loading" | "ready" | "error"

export function HelpWorkspace() {
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [sections, setSections] = useState<FaqSection[]>([])
  const [error, setError] = useState<string | null>(null)

  async function loadFaq() {
    try {
      const response = await getHelpFaq("zh_CN")
      setSections(response.sections)
      setLoadState("ready")
    } catch (loadError) {
      setLoadState("error")
      setError(readableError(loadError))
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadInitialFaq() {
      try {
        const response = await getHelpFaq("zh_CN")
        if (!cancelled) {
          setSections(response.sections)
          setLoadState("ready")
        }
      } catch (loadError) {
        if (!cancelled) {
          setLoadState("error")
          setError(readableError(loadError))
        }
      }
    }

    void loadInitialFaq()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex flex-col gap-5">
      <Card className="rounded-lg">
        <CardHeader className="border-b">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>帮助</CardTitle>
              <CardDescription>常见问题与使用说明。</CardDescription>
            </div>
            <Badge variant="secondary">FAQ</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loadState === "loading" && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              <Loader2 className="animate-spin" data-icon="inline-start" />
              正在读取帮助内容
            </div>
          )}

          {loadState === "error" && error && (
            <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <div>
                  <div className="font-medium">帮助内容读取失败</div>
                  <div className="mt-1 leading-6">{error}</div>
                </div>
              </div>
              <Button
                onClick={() => {
                  setLoadState("loading")
                  setError(null)
                  void loadFaq()
                }}
                size="sm"
                variant="outline"
              >
                <RefreshCw data-icon="inline-start" />
                重新读取
              </Button>
            </div>
          )}

          {loadState === "ready" && (
            <div className="flex flex-col gap-4">
              {sections.length === 0 ? (
                <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                  没有读取到 FAQ 条目。
                </div>
              ) : (
                sections.map((section) => (
                  <article
                    className="rounded-lg border bg-background p-4"
                    key={section.question}
                  >
                    <div className="flex items-start gap-2">
                      <HelpCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div>
                        <h2 className="text-base font-semibold">
                          {section.question}
                        </h2>
                        <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                          {section.answer}
                        </div>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
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
