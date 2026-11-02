import * as React from "react"
import { Upload } from "lucide-react"

import type {
  AlertStyle,
  Appearance,
  ColorTheme,
  Settings as SettingsModel,
  SnoozeMinutes,
  SoundChoice,
} from "@/app/native-store"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { isWavFileName, playAlertSound } from "@/features/alert/sound"

const SOUND_OPTIONS: Array<{ value: SoundChoice; label: string }> = [
  { value: "tone", label: "Classic tone" },
  { value: "remove", label: "Interface remove" },
  { value: "announce", label: "Clear announce" },
  { value: "back", label: "Interface back" },
  { value: "custom", label: "Custom WAV" },
]

const APPEARANCES: Array<{ value: Appearance; label: string }> = [
  { value: "system", label: "Follow System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]
const THEMES: Array<{ value: ColorTheme; label: string }> = [
  { value: "monochrome", label: "Monochrome" },
  { value: "vermilion", label: "Ink & Vermilion" },
  { value: "cobalt", label: "Chalk & Cobalt" },
  { value: "brass", label: "Graphite & Brass" },
]

const SNOOZE_OPTIONS: Array<{ value: SnoozeMinutes; label: string }> = [
  { value: 5, label: "5 minutes" },
  { value: 10, label: "10 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
]

// Shared with onboarding; keep values aligned with the native settings contract.
export const ALERT_STYLES: Array<{
  value: AlertStyle
  label: string
  help: string
}> = [
  {
    value: "fullscreen",
    label: "Full screen",
    help: "A clear pause with your reminder front and center.",
  },
  {
    value: "notch",
    label: "From the notch",
    help: "A compact reminder at the top of the current display.",
  },
  {
    value: "native",
    label: "macOS notification",
    help: "A system banner. Notification permissions and Focus apply.",
  },
]

type Command = <T>(name: string, args?: Record<string, unknown>) => Promise<T>

export function Settings({
  settings,
  launchAtLogin,
  disabled,
  command,
  onError,
}: {
  settings: SettingsModel
  launchAtLogin: boolean
  disabled: boolean
  command: Command
  onError: (message: string | null) => void
}) {
  const [savingLogin, setSavingLogin] = React.useState(false)
  const [uploadingSound, setUploadingSound] = React.useState(false)
  const soundFile = React.useRef<HTMLInputElement>(null)
  const loginRequest = React.useRef(false)
  const request = (name: string, args?: Record<string, unknown>) => {
    void command(name, args).catch((error: Error) => onError(error.message))
  }

  React.useEffect(() => {
    if (disabled) return
    const refresh = () => {
      if (document.hasFocus() && !loginRequest.current) {
        void command<boolean>("get_launch_at_login").catch((error: Error) =>
          onError(error.message)
        )
      }
    }
    window.addEventListener("focus", refresh)
    return () => window.removeEventListener("focus", refresh)
  }, [disabled, command, onError])

  const toggleLogin = async (enabled: boolean) => {
    if (loginRequest.current) return
    loginRequest.current = true
    setSavingLogin(true)
    try {
      await command<boolean>("set_launch_at_login", { enabled })
      onError(null)
    } catch (error) {
      onError((error as Error).message)
    } finally {
      loginRequest.current = false
      setSavingLogin(false)
    }
  }

  const currentStyle = ALERT_STYLES.find(
    (item) => item.value === settings.alertStyle
  )!
  return (
    <section aria-labelledby="settings-title" className="sela-page">
      <header className="mb-5">
        <h1 id="settings-title" className="sela-page-title">
          Settings
        </h1>
      </header>
      <section aria-labelledby="appearance-heading" className="mb-4">
        <h2 id="appearance-heading" className="sela-section-title">
          Display
        </h2>
        <div className="divide-y divide-border/60">
          <SettingRow
            id="appearance"
            label="Appearance"
            help="Applied to every Sela window."
          >
            <Select
              items={APPEARANCES}
              disabled={disabled}
              value={settings.appearance}
              onValueChange={(value) => {
                const choice = APPEARANCES.find((item) => item.value === value)
                if (choice)
                  request("set_appearance", { appearance: choice.value })
              }}
            >
              <SelectTrigger
                id="appearance"
                aria-describedby="appearance-help"
                className="w-full rounded-md text-[13px]"
              >
                <SelectValue>
                  {
                    APPEARANCES.find(
                      (item) => item.value === settings.appearance
                    )?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                {APPEARANCES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow id="color-theme" label="Color theme">
            <Select
              items={THEMES}
              disabled={disabled}
              value={settings.colorTheme}
              onValueChange={(value) => {
                const choice = THEMES.find((item) => item.value === value)
                if (choice)
                  request("set_appearance", { colorTheme: choice.value })
              }}
            >
              <SelectTrigger
                id="color-theme"
                className="w-full rounded-md text-[13px]"
              >
                <SelectValue>
                  {
                    THEMES.find((item) => item.value === settings.colorTheme)
                      ?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                {THEMES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </div>
      </section>
      <section aria-labelledby="reminders-heading" className="mb-4">
        <h2 id="reminders-heading" className="sela-section-title">
          Reminders
        </h2>
        <div className="py-2.5">
          <p id="alert-style-label" className="text-[13px] font-medium">
            Alert style
          </p>
          <p
            id="alert-style-help"
            className="mt-1 min-h-10 text-xs leading-5 text-muted-foreground"
          >
            {currentStyle.help}
          </p>
          <RadioGroup
            aria-labelledby="alert-style-label"
            aria-describedby="alert-style-help"
            className="mt-3 grid grid-cols-3 gap-3"
            value={settings.alertStyle}
            disabled={disabled}
            onValueChange={(value) => {
              const choice = ALERT_STYLES.find((item) => item.value === value)
              if (choice) request("set_alert_style", { style: choice.value })
            }}
          >
            {ALERT_STYLES.map((item) => (
              <label
                key={item.value}
                className="group flex min-w-0 cursor-pointer flex-col items-center gap-1.5 text-center text-xs has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
              >
                <RadioGroupItem value={item.value} className="sr-only" />
                <span
                  aria-hidden="true"
                  className="relative flex aspect-[16/10] w-full max-w-36 overflow-hidden rounded-md border-2 border-border bg-muted p-2 group-has-data-checked:border-primary group-has-[:focus-visible]:ring-2 group-has-[:focus-visible]:ring-ring"
                >
                  <span className="relative block size-full overflow-hidden rounded-sm border border-border/70 bg-background">
                    {item.value === "fullscreen" && (
                      <span className="absolute inset-1 grid place-items-center rounded-sm bg-foreground text-[8px] text-background">
                        Reminder
                      </span>
                    )}
                    {item.value === "notch" && (
                      <span className="absolute inset-x-3 top-0 truncate rounded-b-md bg-foreground px-1 py-1 text-[8px] text-background">
                        Reminder
                      </span>
                    )}
                    {item.value === "native" && (
                      <span className="absolute top-1 right-1 w-3/5 rounded-sm border bg-card p-1 text-left text-[7px] leading-tight shadow-sm">
                        Sela
                        <br />
                        Reminder
                      </span>
                    )}
                  </span>
                </span>
                <span className="font-medium">{item.label}</span>
              </label>
            ))}
          </RadioGroup>
        </div>
        <SettingRow
          id="alert-sound"
          label="Alert sound"
          help="Play a sound when a reminder appears."
        >
          <div className="flex justify-end">
            <Switch
              id="alert-sound"
              aria-describedby="alert-sound-help"
              checked={settings.soundEnabled}
              disabled={disabled}
              onCheckedChange={(enabled) =>
                request("set_sound_enabled", { enabled })
              }
            />
          </div>
        </SettingRow>
        <SettingRow
          id="sound-choice"
          label="Sound"
          help="Used for full-screen and notch alerts. macOS notifications use the system sound."
        >
          <div className="flex items-center gap-2">
            <Select
              items={SOUND_OPTIONS}
              value={settings.soundChoice}
              disabled={disabled || uploadingSound}
              onValueChange={(choice) => {
                if (!choice) return
                void playAlertSound(
                  choice,
                  settings.customSoundId,
                  command
                ).catch((error: Error) => onError(error.message))
                void command("set_sound_choice", { choice }).catch(
                  (error: Error) => onError(error.message)
                )
              }}
            >
              <SelectTrigger
                id="sound-choice"
                aria-describedby="sound-choice-help"
                className="min-w-0 flex-1"
              >
                <SelectValue>
                  {
                    SOUND_OPTIONS.find(
                      (item) => item.value === settings.soundChoice
                    )?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                {SOUND_OPTIONS.filter(
                  (item) => item.value !== "custom" || settings.customSoundId
                ).map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              ref={soundFile}
              type="file"
              accept=".wav"
              hidden
              disabled={disabled || uploadingSound}
              aria-label="Upload a WAV sound"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ""
                if (!file) return
                if (!isWavFileName(file.name)) {
                  onError("Choose a WAV file.")
                  return
                }
                if (file.size > 8 * 1024 * 1024) {
                  onError("Choose a WAV file no larger than 8 MB.")
                  return
                }
                let audio: AudioContext
                try {
                  audio = new AudioContext()
                } catch {
                  onError("The sound could not be played on this device.")
                  return
                }
                setUploadingSound(true)
                void audio
                  .resume()
                  .catch(() => onError("The sound could not be played."))
                void file
                  .arrayBuffer()
                  .then(async (buffer) => {
                    const decoded = await audio.decodeAudioData(buffer.slice(0))
                    await command<string>("upload_custom_sound", {
                      bytes: Array.from(new Uint8Array(buffer)),
                    })
                    const source = audio.createBufferSource()
                    source.buffer = decoded
                    source.connect(audio.destination)
                    source.onended = () => void audio.close().catch(() => {})
                    source.start()
                  })
                  .catch((error: unknown) => {
                    void audio.close().catch(() => {})
                    onError(
                      error instanceof Error
                        ? error.message
                        : "The WAV sound could not be loaded."
                    )
                  })
                  .finally(() => setUploadingSound(false))
              }}
            />
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label={
                uploadingSound ? "Uploading WAV sound" : "Upload WAV sound"
              }
              title="Upload WAV sound"
              disabled={disabled || uploadingSound}
              onClick={() => soundFile.current?.click()}
            >
              <Upload aria-hidden="true" />
            </Button>
          </div>
        </SettingRow>
        <SettingRow
          id="snooze-duration"
          label="Default snooze"
          help="macOS notification snooze is always 5 minutes."
        >
          <Select
            items={SNOOZE_OPTIONS}
            disabled={disabled}
            value={settings.defaultSnoozeMinutes}
            onValueChange={(minutes) => {
              if (SNOOZE_OPTIONS.some((item) => item.value === minutes))
                request("set_default_snooze_minutes", { minutes })
            }}
          >
            <SelectTrigger
              id="snooze-duration"
              aria-describedby="snooze-duration-help"
              className="w-full rounded-md text-[13px]"
            >
              <SelectValue>{settings.defaultSnoozeMinutes} minutes</SelectValue>
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              {SNOOZE_OPTIONS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <div className="flex items-center justify-between gap-4 pb-1">
          <p className="max-w-[40ch] text-xs leading-5 text-muted-foreground">
            Reminders appear while Sela is running. They won’t wake a sleeping
            Mac.
          </p>
          <Button
            disabled={disabled}
            size="sm"
            variant="outline"
            className="rounded-md text-xs"
            onClick={() => request("preview_alert")}
          >
            Test alert
          </Button>
        </div>
      </section>
      <section aria-label="Startup" className="mb-4 border-t">
        <div className="flex items-center justify-between gap-5 py-3">
          <div>
            <Label htmlFor="launch-login" className="text-[13px] font-medium">
              Launch at login
            </Label>
            <p
              id="login-help"
              className="mt-1 text-xs leading-5 text-muted-foreground"
            >
              Open quietly in the menu bar when you sign in.
            </p>
          </div>
          <Switch
            id="launch-login"
            aria-describedby="login-help"
            checked={launchAtLogin}
            disabled={disabled || savingLogin}
            onCheckedChange={(checked) => void toggleLogin(checked)}
          />
        </div>
      </section>
      <section aria-labelledby="shortcuts-heading" className="border-t pt-4">
        <h2 id="shortcuts-heading" className="sela-section-title">
          Keyboard shortcuts
        </h2>
        <dl className="mt-3 grid gap-y-2 text-xs">
          {[
            ["New reminder · anywhere", "⌘⇧Space"],
            ["Timer presets · quick add", "⌘1–3"],
            ["Custom duration · quick add", "⌘T"],
            ["Open dashboard · quick add", "⌘L"],
            ["Complete · alert", "Enter"],
            [`Snooze ${settings.defaultSnoozeMinutes} min · alert`, "S"],
            ["Dismiss · alert", "Esc"],
          ].map(([label, key]) => (
            <div
              className="flex items-center justify-between gap-4 py-0.5"
              key={label}
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd>
                <kbd className="sela-key">{key}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </section>
  )
}

function SettingRow({
  id,
  label,
  help,
  children,
}: {
  id: string
  label: string
  help?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(140px,184px)] items-center gap-x-4 py-2.5">
      <div>
        <Label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </Label>
        {help ? (
          <p
            id={`${id}-help`}
            className="mt-1 text-xs leading-5 text-muted-foreground"
          >
            {help}
          </p>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
