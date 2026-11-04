import { listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
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
  suppressedReminderIds: string[]
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

export type DashboardTab = "activities" | "settings" | "about"

export type NativeStoreState = {
  snapshot: NativeSnapshot
  initialized: boolean
  requestedDashboardTab: DashboardTab | null
  loading: boolean
  error: string | null
}

const EMPTY_SNAPSHOT: NativeSnapshot = {
  revision: 0,
  documentRevision: 0,
  reminders: [],
  suppressedReminderIds: [],
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
  appVersion: "1.1.0",
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
function isReminderSchedule(value: unknown): value is ReminderSchedule {
  if (!value || typeof value !== "object") return false
  const schedule = value as Partial<ReminderSchedule>
  return (
    ["once", "daily", "weekdays", "dates"].includes(String(schedule.kind)) &&
    typeof schedule.date === "string" &&
    typeof schedule.time === "string" &&
    typeof schedule.timeZone === "string" &&
    (schedule.endDate === null || typeof schedule.endDate === "string") &&
    Array.isArray(schedule.weekdays) &&
    schedule.weekdays.every(
      (day) => Number.isInteger(day) && day >= 0 && day <= 6
    ) &&
    Array.isArray(schedule.dates) &&
    schedule.dates.every((date) => typeof date === "string")
  )
}

export function isSnapshot(value: unknown): value is NativeSnapshot {
  if (!value || typeof value !== "object") return false
  const snapshot = value as Partial<NativeSnapshot>
  const settings = snapshot.settings as Partial<Settings> | null | undefined
  return (
    Number.isSafeInteger(snapshot.revision) &&
    Number.isSafeInteger(snapshot.documentRevision) &&
    Array.isArray(snapshot.reminders) &&
    Array.isArray(snapshot.suppressedReminderIds) &&
    snapshot.suppressedReminderIds.every((id) => typeof id === "string") &&
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
        ["pending", "completed", "cancelled"].includes(reminder.status) &&
        (reminder.schedule == null || isReminderSchedule(reminder.schedule)) &&
        (reminder.snoozedUntil == null ||
          Number.isSafeInteger(reminder.snoozedUntil)) &&
        (reminder.occurrenceRevision === undefined ||
          (Number.isSafeInteger(reminder.occurrenceRevision) &&
            reminder.occurrenceRevision >= 0)) &&
        (reminder.occurrenceHistory === undefined ||
          (Array.isArray(reminder.occurrenceHistory) &&
            reminder.occurrenceHistory.every(Number.isSafeInteger)))
      )
    })
  )
}

export class NativeStore {
  private state: NativeStoreState = {
    snapshot: isTauri()
      ? EMPTY_SNAPSHOT
      : {
          ...EMPTY_SNAPSHOT,
          settings: { ...EMPTY_SNAPSHOT.settings, onboardingCompleted: true },
        },
    initialized: !isTauri(),
    requestedDashboardTab: null,
    loading: isTauri(),
    error: null,
  }
  private listeners = new Set<() => void>()
  private started: Promise<void> | null = null
  private stateSubscription: Promise<void> | null = null
  private dashboardSubscription: Promise<void> | null = null
  private dashboardDrain = Promise.resolve()
  private connected = false
  private requestSequence = 0

  getSnapshot = () => this.state

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    void this.start()
    return () => this.listeners.delete(listener)
  }

  start() {
    if (!isTauri() || (this.connected && this.state.initialized)) {
      return Promise.resolve()
    }
    if (!this.started) {
      this.started = this.refresh().finally(() => {
        this.started = null
      })
    }
    return this.started
  }

  private async connect() {
    const label = getCurrentWebviewWindow().label
    if (!this.stateSubscription) {
      this.stateSubscription = listen<NativeSnapshot>(
        "sela://state",
        (event) => this.accept(event.payload),
        { target: label }
      )
        .then(() => undefined)
        .catch((error: unknown) => {
          this.stateSubscription = null
          throw error
        })
    }
    await this.stateSubscription
    if (label === "main") {
      if (!this.dashboardSubscription) {
        this.dashboardSubscription = listen(
          "sela://dashboard-tab",
          () => {
            void this.drainDashboardTab().catch((error: unknown) =>
              this.reportError(error)
            )
          },
          { target: label }
        )
          .then(() => undefined)
          .catch((error: unknown) => {
            this.dashboardSubscription = null
            throw error
          })
      }
      await this.dashboardSubscription
      await this.drainDashboardTab()
    }
    this.connected = true
  }

  private drainDashboardTab() {
    const drain = this.dashboardDrain
      .catch(() => undefined)
      .then(async () => {
        const tab = await trackedInvoke<DashboardTab | null>(
          "take_requested_dashboard_tab"
        )
        if (tab === "activities" || tab === "settings" || tab === "about") {
          this.setState({ ...this.state, requestedDashboardTab: tab })
        }
      })
    this.dashboardDrain = drain
    return drain
  }

  clearRequestedDashboardTab = (tab: DashboardTab) => {
    if (this.state.requestedDashboardTab === tab) {
      this.setState({ ...this.state, requestedDashboardTab: null })
    }
  }

  async refresh() {
    if (!isTauri()) return
    const request = ++this.requestSequence
    if (!this.state.initialized) {
      this.setState({ ...this.state, loading: true, error: null })
    }
    try {
      await this.connect()
    } catch (error) {
      if (request === this.requestSequence) this.reportError(error)
      return
    }
    const previousSnapshot = this.state.snapshot
    try {
      const snapshot = await trackedInvoke<NativeSnapshot>("get_snapshot")
      if (request === this.requestSequence) this.accept(snapshot)
    } catch (error) {
      if (
        request === this.requestSequence &&
        this.state.snapshot === previousSnapshot
      ) {
        this.reportError(error)
      }
    }
  }

  private reportError(error: unknown) {
    this.setState({ ...this.state, loading: false, error: humanError(error) })
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
    if (this.state.initialized && value.revision < this.state.snapshot.revision)
      return
    this.setState({
      ...this.state,
      snapshot: value,
      initialized: true,
      loading: false,
      error: null,
    })
  }

  private setState(state: NativeStoreState) {
    this.state = state
    this.listeners.forEach((listener) => listener())
  }
}

export const nativeStore = new NativeStore()
export { EMPTY_SNAPSHOT, humanError }
