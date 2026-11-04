import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  EMPTY_SNAPSHOT,
  humanError,
  isSnapshot,
  NativeStore,
} from "./native-store"
import type { NativeSnapshot } from "./native-store"

const bridge = vi.hoisted(() => ({
  desktop: false,
  label: "main",
  listen: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock("@tauri-apps/api/event", () => ({ listen: bridge.listen }))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: bridge.label }),
}))
vi.mock("@/lib/tauri", () => ({
  isTauri: () => bridge.desktop,
  trackedInvoke: bridge.invoke,
}))

beforeEach(() => {
  bridge.desktop = false
  bridge.label = "main"
  bridge.listen.mockReset()
  bridge.invoke.mockReset()
})

function deferred<T>() {
  // Keep deferred test barriers compatible with the app's ES2023 target.
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function snapshot(
  revision: number,
  onboardingCompleted = true
): NativeSnapshot {
  return {
    ...EMPTY_SNAPSHOT,
    revision,
    settings: { ...EMPTY_SNAPSHOT.settings, onboardingCompleted },
  }
}

function desktopStore() {
  bridge.desktop = true
  const listeners = new Map<string, (event: { payload: unknown }) => void>()
  const getSnapshot = vi.fn().mockResolvedValue(snapshot(1))
  const takeTab = vi.fn().mockResolvedValue(null)
  bridge.listen.mockImplementation(
    async (name: string, listener: (event: { payload: unknown }) => void) => {
      listeners.set(name, listener)
      return vi.fn()
    }
  )
  bridge.invoke.mockImplementation((command: string) => {
    if (command === "get_snapshot") return getSnapshot()
    if (command === "take_requested_dashboard_tab") return takeTab()
    throw new Error(`Unexpected command: ${command}`)
  })
  return {
    store: new NativeStore(),
    getSnapshot,
    takeTab,
    emit(name: string, payload: unknown) {
      const listener = listeners.get(name)
      if (!listener) throw new Error(`Missing listener: ${name}`)
      listener({ payload })
    },
  }
}

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
        suppressedReminderIds: [],
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
  it("rejects malformed occurrence and schedule fields before rendering", () => {
    const reminder = {
      id: "a",
      title: "Reminder",
      createdAt: 100,
      dueAt: 200,
      status: "pending",
      resolvedAt: null,
      appleReminderId: null,
    }
    const schedule = {
      kind: "daily",
      date: "2030-01-01",
      time: "09:00",
      timeZone: "UTC",
      weekdays: [],
      dates: [],
      endDate: null,
    }
    const withReminder = (fields: object) => ({
      ...EMPTY_SNAPSHOT,
      reminders: [{ ...reminder, ...fields }],
    })
    expect(
      isSnapshot(
        withReminder({
          schedule,
          occurrenceRevision: 1,
          occurrenceHistory: [200],
        })
      )
    ).toBe(true)
    expect(
      isSnapshot(withReminder({ schedule: { ...schedule, dates: null } }))
    ).toBe(false)
    expect(
      isSnapshot(withReminder({ schedule: { ...schedule, weekdays: [7] } }))
    ).toBe(false)
    expect(isSnapshot(withReminder({ occurrenceRevision: -1 }))).toBe(false)
    expect(isSnapshot(withReminder({ occurrenceHistory: [null] }))).toBe(false)
    expect(isSnapshot(withReminder({ snoozedUntil: "tomorrow" }))).toBe(false)
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

describe("native startup and recovery", () => {
  it("keeps failed startup uninitialized, then recognizes a genuine first run", async () => {
    const { store, getSnapshot, emit } = desktopStore()
    getSnapshot.mockRejectedValueOnce("Your reminders could not be opened.")
    expect(store.getSnapshot()).toMatchObject({
      initialized: false,
      loading: true,
      error: null,
    })

    await store.start()
    expect(store.getSnapshot()).toMatchObject({
      initialized: false,
      loading: false,
      error: "Your reminders could not be opened.",
    })

    const retriedSnapshot = deferred<NativeSnapshot>()
    getSnapshot.mockReturnValueOnce(retriedSnapshot.promise)
    const retry = store.refresh()
    expect(store.getSnapshot()).toMatchObject({
      initialized: false,
      loading: true,
      error: null,
    })
    retriedSnapshot.resolve(snapshot(2, false))
    await retry
    expect(store.getSnapshot()).toMatchObject({
      initialized: true,
      loading: false,
      error: null,
      snapshot: { revision: 2, settings: { onboardingCompleted: false } },
    })

    emit("sela://state", snapshot(3))
    expect(store.getSnapshot().snapshot.settings.onboardingCompleted).toBe(true)
    expect(store.getSnapshot().snapshot.revision).toBe(3)
  })

  it("resets failed listener startup so start can reconnect and receive updates", async () => {
    const { store, getSnapshot, emit } = desktopStore()
    bridge.listen.mockRejectedValueOnce(
      "Sela could not connect. Please try again."
    )
    await store.start()
    expect(store.getSnapshot()).toMatchObject({
      initialized: false,
      loading: false,
      error: "Sela could not connect. Please try again.",
    })
    expect(getSnapshot).not.toHaveBeenCalled()

    await store.start()
    emit("sela://state", snapshot(4))
    expect(store.getSnapshot()).toMatchObject({
      initialized: true,
      error: null,
      snapshot: { revision: 4 },
    })
  })

  it("retries a missing navigation subscription without duplicating the state listener", async () => {
    const { store, emit } = desktopStore()
    const register = bridge.listen.getMockImplementation()!
    let failed = false
    bridge.listen.mockImplementation((name: string, ...args: unknown[]) => {
      if (name === "sela://dashboard-tab" && !failed) {
        failed = true
        return Promise.reject("Sela could not connect. Please try again.")
      }
      return register(name, ...args)
    })
    await store.start()
    expect(store.getSnapshot().initialized).toBe(false)
    await store.refresh()
    emit("sela://state", snapshot(5))
    expect(store.getSnapshot().snapshot.revision).toBe(5)
    expect(store.getSnapshot().error).toBeNull()
    expect(
      bridge.listen.mock.calls.filter(([name]) => name === "sela://state")
    ).toHaveLength(1)
    expect(
      bridge.listen.mock.calls.filter(
        ([name]) => name === "sela://dashboard-tab"
      )
    ).toHaveLength(2)
    expect(
      bridge.listen.mock.calls.every(
        ([, , options]) => options.target === "main"
      )
    ).toBe(true)
  })

  it("shares in-flight listener registration across startup and refresh", async () => {
    const { store, emit } = desktopStore()
    const registered = deferred<() => void>()
    const register = bridge.listen.getMockImplementation()!
    bridge.listen.mockImplementation((name: string, ...args: unknown[]) => {
      const result = register(name, ...args)
      return name === "sela://state" ? registered.promise : result
    })
    const startup = store.start()
    const refresh = store.refresh()
    registered.resolve(vi.fn())
    await Promise.all([startup, refresh])
    emit("sela://state", snapshot(6))
    expect(store.getSnapshot()).toMatchObject({
      initialized: true,
      loading: false,
      snapshot: { revision: 6 },
    })
    expect(
      bridge.listen.mock.calls.filter(([name]) => name === "sela://state")
    ).toHaveLength(1)
    expect(
      bridge.listen.mock.calls.filter(
        ([name]) => name === "sela://dashboard-tab"
      )
    ).toHaveLength(1)
  })

  it("does not replace a newer event with an older refresh result", async () => {
    const { store, getSnapshot, emit } = desktopStore()
    await store.start()
    const response = deferred<NativeSnapshot>()
    const requested = deferred<void>()
    getSnapshot.mockImplementationOnce(() => {
      requested.resolve()
      return response.promise
    })
    const refresh = store.refresh()
    await requested.promise
    emit("sela://state", snapshot(8))
    response.resolve(snapshot(7, false))
    await refresh
    expect(store.getSnapshot()).toMatchObject({
      initialized: true,
      error: null,
      snapshot: { revision: 8, settings: { onboardingCompleted: true } },
    })
  })

  it("does not report a stale refresh failure after a successful live update", async () => {
    const { store, getSnapshot, emit } = desktopStore()
    await store.start()
    const response = deferred<NativeSnapshot>()
    const requested = deferred<void>()
    getSnapshot.mockImplementationOnce(() => {
      requested.resolve()
      return response.promise
    })
    const refresh = store.refresh()
    await requested.promise
    emit("sela://state", snapshot(9))
    response.reject("Your reminders could not be opened.")
    await refresh
    expect(store.getSnapshot()).toMatchObject({
      initialized: true,
      loading: false,
      error: null,
      snapshot: { revision: 9 },
    })
  })

  it("rejects malformed first responses without inventing a first-run state", async () => {
    const { store, getSnapshot, emit } = desktopStore()
    getSnapshot.mockResolvedValueOnce({
      settings: { onboardingCompleted: false },
    })
    await store.start()
    expect(store.getSnapshot()).toMatchObject({
      initialized: false,
      loading: false,
      error: "Sela received an unexpected response. Please reopen the app.",
    })
    emit("sela://state", snapshot(2, false))
    expect(store.getSnapshot()).toMatchObject({
      initialized: true,
      error: null,
      snapshot: { settings: { onboardingCompleted: false } },
    })
  })

  it("preserves pending tray navigation through startup failure and onboarding", async () => {
    const { store, getSnapshot, takeTab, emit } = desktopStore()
    takeTab.mockResolvedValueOnce("settings")
    getSnapshot.mockRejectedValueOnce("Your reminders could not be opened.")
    await store.start()
    expect(store.getSnapshot()).toMatchObject({
      initialized: false,
      requestedDashboardTab: "settings",
    })
    getSnapshot.mockResolvedValueOnce(snapshot(2, false))
    await store.refresh()
    expect(store.getSnapshot()).toMatchObject({
      initialized: true,
      requestedDashboardTab: "settings",
      snapshot: { settings: { onboardingCompleted: false } },
    })
    emit("sela://state", snapshot(3))
    expect(store.getSnapshot().requestedDashboardTab).toBe("settings")
    store.clearRequestedDashboardTab("settings")
    expect(store.getSnapshot().requestedDashboardTab).toBeNull()

    takeTab.mockResolvedValueOnce("about")
    emit("sela://dashboard-tab", "settings")
    await store.refresh()
    expect(store.getSnapshot().requestedDashboardTab).toBe("about")
    store.clearRequestedDashboardTab("settings")
    expect(store.getSnapshot().requestedDashboardTab).toBe("about")
    store.clearRequestedDashboardTab("about")
    expect(store.getSnapshot().requestedDashboardTab).toBeNull()
  })

  it("serializes navigation drains so a delayed response cannot overwrite a later request", async () => {
    const { store, takeTab, emit } = desktopStore()
    const firstTab = deferred<string | null>()
    const requested = deferred<void>()
    takeTab.mockImplementationOnce(() => {
      requested.resolve()
      return firstTab.promise
    })
    const startup = store.start()
    await requested.promise
    takeTab.mockResolvedValueOnce("about")
    emit("sela://dashboard-tab", "ignored")
    expect(takeTab).toHaveBeenCalledTimes(1)
    firstTab.resolve("settings")
    await startup
    await store.refresh()
    expect(store.getSnapshot().requestedDashboardTab).toBe("about")
    expect(store.getSnapshot().initialized).toBe(true)
  })

  it.each(["capture", "alert"])(
    "keeps %s state events window-targeted without consuming main-window navigation",
    async (label) => {
      const { store, takeTab, emit } = desktopStore()
      bridge.label = label
      await store.start()
      emit("sela://state", snapshot(3))
      expect(store.getSnapshot().snapshot.revision).toBe(3)
      expect(takeTab).not.toHaveBeenCalled()
      expect(bridge.listen).toHaveBeenCalledTimes(1)
      expect(bridge.listen.mock.calls[0]?.[2]).toEqual({ target: label })
    }
  )

  it("keeps browser preview initialized and read-only without native subscriptions", async () => {
    const store = new NativeStore()
    await store.start()
    await store.refresh()
    expect(store.getSnapshot()).toMatchObject({
      initialized: true,
      loading: false,
      error: null,
      snapshot: { settings: { onboardingCompleted: true } },
    })
    await expect(store.command("complete_onboarding")).rejects.toThrow(
      "This action is available in the desktop app."
    )
    expect(bridge.listen).not.toHaveBeenCalled()
    expect(bridge.invoke).not.toHaveBeenCalled()
  })
})
