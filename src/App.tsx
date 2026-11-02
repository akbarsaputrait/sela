import { useState } from "react"

import { ThemeSync } from "@/app/theme-sync"
import { useNativeState, type NativeState } from "@/app/use-native-state"
import { Onboarding } from "@/features/onboarding/onboarding"
import { ReminderAlert } from "@/features/alert/reminder-alert"
import { Dashboard } from "@/features/dashboard/dashboard"
import { QuickAdd } from "@/features/quick-add/quick-add"

export type WindowRoute = "main" | "capture" | "alert"

export function route(): WindowRoute {
  const requested = new URLSearchParams(window.location.search).get("window")
  return requested === "capture" || requested === "alert" ? requested : "main"
}

function MainWindow({ nativeState }: { nativeState: NativeState }) {
  const { snapshot, loading, error, command } = nativeState
  const [onboardingError, setOnboardingError] = useState<string | null>(null)
  const previewDashboard =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("preview") === "dashboard"
  if (!loading && !snapshot.settings.onboardingCompleted && !previewDashboard) {
    return (
      <Onboarding
        snapshot={snapshot}
        command={command}
        error={onboardingError ?? error ?? snapshot.storageError}
        onError={setOnboardingError}
      />
    )
  }
  if (loading) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Sela</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Opening your reminders…
        </p>
      </main>
    )
  }
  return <Dashboard nativeState={nativeState} />
}

export default function App() {
  const current = route()
  const nativeState = useNativeState()
  const { snapshot, loading, command } = nativeState
  return (
    <>
      <ThemeSync
        appearance={snapshot.settings.appearance}
        colorTheme={snapshot.settings.colorTheme}
      />
      {current === "capture" ? (
        <QuickAdd command={command} />
      ) : current === "alert" ? (
        loading ? null : (
          <ReminderAlert nativeState={nativeState} />
        )
      ) : (
        <MainWindow nativeState={nativeState} />
      )}
    </>
  )
}
