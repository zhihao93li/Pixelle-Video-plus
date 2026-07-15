import { expect, test } from "playwright/test"

import { preparePage } from "./fixtures/app"
import {
  fixtureIds,
  installApiFixtures,
  type ApiFixtureRequest,
} from "./fixtures/api"

test.describe("生产模式与产物", () => {
  test("生成工作区在超宽桌面使用全部可用内容宽度", async ({ page }) => {
    await page.setViewportSize({ width: 2048, height: 1152 })
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })

    const frame = await page.locator('[data-slot="page-frame"]').boundingBox()
    const workspace = await page
      .locator('[data-slot="production-workspace"]')
      .boundingBox()
    const editor = await page
      .locator('[data-slot="production-editor"]')
      .boundingBox()
    const rail = await page
      .locator('[data-slot="production-rail"]')
      .boundingBox()
    expect(frame).not.toBeNull()
    expect(workspace).not.toBeNull()
    expect(editor).not.toBeNull()
    expect(rail).not.toBeNull()
    expect(frame!.x + frame!.width).toBeGreaterThanOrEqual(2047)
    expect(frame!.width).toBeGreaterThan(1750)
    expect(workspace!.x + workspace!.width).toBeGreaterThanOrEqual(2023)
    expect(rail!.width).toBeGreaterThanOrEqual(719)
    expect(rail!.width).toBeLessThanOrEqual(721)
    expect(editor!.width).toBeGreaterThan(rail!.width)

    await page.setViewportSize({ width: 1280, height: 900 })
    const compactRail = await page
      .locator('[data-slot="production-rail"]')
      .boundingBox()
    expect(compactRail).not.toBeNull()
    expect(compactRail!.width).toBeGreaterThanOrEqual(420)
    expect(compactRail!.width).toBeLessThanOrEqual(430)
    expect(unhandledApi).toEqual([])
  })

  test("主题路线在模板和本次设置共用写稿与分镜控件", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)

    await page.goto(`/#/create/recipes/${fixtureIds.topicTemplate}`, {
      waitUntil: "networkidle",
    })
    await expect(page.getByRole("heading", { name: "1. 写稿" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "2. 分镜" })).toBeVisible()
    await expect(
      page.getByRole("combobox", { name: "写稿提示词" })
    ).toContainText("default-script")
    await expect(
      page.getByRole("combobox", { name: "分镜提示词" })
    ).toContainText("default-split")
    await page.getByRole("button", { name: "展开编辑" }).first().click()
    const promptEditor = page.getByRole("textbox", { name: "写稿提示词正文" })
    await expect(promptEditor).toBeVisible()
    await expect(page.getByText("分镜数量", { exact: true })).toHaveCount(0)

    await page.goto(`/#/create/generate/${fixtureIds.topicTemplate}`, {
      waitUntil: "networkidle",
    })
    await page
      .getByRole("button", { name: "展开本次设置", exact: true })
      .click()
    await expect(page.getByRole("heading", { name: "1. 写稿" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "2. 分镜" })).toBeVisible()
    await expect(
      page.getByRole("combobox", { name: "写稿提示词" })
    ).toContainText("default-script")
    await expect(
      page.getByRole("combobox", { name: "分镜提示词" })
    ).toContainText("default-split")
    await page.getByRole("button", { name: "展开编辑" }).first().click()
    await page
      .getByRole("textbox", { name: "写稿提示词正文" })
      .fill("请围绕 {topic} 写一段清晰的口播文案。")
    await expect(page.getByText("自定义正文 · 不跟随提示词库")).toBeVisible()
    await page.getByRole("button", { name: "恢复跟随模板" }).click()
    await expect(page.getByText("自定义正文 · 不跟随提示词库")).toHaveCount(0)
    await page.getByRole("combobox", { name: "写稿模型 LLM 服务" }).click()
    await page.getByRole("option", { name: "OpenAI 直连" }).click()
    await page.getByRole("combobox", { name: "写稿模型", exact: true }).click()
    await page.getByPlaceholder("搜索模型名称").fill("4.1-mini")
    await page.getByRole("option", { name: "gpt-4.1-mini" }).click()
    await page.getByRole("button", { name: "添加语言" }).click()
    await page.getByRole("textbox", { name: "第 1 行语言" }).fill("English")
    await page.getByRole("combobox", { name: "第 1 行 LLM 服务" }).click()
    await page.getByRole("option", { name: "AiHubMix 主账号" }).click()
    await page.getByRole("combobox", { name: "第 1 行模型" }).click()
    await page.getByRole("option", { name: "deepseek-v4" }).click()
    await expect(page.getByText("分镜数量", { exact: true })).toHaveCount(0)
    expect(unhandledApi).toEqual([])
  })

  test("模板有效默认进入表单，任务只提交本次 dirty override", async ({
    page,
  }) => {
    const captured: ApiFixtureRequest[] = []
    const unhandledApi = await installApiFixtures(page, {
      captureJsonRequests: captured,
      imageProvidersReady: true,
      submissionState: "completed",
      videoFixedParams: {
        split_mode: "line",
        tts_voice: "recipe-voice",
        bgm_volume: 0.12,
      },
    })
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })

    await expect(page.getByText(/全部沿用模板默认/).first()).toBeVisible()
    await expect(page.getByLabel(/^音色/)).toHaveCount(0)
    await page
      .getByRole("button", { name: "展开本次设置", exact: true })
      .click()
    const voice = page.getByLabel(/^音色/).last()
    await expect(voice).toHaveValue("recipe-voice")

    await voice.fill("temporary-voice")
    await page.getByRole("button", { name: "恢复模板默认" }).click()
    await expect(voice).toHaveValue("recipe-voice")
    await voice.fill("run-voice")
    await page.getByRole("combobox", { name: "图片 Provider" }).click()
    await page.getByRole("option", { name: "阿里云百炼" }).click()
    await page.getByRole("combobox", { name: "图片模型" }).click()
    await page.getByRole("option", { name: "Qwen-Image 2.0 Pro" }).click()
    await expect(page.getByText(/本次覆盖 3 项/).first()).toBeVisible()

    await page
      .getByLabel("视频文案", { exact: true })
      .fill("只验证本次覆盖的提交文案。")
    await page.getByRole("button", { name: "开始生成" }).first().click()
    await expect(page.getByText("已完成", { exact: true })).toBeVisible()

    const taskRequest = captured.find(
      (request) => request.path === "/production-tasks"
    )
    expect(taskRequest?.body).toMatchObject({
      input: {
        script: "只验证本次覆盖的提交文案。",
      },
      overrides: {
        image_provider: "aliyun_bailian",
        image_model: "qwen-image-2.0-pro",
        tts_voice: "run-voice",
      },
      pipeline_id: "script_to_video",
      recipe_id: fixtureIds.videoTemplate,
    })
    expect(
      Object.keys(
        (taskRequest?.body as { overrides?: Record<string, unknown> })
          .overrides ?? {}
      ).sort()
    ).toEqual(["image_model", "image_provider", "tts_voice"])
    expect(unhandledApi).toEqual([])
  })

  test("长文产线复用共享设置编辑器并只提交本次字数覆盖", async ({ page }) => {
    const captured: ApiFixtureRequest[] = []
    const unhandledApi = await installApiFixtures(page, {
      captureJsonRequests: captured,
      submissionState: "completed",
    })
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.textTemplate}`, {
      waitUntil: "networkidle",
    })

    await page
      .getByRole("button", { name: "展开本次设置", exact: true })
      .click()
    await page.getByLabel("目标字数").fill("2400")
    await expect(page.getByText(/本次覆盖 1 项/).first()).toBeVisible()

    await page
      .getByLabel("文案", { exact: true })
      .fill("请把这段养猫素材扩写成结构化长文。")
    await page.getByRole("button", { name: "开始生成" }).first().click()
    await expect(page.getByText("已完成", { exact: true })).toBeVisible()

    const taskRequest = captured.find(
      (request) => request.path === "/production-tasks"
    )
    expect(taskRequest?.body).toMatchObject({
      input: {
        script: "请把这段养猫素材扩写成结构化长文。",
      },
      overrides: {
        word_count: 2400,
      },
      pipeline_id: "long_form",
      recipe_id: fixtureIds.textTemplate,
    })
    expect(
      Object.keys(
        (taskRequest?.body as { overrides?: Record<string, unknown> })
          .overrides ?? {}
      ).sort()
    ).toEqual(["word_count"])
    expect(unhandledApi).toEqual([])
  })

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
    await expect(page.getByText("分镜数量由 AI 决定")).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("本次设置默认折叠，展开后按完整生产阶段编辑", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })

    await expect(page.getByText("文案拆分方式", { exact: true })).toHaveCount(0)
    await expect(page.getByText("当前模板", { exact: true })).toBeVisible()
    await expect(page.getByLabel("视频文案", { exact: true })).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "本次设置", exact: true })
    ).toBeVisible()
    await expect(page.getByRole("heading", { name: "1. 分镜" })).toHaveCount(0)
    await expect(
      page.getByRole("heading", { name: "2. 每镜画面" })
    ).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "3. 音色" })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "4. 合成" })).toHaveCount(0)
    await expect(page.getByLabel(/^音色/)).toHaveCount(0)
    await expect(page.getByLabel("背景音乐文件")).toHaveCount(0)
    await expect(page.getByText("全部沿用模板默认").first()).toBeVisible()

    const manageRecipe = page.getByRole("link", { name: "管理长期模板" })
    await expect(manageRecipe).toHaveAttribute("data-variant", "outline")
    const expand = page.getByRole("button", {
      name: "展开本次设置",
      exact: true,
    })
    await expect(expand).toHaveAttribute("data-variant", "outline")
    await expand.click()
    await expect(page.getByRole("heading", { name: "1. 分镜" })).toBeVisible()
    await expect(page.getByRole("dialog", { name: "高级设置" })).toHaveCount(0)
    await expect(
      page.getByRole("heading", { name: "2. 每镜画面" })
    ).toBeVisible()
    await expect(page.getByRole("heading", { name: "3. 音色" })).toHaveCount(1)
    await expect(page.getByRole("heading", { name: "4. 合成" })).toHaveCount(1)
    await expect(page.getByLabel(/^音色/)).toHaveCount(1)
    await expect(page.getByLabel("背景音乐文件")).toHaveCount(1)
    await expect(
      page.getByRole("button", { name: "收起本次设置", exact: true })
    ).toHaveAttribute("aria-expanded", "true")
    await page
      .getByRole("button", { name: "收起本次设置", exact: true })
      .click()
    await expect(page.getByLabel(/^音色/)).toHaveCount(0)
    await expect(page.getByLabel("背景音乐文件")).toHaveCount(0)
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

  test("批量提交创建彼此独立的生产任务并回到工作台", async ({ page }) => {
    const captured: ApiFixtureRequest[] = []
    const unhandledApi = await installApiFixtures(page, {
      captureJsonRequests: captured,
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
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "确认提交" })
      .click()

    await expect(page).toHaveURL(/#\/board$/)
    const submissions = captured.filter(
      (request) =>
        request.method === "POST" && request.path === "/production-tasks"
    )
    expect(submissions).toHaveLength(3)
    expect(
      submissions.map(
        (request) =>
          (request.body as { input: { script: string } }).input.script
      )
    ).toEqual(["第一条完整文案", "第二条完整文案", "第三条完整文案"])
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
    await page
      .getByRole("button", { name: "展开本次设置", exact: true })
      .click()
    await expect(
      page.getByRole("combobox", {
        name: "背景音乐文件",
        exact: true,
      })
    ).toBeVisible()
    await expect(
      page.getByRole("dialog", { name: "素材合成设置" })
    ).toHaveCount(0)
    await expect(
      page.getByText("图片或视频素材", { exact: true })
    ).toBeVisible()
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
      page.locator("button:visible").filter({ hasText: "正在上传并提交…" })
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

    await Promise.all([
      expect(
        page.locator("button:visible").filter({ hasText: "正在提交…" })
      ).toBeVisible(),
      expect(page.getByText("提交中", { exact: true })).toBeVisible(),
      expect(
        page.getByRole("heading", { name: "任务状态", exact: true })
      ).toBeVisible(),
    ])
    await expect(page.getByText("已完成", { exact: true })).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "生成结果", exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "任务状态", exact: true })
    ).toHaveCount(0)
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
    await page
      .getByLabel("视频文案", { exact: true })
      .fill("故障状态验收文案。")
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
    await page
      .getByLabel("视频文案", { exact: true })
      .fill("取消状态验收文案。")
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
    await page
      .getByLabel("视频文案", { exact: true })
      .fill("未知状态验收文案。")
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
    await page
      .getByLabel("视频文案", { exact: true })
      .fill("提交失败验收文案。")
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
    await page
      .getByLabel("视频文案", { exact: true })
      .fill("结果读取失败验收文案。")
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
