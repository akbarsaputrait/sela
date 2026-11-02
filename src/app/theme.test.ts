import { describe, expect, it } from "vitest"

import { resolveAppearance } from "./theme-sync"

describe("system appearance", () => {
  it("follows the OS when no appearance override is set", () => {
    expect(resolveAppearance("system", false)).toBe("light")
    expect(resolveAppearance("system", true)).toBe("dark")
  })

  it("honors an explicit user override", () => {
    expect(resolveAppearance("light", true)).toBe("light")
    expect(resolveAppearance("dark", false)).toBe("dark")
  })
})
