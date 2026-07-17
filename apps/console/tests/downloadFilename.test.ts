import assert from "node:assert/strict"
import test from "node:test"

import {
  downloadFilename,
  downloadUrlWithFilename,
  extensionFromUrl,
} from "../src/lib/downloadFilename.ts"

test("downloads use the content title and keep the requested extension", () => {
  assert.equal(
    downloadFilename("猫为什么不如狗亲人", "mp4"),
    "猫为什么不如狗亲人.mp4"
  )
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

test("local artifact downloads ask the server for the title filename", () => {
  assert.equal(
    downloadUrlWithFilename(
      "/api/files/task-1/final.mp4",
      "猫为什么不如狗亲人.mp4"
    ),
    "/api/files/task-1/final.mp4?download_name=%E7%8C%AB%E4%B8%BA%E4%BB%80%E4%B9%88%E4%B8%8D%E5%A6%82%E7%8B%97%E4%BA%B2%E4%BA%BA.mp4"
  )
  assert.equal(
    downloadUrlWithFilename("https://cdn.example.com/final.mp4", "标题.mp4"),
    "https://cdn.example.com/final.mp4"
  )
})
