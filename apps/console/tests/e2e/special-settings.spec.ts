import { expect, test } from "playwright/test"

import { preparePage } from "./fixtures/app"
import { fixtureIds, installApiFixtures } from "./fixtures/api"

test.describe("专用生产", () => {
  test("批量图生视频明确按上传图片区分任务", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto(
      `/#/create/special/image_to_video/${fixtureIds.i2vTemplate}`,
      { waitUntil: "networkidle" }
    )

    await page.getByRole("radio", { name: "批量", exact: true }).click()
    const guide = page.getByRole("complementary", {
      name: "批量图片如何区分",
    })
    await expect(guide).toContainText("每张上传图片创建一条独立视频")
    await expect(guide).toContainText("不使用分隔线")
    await expect(guide).toContainText("共用同一段运动描述")
    expect(unhandledApi).toEqual([])
  })

  test("保留精确模板身份，切换模式不带入旧草稿", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto(
      `/#/create/special/image_to_video/${fixtureIds.i2vTemplate}`,
      { waitUntil: "networkidle" }
    )

    await page.getByLabel("运动描述").fill("让猫咪缓慢望向镜头")
    await page.getByRole("link", { name: "动作迁移" }).click()

    await expect(page).toHaveURL(
      new RegExp(
        `#/create/special/action_transfer/${fixtureIds.actionTemplate}$`
      )
    )
    await expect(
      page.getByRole("heading", { name: "动作迁移 视频", exact: true })
    ).toBeVisible()
    await expect(page.getByLabel("效果描述")).toHaveValue("")
    expect(unhandledApi).toEqual([])
  })

  test("模式与模板不匹配时不静默回落", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto(
      `/#/create/special/action_transfer/${fixtureIds.i2vTemplate}`,
      { waitUntil: "networkidle" }
    )

    await expect(page.getByText("模板与生产模式不匹配")).toBeVisible()
    await expect(
      page.getByText("不会自动改用其他模板", { exact: false })
    ).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("模板刷新失败时保留当前工作区", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      productionState: "stale",
    })
    await preparePage(page)
    await page.goto(
      `/#/create/special/image_to_video/${fixtureIds.i2vTemplate}`,
      { waitUntil: "networkidle" }
    )

    await page.getByRole("button", { name: "刷新专用模板" }).click()
    await expect(page.getByText("专用模板可能不是最新状态")).toBeVisible()
    await expect(page.getByLabel("运动描述")).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("专用任务复用统一结果预览与发布入口", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      submissionState: "completed",
    })
    await preparePage(page)
    await page.goto(
      `/#/create/special/image_to_video/${fixtureIds.i2vTemplate}`,
      { waitUntil: "networkidle" }
    )

    await page.locator('input[type="file"]').setInputFiles({
      name: "cat.png",
      mimeType: "image/png",
      buffer: Buffer.from("phase-4-special-image"),
    })
    await page.getByLabel("运动描述").fill("让猫咪缓慢望向镜头")
    await page.getByRole("button", { name: "开始生成" }).first().click()

    await expect(page.getByLabel("图生视频视频预览")).toBeVisible()
    await expect(page.getByRole("link", { name: "下载视频" })).toBeVisible()
    await expect(page.getByRole("link", { name: "前往发布" })).toBeVisible()
    expect(unhandledApi).toEqual([])
  })
})

test.describe("设置中心", () => {
  test("诊断服务失败不阻断设置表单", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      settingsDiagnosticsState: "error",
    })
    await preparePage(page)
    await page.goto("/#/settings?view=overview", { waitUntil: "networkidle" })

    await expect(page.getByText("生产准备情况")).toBeVisible()
    await expect(
      page.getByText("设置诊断服务暂时不可用。").first()
    ).toBeVisible()
    await page
      .getByRole("navigation", { name: "设置分区" })
      .getByRole("link", { name: /AI 大模型/ })
      .click()
    await expect(page.getByRole("heading", { name: "AI 大模型" })).toBeVisible()
    await expect(page.getByLabel("API Key").first()).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("项目分区保存失败在当前分区显示", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto(`/#/settings/projects/${fixtureIds.project}`, {
      waitUntil: "networkidle",
    })

    await page.getByLabel("名称", { exact: true }).fill("")
    const basicCard = page
      .getByText("基本信息", { exact: true })
      .locator("xpath=ancestor::*[@data-slot='card'][1]")
    await basicCard.getByRole("button", { name: "保存更改" }).click()
    await expect(basicCard.getByText("内容空间名称不能为空。")).toBeVisible()
    expect(unhandledApi).toEqual([])
  })
})
