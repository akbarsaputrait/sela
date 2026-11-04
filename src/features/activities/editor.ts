import type { Reminder } from "@/app/native-store"

export function reminderEditConflict(
  expected: Reminder,
  latest: Reminder | undefined
): "missing" | "resolved" | "changed" | null {
  if (!latest || latest.id !== expected.id) return "missing"
  if (latest.status !== "pending") return "resolved"
  if (
    (latest.occurrenceRevision ?? 0) !== (expected.occurrenceRevision ?? 0) ||
    latest.title !== expected.title
  )
    return "changed"
  return null
}
