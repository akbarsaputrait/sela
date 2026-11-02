import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }))
vi.mock("@/lib/tauri", () => ({ isTauri: () => false, trackedInvoke: vi.fn() }))

const { EMPTY_SNAPSHOT, humanError, isSnapshot } =
  await import("./native-store")

describe("native state boundary", () => {
  it("accepts a shaped native snapshot", () => {
    expect(
      isSnapshot({
        revision: 4,
        documentRevision: 3,
        reminders: [
          {
            id: "a",
            title: "Call Sam",
            createdAt: 100,
            dueAt: null,
            status: "pending",
            resolvedAt: null,
            appleReminderId: null,
          },
        ],
        settings: {
          alertStyle: "notch",
          appearance: "system",
          colorTheme: "monochrome",
          onboardingCompleted: false,
          soundEnabled: true,
          soundChoice: "tone",
          customSoundId: null,
          defaultSnoozeMinutes: 5,
        },
        activeId: null,
        alertToken: 2,
        preview: false,
        storageError: null,
        shortcutError: null,
        deliveryError: null,
        appVersion: "0.1.0",
        launchAtLogin: false,
      })
    ).toBe(true)
  })
  it.each([5, 10, 15, 30])("accepts snooze duration %i", (minutes) => {
    expect(
      isSnapshot({
        ...EMPTY_SNAPSHOT,
        settings: { ...EMPTY_SNAPSHOT.settings, defaultSnoozeMinutes: minutes },
      })
    ).toBe(true)
  })
  it.each([0, 7, 60, "5", null])(
    "rejects invalid snooze duration %j",
    (minutes) => {
      expect(
        isSnapshot({
          ...EMPTY_SNAPSHOT,
          settings: {
            ...EMPTY_SNAPSHOT.settings,
            defaultSnoozeMinutes: minutes,
          },
        })
      ).toBe(false)
    }
  )
  it.each(["tone", "remove", "announce", "back", "custom"])(
    "accepts sound choice %s",
    (soundChoice) => {
      expect(
        isSnapshot({
          ...EMPTY_SNAPSHOT,
          settings: {
            ...EMPTY_SNAPSHOT.settings,
            soundChoice,
            customSoundId: soundChoice === "custom" ? "test-id" : null,
          },
        })
      ).toBe(true)
    }
  )
  it("rejects an unknown sound choice", () => {
    expect(
      isSnapshot({
        ...EMPTY_SNAPSHOT,
        settings: { ...EMPTY_SNAPSHOT.settings, soundChoice: "unknown" },
      })
    ).toBe(false)
  })
  it("rejects a missing sound setting", () => {
    expect(
      isSnapshot({
        ...EMPTY_SNAPSHOT,
        settings: { ...EMPTY_SNAPSHOT.settings, soundEnabled: undefined },
      })
    ).toBe(false)
  })
  it.each([
    null,
    {},
    {
      revision: -1,
      documentRevision: 0,
      reminders: [],
      settings: {},
      alertToken: 0,
      appVersion: "0",
    },
  ])("rejects malformed snapshots", (snapshot) =>
    expect(isSnapshot(snapshot)).toBe(false)
  )
})

describe("human-facing errors", () => {
  it.each([
    "Command plugin:window|hide not allowed by ACL",
    "invalid args for command change_reminder",
    new Error("undefined is not a function"),
    "No such file or directory (os error 2)",
    { code: "EIO" },
  ])("hides technical message %j", (value) =>
    expect(humanError(value)).toBe("Something went wrong. Please try again.")
  )
  it.each([
    "Choose a timer between 1 second and 30 days.",
    "That reminder just changed. Here’s the latest.",
    "⌘⇧Space is used by another app. Use the Sela menu-bar icon for now.",
  ])("preserves clear text %j", (value) =>
    expect(humanError(value)).toBe(value)
  )
})
