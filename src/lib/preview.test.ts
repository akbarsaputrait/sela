import { describe, expect, it } from "vitest"

import { isDashboardPreview } from "./preview"

describe("dashboard preview", () => {
  it("allows the dashboard only in a development browser", () => {
    expect(isDashboardPreview("?preview=dashboard", true, false)).toBe(true)
    expect(isDashboardPreview("?preview=dashboard", true, true)).toBe(false)
    expect(isDashboardPreview("?preview=dashboard", false, false)).toBe(false)
    expect(isDashboardPreview("?preview=dashboard", false, true)).toBe(false)
  })

  it("does not interpret other query values as a preview", () => {
    expect(isDashboardPreview("?window=dashboard", true, false)).toBe(false)
    expect(isDashboardPreview("?preview=other", true, false)).toBe(false)
  })
})
