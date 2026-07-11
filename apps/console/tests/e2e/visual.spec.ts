import { expect, test, type Page } from "playwright/test"

import {
  observeRuntimeErrors,
  preparePage,
  type TestTheme,
} from "./fixtures/app"
import { fixtureIds, installApiFixtures } from "./fixtures/api"
import {
  FORMAL_SURFACES,
  MOBILE_VISUAL_SURFACES,
  type FormalSurface,
} from "./fixtures/surfaces"

test.describe("formal route visual regression", () => {
  test.use({ locale: "zh-CN", timezoneId: "Asia/Shanghai" })

  test.describe("desktop light", () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    for (const route of FORMAL_SURFACES) {
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

    for (const route of MOBILE_VISUAL_SURFACES) {
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
  route: FormalSurface,
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
