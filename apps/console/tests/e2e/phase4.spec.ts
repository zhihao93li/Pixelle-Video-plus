import { expect, test } from "playwright/test"

import { preparePage } from "./fixtures/app"
import { fixtureIds, installApiFixtures } from "./fixtures/api"

test.describe("Phase 4 专用生产", () => {
  test("保留精确配方身份，切换模式不带入旧草稿", async ({ page }) => {
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

  test("模式与配方不匹配时不静默回落", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto(
      `/#/create/special/action_transfer/${fixtureIds.i2vTemplate}`,
      { waitUntil: "networkidle" }
    )

    await expect(page.getByText("配方与生产模式不匹配")).toBeVisible()
    await expect(
      page.getByText("不会自动改用其他配方", { exact: false })
    ).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("配方刷新失败时保留当前工作区", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      productionState: "stale",
    })
    await preparePage(page)
    await page.goto(
      `/#/create/special/image_to_video/${fixtureIds.i2vTemplate}`,
      { waitUntil: "networkidle" }
    )

    await page.getByRole("button", { name: "刷新专用配方" }).click()
    await expect(page.getByText("专用配方可能不是最新状态")).toBeVisible()
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

test.describe("Phase 4 文案审核", () => {
  test("首步只突出选题与语言，第二步按选题和语言折叠编辑", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      scriptReviewState: "save-error",
    })
    await preparePage(page)
    await page.goto("/#/create/script-review", { waitUntil: "networkidle" })

    await expect(page.getByLabel("选题", { exact: true })).toBeVisible()
    await expect(page.getByText("起草模型与 Prompt")).toBeVisible()
    await expect(page.getByLabel("脚本模型")).toBeHidden()

    await page.getByLabel("选题", { exact: true }).fill("猫咪夏天饮水少怎么办")
    await page.getByRole("button", { name: "生成审核草稿" }).click()

    await expect(
      page.getByRole("heading", { name: "逐条审核草稿" })
    ).toBeVisible()
    await expect(
      page.getByText("猫咪夏天饮水少怎么办", { exact: true })
    ).toBeVisible()
    await expect(page.getByText("Chinese", { exact: true })).toBeVisible()
    await page.getByLabel("标题").fill("夏天饮水新标题")
    await page.getByRole("button", { name: "保存修改" }).click()
    await expect(page.getByText("审核草稿保存失败。")).toBeVisible()
    await expect(page.getByText("审核保存失败")).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("第三步的提交失败留在当前步骤", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      scriptReviewState: "submit-error",
    })
    await preparePage(page)
    await page.goto("/#/create/script-review", { waitUntil: "networkidle" })
    await page.getByLabel("选题", { exact: true }).fill("猫咪夏天饮水少怎么办")
    await page.getByRole("button", { name: "生成审核草稿" }).click()
    await page.getByRole("button", { name: "下一步：确认提交" }).click()

    const submit = page.getByRole("button", { name: "提交生成视频" })
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(page.getByText("生产批次提交失败。")).toBeVisible()
    await expect(page.getByText("生产操作未完成")).toBeVisible()
    await expect(page.getByText("确认生产设置")).toBeVisible()
    expect(unhandledApi).toEqual([])
  })
})

test.describe("Phase 4 设置中心", () => {
  test("诊断服务失败不阻断设置表单", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      settingsDiagnosticsState: "error",
    })
    await preparePage(page)
    await page.goto("/#/settings?view=overview", { waitUntil: "networkidle" })

    await expect(page.getByText("系统概览")).toBeVisible()
    await expect(page.getByText("设置诊断服务暂时不可用。")).toBeVisible()
    await page
      .getByRole("navigation", { name: "设置分区" })
      .getByRole("link", { name: /AI 与语音/ })
      .click()
    await expect(page.getByLabel("AiHubMix API Key")).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("项目分区保存失败在当前分区显示", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto(`/#/settings/projects/${fixtureIds.project}`, {
      waitUntil: "networkidle",
    })

    await page.getByLabel("名称", { exact: true }).fill("")
    const basicSection = page.locator("section").filter({ hasText: "基本信息" })
    await basicSection.getByRole("button", { name: "保存" }).click()
    await expect(basicSection.getByText("项目名称不能为空。")).toBeVisible()
    await expect(
      basicSection.getByText("保存失败", { exact: true })
    ).toBeVisible()
    expect(unhandledApi).toEqual([])
  })
})
