import { listen } from "@tauri-apps/api/event"
import type { InvokeArgs } from "@tauri-apps/api/core"

import { isTauri, trackedInvoke } from "@/lib/tauri"
import type { ReminderSchedule } from "@/features/reminders/schedule"

export type ReminderStatus = "pending" | "completed" | "cancelled"
export type AlertStyle = "fullscreen" | "notch" | "native"
export type Appearance = "system" | "light" | "dark"
export type ColorTheme = "monochrome" | "vermilion" | "cobalt" | "brass"
export type SnoozeMinutes = 5 | 10 | 15 | 30
export type SoundChoice = "tone" | "remove" | "announce" | "back" | "custom"

export type Reminder = {
  id: string
  title: string
  createdAt: number
  dueAt: number | null
  status: ReminderStatus
  resolvedAt: number | null
  appleReminderId: string | null
  schedule?: ReminderSchedule | null
  snoozedUntil?: number | null
  occurrenceRevision?: number
  occurrenceHistory?: number[]
}

export type Settings = {
  alertStyle: AlertStyle
  appearance: Appearance
  colorTheme: ColorTheme
  onboardingCompleted: boolean
  soundEnabled: boolean
  soundChoice: SoundChoice
  customSoundId: string | null
  defaultSnoozeMinutes: SnoozeMinutes
}

export type NativeSnapshot = {
  revision: number
  documentRevision: number
  reminders: Reminder[]
  settings: Settings
  activeId: string | null
  alertToken: number
  preview: boolean
  storageError: string | null
  shortcutError: string | null
  deliveryError: string | null
  appVersion: string
  launchAtLogin: boolean
}

export type NativeStoreState = {
  snapshot: NativeSnapshot
  loading: boolean
  error: string | null
}

const EMPTY_SNAPSHOT: NativeSnapshot = {
  revision: 0,
  documentRevision: 0,
  reminders: [],
  settings: {
    alertStyle: "fullscreen",
    appearance: "system",
    colorTheme: "monochrome",
    onboardingCompleted: false,
    soundEnabled: true,
    soundChoice: "tone",
    customSoundId: null,
    defaultSnoozeMinutes: 5,
  },
  activeId: null,
  alertToken: 0,
  preview: false,
  storageError: null,
  shortcutError: null,
  deliveryError: null,
  appVersion: "1.0.0",
  launchAtLogin: false,
}

function humanError(error: unknown) {
  const text =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : ""
  const sentence = /^[A-Z⌘◷][^{}<>|]*[.!?]$/.test(text.trim())
  const technical = /\b(ACL|plugin|invoke|IPC|undefined|null|os error)\b/i.test(
    text
  )
  if (!sentence || technical) {
    console.error("[sela]", error)
    return "Something went wrong. Please try again."
  }
  return text.trim()
}

export function isSnapshot(value: unknown): value is NativeSnapshot {
  if (!value || typeof value !== "object") return false
  const snapshot = value as Partial<NativeSnapshot>
  const settings = snapshot.settings as Partial<Settings> | null | undefined
  return (
    Number.isSafeInteger(snapshot.revision) &&
    Number.isSafeInteger(snapshot.documentRevision) &&
    Array.isArray(snapshot.reminders) &&
    settings !== null &&
    typeof settings === "object" &&
    ["fullscreen", "notch", "native"].includes(String(settings.alertStyle)) &&
    ["system", "light", "dark"].includes(String(settings.appearance)) &&
    ["monochrome", "vermilion", "cobalt", "brass"].includes(
      String(settings.colorTheme)
    ) &&
    typeof settings.onboardingCompleted === "boolean" &&
    typeof settings.soundEnabled === "boolean" &&
    ["tone", "remove", "announce", "back", "custom"].includes(
      String(settings.soundChoice)
    ) &&
    (settings.customSoundId === null ||
      typeof settings.customSoundId === "string") &&
    (settings.soundChoice !== "custom" ||
      typeof settings.customSoundId === "string") &&
    [5, 10, 15, 30].some(
      (minutes) => minutes === settings.defaultSnoozeMinutes
    ) &&
    Number.isSafeInteger(snapshot.alertToken) &&
    typeof snapshot.appVersion === "string" &&
    typeof snapshot.launchAtLogin === "boolean" &&
    (snapshot.activeId === null || typeof snapshot.activeId === "string") &&
    typeof snapshot.preview === "boolean" &&
    [
      snapshot.storageError,
      snapshot.shortcutError,
      snapshot.deliveryError,
    ].every((value) => value === null || typeof value === "string") &&
    snapshot.reminders.every((reminder) => {
      if (!reminder || typeof reminder !== "object") return false
      return (
        typeof reminder.id === "string" &&
        typeof reminder.title === "string" &&
        Number.isSafeInteger(reminder.createdAt) &&
        (reminder.dueAt === null || Number.isSafeInteger(reminder.dueAt)) &&
        (reminder.resolvedAt === null ||
          Number.isSafeInteger(reminder.resolvedAt)) &&
        (reminder.appleReminderId === null ||
          typeof reminder.appleReminderId === "string") &&
        ["pending", "completed", "cancelled"].includes(reminder.status)
      )
    })
  )
}

class NativeStore {
  private state: NativeStoreState = {
    snapshot: isTauri()
      ? EMPTY_SNAPSHOT
      : {
          ...EMPTY_SNAPSHOT,
          settings: { ...EMPTY_SNAPSHOT.settings, onboardingCompleted: true },
        },
    loading: isTauri(),
    error: null,
  }
  private listeners = new Set<() => void>()
  private started: Promise<void> | null = null
  private requestSequence = 0

  getSnapshot = () => this.state

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    void this.start()
    return () => this.listeners.delete(listener)
  }

  async start() {
    if (!isTauri() || this.started) return this.started ?? Promise.resolve()
    this.started = (async () => {
      await listen<NativeSnapshot>("sela://state", (event) =>
        this.accept(event.payload)
      )
      await this.refresh()
    })().catch((error: unknown) => {
      this.setState({ ...this.state, loading: false, error: humanError(error) })
    })
    return this.started
  }

  async refresh() {
    if (!isTauri()) return
    const request = ++this.requestSequence
    try {
      const snapshot = await trackedInvoke<NativeSnapshot>("get_snapshot")
      if (request === this.requestSequence) this.accept(snapshot)
    } catch (error) {
      if (request === this.requestSequence) {
        this.setState({
          ...this.state,
          loading: false,
          error: humanError(error),
        })
      }
    }
  }

  async command<T = void>(command: string, args?: InvokeArgs) {
    if (!isTauri())
      throw new Error("This action is available in the desktop app.")
    try {
      return await trackedInvoke<T>(command, args)
    } catch (error) {
      const message = humanError(error)
      this.setState({ ...this.state, error: message })
      throw new Error(message, { cause: error })
    }
  }

  clearError() {
    if (this.state.error) this.setState({ ...this.state, error: null })
  }

  private accept(value: unknown) {
    if (!isSnapshot(value)) {
      this.setState({
        ...this.state,
        loading: false,
        error: "Sela received an unexpected response. Please reopen the app.",
      })
      return
    }
    if (value.revision < this.state.snapshot.revision) return
    this.setState({ snapshot: value, loading: false, error: null })
  }

  private setState(state: NativeStoreState) {
    this.state = state
    this.listeners.forEach((listener) => listener())
  }
}

export const nativeStore = new NativeStore()
export { EMPTY_SNAPSHOT, humanError }
