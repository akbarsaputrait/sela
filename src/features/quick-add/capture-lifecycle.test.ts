import { describe, expect, it } from "vitest"

import { CaptureLifecycle } from "./capture-lifecycle"

describe("Quick Add capture lifecycle", () => {
  it("shares one save lock across timer and scheduled submissions", () => {
    const capture = new CaptureLifecycle()
    const timerSave = capture.beginSubmission()
    expect(timerSave).not.toBeNull()
    expect(capture.beginSubmission()).toBeNull()
    expect(capture.isSubmitting).toBe(true)
    expect(capture.finishSubmission(timerSave!, false)).toBe(true)
    expect(capture.beginSubmission()).not.toBeNull()
  })

  it("does not submit again while the saved confirmation is visible", () => {
    const capture = new CaptureLifecycle()
    const save = capture.beginSubmission()!
    expect(capture.finishSubmission(save, true)).toBe(true)
    expect(capture.isSubmitting).toBe(false)
    expect(capture.beginSubmission()).toBeNull()
    capture.closeCapture()
    capture.openCapture()
    expect(capture.beginSubmission()).not.toBeNull()
  })

  it("retains a later draft when a previous opening finishes saving", async () => {
    const capture = new CaptureLifecycle()
    const submission = capture.beginSubmission()!
    let resolveSave!: () => void
    const savedReminder = new Promise<void>((resolve) => {
      resolveSave = resolve
    })
    let draft = "Original reminder"
    let savedCount = 0
    let closeCount = 0
    const completion = savedReminder.then(() => {
      savedCount += 1
      if (capture.finishSubmission(submission, true)) {
        draft = ""
        closeCount += 1
      }
    })

    capture.closeCapture()
    capture.openCapture()
    draft = "A different reminder"
    expect(capture.beginSubmission()).toBeNull()
    resolveSave()
    await completion

    expect(savedCount).toBe(1)
    expect(draft).toBe("A different reminder")
    expect(closeCount).toBe(0)
    expect(capture.beginSubmission()).not.toBeNull()
  })

  it("recognizes an unchanged draft after a hidden save succeeds", () => {
    const capture = new CaptureLifecycle()
    const submission = capture.beginSubmission()!
    capture.closeCapture()
    capture.openCapture()

    expect(capture.isSubmittedDraft(submission)).toBe(true)
    expect(capture.finishSubmission(submission, true)).toBe(false)
    expect(capture.beginSubmission()).not.toBeNull()
  })

  it("distinguishes edits made while a previous save is pending", () => {
    const capture = new CaptureLifecycle()
    const submission = capture.beginSubmission()!
    capture.closeCapture()
    capture.openCapture()
    capture.draftChanged()

    expect(capture.isSubmittedDraft(submission)).toBe(false)
    expect(capture.finishSubmission(submission, true)).toBe(false)
    expect(capture.beginSubmission()).not.toBeNull()
  })

  it("keeps an unchanged failed draft eligible for retry", () => {
    const capture = new CaptureLifecycle()
    const submission = capture.beginSubmission()!
    capture.closeCapture()
    capture.openCapture()

    expect(capture.finishSubmission(submission, false)).toBe(false)
    expect(capture.isSubmittedDraft(submission)).toBe(true)
    expect(capture.beginSubmission()).not.toBeNull()
  })

  it("invalidates confirmation callbacks on both close and reopen", () => {
    const capture = new CaptureLifecycle()
    const submission = capture.beginSubmission()!
    capture.finishSubmission(submission, true)
    expect(capture.isCurrent(submission.generation)).toBe(true)
    capture.closeCapture()
    expect(capture.isCurrent(submission.generation)).toBe(false)
    capture.openCapture()
    expect(capture.isCurrent(submission.generation)).toBe(false)
    expect(capture.isOpen).toBe(true)
  })

  it("does not let an old completion release a newer submission", () => {
    const capture = new CaptureLifecycle()
    const previous = capture.beginSubmission()!
    capture.finishSubmission(previous, false)
    const current = capture.beginSubmission()!
    expect(capture.finishSubmission(previous, true)).toBe(false)
    expect(capture.isSubmitting).toBe(true)
    expect(capture.beginSubmission()).toBeNull()
    expect(capture.finishSubmission(current, false)).toBe(true)
  })

  it("keeps a hidden save pending and releases it after failure", () => {
    const capture = new CaptureLifecycle()
    const submission = capture.beginSubmission()!
    capture.closeCapture()
    expect(capture.isSubmitting).toBe(true)
    expect(capture.beginSubmission()).toBeNull()
    expect(capture.finishSubmission(submission, false)).toBe(false)
    expect(capture.isSubmitting).toBe(false)
    expect(capture.beginSubmission()).toBeNull()
    capture.openCapture()
    expect(capture.beginSubmission()).not.toBeNull()
  })
})
