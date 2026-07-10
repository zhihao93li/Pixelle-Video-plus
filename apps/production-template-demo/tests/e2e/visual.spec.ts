import { expect, test, type Page } from "playwright/test"

import {
  observeRuntimeErrors,
  preparePage,
  type TestTheme,
} from "./fixtures/app"
import { fixtureIds, installApiFixtures } from "./fixtures/api"

type VisualRoute = {
  name: string
  path: string
  heading: string
}

const DESKTOP_LIGHT_ROUTES: readonly VisualRoute[] = [
  { name: "board-loaded", path: "/board", heading: "工作台" },
  {
    name: "content-detail-confirmed",
    path: `/board/item/${fixtureIds.contentItem}`,
    heading: "内容详情",
  },
  { name: "create-gallery", path: "/create", heading: "快速生产" },
  {
    name: "generate-video-idle",
    path: `/create/generate/${fixtureIds.videoTemplate}`,
    heading: "生成",
  },
  {
    name: "generate-image-set-idle",
    path: `/create/generate/${fixtureIds.imageTemplate}`,
    heading: "生成",
  },
  {
    name: "generate-text-idle",
    path: `/create/generate/${fixtureIds.textTemplate}`,
    heading: "生成",
  },
  {
    name: "recipe-detail",
    path: `/create/recipes/${fixtureIds.videoTemplate}`,
    heading: "配方详情",
  },
  {
    name: "special-image-to-video-idle",
    path: `/create/special/image_to_video/${fixtureIds.i2vTemplate}`,
    heading: "特殊视频生成",
  },
  {
    name: "special-action-transfer-idle",
    path: `/create/special/action_transfer/${fixtureIds.actionTemplate}`,
    heading: "特殊视频生成",
  },
  {
    name: "special-digital-human-idle",
    path: `/create/special/digital_human/${fixtureIds.humanTemplate}`,
    heading: "特殊视频生成",
  },
  {
    name: "script-review-step-1",
    path: "/create/script-review",
    heading: "多语言审核出片",
  },
  {
    name: "tasks-partial-failure",
    path: "/tasks",
    heading: "任务",
  },
  {
    name: "library-loaded-image-set",
    path: `/library?task=${fixtureIds.historyImageTask}`,
    heading: "作品库",
  },
  {
    name: "settings-overview",
    path: "/settings?view=overview",
    heading: "设置",
  },
  {
    name: "settings-projects",
    path: "/settings?view=projects",
    heading: "设置",
  },
  {
    name: "settings-ai-voice",
    path: "/settings?view=ai-voice",
    heading: "设置",
  },
  {
    name: "settings-generation",
    path: "/settings?view=generation",
    heading: "设置",
  },
  {
    name: "settings-publish-storage",
    path: "/settings?view=publish-storage",
    heading: "设置",
  },
  {
    name: "settings-recipes",
    path: "/settings?view=recipes",
    heading: "设置",
  },
  {
    name: "settings-help-markdown",
    path: "/settings?view=help",
    heading: "设置",
  },
  {
    name: "project-detail",
    path: `/settings/projects/${fixtureIds.project}`,
    heading: "项目详情",
  },
]

const MOBILE_DARK_ROUTES: readonly VisualRoute[] = [
  {
    name: "content-detail-confirmed",
    path: `/board/item/${fixtureIds.contentItem}`,
    heading: "内容详情",
  },
  { name: "create-gallery", path: "/create", heading: "快速生产" },
  {
    name: "generate-video-idle",
    path: `/create/generate/${fixtureIds.videoTemplate}`,
    heading: "生成",
  },
  {
    name: "special-digital-human-idle",
    path: `/create/special/digital_human/${fixtureIds.humanTemplate}`,
    heading: "特殊视频生成",
  },
  {
    name: "script-review-step-1",
    path: "/create/script-review",
    heading: "多语言审核出片",
  },
  {
    name: "tasks-partial-failure",
    path: "/tasks",
    heading: "任务",
  },
  {
    name: "library-loaded-image-set",
    path: `/library?task=${fixtureIds.historyImageTask}`,
    heading: "作品库",
  },
  {
    name: "settings-overview",
    path: "/settings?view=overview",
    heading: "设置",
  },
  {
    name: "settings-generation",
    path: "/settings?view=generation",
    heading: "设置",
  },
]

