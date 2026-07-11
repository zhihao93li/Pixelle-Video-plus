import { Fragment, type ReactNode } from "react"

import {
  parseMarkdownBlocks,
  parseRawMarkdownImage,
  safeMarkdownUrl,
} from "@/lib/safeMarkdown"
import { cn } from "@/lib/utils"

export function SafeMarkdown({
  children,
  className,
  headingOffset = 2,
}: {
  children: string
  className?: string
  headingOffset?: number
}) {
  const blocks = parseMarkdownBlocks(children)
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const level = Math.min(6, Math.max(2, block.depth + headingOffset))
          const Heading = HEADING_TAGS[level - 2]
          return (
            <Heading className="pt-1 text-sm font-medium" key={index}>
              {renderInlineMarkdown(block.text, `heading-${index}`)}
            </Heading>
          )
        }
        if (block.kind === "code") {
          return (
            <pre
              className="max-w-full overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs leading-5"
              key={index}
            >
              <code data-language={block.language ?? undefined}>
                {block.code}
              </code>
            </pre>
          )
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul"
          return (
            <List
              className={cn(
                "space-y-1 pl-5 text-sm leading-6 text-muted-foreground",
                block.ordered ? "list-decimal" : "list-disc"
              )}
              key={index}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {renderInlineMarkdown(item, `list-${index}-${itemIndex}`)}
                </li>
              ))}
            </List>
          )
        }
        return (
          <p className="text-sm leading-6 text-muted-foreground" key={index}>
            {renderInlineMarkdown(block.text, `paragraph-${index}`)}
          </p>
        )
      })}
    </div>
  )
}

const INLINE_PATTERN =
  /(<img\b[^>]*\/?\s*>|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/gi
const HEADING_TAGS = ["h2", "h3", "h4", "h5", "h6"] as const

function renderInlineMarkdown(value: string, keyPrefix: string): ReactNode[] {
  return value
    .split(INLINE_PATTERN)
    .filter(Boolean)
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code className="rounded bg-muted px-1 py-0.5 text-xs" key={key}>
            {part.slice(1, -1)}
          </code>
        )
      }

      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={key}>{part.slice(2, -2)}</strong>
      }

      if (part.startsWith("*") && part.endsWith("*")) {
        return <em key={key}>{part.slice(1, -1)}</em>
      }

      if (/^<img\b/i.test(part)) {
        const image = parseRawMarkdownImage(part)
        return image ? (
          <img
            alt={image.alt}
            className="my-2 max-h-96 max-w-full rounded-lg border object-contain"
            decoding="async"
            key={key}
            loading="lazy"
            referrerPolicy="no-referrer"
            src={image.source}
          />
        ) : (
          <Fragment key={key} />
        )
      }

      const image = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
      if (image) {
        const source = safeMarkdownUrl(image[2], "image")
        return source ? (
          <img
            alt={image[1]}
            className="my-2 max-h-96 max-w-full rounded-lg border object-contain"
            decoding="async"
            key={key}
            loading="lazy"
            referrerPolicy="no-referrer"
            src={source}
          />
        ) : (
          <Fragment key={key}>{image[1]}</Fragment>
        )
      }

      const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (link) {
        const href = safeMarkdownUrl(link[2], "link")
        return href ? (
          <a
            className="text-primary underline underline-offset-4"
            href={href}
            key={key}
            rel={isExternalUrl(href) ? "noopener noreferrer" : undefined}
            target={isExternalUrl(href) ? "_blank" : undefined}
          >
            {link[1]}
          </a>
        ) : (
          <Fragment key={key}>{link[1]}</Fragment>
        )
      }

      return <Fragment key={key}>{part}</Fragment>
    })
}

function isExternalUrl(value: string) {
  return /^https?:\/\//i.test(value)
}
