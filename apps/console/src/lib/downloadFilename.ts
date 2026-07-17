const ILLEGAL_FILENAME_CHARACTERS = new Set('\\/:*?"<>|')
const TRAILING_DOTS_OR_SPACES = /[. ]+$/g

function replaceIllegalCharacters(value: string) {
  return [...value]
    .map((character) =>
      character.charCodeAt(0) < 32 || ILLEGAL_FILENAME_CHARACTERS.has(character)
        ? "_"
        : character
    )
    .join("")
}

export function downloadFilename(
  title: string | null | undefined,
  extension: string,
  fallback = "download"
) {
  const normalizedExtension = extension.replace(/^\.+/, "").toLowerCase()
  const source = (title || fallback).trim()
  const safeStem =
    replaceIllegalCharacters(source)
      .replace(TRAILING_DOTS_OR_SPACES, "")
      .slice(0, 100)
      .trim() || fallback
  const existingSuffix = `.${normalizedExtension}`
  return safeStem.toLowerCase().endsWith(existingSuffix)
    ? safeStem
    : `${safeStem}${existingSuffix}`
}

export function extensionFromUrl(url: string, fallback = "png") {
  try {
    const base =
      typeof window === "undefined" ? "http://localhost" : window.location.href
    const pathname = new URL(url, base).pathname
    const suffix = pathname.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1]
    return suffix?.toLowerCase() || fallback
  } catch {
    return fallback
  }
}

export function downloadUrlWithFilename(url: string, filename: string) {
  try {
    const base =
      typeof window === "undefined" ? "http://localhost" : window.location.href
    const parsed = new URL(url, base)
    if (!parsed.pathname.includes("/files/")) {
      return url
    }
    parsed.searchParams.set("download_name", filename)
    if (url.startsWith("/")) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`
    }
    return parsed.toString()
  } catch {
    return url
  }
}
