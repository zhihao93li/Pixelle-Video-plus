import { expect, test } from "playwright/test"

import { preparePage } from "./fixtures/app"
import { fixtureIds, installApiFixtures } from "./fixtures/api"

type FrameExpectation = {
  path: string
  heading: string
  width: number
  x: number
}

const VIEWPORT = { width: 2560, height: 1200 }

const CASES: FrameExpectation[] = [
  { path: "/create", heading: "快速生产", width: 1920, x: 432 },
  {
    path: `/library?task=${fixtureIds.historyVideoTask}`,
    heading: "作品库",
    width: 1920,
    x: 432,
  },
  {
    path: "/settings?view=overview",
    heading: "设置",
    width: 1440,
    x: 672,
  },
  {
    path: `/create/special/image_to_video/${fixtureIds.i2vTemplate}`,
    heading: "特殊视频生成",
    width: 2336,
    x: 224,
  },
]

test("desktop routes use the route-owned adaptive width contract", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORT)
  const unhandledApi = await installApiFixtures(page)
  await preparePage(page)

  for (const surface of CASES) {
    await page.goto(`/#${surface.path}`, { waitUntil: "networkidle" })
    await expect(
      page.getByRole("heading", { level: 1, name: surface.heading })
    ).toBeVisible()
    const frameLocator = page.locator(
      'main[data-slot="page-frame"]:not([role="status"])'
    )
    await expect
      .poll(async () => {
        const frame = await frameLocator.boundingBox().catch(() => null)
        return frame
          ? { width: Math.round(frame.width), x: Math.round(frame.x) }
          : null
      })
      .toEqual({ width: surface.width, x: surface.x })
  }

  expect(unhandledApi).toEqual([])
})
