import assert from "node:assert/strict"
import test from "node:test"

import {
  parseMarkdownBlocks,
  parseRawMarkdownImage,
  safeMarkdownUrl,
} from "../src/lib/safeMarkdown.ts"
import {
  resolveSettingsLocation,
  settingsLink,
} from "../src/lib/settingsLinks.ts"

test("settings deep links resolve canonical views and sections", () => {
  assert.deepEqual(
    resolveSettingsLocation(new URLSearchParams("view=ai-voice&focus=tts")),
    {
      view: "ai-voice",
      focus: "tts",
      template: null,
      canonicalPath: "/settings?view=ai-voice&focus=tts",
      needsNormalization: false,
    }
  )
  assert.equal(
    resolveSettingsLocation(
      new URLSearchParams("view=recipes&template=recipe-1")
    ).canonicalPath,
    "/settings?view=recipes&template=recipe-1"
  )
  assert.equal(
    resolveSettingsLocation(new URLSearchParams("view=help")).canonicalPath,
    "/settings?view=help"
  )
  assert.equal(
    resolveSettingsLocation(
      new URLSearchParams("view=publish-storage&focus=buffer")
    ).canonicalPath,
    "/settings?view=publish-storage&focus=buffer"
  )
})

test("canonical settings links stay stable and encode target ids", () => {
  const query = new URLSearchParams("view=publish-storage")
  assert.equal(resolveSettingsLocation(query).needsNormalization, false)
  assert.equal(
    resolveSettingsLocation(
      new URLSearchParams("view=unknown&focus=not-a-section")
    ).canonicalPath,
    "/settings?view=overview"
  )
  assert.equal(
    settingsLink({ kind: "template", id: "recipe / 中文" }),
    "/settings?view=recipes&template=recipe+%2F+%E4%B8%AD%E6%96%87"
  )
})

test("safe markdown parses supported block structures without HTML", () => {
  assert.deepEqual(
    parseMarkdownBlocks(
      [
        "## 快速开始",
        "",
        "打开 `settings` 并按照提示操作。",
        "",
        "- 检查连接",
        "- 保存设置",
        "",
        "```sh",
        "npm run dev",
        "```",
      ].join("\n")
    ),
    [
      { kind: "heading", depth: 2, text: "快速开始" },
      {
        kind: "paragraph",
        text: "打开 `settings` 并按照提示操作。",
      },
      {
        kind: "list",
        ordered: false,
        items: ["检查连接", "保存设置"],
      },
      { kind: "code", language: "sh", code: "npm run dev" },
    ]
  )
})

test("safe markdown rejects executable and control-character URLs", () => {
  assert.equal(safeMarkdownUrl("javascript:alert(1)", "link"), null)
  assert.equal(safeMarkdownUrl("data:image/svg+xml,<svg />", "image"), null)
  assert.equal(safeMarkdownUrl("//example.com/tracker.png", "image"), null)
  assert.equal(safeMarkdownUrl("https://example.com/\u0000x", "link"), null)
  assert.equal(
    safeMarkdownUrl("https://example.com/help", "link"),
    "https://example.com/help"
  )
  assert.equal(
    safeMarkdownUrl("mailto:ops@example.com", "link"),
    "mailto:ops@example.com"
  )
  assert.equal(
    safeMarkdownUrl("./images/help.png", "image"),
    "./images/help.png"
  )
})

test("safe markdown accepts raw images but ignores unsafe HTML attributes", () => {
  assert.deepEqual(
    parseRawMarkdownImage(
      '<img src="/docs/guide.png" alt="生成指南" width="960" onerror="alert(1)" />'
    ),
    { source: "/docs/guide.png", alt: "生成指南" }
  )
  assert.equal(
    parseRawMarkdownImage('<img src="javascript:alert(1)" alt="bad" />'),
    null
  )
  assert.equal(
    parseRawMarkdownImage('<script src="https://example.com/x.js" />'),
    null
  )
})
