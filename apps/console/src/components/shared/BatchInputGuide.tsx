import { cn } from "@/lib/utils"

export function BatchInputGuide({
  className,
  example,
  rules,
  title = "批量区分规则",
}: {
  className?: string
  example?: string
  rules: string[]
  title?: string
}) {
  return (
    <aside
      aria-label={title}
      className={cn(
        "rounded-lg border bg-muted/30 px-4 py-3 text-sm",
        className
      )}
    >
      <p className="font-medium text-foreground">{title}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 leading-6 text-muted-foreground marker:text-foreground">
        {rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ol>
      {example ? (
        <div className="mt-3 border-t pt-3">
          <p className="text-xs font-medium text-foreground">填写示例</p>
          <pre className="mt-2 overflow-x-auto rounded-md border bg-background px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap text-foreground">
            {example}
          </pre>
        </div>
      ) : null}
    </aside>
  )
}
