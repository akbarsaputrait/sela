import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LandingPage } from "./page"

afterEach(() => vi.unstubAllGlobals())

describe("website appearance choices", () => {
  it.each(["system", "light", "dark"])(
    "restores the saved %s choice without replacing system with its current color",
    (appearance) => {
      vi.stubGlobal("localStorage", { getItem: () => appearance })
      vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) })

      const html = renderToStaticMarkup(<LandingPage />)
      expect(html).toContain('aria-label="Appearance"')
      expect(html).toContain(`<option value="${appearance}" selected="">`)
      for (const choice of ["System", "Light", "Dark"]) {
        expect(html).toContain(`>${choice}</option>`)
      }
    }
  )

  it("uses System for an unknown saved preference", () => {
    vi.stubGlobal("localStorage", { getItem: () => "unknown" })
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) })

    expect(renderToStaticMarkup(<LandingPage />)).toContain(
      '<option value="system" selected="">System</option>'
    )
  })

  it("renders a System choice without browser globals or available storage", () => {
    vi.stubGlobal("window", undefined)
    vi.stubGlobal("localStorage", undefined)

    expect(renderToStaticMarkup(<LandingPage />)).toContain(
      '<option value="system" selected="">System</option>'
    )
  })
})
