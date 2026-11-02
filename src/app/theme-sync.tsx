import { useEffect } from "react"

import type { Appearance, ColorTheme } from "./native-store"

const QUERY = "(prefers-color-scheme: dark)"

export function resolveAppearance(
  appearance: Appearance,
  systemDark: boolean
): "light" | "dark" {
  return appearance === "system" ? (systemDark ? "dark" : "light") : appearance
}

function applyTheme(appearance: Appearance, colorTheme: ColorTheme) {
  const systemDark = window.matchMedia(QUERY).matches
  const resolved = resolveAppearance(appearance, systemDark)
  const root = document.documentElement
  root.classList.remove("light", "dark")
  root.classList.add(resolved)
  root.dataset.theme = colorTheme
  root.style.colorScheme = resolved
}

export function ThemeSync({
  appearance,
  colorTheme,
}: {
  appearance: Appearance
  colorTheme: ColorTheme
}) {
  useEffect(() => {
    const media = window.matchMedia(QUERY)
    const sync = () => applyTheme(appearance, colorTheme)
    sync()
    if (appearance !== "system") return
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [appearance, colorTheme])
  return null
}
