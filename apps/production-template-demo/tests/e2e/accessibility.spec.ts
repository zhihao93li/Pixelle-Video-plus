import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "playwright/test"

import { preparePage, type TestTheme, visitRoute } from "./fixtures/app"
import { installApiFixtures } from "./fixtures/api"
import { FORMAL_SURFACES } from "./fixtures/surfaces"

type SeriousViolation = {
  help: string
  id: string
  impact: string | null | undefined
  nodes: Array<{
    failureSummary: string | undefined
    html: string
    target: string
  }>
  route: string
}

async function seriousViolations(page: Page, route: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical"
    )
    .map<SeriousViolation>((violation) => ({
      help: violation.help,
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        failureSummary: node.failureSummary,
        html: node.html,
        target: node.target.join(" "),
      })),
      route,
    }))
}

for (const scenario of [
  {
    name: "desktop light",
    width: 1440,
    height: 900,
    theme: "light" as TestTheme,
  },
  {
    name: "mobile dark",
    width: 390,
    height: 844,
    theme: "dark" as TestTheme,
  },
]) {
  test(`${scenario.name} 全部正式 surface 无 serious/critical axe 问题`, async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({
      width: scenario.width,
      height: scenario.height,
    })
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page, scenario.theme)
    const violations: SeriousViolation[] = []

    for (const route of FORMAL_SURFACES) {
      await visitRoute(page, route.path, route.heading)
      violations.push(...(await seriousViolations(page, route.path)))
    }

    expect(unhandledApi, "存在未定义的 E2E API fixture").toEqual([])
    expect(
      violations,
      `axe serious/critical violations:\n${JSON.stringify(violations, null, 2)}`
    ).toEqual([])
  })
}
