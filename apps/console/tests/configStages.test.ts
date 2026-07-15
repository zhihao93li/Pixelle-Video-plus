import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { settingSourceNote } from "../src/lib/configStages.ts"

test("production setting source and pending state stay independent", () => {
  assert.equal(settingSourceNote("recipe", "factory", false), "出厂默认")
  assert.equal(settingSourceNote("recipe", "recipe", false), "已自定义")
  assert.equal(settingSourceNote("recipe", "factory", true), "未保存")
  assert.equal(settingSourceNote("run", "recipe", false), "模板默认")
  assert.equal(settingSourceNote("run", "run", false), "本次")
  assert.equal(settingSourceNote("run", "recipe", true), "未保存")
})

test("workbench does not contain a production-entry dialog", () => {
  const source = readFileSync(
    new URL("../src/components/WorkbenchBoard.tsx", import.meta.url),
    "utf8"
  )
  assert.doesNotMatch(source, /AddContentDialog|添加内容|仅入池/)
})
