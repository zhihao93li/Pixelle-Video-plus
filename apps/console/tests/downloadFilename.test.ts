import assert from "node:assert/strict"
import test from "node:test"

import {
  downloadFilename,
  extensionFromUrl,
} from "../src/lib/downloadFilename.ts"

test("downloads use the content title and keep the requested extension", () => {
  assert.equal(downloadFilename("猫为什么不如狗亲人", "mp4"), "猫为什么不如狗亲人.mp4")
  assert.equal(downloadFilename("已经命名.MP4", ".mp4"), "已经命名.MP4")
})

test("download names replace filesystem-invalid characters", () => {
  assert.equal(downloadFilename('猫/狗:*?"<>|', "md"), "猫_狗_______.md")
  assert.equal(downloadFilename("   ", "png", "未命名图片"), "未命名图片.png")
})

test("image downloads preserve a safe URL extension", () => {
  assert.equal(extensionFromUrl("/files/page-1.webp?token=1"), "webp")
  assert.equal(extensionFromUrl("/files/no-extension"), "png")
})
