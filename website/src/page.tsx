import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"

import { Kbd } from "@/components/ui/kbd"
import { DesktopScene } from "./desktop-scene"

type Appearance = "system" | "light" | "dark"
type EffectiveAppearance = Exclude<Appearance, "system">
type AlertStyle = "fullscreen" | "notch" | "native"

const appearanceCycle: Appearance[] = ["system", "light", "dark"]
const appearanceStorageKey = "sela-landing-appearance"
const rotatingWords = ["remember", "refocus", "return"]
const alertStyles: Array<{
  value: AlertStyle
  label: string
  compactLabel: string
}> = [
  { value: "fullscreen", label: "Full screen", compactLabel: "Full screen" },
  { value: "notch", label: "From the notch", compactLabel: "Notch" },
  {
    value: "native",
    label: "macOS notification",
    compactLabel: "Notification",
  },
]

function getSavedAppearance(): Appearance {
  try {
    const value = localStorage.getItem(appearanceStorageKey)
    return appearanceCycle.includes(value as Appearance)
      ? (value as Appearance)
      : "system"
  } catch {
    return "system"
  }
}

function AppearanceToggle({
  appearance,
  onChange,
}: {
  appearance: EffectiveAppearance
  onChange: () => void
}) {
  const Icon = appearance === "dark" ? Moon : Sun
  const nextAppearance = appearance === "dark" ? "light" : "dark"

  return (
    <button
      aria-label={`Switch to ${nextAppearance} appearance`}
      className="appearance-toggle grid size-10 place-items-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-4"
      onClick={onChange}
      title={`Switch to ${nextAppearance} appearance`}
      type="button"
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  )
}

function DotWave() {
  return (
    <div aria-hidden="true" className="dot-wave">
      <svg
        className="size-full"
        fill="none"
        preserveAspectRatio="none"
        viewBox="0 0 1440 280"
      >
        <path
          className="dot-wave-line dot-wave-line-main"
          d="M-40 154C126 66 271 54 421 111s242 107 387 101 229-65 364-92 205-12 308 29"
        />
        <path
          className="dot-wave-line dot-wave-line-secondary"
          d="M-48 190c174-88 298-95 451-32s239 106 393 97 223-75 363-98 212-1 321 43"
        />
      </svg>
    </div>
  )
}

function AlertPlayground() {
  const [style, setStyle] = useState<AlertStyle>("fullscreen")
  const [dismissed, setDismissed] = useState(false)
  const [closing, setClosing] = useState(false)
  const [replay, setReplay] = useState(0)
  const selectedStyle = alertStyles.find((option) => option.value === style)

  return (
    <div className="alert-playground mt-8 w-full max-w-4xl sm:mt-9">
      <div
        aria-label="Choose an alert style to preview"
        className="playground-tabs mb-3 flex flex-wrap items-center justify-center gap-2"
        role="group"
      >
        {alertStyles.map((option) => (
          <button
            aria-label={option.label}
            aria-pressed={style === option.value}
            className="playground-tab rounded-lg border px-3 py-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:text-sm"
            key={option.value}
            onClick={() => {
              setStyle(option.value)
              setDismissed(false)
              setClosing(false)
              setReplay((value) => value + 1)
            }}
            type="button"
          >
            <span className="hidden min-[400px]:inline">{option.label}</span>
            <span className="min-[400px]:hidden">{option.compactLabel}</span>
          </button>
        ))}
      </div>

      <div
        aria-label={`${selectedStyle?.label} example alert`}
        aria-live="polite"
        className={`playground-stage playground-stage-${style}`}
        role="group"
      >
        <DesktopScene
          style={style}
          dismissed={dismissed}
          closing={closing}
          replay={replay}
          onDismiss={() => setClosing(true)}
          onDismissComplete={() => {
            setClosing(false)
            setDismissed(true)
          }}
        />
        <span className="sr-only" key={replay}>
          {dismissed
            ? "Preview closed. Select a style to replay."
            : `${selectedStyle?.label} preview. Close preview to dismiss.`}
        </span>
      </div>
      <p className="text-site-muted mt-2 text-xs">
        {style === "native"
          ? "Browser simulation — macOS controls the actual banner and animation."
          : "Interactive desktop preview. Select a style to replay."}
      </p>
    </div>
  )
}

