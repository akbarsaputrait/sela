import type { Reminder } from "@/app/native-store"

export const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000

export function parseDuration(value: string): number | null {
  const text = value.trim().toLowerCase()
  if (!text) return null

  let milliseconds = 0
  if (/^\d+$/.test(text)) {
    milliseconds = Number(text) * 60_000
  } else {
    const token = /(\d+)\s*([hms])/gy
    const seen = new Set<string>()
    let position = 0
    while (position < text.length) {
      token.lastIndex = position
      const match = token.exec(text)
      if (!match || seen.has(match[2])) {
        throw new Error("Use a duration like 10m, 1h 30m, or 10s.")
      }
      seen.add(match[2])
      const multiplier =
        match[2] === "h" ? 3_600_000 : match[2] === "m" ? 60_000 : 1_000
      milliseconds += Number(match[1]) * multiplier
      position = token.lastIndex
      while (text[position] === " ") position += 1
    }
  }

  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 1_000 ||
    milliseconds > MAX_DURATION_MS
  ) {
    throw new Error("Choose a timer between 1 second and 30 days.")
  }
  return milliseconds
}

export type PreviousEntry =
  | (Reminder & { kind: "reminder"; timestamp: number })
  | {
      kind: "occurrence"
      id: string
      reminderId: string
      occurrenceIndex: number
      occurrenceRevision: number
      title: string
      createdAt: number
      timestamp: number
    }

export function groupReminders(reminders: Reminder[]) {
  const pending = reminders.filter((reminder) => reminder.status === "pending")
  return {
    upcoming: pending
      .filter((reminder) => reminder.dueAt !== null)
      .toSorted(
        (left, right) =>
          (left.snoozedUntil ?? left.dueAt ?? 0) -
            (right.snoozedUntil ?? right.dueAt ?? 0) ||
          left.createdAt - right.createdAt ||
          left.id.localeCompare(right.id)
      ),
    untimed: pending
      .filter((reminder) => reminder.dueAt === null)
      .toSorted(
        (left, right) =>
          right.createdAt - left.createdAt || left.id.localeCompare(right.id)
      ),
    previous: reminders
      .flatMap((reminder): PreviousEntry[] => [
        ...(reminder.status !== "pending"
          ? [
              {
                ...reminder,
                kind: "reminder" as const,
                timestamp: reminder.resolvedAt ?? reminder.createdAt,
              },
            ]
          : []),
        ...(reminder.occurrenceHistory ?? []).map((timestamp, index) => ({
          kind: "occurrence" as const,
          id: `${reminder.id}:occurrence:${timestamp}:${index}`,
          reminderId: reminder.id,
          occurrenceIndex: index,
          occurrenceRevision: reminder.occurrenceRevision ?? 0,
          title: reminder.title,
          createdAt: reminder.createdAt,
          timestamp,
        })),
      ])
      .toSorted(
        (left, right) =>
          right.timestamp - left.timestamp ||
          right.createdAt - left.createdAt ||
          left.id.localeCompare(right.id)
      ),
  }
}

export function remainingLabel(dueAt: number | null, now: number) {
  if (dueAt === null) return "No timer"
  const delta = dueAt - now
  if (delta === 0) return "Due now"
  const seconds = Math.ceil(Math.abs(delta) / 1_000)
  const prefix = delta < 0 ? "Overdue by" : "In"
  if (seconds < 60) return `${prefix} ${seconds}s`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${prefix} ${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${prefix} ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
}
