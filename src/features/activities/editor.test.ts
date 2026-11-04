import { describe, expect, it } from "vitest"

import type { Reminder } from "@/app/native-store"
import { reminderEditConflict } from "./editor"

const opened: Reminder = {
  id: "reminder-a",
  title: "Keep my draft",
  createdAt: 10,
  dueAt: 100,
  status: "pending",
  resolvedAt: null,
  appleReminderId: null,
  occurrenceRevision: 2,
}

describe("reminder editor conflict boundary", () => {
  it("does not block an unchanged snapshot or unrelated reminder changes", () => {
    expect(reminderEditConflict(opened, { ...opened })).toBeNull()
  })

  it("blocks the old draft when an occurrence advances or timing changes", () => {
    expect(
      reminderEditConflict(opened, {
        ...opened,
        occurrenceRevision: 3,
        dueAt: 200,
        occurrenceHistory: [100],
      })
    ).toBe("changed")
    expect(
      reminderEditConflict(opened, {
        ...opened,
        occurrenceRevision: 3,
        snoozedUntil: 300,
      })
    ).toBe("changed")
  })

  it("blocks removed or completed reminders even if the revision is unchanged", () => {
    expect(
      reminderEditConflict(opened, {
        ...opened,
        status: "completed",
        resolvedAt: 120,
      })
    ).toBe("resolved")
    expect(
      reminderEditConflict(opened, {
        ...opened,
        status: "cancelled",
        resolvedAt: 120,
      })
    ).toBe("resolved")
    expect(reminderEditConflict(opened, undefined)).toBe("missing")
    expect(reminderEditConflict(opened, { ...opened, id: "reminder-b" })).toBe(
      "missing"
    )
  })

  it("accepts an explicitly adopted baseline but blocks another subsequent revision", () => {
    const latest = {
      ...opened,
      title: "Changed elsewhere",
      occurrenceRevision: 3,
    }
    expect(reminderEditConflict(opened, latest)).toBe("changed")
    expect(reminderEditConflict(latest, latest)).toBeNull()
    expect(
      reminderEditConflict(latest, { ...latest, occurrenceRevision: 4 })
    ).toBe("changed")
  })

  it("treats absent legacy revisions as zero but detects title conflicts", () => {
    const legacy = { ...opened, occurrenceRevision: undefined }
    expect(
      reminderEditConflict(legacy, { ...legacy, occurrenceRevision: 0 })
    ).toBeNull()
    expect(
      reminderEditConflict(legacy, { ...legacy, title: "New title" })
    ).toBe("changed")
  })
})
