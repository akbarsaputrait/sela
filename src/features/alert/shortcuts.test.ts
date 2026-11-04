import { describe, expect, it } from "vitest"

import { alertShortcut } from "./shortcuts"

const keyEvent = (key: string, overrides = {}) => ({
  key,
  defaultPrevented: false,
  repeat: false,
  isComposing: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...overrides,
})

describe("alert keyboard shortcuts", () => {
  it("does not intercept Enter, leaving focused buttons to activate normally", () => {
    expect(alertShortcut(keyEvent("Enter"), false)).toBeNull()
    expect(alertShortcut(keyEvent("Enter"), true)).toBeNull()
  })

  it("snoozes with S and dismisses with Escape", () => {
    expect(alertShortcut(keyEvent("s"), false)).toBe("snooze")
    expect(alertShortcut(keyEvent("S"), false)).toBe("snooze")
    expect(alertShortcut(keyEvent("Escape"), false)).toBe("dismiss")
  })

  it.each(["Enter", "s", "Escape"])(
    "ignores handled, repeated, composing, or modified %s events",
    (key) => {
      for (const flag of [
        "defaultPrevented",
        "repeat",
        "isComposing",
        "metaKey",
        "ctrlKey",
        "altKey",
      ]) {
        expect(alertShortcut(keyEvent(key, { [flag]: true }), false)).toBeNull()
      }
    }
  )

  it("only dismisses a preview", () => {
    expect(alertShortcut(keyEvent("s"), true)).toBeNull()
    expect(alertShortcut(keyEvent("Escape"), true)).toBe("dismiss")
  })
})
