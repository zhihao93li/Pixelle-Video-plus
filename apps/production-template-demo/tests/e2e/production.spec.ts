import { expect, test } from "playwright/test"

import { preparePage } from "./fixtures/app"
import { fixtureIds, installApiFixtures } from "./fixtures/api"

test.describe("生产模式与产物", () => {
  test("切换项目后重置当前生产草稿与运行表面", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      includeSecondProject: true,
    })
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })

    const script = page.getByLabel("视频文案", { exact: true })
    await script.fill("这是 PetWoods 项目专属的未提交草稿。")
    await page.getByRole("combobox", { name: /切换项目/ }).click()
    await page.getByRole("option", { name: /WhiskerLab 内容计划/ }).click()

    await expect(
      page.getByRole("combobox", { name: /当前：WhiskerLab 内容计划/ })
    ).toBeVisible()
    await expect(page.getByLabel("视频文案", { exact: true })).toHaveValue("")
    await expect(page.getByText("输入内容后显示预估")).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("standard 在 single 与 batch 间切换，批量解析与单项删除可用", async ({
    page,
  }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })

    const single = page.getByRole("radio", { name: "单条", exact: true })
    const batch = page.getByRole("radio", { name: "批量", exact: true })
    await expect(single).toBeChecked()
    await expect(page.getByLabel("视频文案", { exact: true })).toBeVisible()

    await batch.click()
    await expect(batch).toBeChecked()
    const batchInput = page.getByLabel("文案列表", { exact: true })
    await batchInput.fill(
      "猫薄荷\n第一条完整文案\n\n---\n\n猫咪尾巴\n第二条完整文案"
    )
    await expect(page.getByText("解析预览 · 2 条")).toBeVisible()
    await page.getByRole("button", { name: "移除第 2 条" }).click()
    await expect(page.getByText("解析预览 · 1 条")).toBeVisible()
    await expect(
      page.getByRole("button", { name: /批量生成 1 条视频/ }).first()
    ).toBeEnabled()

    await single.click()
    await expect(page.getByLabel("视频文案", { exact: true })).toBeVisible()
    await batch.click()
    await expect(batchInput).toHaveValue(/猫薄荷/)
    expect(unhandledApi).toEqual([])
  })

  test("批量确认、部分失败与单项重试在当前页闭环", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      enableBatchSubmission: true,
    })
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })

    await page.getByRole("radio", { name: "批量", exact: true }).click()
    await page
      .getByLabel("文案列表", { exact: true })
      .fill(
        "猫薄荷\n第一条完整文案\n\n---\n\n猫咪尾巴\n第二条完整文案\n\n---\n\n新手养猫\n第三条完整文案"
      )
    await page
      .locator("button:visible")
      .filter({ hasText: "批量生成 3 条视频" })
      .click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "确认提交" }).click()

    await expect(page.getByText("部分失败", { exact: true }).first()).toBeVisible()
    await expect(page.getByText("失败 1", { exact: true })).toBeVisible()
    const retry = page.getByRole("button", { name: "重试", exact: true })
    await expect(retry).toHaveCount(1)
    await retry.click()
    await expect(page.getByText("失败 0", { exact: true })).toBeVisible()
    await expect(retry).toHaveCount(0)
    expect(unhandledApi).toEqual([])
  })

  test("asset_based 只显示单条素材表面，选文件后可提交", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      submissionDelayMs: 350,
      submissionState: "completed",
    })
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.assetTemplate}`, {
      waitUntil: "networkidle",
    })

    await expect(page.getByText("上传素材", { exact: true })).toBeVisible()
    await expect(
      page.getByRole("button", { name: "批量", exact: true })
    ).toHaveCount(0)
    await page.locator("#assets").setInputFiles([
      {
        name: "front.png",
        mimeType: "image/png",
        buffer: Buffer.from("front-fixture"),
      },
      {
        name: "detail.png",
        mimeType: "image/png",
        buffer: Buffer.from("detail-fixture"),
      },
    ])
    await expect(page.getByText("front.png", { exact: true })).toBeVisible()
    await expect(page.getByText("detail.png", { exact: true })).toBeVisible()
    await expect(
      page.getByRole("button", { name: "开始生成" }).first()
    ).toBeEnabled()
    await page.getByRole("button", { name: "开始生成" }).first().click()
    await expect(
      page
        .locator("button:visible")
        .filter({ hasText: "正在上传并提交…" })
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "前往发布" })).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("标准视频从 submitting 进入 completed 并自动读取结果", async ({
    page,
  }) => {
    const unhandledApi = await installApiFixtures(page, {
      submissionDelayMs: 350,
      submissionState: "completed",
    })
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })
    await page
      .getByLabel("视频文案", { exact: true })
      .fill("猫咪摇尾巴时，速度和高度都在表达情绪。")
    await page.getByRole("button", { name: "开始生成" }).first().click()

    await expect(
      page.locator("button:visible").filter({ hasText: "正在提交…" })
    ).toBeVisible()
    await expect(page.getByText("已完成", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "前往发布" })).toBeVisible()
    await expect(page.locator("video")).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("标准视频 failed 显示原因并允许重新提交", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      submissionState: "failed",
    })
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })
    await page.getByLabel("视频文案", { exact: true }).fill("故障状态验收文案。")
    await page.getByRole("button", { name: "开始生成" }).first().click()

    await expect(page.getByText("任务失败", { exact: true })).toBeVisible()
    await expect(page.getByText(/渲染节点暂时不可用/)).toBeVisible()
    await expect(
      page.getByRole("button", { name: "开始生成" }).first()
    ).toBeEnabled()
    expect(unhandledApi).toEqual([])
  })

  test("运行中任务可取消，cancelled 后恢复提交", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      submissionState: "running",
    })
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })
    await page.getByLabel("视频文案", { exact: true }).fill("取消状态验收文案。")
    await page.getByRole("button", { name: "开始生成" }).first().click()

    await expect(page.getByText("生成中", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "取消任务" }).click()
    await expect(page.getByText("已取消", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "取消任务" })).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "开始生成" }).first()
    ).toBeEnabled()
    expect(unhandledApi).toEqual([])
  })

  test("未知后端状态不推断为运行中，也不暴露取消操作", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      submissionState: "unknown",
    })
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })
    await page.getByLabel("视频文案", { exact: true }).fill("未知状态验收文案。")
    await page.getByRole("button", { name: "开始生成" }).first().click()

    await expect(page.getByText("状态待同步", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "取消任务" })).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "开始生成" }).first()
    ).toBeEnabled()
    expect(unhandledApi).toEqual([])
  })

  test("提交失败停留当前表面并显示可恢复错误", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      submissionState: "submit-error",
    })
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })
    await page.getByLabel("视频文案", { exact: true }).fill("提交失败验收文案。")
    await page.getByRole("button", { name: "开始生成" }).first().click()

    await expect(page.getByText("提交失败", { exact: true })).toBeVisible()
    await expect(page.getByText("生成服务暂时不可用。")).toBeVisible()
    await expect(page.getByLabel("视频文案", { exact: true })).toHaveValue(
      "提交失败验收文案。"
    )
    expect(unhandledApi).toEqual([])
  })

  test("completed 后结果读取失败提供就地重试", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      submissionState: "result-error",
    })
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })
    await page.getByLabel("视频文案", { exact: true }).fill("结果读取失败验收文案。")
    await page.getByRole("button", { name: "开始生成" }).first().click()

    await expect(page.getByText("结果读取失败", { exact: true })).toBeVisible()
    const retry = page.getByRole("button", { name: "重新读取结果" })
    await expect(retry).toBeVisible()
    await retry.click()
    await expect(page.getByText("结果读取失败", { exact: true })).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  for (const artifact of [
    {
      name: "video",
      taskId: fixtureIds.historyVideoTask,
      previewLabel: "猫咪尾巴语言视频预览",
      action: "下载视频",
    },
    {
      name: "image_set",
      taskId: fixtureIds.historyImageTask,
      previewLabel: "猫咪为什么喜欢猫薄荷图集预览",
      action: "下载图集去发布",
    },
    {
      name: "text",
      taskId: fixtureIds.historyTextTask,
      previewLabel: "第一次养猫的七天准备清单长文预览",
      action: "下载 .md",
    },
  ]) {
    test(`${artifact.name} completed 结果渲染专属预览与操作`, async ({
      page,
    }) => {
      const unhandledApi = await installApiFixtures(page)
      await preparePage(page)
      await page.goto(`/#/library?task=${artifact.taskId}`, {
        waitUntil: "networkidle",
      })

      const preview = page.getByLabel(artifact.previewLabel)
      await expect(preview).toBeVisible()
      const action =
        artifact.name === "video"
          ? page.getByRole("link", { name: artifact.action }).last()
          : preview.getByRole("button", { name: artifact.action })
      await expect(action).toBeVisible()
      expect(unhandledApi).toEqual([])
    })
  }
})
