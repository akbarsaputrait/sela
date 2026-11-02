import * as React from "react"
import { listen } from "@tauri-apps/api/event"

import { useCurrentTime } from "@/app/clock"
import type { NativeState } from "@/app/use-native-state"
import { Button } from "@/components/ui/button"
import { playAlertSound } from "@/features/alert/sound"

function relativeCreatedAt(createdAt: number, now: number) {
  const minutes = Math.round((now - createdAt) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return `${hours} hour${hours === 1 ? "" : "s"} ago`
}

export function ReminderAlert({ nativeState }: { nativeState: NativeState }) {
  const { snapshot, error, command } = nativeState
  const [entrance, setEntrance] = React.useState(0)
  const now = useCurrentTime()
  const heading = React.useRef<HTMLHeadingElement>(null)
  const soundedToken = React.useRef<number | null>(null)
  const active = snapshot.reminders.find(
    (reminder) => reminder.id === snapshot.activeId
  )
  const shown = snapshot.settings.alertStyle
  const preview = snapshot.preview
  const snoozeMinutes = snapshot.settings.defaultSnoozeMinutes

  React.useEffect(() => {
    if (
      !active ||
      preview ||
      shown === "native" ||
      soundedToken.current === snapshot.alertToken
    )
      return
    soundedToken.current = snapshot.alertToken
    if (snapshot.settings.soundEnabled) {
      void playAlertSound(
        snapshot.settings.soundChoice,
        snapshot.settings.customSoundId,
        command
      ).catch((failure: unknown) => {
        console.error("[sela] alert sound unavailable", failure)
        if (snapshot.settings.soundChoice !== "tone") {
          void playAlertSound("tone", null, command).catch((error: unknown) =>
            console.error("[sela] fallback alert sound unavailable", error)
          )
        }
      })
    }
  }, [
    active,
    preview,
    shown,
    snapshot.alertToken,
    snapshot.settings.soundEnabled,
    snapshot.settings.soundChoice,
    snapshot.settings.customSoundId,
    command,
  ])

  React.useEffect(() => {
    document.documentElement.dataset.alert = shown
  }, [shown])

  React.useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void listen("sela://alert-open", () => setEntrance((value) => value + 1))
      .then(async (unsubscribe) => {
        if (disposed) {
          unsubscribe()
          return
        }
        unlisten = unsubscribe
        await command("mark_window_ready")
      })
      .catch((failure: Error) =>
        console.error("[sela] alert window setup failed", failure)
      )
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [command])
  React.useEffect(
    () => heading.current?.focus(),
    [entrance, snapshot.activeId, preview]
  )

  const alert = { alertToken: snapshot.alertToken }
  const dismiss = () => command("dismiss_alert", { ...alert })
  const change = (action: "done" | "snooze", durationMs?: number) =>
    active
      ? command("change_reminder", { id: active.id, action, durationMs, alert })
      : Promise.resolve()

  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === "escape") {
        event.preventDefault()
        void dismiss()
      } else if (!preview && key === "enter") {
        event.preventDefault()
        void change("done")
      } else if (!preview && key === "s") {
        event.preventDefault()
        void change("snooze", snoozeMinutes * 60_000)
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  })

  const kicker = preview
    ? "Preview — nothing will change"
    : `You asked to be reminded${active ? ` · ${relativeCreatedAt(active.createdAt, now)}` : ""}${active?.dueAt != null ? ` · Scheduled ${new Date(active.dueAt).toLocaleString()}` : ""}${active?.schedule && active.schedule.kind !== "once" ? ` · repeats in ${active.schedule.timeZone}` : ""}`
  const title = preview
    ? "Your reminder shows up right here."
    : (active?.title ?? "All clear.")

  if (shown === "notch") {
    return (
      <main className="h-svh overflow-hidden bg-transparent px-3">
        <section
          className="max-h-44 animate-in overflow-y-auto rounded-b-2xl border border-t-0 bg-background p-5 shadow-lg duration-200 slide-in-from-top-full"
          key={entrance}
          role="alertdialog"
          aria-labelledby="alert-title"
        >
          <p className="text-xs text-muted-foreground">{kicker}</p>
          <h1
            className="mt-1 text-xl font-semibold tracking-tight break-words outline-none"
            id="alert-title"
            ref={heading}
            tabIndex={-1}
          >
            {title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {preview ? (
              <Button size="sm" onClick={() => void dismiss()}>
                Close <kbd>Esc</kbd>
              </Button>
            ) : active ? (
              <>
                <Button size="sm" onClick={() => void change("done")}>
                  Done <kbd>↵</kbd>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void change("snooze", snoozeMinutes * 60_000)}
                >
                  {snoozeMinutes} more min <kbd>S</kbd>
                </Button>
                <Button
                  className="ml-auto"
                  size="sm"
                  variant="ghost"
                  onClick={() => void dismiss()}
                >
                  Not now <kbd>Esc</kbd>
                </Button>
              </>
            ) : null}
          </div>
          {error ? (
            <p className="mt-2 text-xs font-medium" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      </main>
    )
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background p-10">
      <section
        className="flex w-full max-w-4xl animate-in flex-col items-center text-center duration-300 fade-in slide-in-from-bottom-2"
        key={entrance}
        role="alertdialog"
        aria-labelledby="alert-title"
      >
        <p className="text-sm text-muted-foreground">
          {preview
            ? kicker
            : `Hey — ${kicker.charAt(0).toLowerCase()}${kicker.slice(1)}`}
        </p>
        <h1
          className="mt-5 max-w-4xl text-5xl leading-tight font-semibold tracking-tight break-words outline-none lg:text-7xl"
          id="alert-title"
          ref={heading}
          tabIndex={-1}
        >
          {title}
        </h1>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          {preview ? (
            <Button size="lg" onClick={() => void dismiss()}>
              Close preview <kbd>Esc</kbd>
            </Button>
          ) : active ? (
            <>
              <Button size="lg" onClick={() => void change("done")}>
                Done <kbd>↵</kbd>
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => void change("snooze", snoozeMinutes * 60_000)}
              >
                {snoozeMinutes} more min <kbd>S</kbd>
              </Button>
            </>
          ) : null}
        </div>
        {!preview && active ? (
          <Button
            className="mt-6 text-muted-foreground"
            variant="ghost"
            onClick={() => void dismiss()}
          >
            Not now, keep it in Activities <kbd>Esc</kbd>
          </Button>
        ) : null}
        {error ? (
          <p className="mt-4 text-sm font-medium" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  )
}
