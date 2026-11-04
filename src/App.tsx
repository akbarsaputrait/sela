import { useState } from "react"

import { ThemeSync } from "@/app/theme-sync"
import { useNativeState, type NativeState } from "@/app/use-native-state"
import { AppError } from "@/components/app-error"
import { Onboarding } from "@/features/onboarding/onboarding"
import { ReminderAlert } from "@/features/alert/reminder-alert"
import { Dashboard } from "@/features/dashboard/dashboard"
import { QuickAdd } from "@/features/quick-add/quick-add"
import { isTauri } from "@/lib/tauri"
import { isDashboardPreview } from "@/lib/preview"

export type WindowRoute = "main" | "capture" | "alert"

export function route(): WindowRoute {
  const requested = new URLSearchParams(window.location.search).get("window")
  return requested === "capture" || requested === "alert" ? requested : "main"
}

function StartupState({ nativeState }: { nativeState: NativeState }) {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Sela</h1>
      {nativeState.loading ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Opening your reminders…
        </p>
      ) : (
        <div className="mt-4">
          <AppError
            title="Your reminders couldn’t be opened"
            message={
              nativeState.error ?? "Please try opening your reminders again."
            }
            onRetry={() => void nativeState.refresh()}
          />
        </div>
      )}
    </main>
  )
}

export function MainWindow({ nativeState }: { nativeState: NativeState }) {
  const { snapshot, initialized, error, command } = nativeState
  const [onboardingError, setOnboardingError] = useState<string | null>(null)
  const previewDashboard = isDashboardPreview(
    window.location.search,
    import.meta.env.DEV,
    isTauri()
  )
  if (!initialized) return <StartupState nativeState={nativeState} />
  if (
    !snapshot.settings.onboardingCompleted &&
    !previewDashboard &&
    !snapshot.storageError
  ) {
    return (
      <Onboarding
        snapshot={snapshot}
        command={command}
        error={onboardingError ?? error}
        onError={setOnboardingError}
      />
    )
  }
  return <Dashboard nativeState={nativeState} />
}

export default function App() {
  const current = route()
  const nativeState = useNativeState()
  const { snapshot, initialized, command } = nativeState
  return (
    <>
      <ThemeSync
        appearance={snapshot.settings.appearance}
        colorTheme={snapshot.settings.colorTheme}
      />
      {current === "capture" ? (
        <QuickAdd command={command} />
      ) : current === "alert" ? (
        !initialized ? (
          <StartupState nativeState={nativeState} />
        ) : (
          <ReminderAlert nativeState={nativeState} />
        )
      ) : (
        <MainWindow nativeState={nativeState} />
      )}
    </>
  )
}