test.describe("formal route visual regression", () => {
  test.use({ locale: "zh-CN", timezoneId: "Asia/Shanghai" })

  test.describe("desktop light", () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    for (const route of DESKTOP_LIGHT_ROUTES) {
      test(route.name, async ({ page }) => {
        await captureFormalRoute(
          page,
          route,
          "light",
          `desktop-${route.name}.png`
        )
      })
    }
  })

  test.describe("critical mobile dark", () => {
    test.use({ viewport: { width: 390, height: 844 } })

    for (const route of MOBILE_DARK_ROUTES) {
      test(route.name, async ({ page }) => {
        await captureFormalRoute(
          page,
          route,
          "dark",
          `mobile-dark-${route.name}.png`
        )
      })
    }
  })

  test.describe("selected split-canvas reference viewport", () => {
    test.use({ viewport: { width: 1487, height: 1058 } })

    test("generation editing", async ({ page }) => {
      const runtimeErrors = observeRuntimeErrors(page)
      const unhandledApi = await installApiFixtures(page)
      await page.clock.setFixedTime(new Date("2026-07-10T12:00:00+08:00"))
      await preparePage(page, "light")
      await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
        waitUntil: "domcontentloaded",
      })
      await expect(
        page.getByRole("heading", { level: 1, name: "生成", exact: true })
      ).toBeVisible()

      const script = page.getByLabel("视频文案", { exact: true })
      await expect(script).toBeVisible()
      await script.fill(
        [
          "猫薄荷会通过嗅觉让一部分猫咪短暂兴奋。",
          "这种反应通常持续五到十五分钟，之后会进入短暂冷却期。",
          "并非所有猫都会有反应，适量使用并观察猫咪状态即可。",
        ].join("\n\n")
      )
      await page.evaluate(async () => {
        await document.fonts.ready
        window.scrollTo(0, 0)
      })

      await expect(page).toHaveScreenshot(
        "reference-viewport-generation-editing.png",
        {
          animations: "disabled",
          caret: "hide",
          fullPage: false,
          scale: "css",
        }
      )
      expect(unhandledApi, "设计参考场景存在未定义 API fixture").toEqual([])
      expect(runtimeErrors, "设计参考场景产生运行时错误").toEqual([])
    })
  })
})

async function captureFormalRoute(
  page: Page,
  route: VisualRoute,
  theme: TestTheme,
  screenshotName: string
) {
  const runtimeErrors = observeRuntimeErrors(page)
  const unhandledApi = await installApiFixtures(page)
  await page.clock.setFixedTime(new Date("2026-07-10T12:00:00+08:00"))
  await preparePage(page, theme)

  await page.goto(`/#${route.path}`, { waitUntil: "domcontentloaded" })
  await expect(page.locator("#root")).not.toBeEmpty()
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: route.heading,
      exact: true,
    })
  ).toBeVisible()
  await expect(page.locator("html")).toHaveClass(new RegExp(theme))
  await page.waitForLoadState("networkidle")
  await page.evaluate(async () => {
    await document.fonts.ready
    for (const image of Array.from(document.images)) {
      image.loading = "eager"
    }
    await Promise.all(
      Array.from(document.images).map((image) => {
        if (image.complete) return Promise.resolve()
        return new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true })
          image.addEventListener("error", () => resolve(), { once: true })
        })
      })
    )
    window.scrollTo(0, 0)
  })

  await expect(page).toHaveScreenshot(screenshotName, {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
  })

  expect(unhandledApi, "存在未定义的视觉回归 API fixture").toEqual([])
  expect(runtimeErrors, "视觉回归页面产生了运行时错误").toEqual([])
}
