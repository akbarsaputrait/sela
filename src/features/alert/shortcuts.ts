type AlertKeyEvent = Pick<
  KeyboardEvent,
  | "key"
  | "defaultPrevented"
  | "repeat"
  | "isComposing"
  | "metaKey"
  | "ctrlKey"
  | "altKey"
>

export function alertShortcut(
  event: AlertKeyEvent,
  preview: boolean
): "dismiss" | "snooze" | null {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) {
    return null
  }

  const key = event.key.toLowerCase()
  if (key === "escape") return "dismiss"
  if (preview) return null
  if (key === "s") return "snooze"
  return null
}
