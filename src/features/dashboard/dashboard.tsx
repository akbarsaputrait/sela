import * as React from "react"

import type { NativeState } from "@/app/use-native-state"
import type { Reminder } from "@/app/native-store"
import { AppError } from "@/components/app-error"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { About } from "@/features/about/about"
import { Activities } from "@/features/activities/activities"
import { Settings } from "@/features/settings/settings"
import { isTauri } from "@/lib/tauri"

export function Dashboard({ nativeState }: { nativeState: NativeState }) {
  const {
    snapshot,
    loading,
    error,
    command,
    refresh,
    clearError,
    requestedDashboardTab,
    clearRequestedDashboardTab,
  } = nativeState
  const [uiError, setUiError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [tab, setTab] = React.useState("activities")

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
        value={requestedDashboardTab ?? tab}
        onValueChange={(value) => {
          if (typeof value === "string") {
            setTab(value)
            if (requestedDashboardTab)
              clearRequestedDashboardTab(requestedDashboardTab)
          }
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
              title="Reminders couldn't be opened"
              message={`${snapshot.storageError} Sela couldn't load your reminders. Resolve the storage problem and reopen Sela.`}
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
              title="An alert couldn't be delivered"
              message={snapshot.deliveryError}
              onRetry={() =>
                void run("retry_failed_deliveries").catch(() => undefined)
              }
            />
          ) : null}
          {error && error !== uiError ? (
            <div className="mb-4">
              <AppError title="Sela needs attention" message={error} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  clearError()
                  void refresh()
                }}
              >
                Refresh reminders
              </Button>
            </div>
          ) : null}
          {uiError ? <AppError message={uiError} /> : null}
          <TabsContent value="activities">
            {!blocked && (
              <Activities
                command={command}
                disabled={busy || !isTauri()}
                suppressedReminderIds={snapshot.suppressedReminderIds}
                reminders={snapshot.reminders}
                onNewReminder={() =>
                  void run("show_capture").catch(() => undefined)
                }
                onChange={changeReminder}
              />
            )}
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
