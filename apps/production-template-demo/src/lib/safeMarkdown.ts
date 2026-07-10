export type MarkdownBlock =
  | { kind: "heading"; depth: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; language: string | null; code: string }

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n")
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = line.match(/^\s*```([^`]*)$/)
    if (fence) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({
        kind: "code",
        language: fence[1].trim() || null,
        code: code.join("\n"),
      })
      continue
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/)
    if (heading) {
      blocks.push({
        kind: "heading",
        depth: heading[1].length,
        text: heading[2],
      })
      index += 1
      continue
    }

    const unordered = line.match(/^\s*[-+*]\s+(.+)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered)
      const items: string[] = []
      while (index < lines.length) {
        const match = isOrdered
          ? lines[index].match(/^\s*\d+[.)]\s+(.+)$/)
          : lines[index].match(/^\s*[-+*]\s+(.+)$/)
        if (!match) break
        items.push(match[1])
        index += 1
      }
      blocks.push({ kind: "list", ordered: isOrdered, items })
      continue
    }

    const paragraph = [line.trim()]
    index += 1
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*```/.test(lines[index]) &&
      !/^\s*#{1,6}\s+/.test(lines[index]) &&
      !/^\s*(?:[-+*]|\d+[.)])\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") })
  }

  return blocks
}

export function safeMarkdownUrl(
  value: string,
  kind: "link" | "image"
): string | null {
  const trimmed = value.trim()
  if (!trimmed || hasControlCharacter(trimmed)) return null
  if (
    /^\/(?!\/)/.test(trimmed) ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("#")
  ) {
    return trimmed
  }
  try {
    const url = new URL(trimmed)
    if (url.protocol === "https:" || url.protocol === "http:") return trimmed
    if (kind === "link" && url.protocol === "mailto:") return trimmed
  } catch {
    return null
  }
  return null
}

export function parseRawMarkdownImage(markup: string) {
  if (!/^<img\b[^>]*\/?\s*>$/i.test(markup.trim())) return null
  const source = readHtmlAttribute(markup, "src")
  if (!source) return null
  const safeSource = safeMarkdownUrl(source, "image")
  if (!safeSource) return null
  return {
    source: safeSource,
    alt: readHtmlAttribute(markup, "alt") ?? "",
  }
}

function hasControlCharacter(value: string) {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 31 || code === 127) return true
  }
  return false
}

function readHtmlAttribute(markup: string, name: string) {
  const pattern = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  )
  const match = markup.match(pattern)
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null
}
