import * as React from "react"
import { listen } from "@tauri-apps/api/event"

import { isTauri } from "@/lib/tauri"
import type { NativeCommand } from "@/app/use-native-state"
import { useCurrentTime } from "@/app/clock"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseDuration } from "@/features/reminders/model"
import { ScheduleForm } from "@/features/reminders/schedule-form"
import { toReminderSchedule } from "@/features/reminders/schedule"
import { CaptureLifecycle } from "./capture-lifecycle"

const PRESETS = ["5m", "15m", "30m"] as const

function durationLabel(durationMs: number) {
  const seconds = durationMs / 1_000
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainingSeconds = seconds % 60
  return [
    hours && `${hours}h`,
    minutes && `${minutes}m`,
    remainingSeconds && `${remainingSeconds}s`,
  ]
    .filter(Boolean)
    .join(" ")
}

export function QuickAdd({ command }: { command: NativeCommand }) {
  const now = useCurrentTime()
  const [title, setTitle] = React.useState("")
  const [preset, setPreset] = React.useState<string | null>(null)
  const [custom, setCustom] = React.useState<string | null>(null)
  const [scheduled, setScheduled] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState<string | null>(null)
  const [previousSaved, setPreviousSaved] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [opening, setOpening] = React.useState(0)
  const lifecycle = React.useRef(new CaptureLifecycle())
  const inputRef = React.useRef<HTMLInputElement>(null)
  const customRef = React.useRef<HTMLInputElement>(null)
  const savedNoticeTimer = React.useRef<number | null>(null)
  const deferredError = React.useRef<string | null>(null)

  const clearSavedNotice = React.useCallback(() => {
    if (savedNoticeTimer.current === null) return
    window.clearTimeout(savedNoticeTimer.current)
    savedNoticeTimer.current = null
  }, [])

  const close = React.useCallback(() => {
    if (!isTauri() || !lifecycle.current.isOpen) return
    clearSavedNotice()
    lifecycle.current.closeCapture()
    const generation = lifecycle.current.currentGeneration
    void command("hide_capture").catch((failure: Error) => {
      if (lifecycle.current.currentGeneration !== generation) return
      lifecycle.current.openCapture()
      setSaving(false)
      setSaved(null)
      setError(failure.message)
    })
  }, [clearSavedNotice, command])

  React.useEffect(() => {
    if (!isTauri()) return
    const captureLifecycle = lifecycle.current
    let disposed = false
    let unlisten: Array<() => void> = []
    const setup = async () => {
      const subscriptions = await Promise.allSettled([
        listen("sela://capture-open", () => {
          clearSavedNotice()
          lifecycle.current.openCapture()
          setOpening(lifecycle.current.currentGeneration)
          setSaving(false)
          setError(deferredError.current)
          deferredError.current = null
          setSaved(null)
          const generation = lifecycle.current.currentGeneration
          requestAnimationFrame(() => {
            if (lifecycle.current.isCurrent(generation))
              inputRef.current?.focus()
          })
        }),
        listen("sela://capture-close", close),
      ])
      const registered = subscriptions.flatMap((subscription) =>
        subscription.status === "fulfilled" ? [subscription.value] : []
      )
      const failed = subscriptions.find(
        (subscription) => subscription.status === "rejected"
      )
      if (disposed || failed) {
        registered.forEach((unsubscribe) => unsubscribe())
        if (!disposed && failed?.status === "rejected") {
          setError(
            failed.reason instanceof Error
              ? failed.reason.message
              : "Could not connect Quick Add. Please reopen the app."
          )
        }
        return
      }
      unlisten = registered
      await command("mark_window_ready").catch((failure: Error) =>
        setError(failure.message)
      )
    }
    void setup()
    return () => {
      disposed = true
      clearSavedNotice()
      captureLifecycle.closeCapture()
      unlisten.forEach((unsubscribe) => unsubscribe())
    }
  }, [clearSavedNotice, close, command])

  React.useEffect(() => {
    if (custom !== null) customRef.current?.focus()
  }, [custom])

  React.useEffect(() => {
    if (!isTauri()) return
    let active = true
    void command("resize_capture", { scheduled }).catch((failure: unknown) => {
      if (!active) return
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not resize Quick Add."
      )
    })
    return () => {
      active = false
    }
  }, [command, opening, scheduled])

  const choosePreset = (value: string) => {
    if (saving || saved) return
    lifecycle.current.draftChanged()
    setScheduled(false)
    setCustom(null)
    setError(null)
    setPreset((current) => (current === value ? null : value))
    inputRef.current?.focus()
  }

  const saveReminder = async (
    create: () => Promise<void>,
    confirmation: string
  ) => {
    const submission = lifecycle.current.beginSubmission()
    if (submission === null) return
    setPending(true)
    setSaving(true)
    setPreviousSaved(null)
    setError(null)
    let succeeded = false
    try {
      await create()
      succeeded = true
      const current = lifecycle.current.isCurrent(submission.generation)
      if (lifecycle.current.isSubmittedDraft(submission)) {
        setTitle("")
        setPreset(null)
        setCustom(null)
        setScheduled(false)
      }
      if (!current) {
        setPreviousSaved(`Previous reminder: ${confirmation}`)
        return
      }
      setSaved(confirmation)
      setError(null)
      deferredError.current = null
      clearSavedNotice()
      savedNoticeTimer.current = window.setTimeout(() => {
        savedNoticeTimer.current = null
        if (!lifecycle.current.isCurrent(submission.generation)) return
        setSaved(null)
        close()
      }, 4000)
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : "Could not save reminder."
      if (lifecycle.current.isCurrent(submission.generation)) {
        setError(message)
      } else {
        const previousFailure = `The previous reminder was not saved: ${message}`
        deferredError.current = previousFailure
        if (lifecycle.current.isOpen) setError(previousFailure)
      }
    } finally {
      const current = lifecycle.current.finishSubmission(submission, succeeded)
      setPending(false)
      if (current) setSaving(false)
    }
  }

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault()
    if (saved || lifecycle.current.isSubmitting) return
    let durationMs: number | null
    try {
      durationMs = parseDuration(custom ?? preset ?? "")
    } catch (failure) {
      setError((failure as Error).message)
      return
    }
    if (!title.trim() && durationMs === null) {
      setError("Type something to remember, or pick a timer.")
      return
    }
    await saveReminder(
      () => command("create_reminder", { title, durationMs }),
      durationMs !== null
        ? `Saved · back in ${durationLabel(durationMs)}`
        : "Saved to your list · no alert"
    )
  }

  let durationPreview: string | null = null
  if (!scheduled && !saved) {
    try {
      const duration = parseDuration(custom ?? preset ?? "")
      if (duration !== null) {
        durationPreview = `Approximately ${new Date(now + duration).toLocaleString()}`
      }
    } catch {
      // Validation is shown when the user saves.
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (saving && (event.key === "Escape" || event.metaKey)) {
      event.preventDefault()
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      if (scheduled) {
        lifecycle.current.draftChanged()
        setScheduled(false)
        inputRef.current?.focus()
      } else if (custom !== null) {
        lifecycle.current.draftChanged()
        setCustom(null)
        inputRef.current?.focus()
      } else close()
      return
    }
    if (!event.metaKey) return
    const index = ["1", "2", "3"].indexOf(event.key)
    if (index >= 0) {
      event.preventDefault()
      choosePreset(PRESETS[index])
    } else if (event.key.toLowerCase() === "t") {
      event.preventDefault()
      lifecycle.current.draftChanged()
      setScheduled(false)
      setPreset(null)
      setCustom("")
    } else if (event.key.toLowerCase() === "l") {
      event.preventDefault()
      void command("show_dashboard").catch((failure: Error) =>
        setError(failure.message)
      )
    }
  }

  return (
    <main
      className="h-svh overflow-y-auto bg-transparent px-3"
      onKeyDown={handleKeyDown}
      onChangeCapture={() => lifecycle.current.draftChanged()}
    >
      <form
        className="flex min-h-14 items-center gap-2 rounded-b-2xl border border-t-0 bg-background px-3 shadow-lg max-[559px]:flex-wrap max-[559px]:py-2"
        onSubmit={(event) => {
          if (scheduled) event.preventDefault()
          else void submit(event)
        }}
      >
        {saved ? (
          <p className="flex-1 text-center text-sm font-medium" role="status">
            ✓ {saved}
          </p>
        ) : (
          <>
            <Input
              aria-label="What do you want to remember?"
              autoComplete="off"
              className="h-10 min-w-0 flex-1 border-0 bg-transparent px-1 text-base shadow-none focus-visible:ring-0 max-[559px]:basis-full"
              disabled={saving}
              maxLength={240}
              placeholder="Remind me to…"
              ref={inputRef}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                setError(null)
              }}
            />
            {custom === null ? (
              <div
                className="flex gap-1"
                role="group"
                aria-label="Timer presets"
              >
                {PRESETS.map((value, index) => (
                  <Button
                    aria-pressed={preset === value}
                    disabled={saving}
                    variant={preset === value ? "default" : "outline"}
                    key={value}
                    size="xs"
                    title={`⌘${index + 1}`}
                    type="button"
                    onClick={() => choosePreset(value)}
                  >
                    {value}
                  </Button>
                ))}
                <Button
                  aria-label="Choose a date or repeating schedule"
                  disabled={saving}
                  size="xs"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    lifecycle.current.draftChanged()
                    setPreset(null)
                    setScheduled(true)
                  }}
                >
                  Schedule
                </Button>
                <Button
                  aria-label="Custom timer duration"
                  disabled={saving}
                  size="xs"
                  title="Custom timer duration (⌘T)"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    lifecycle.current.draftChanged()
                    setScheduled(false)
                    setPreset(null)
                    setCustom("")
                  }}
                >
                  Custom timer
                </Button>
              </div>
            ) : (
              <Input
                aria-label="Custom duration"
                className="h-8 w-36"
                placeholder="45m or 1h 30m"
                ref={customRef}
                disabled={saving}
                value={custom}
                onChange={(event) => {
                  setCustom(event.target.value)
                  setError(null)
                }}
              />
            )}
            {!scheduled && (
              <Button
                aria-label="Save reminder"
                disabled={pending}
                size="sm"
                type="submit"
              >
                Save
              </Button>
            )}
          </>
        )}
      </form>
      {scheduled && !saved && (
        <div className="rounded-b-xl border bg-background p-4">
          <ScheduleForm
            disabled={pending}
            onSubmit={async (resolved) => {
              if (saved || lifecycle.current.isSubmitting) return
              if (!title.trim()) throw new Error("Enter a reminder title.")
              await saveReminder(
                () =>
                  command("create_scheduled_reminder", {
                    title,
                    schedule: toReminderSchedule(resolved),
                  }),
                "Saved to your list"
              )
            }}
          />
          {error && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button
            type="button"
            disabled={saving}
            variant="ghost"
            onClick={() => {
              lifecycle.current.draftChanged()
              setScheduled(false)
            }}
          >
            Back
          </Button>
        </div>
      )}
      {previousSaved && (
        <p
          className="mx-auto mt-2 w-fit rounded-md border bg-background px-2 py-1 text-sm"
          role="status"
        >
          {previousSaved}
        </p>
      )}
      {!scheduled && !saved && (
        <p
          className="mx-auto mt-2 w-fit rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground"
          role={error ? "alert" : undefined}
        >
          {error ??
            durationPreview ??
            (preset === null && (custom === null || !custom.trim())
              ? "No timer selected · saved without an alert"
              : "Enter a timer duration")}
        </p>
      )}
      {!saved && (
        <p className="mx-auto mt-2 w-fit rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground">
          {scheduled ? (
            <>
              <kbd>Esc</kbd> back
            </>
          ) : (
            <>
              <kbd>↵</kbd> save · <kbd>⌘1–3</kbd> timer · <kbd>⌘T</kbd> custom
              timer · <kbd>Esc</kbd> {custom !== null ? "back" : "close"}
            </>
          )}
        </p>
      )}
    </main>
  )
}