export function LandingPage() {
  const [appearance, setAppearance] = useState<Appearance>(getSavedAppearance)
  const [wordIndex, setWordIndex] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [systemAppearance, setSystemAppearance] = useState<EffectiveAppearance>(
    () =>
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
  )
  const effectiveAppearance =
    appearance === "system" ? systemAppearance : appearance

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const updateSystemAppearance = () =>
      setSystemAppearance(media.matches ? "dark" : "light")

    media.addEventListener("change", updateSystemAppearance)
    return () => media.removeEventListener("change", updateSystemAppearance)
  }, [])

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const updateReducedMotion = () => setReducedMotion(media.matches)

    updateReducedMotion()
    media.addEventListener("change", updateReducedMotion)
    return () => media.removeEventListener("change", updateReducedMotion)
  }, [])

  useEffect(() => {
    if (reducedMotion) return

    const interval = window.setInterval(() => {
      setWordIndex((index) => (index + 1) % rotatingWords.length)
    }, 3200)
    return () => window.clearInterval(interval)
  }, [reducedMotion])

  useEffect(() => {
    document.documentElement.dataset.theme = appearance
    try {
      localStorage.setItem(appearanceStorageKey, appearance)
    } catch {
      // The page remains usable when browser storage is unavailable.
    }

    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        effectiveAppearance === "dark" ? "#181816" : "#f5f4f0"
      )
  }, [appearance, effectiveAppearance])

  const toggleAppearance = () => {
    setAppearance(effectiveAppearance === "dark" ? "light" : "dark")
  }

  return (
    <main className="site-shell relative isolate flex min-h-svh flex-col overflow-x-hidden px-5 sm:px-8">
      <DotWave />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between py-5 sm:py-7">
        <div className="flex items-center gap-2.5">
          <img
            alt=""
            aria-hidden="true"
            className="size-7 object-contain"
            height="28"
            src="/favicon.png"
            width="28"
          />
          <span className="font-medium tracking-[-0.035em]">Sela</span>
          <span
            aria-hidden="true"
            className="text-site-muted max-[360px]:hidden"
          >
            /
          </span>
          <span className="text-site-muted text-xs max-[360px]:hidden sm:text-sm">
            A little space to remember
          </span>
        </div>
        <AppearanceToggle
          appearance={effectiveAppearance}
          onChange={toggleAppearance}
        />
      </header>

      <section
        aria-labelledby="hero-title"
        className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center pb-8 text-center sm:pb-10"
        id="home"
      >
        <h1
          aria-label="A little space to remember."
          className="text-site-foreground max-w-4xl text-[clamp(2.6rem,5vw,4.8rem)] leading-[0.98] font-medium tracking-[-0.075em]"
          id="hero-title"
        >
          A little space to
          <span aria-hidden="true" className="word-window mt-1 block sm:mt-2">
            <span
              className={`word-slide${reducedMotion ? "" : " word-slide-enter"}`}
              key={wordIndex}
            >
              {rotatingWords[wordIndex]}.
            </span>
          </span>
        </h1>

        <p className="text-site-muted mt-5 max-w-xl text-base leading-relaxed sm:mt-6 sm:text-lg">
          A calm, local-first reminder for thoughts that arrive at the wrong
          time. Designed with ADHD in mind.
        </p>

        <a
          className="primary-link mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium transition-[background-color,transform] duration-150 ease-out hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 active:translate-y-0 sm:mt-8"
          href="/downloads/Sela-macOS-arm64.dmg"
          download
        >
          <svg
            aria-hidden="true"
            className="size-4 fill-current"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
          </svg>
          Download for Apple Silicon
        </a>
        <a
          className="text-site-muted hover:text-site-foreground mt-3 inline-flex min-h-10 items-center gap-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-4"
          href="https://github.com/akbarsaputrait/sela"
          rel="noreferrer"
          target="_blank"
        >
          <svg
            aria-hidden="true"
            className="size-4 fill-current"
            viewBox="0 0 24 24"
          >
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
          Explore Sela on GitHub
        </a>

        <AlertPlayground />

        <div
          aria-label="Keyboard shortcuts"
          className="text-site-muted mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-xs leading-relaxed sm:mt-6 sm:text-sm"
          role="group"
        >
          <span className="text-site-foreground font-medium">Add reminder</span>
          <Kbd>⌘⇧Space</Kbd>
          <span aria-hidden="true" className="max-[360px]:hidden">
            ·
          </span>
          <span className="inline-flex items-center gap-x-2 max-[360px]:hidden">
            <Kbd>⌘1–3</Kbd> timer presets
            <span aria-hidden="true">·</span>
            <Kbd>⌘T</Kbd> custom timer
            <span aria-hidden="true">·</span>
            <Kbd>⌘L</Kbd> dashboard
          </span>
        </div>

        <p className="text-site-muted mt-4 text-xs tracking-wide sm:mt-5">
          For macOS <span aria-hidden="true">·</span> Private by default
        </p>
      </section>
    </main>
  )
}
