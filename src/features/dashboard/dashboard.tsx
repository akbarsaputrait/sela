import * as React from "react"
import { listen } from "@tauri-apps/api/event"

import type { NativeState } from "@/app/use-native-state"
import type { Reminder } from "@/app/native-store"
import { AppError } from "@/components/app-error"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { About } from "@/features/about/about"
import { Activities } from "@/features/activities/activities"
import { Onboarding } from "@/features/onboarding/onboarding"
import { Settings } from "@/features/settings/settings"
import { isTauri } from "@/lib/tauri"

export function Dashboard({ nativeState }: { nativeState: NativeState }) {
  const { snapshot, loading, error, command, refresh, clearError } = nativeState
  const [uiError, setUiError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [tab, setTab] = React.useState("activities")

  React.useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let unsubscribe: (() => void) | undefined
    void listen<string>("sela://dashboard-tab", (event) => {
      if (["activities", "settings", "about"].includes(event.payload))
        setTab(event.payload)
    })
      .then((unlisten) => {
        if (disposed) unlisten()
        else unsubscribe = unlisten
      })
      .catch((failure: unknown) =>
        console.error("Dashboard navigation unavailable", failure)
      )
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  const run = React.useCallback(
    async <T,>(name: string, args?: Record<string, unknown>) => {
      setUiError(null)
      setBusy(true)
      try {
        return await command<T>(name, args)
      } catch (failure) {
        setUiError((failure as Error).message)
        throw failure
      } finally {
        setBusy(false)
      }
    },
    [command]
  )

  const runSettings = React.useCallback(
    async <T,>(name: string, args?: Record<string, unknown>) => {
      setUiError(null)
      try {
        return await command<T>(name, args)
      } catch (failure) {
        setUiError((failure as Error).message)
        throw failure
      }
    },
    [command]
  )

  if (loading)
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Sela</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Opening your reminders…
        </p>
      </main>
    )
  const browserDashboardPreview =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("preview") === "dashboard"
  if (!snapshot.settings.onboardingCompleted && !browserDashboardPreview)
    return (
      <Onboarding
        error={
          uiError ??
          error ??
          snapshot.storageError ??
          snapshot.shortcutError ??
          snapshot.deliveryError
        }
        snapshot={snapshot}
        command={run}
        onError={setUiError}
      />
    )

  const blocked = Boolean(snapshot.storageError)
  const changeReminder = (
    reminder: Reminder,
    action: "done" | "remove" | "reschedule",
    durationMs?: number
  ) => {
    void run("change_reminder", {
      id: reminder.id,
      action,
      durationMs,
      expectedOccurrenceRevision: reminder.occurrenceRevision ?? 0,
    }).catch(() => undefined)
  }

  return (
    <main className="min-h-svh bg-background">
      <Tabs
        className="min-h-svh gap-0"
        value={tab}
        onValueChange={(value) => {
          if (typeof value === "string") setTab(value)
        }}
        orientation="horizontal"
      >
        <header className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-x-5 gap-y-1 border-b bg-background px-6">
          <p className="mr-auto text-[15px] font-semibold tracking-tight">
            Sela
          </p>
          <TabsList
            className="order-3 h-10 w-full justify-start gap-3 sm:order-none sm:w-auto"
            variant="line"
          >
            <TabsTrigger value="activities">Activities</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>
        </header>
        <div className="mx-auto w-full max-w-4xl px-6 py-6">
          {!isTauri() ? (
            <AppError
              message="This browser view is read-only. Open the desktop app to save or change reminders."
              title="Preview mode"
            />
          ) : null}
          {snapshot.storageError ? (
            <AppError
              title="Reminders are read-only"
              message={snapshot.storageError}
            />
          ) : null}
          {snapshot.shortcutError ? (
            <AppError
              title="Quick Add shortcut unavailable"
              message={snapshot.shortcutError}
            />
          ) : null}
          {snapshot.deliveryError ? (
            <AppError
              title="Your reminder is still in Activities"
              message={snapshot.deliveryError}
              onRetry={() =>
                void run("retry_failed_deliveries").catch(() => undefined)
              }
            />
          ) : null}
          {error ? (
            <AppError
              title="Sela couldn't refresh"
              message={error}
              onRetry={() => {
                clearError()
                void refresh()
              }}
            />
          ) : null}
          {uiError ? <AppError message={uiError} /> : null}
          <TabsContent value="activities">
            <Activities
              command={command}
              disabled={busy || blocked || !isTauri()}
              reminders={snapshot.reminders}
              onNewReminder={() =>
                void run("show_capture").catch(() => undefined)
              }
              onChange={changeReminder}
            />
          </TabsContent>
          <TabsContent value="settings">
            <Settings
              command={runSettings}
              disabled={blocked || !isTauri()}
              launchAtLogin={snapshot.launchAtLogin}
              onError={setUiError}
              settings={snapshot.settings}
            />
          </TabsContent>
          <TabsContent value="about">
            <About version={snapshot.appVersion} />
          </TabsContent>
        </div>
      </Tabs>
    </main>
  )
}
