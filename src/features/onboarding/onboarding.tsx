import * as React from "react"
import type { NativeSnapshot } from "@/app/native-store"
import { AppError } from "@/components/app-error"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ALERT_STYLES } from "@/features/settings/settings"

const PRESETS = ["5m", "15m", "30m"] as const

type Command = <T>(name: string, args?: Record<string, unknown>) => Promise<T>

const SLIDES = [
  {
    id: "capture",
    eyebrow: "QUICK ADD",
    title: "Catch a thought. Keep your flow.",
    copy: "Press ⌘⇧Space from any app, or use the menu-bar icon.",
  },
  {
    id: "alerts",
    eyebrow: "REMINDER STYLE",
    title: "How should we remind you?",
    copy: "Choose a style that feels right. You can change it later in Settings.",
  },
] as const

export function Onboarding({
  snapshot,
  command,
  error,
  onError,
}: {
  snapshot: NativeSnapshot
  command: Command
  error: string | null
  onError: (message: string | null) => void
}) {
  const [slide, setSlide] = React.useState(0)
  const heading = React.useRef<HTMLHeadingElement>(null)

  React.useEffect(() => heading.current?.focus(), [slide])

  const finish = async () => {
    try {
      await command("complete_onboarding")
      onError(null)
    } catch (error) {
      onError((error as Error).message)
    }
  }

  const next = () =>
    slide === SLIDES.length - 1 ? void finish() : setSlide((value) => value + 1)

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col px-8 py-7">
      <header className="mb-5 flex items-center justify-between">
        <p className="text-2xl font-semibold tracking-tight">Sela</p>
        <div
          aria-label={`Step ${slide + 1} of ${SLIDES.length}`}
          className="flex items-center gap-2"
          role="group"
        >
          <div aria-hidden="true" className="flex items-center gap-1.5">
            {SLIDES.map((item, index) => (
              <span
                className={`h-1.5 rounded-full ${index === slide ? "w-5 bg-foreground" : "w-1.5 bg-border"}`}
                key={item.id}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            Step {slide + 1} of {SLIDES.length}
          </span>
        </div>
      </header>

      <section
        aria-labelledby="welcome-title"
        className="flex flex-1 flex-col justify-center"
        key={slide}
      >
        <div className="onboarding-slide animate-in duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] fade-in-0 slide-in-from-bottom-2">
          <h1
            className="max-w-2xl text-3xl leading-tight font-semibold tracking-tight outline-none"
            id="welcome-title"
            ref={heading}
            tabIndex={-1}
          >
            {SLIDES[slide].title}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            {SLIDES[slide].copy}
          </p>

          {slide === 0 ? (
            <div className="mt-7 grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <QuickAddPreview />
              <div>
                <Button
                  size="sm"
                  onClick={() =>
                    void command("show_capture").catch((error: Error) =>
                      onError(error.message)
                    )
                  }
                >
                  Try Quick Add
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-7">
              <RadioGroup
                aria-label="Choose how reminders appear"
                className="grid grid-cols-3 gap-2"
                value={snapshot.settings.alertStyle}
                onValueChange={(value) =>
                  void command("set_alert_style", { style: value }).catch(
                    (error: Error) => onError(error.message)
                  )
                }
              >
                {ALERT_STYLES.map((item) => (
                  <Label
                    className="flex h-full min-w-0 cursor-pointer flex-col items-stretch gap-3 rounded-lg border p-3 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring has-data-checked:border-foreground has-data-checked:bg-muted"
                    key={item.value}
                  >
                    <div
                      aria-hidden="true"
                      className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded border bg-muted"
                    >
                      {item.value === "fullscreen" ? (
                        <div className="absolute inset-2 grid place-items-center rounded-sm border bg-background text-[9px]">
                          Call Alex
                        </div>
                      ) : item.value === "notch" ? (
                        <>
                          <div className="absolute inset-2 bg-background" />
                          <div className="absolute inset-x-5 top-0 rounded-b-md bg-foreground p-1.5 text-center text-[8px] text-background">
                            Call Alex
                          </div>
                        </>
                      ) : (
                        <div className="absolute top-2 right-2 w-[70%] rounded-md border bg-background p-2 shadow-sm">
                          <p className="text-[8px] font-semibold">Sela</p>
                          <p className="mt-1 text-[8px] text-muted-foreground">
                            Call Alex
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-start gap-2">
                      <RadioGroupItem className="mt-0.5" value={item.value} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {item.label}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          {item.value === "fullscreen"
                            ? "A moment to pause."
                            : item.value === "notch"
                              ? "A nudge from the top."
                              : "A familiar system banner."}
                        </span>
                      </span>
                    </div>
                  </Label>
                ))}
              </RadioGroup>
              <Button
                className="mt-4"
                size="sm"
                variant="outline"
                onClick={() =>
                  void command("preview_alert").catch((error: Error) =>
                    onError(error.message)
                  )
                }
              >
                Preview selected alert
              </Button>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                In-app alerts need Sela running. macOS notifications follow
                Focus and permissions.
              </p>
            </div>
          )}
          {error ? <AppError message={error} /> : null}
        </div>
      </section>

      <footer className="mt-auto flex items-center justify-between gap-4 pt-6">
        <Button variant="link" onClick={() => void finish()}>
          Skip
        </Button>
        <div className="flex gap-2">
          {slide > 0 ? (
            <Button
              variant="outline"
              onClick={() => setSlide((value) => value - 1)}
            >
              Back
            </Button>
          ) : null}
          <Button onClick={next}>
            {slide === SLIDES.length - 1 ? "Start using Sela" : "Continue"}
          </Button>
        </div>
      </footer>
    </main>
  )
}

function QuickAddPreview() {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-xl border bg-card p-5">
      <div
        aria-hidden="true"
        className="flex w-full max-w-lg items-center gap-3 rounded-xl bg-foreground p-3 text-background"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium tracking-wide text-background/65 uppercase">
            Quick Add
          </p>
          <p className="mt-1 truncate text-sm">Call Alex tomorrow</p>
        </div>
        <div className="flex gap-1">
          {PRESETS.map((preset, index) => (
            <span
              className={
                index === 0
                  ? "rounded bg-background px-2 py-1 text-xs text-foreground"
                  : "rounded border border-background/30 px-2 py-1 text-xs"
              }
              key={preset}
            >
              {preset}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
