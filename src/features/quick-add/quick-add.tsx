import * as React from "react"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window"

import { isTauri } from "@/lib/tauri"
import type { NativeCommand } from "@/app/use-native-state"
import { useCurrentTime } from "@/app/clock"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseDuration } from "@/features/reminders/model"
import { ScheduleForm } from "@/features/reminders/schedule-form"
import { toReminderSchedule } from "@/features/reminders/schedule"

const PRESETS = ["5m", "15m", "30m"] as const
export function QuickAdd({ command }: { command: NativeCommand }) {
  const now = useCurrentTime()
  const [title, setTitle] = React.useState("")
  const [preset, setPreset] = React.useState<string | null>(null)
  const [custom, setCustom] = React.useState<string | null>(null)
  const [scheduled, setScheduled] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const submitting = React.useRef(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const customRef = React.useRef<HTMLInputElement>(null)
  const closing = React.useRef(false)
  const savedNoticeTimer = React.useRef<number | null>(null)

  const close = React.useCallback(() => {
    if (!isTauri() || closing.current) return
    closing.current = true
    void command("hide_capture")
      .catch((failure: Error) => setError(failure.message))
      .finally(() => {
        closing.current = false
      })
  }, [command])

  React.useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let unlisten: Array<() => void> = []
    const setup = async () => {
      const subscriptions = await Promise.all([
        listen("sela://capture-open", () => {
          if (savedNoticeTimer.current !== null) {
            window.clearTimeout(savedNoticeTimer.current)
            savedNoticeTimer.current = null
          }
          closing.current = false
          setError(null)
          setSaved(null)
          requestAnimationFrame(() => inputRef.current?.focus())
        }),
        listen("sela://capture-close", close),
      ])
      if (disposed) {
        subscriptions.forEach((unsubscribe) => unsubscribe())
        return
      }
      unlisten = subscriptions
      await command("mark_window_ready").catch((failure: Error) =>
        setError(failure.message)
      )
    }
    void setup()
    return () => {
      disposed = true
      if (savedNoticeTimer.current !== null)
        window.clearTimeout(savedNoticeTimer.current)
      unlisten.forEach((unsubscribe) => unsubscribe())
    }
  }, [close, command])

  React.useEffect(() => {
    if (custom !== null) customRef.current?.focus()
  }, [custom])

  React.useEffect(() => {
    if (!isTauri()) return
    void getCurrentWindow()
      .setSize(new LogicalSize(640, scheduled ? 700 : 132))
      .catch((failure: unknown) =>
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not resize Quick Add."
        )
      )
  }, [scheduled])

  const choosePreset = (value: string) => {
    setScheduled(false)
    setCustom(null)
    setError(null)
    setPreset((current) => (current === value ? null : value))
    inputRef.current?.focus()
  }

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault()
    if (saved || submitting.current) return
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
    submitting.current = true
    setSaving(true)
    try {
      await command("create_reminder", { title, durationMs })
      const label = custom?.trim() || preset
      setSaved(label ? `Saved · back in ${label}` : "Saved to your list")
      setTitle("")
      setPreset(null)
      setCustom(null)
      setError(null)
      if (savedNoticeTimer.current !== null)
        window.clearTimeout(savedNoticeTimer.current)
      savedNoticeTimer.current = window.setTimeout(() => {
        savedNoticeTimer.current = null
        setSaved(null)
        close()
      }, 650)
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      submitting.current = false
      setSaving(false)
    }
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
    if (event.key === "Escape") {
      event.preventDefault()
      if (scheduled) {
        setScheduled(false)
        inputRef.current?.focus()
      } else if (custom !== null) {
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
    >
      <form
        className="flex min-h-14 items-center gap-2 rounded-b-2xl border border-t-0 bg-background px-3 shadow-lg"
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
              className="h-10 flex-1 border-0 bg-transparent px-1 text-base shadow-none focus-visible:ring-0"
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
                    className="aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                    key={value}
                    size="xs"
                    title={`⌘${index + 1}`}
                    type="button"
                    variant="outline"
                    onClick={() => choosePreset(value)}
                  >
                    {value}
                  </Button>
                ))}
                <Button
                  aria-label="Other schedule"
                  size="xs"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setPreset(null)
                    setScheduled(true)
                  }}
                >
                  Other
                </Button>
                <Button
                  aria-label="Other duration"
                  size="xs"
                  title="Other duration (⌘T)"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setScheduled(false)
                    setPreset(null)
                    setCustom("")
                  }}
                >
                  Duration
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
                disabled={saving}
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
            onSubmit={async (resolved) => {
              if (!title.trim()) throw new Error("Enter a reminder title.")
              await command("create_scheduled_reminder", {
                title,
                schedule: toReminderSchedule(resolved),
              })
              setTitle("")
              setScheduled(false)
              setSaved("Saved to your list")
              savedNoticeTimer.current = window.setTimeout(() => {
                savedNoticeTimer.current = null
                setSaved(null)
                close()
              }, 650)
            }}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() => setScheduled(false)}
          >
            Back
          </Button>
        </div>
      )}
      <p
        className="mx-auto mt-2 w-fit rounded-md border bg-background px-2 py-1 text-[11px] text-muted-foreground"
        role={error ? "alert" : undefined}
      >
        {error ?? durationPreview ?? (
          <>
            <kbd>↵</kbd> save · <kbd>⌘1–3</kbd> timer · <kbd>⌘T</kbd> other ·{" "}
            <kbd>Esc</kbd> close
          </>
        )}
      </p>
    </main>
  )
}
