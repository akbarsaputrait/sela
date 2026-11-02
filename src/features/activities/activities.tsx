import * as React from "react"

import type { Reminder } from "@/app/native-store"
import { useCurrentTime } from "@/app/clock"
import { Button } from "@/components/ui/button"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { groupReminders, remainingLabel } from "@/features/reminders/model"
import { ScheduleForm } from "@/features/reminders/schedule-form"
import {
  localDateString,
  toReminderSchedule,
} from "@/features/reminders/schedule"
import { Input } from "@/components/ui/input"
import type { NativeCommand } from "@/app/use-native-state"

function dateLabel(timestamp: number) {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function ReminderRow({
  reminder,
  now,
  disabled,
  onChange,
  onEdit,
}: {
  reminder: Reminder
  now: number
  disabled: boolean
  onEdit: (reminder: Reminder) => void
  onChange: (
    reminder: Reminder,
    action: "done" | "remove" | "reschedule",
    durationMs?: number
  ) => void
}) {
  const effectiveDue = reminder.snoozedUntil ?? reminder.dueAt
  return (
    <li className="flex items-center gap-3 border-b py-3 last:border-b-0">
      <Button
        aria-label={`Complete ${reminder.title}`}
        className="size-7 rounded-full"
        disabled={disabled}
        size="icon-sm"
        variant="outline"
        onClick={() => onChange(reminder, "done")}
      >
        ✓
      </Button>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words">{reminder.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          <span
            className={
              effectiveDue !== null && effectiveDue <= now
                ? "font-medium text-foreground"
                : undefined
            }
          >
            {reminder.snoozedUntil != null ? "Snoozed · " : ""}
            {remainingLabel(effectiveDue, now)}
          </span>
          {effectiveDue !== null ? ` · ${dateLabel(effectiveDue)}` : null}
          {reminder.snoozedUntil != null && reminder.dueAt !== null
            ? ` · scheduled ${dateLabel(reminder.dueAt)}`
            : null}
          {reminder.schedule && reminder.schedule.kind !== "once"
            ? ` · repeats in ${reminder.schedule.timeZone}`
            : null}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          disabled={disabled}
          size="xs"
          variant="outline"
          onClick={() => onChange(reminder, "reschedule", 5 * 60_000)}
        >
          +5m
        </Button>
        <Button
          disabled={disabled}
          size="xs"
          variant="outline"
          onClick={() => onEdit(reminder)}
        >
          Edit
        </Button>
        <Button
          disabled={disabled}
          size="xs"
          variant="ghost"
          onClick={() => onChange(reminder, "remove")}
        >
          {reminder.schedule && reminder.schedule.kind !== "once"
            ? "Stop repeating"
            : "Remove"}
        </Button>
      </div>
    </li>
  )
}

export function Activities({
  reminders,
  disabled,
  onNewReminder,
  onChange,
  command,
}: {
  reminders: Reminder[]
  disabled: boolean
  onNewReminder: () => void
  command: NativeCommand
  onChange: (
    reminder: Reminder,
    action: "done" | "remove" | "reschedule",
    durationMs?: number
  ) => void
}) {
  const now = useCurrentTime()
  const [editing, setEditing] = React.useState<Reminder | null>(null)
  const [editTitle, setEditTitle] = React.useState("")
  const [reanchor, setReanchor] = React.useState(false)
  const [editError, setEditError] = React.useState<string | null>(null)
  const [renaming, setRenaming] = React.useState(false)
  const startEditing = (reminder: Reminder) => {
    setEditError(null)
    setReanchor(false)
    setEditing(reminder)
    setEditTitle(reminder.title)
  }
  const [upcomingLimit, setUpcomingLimit] = React.useState(100)
  const [untimedLimit, setUntimedLimit] = React.useState(100)
  const [historyLimit, setHistoryLimit] = React.useState(100)
  const groups = React.useMemo(() => groupReminders(reminders), [reminders])
  return (
    <section aria-labelledby="activities-title" className="sela-page">
      <header className="mb-4 flex items-center justify-between gap-4">
        <h1 id="activities-title" className="sela-page-title">
          Activities
        </h1>
        <Button disabled={disabled} onClick={onNewReminder}>
          New reminder{" "}
          <kbd
            className="ml-1 rounded border border-current/30 px-1 py-0.5 text-[10px] font-normal"
            aria-label="Command Shift Space"
          >
            ⌘⇧Space
          </kbd>
        </Button>
      </header>
      {editing &&
        (() => {
          const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone
          const schedule = editing.schedule
          const due = new Date(editing.dueAt ?? now)
          const initialValues = schedule
            ? { ...schedule, endDate: schedule.endDate ?? "" }
            : {
                kind: "once" as const,
                date: localDateString(due),
                time:
                  editing.dueAt === null
                    ? ""
                    : `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`,
                weekdays: [],
                dates: [""],
                endDate: "",
              }
          return (
            <section
              className="mb-5 space-y-3 rounded-md border p-4"
              aria-label="Edit reminder"
            >
              <h2 className="font-semibold">Edit reminder</h2>
              {schedule && schedule.kind !== "once" && (
                <p className="text-sm">
                  Changes replace the current schedule and future occurrences,
                  including any current snooze.
                </p>
              )}
              <label htmlFor="edit-reminder-title">Title</label>
              <Input
                id="edit-reminder-title"
                maxLength={240}
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={renaming || !editTitle.trim()}
                onClick={() => {
                  setRenaming(true)
                  setEditError(null)
                  void command("rename_reminder", {
                    id: editing.id,
                    title: editTitle,
                    expectedOccurrenceRevision: editing.occurrenceRevision ?? 0,
                  })
                    .then(() => setEditing(null))
                    .catch((error: Error) => setEditError(error.message))
                    .finally(() => setRenaming(false))
                }}
              >
                Save title only
              </Button>
              {editError && <p role="alert">{editError}</p>}
              {schedule && schedule.timeZone !== localZone && !reanchor ? (
                <div className="space-y-2">
                  <p>
                    This reminder uses {schedule.timeZone}. Editing in{" "}
                    {localZone} will change its scheduled instant and re-anchor
                    future occurrences to {localZone}.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setReanchor(true)}
                  >
                    Edit using {localZone}
                  </Button>
                </div>
              ) : (
                <ScheduleForm
                  editing
                  key={editing.id}
                  initialValues={initialValues}
                  onSubmit={async (resolved) => {
                    if (!editTitle.trim())
                      throw new Error("Enter a reminder title.")
                    await command("edit_scheduled_reminder", {
                      id: editing.id,
                      title: editTitle,
                      schedule: toReminderSchedule(resolved),
                      expectedOccurrenceRevision:
                        editing.occurrenceRevision ?? 0,
                    })
                    setEditing(null)
                  }}
                />
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
            </section>
          )
        })()}
      <Accordion className="border-y" defaultValue={["upcoming"]} multiple>
        <AccordionItem value="upcoming">
          <AccordionTrigger className="rounded-none px-0 hover:no-underline">
            <span>
              Upcoming{" "}
              <span className="ml-2 font-normal text-muted-foreground">
                {groups.upcoming.length}
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            {groups.upcoming.length ? (
              <>
                <ul>
                  {groups.upcoming.slice(0, upcomingLimit).map((reminder) => (
                    <ReminderRow
                      onEdit={startEditing}
                      key={reminder.id}
                      reminder={reminder}
                      now={now}
                      disabled={disabled}
                      onChange={onChange}
                    />
                  ))}
                </ul>
                {groups.upcoming.length > upcomingLimit ? (
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() => setUpcomingLimit((value) => value + 100)}
                  >
                    Show next{" "}
                    {Math.min(100, groups.upcoming.length - upcomingLimit)}
                  </Button>
                ) : null}
              </>
            ) : (
              <EmptyState>No timed reminders yet.</EmptyState>
            )}
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="untimed">
          <AccordionTrigger className="rounded-none px-0 hover:no-underline">
            <span>
              No timer{" "}
              <span className="ml-2 font-normal text-muted-foreground">
                {groups.untimed.length}
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            {groups.untimed.length ? (
              <>
                <ul>
                  {groups.untimed.slice(0, untimedLimit).map((reminder) => (
                    <ReminderRow
                      onEdit={startEditing}
                      key={reminder.id}
                      reminder={reminder}
                      now={now}
                      disabled={disabled}
                      onChange={onChange}
                    />
                  ))}
                </ul>
                {groups.untimed.length > untimedLimit ? (
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() => setUntimedLimit((value) => value + 100)}
                  >
                    Show next{" "}
                    {Math.min(100, groups.untimed.length - untimedLimit)}
                  </Button>
                ) : null}
              </>
            ) : (
              <EmptyState>None yet.</EmptyState>
            )}
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="previous">
          <AccordionTrigger className="rounded-none px-0 hover:no-underline">
            <span>
              Previous{" "}
              <span className="ml-2 font-normal text-muted-foreground">
                {groups.previous.length}
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            {groups.previous.length ? (
              <>
                <ul>
                  {groups.previous.slice(0, historyLimit).map((reminder) => (
                    <li
                      className="flex items-center gap-3 border-b py-3 text-sm last:border-b-0"
                      key={reminder.id}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium break-words">
                          {reminder.title}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Resolved{" "}
                          {dateLabel(reminder.resolvedAt ?? reminder.createdAt)}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {reminder.status === "completed"
                          ? "Completed"
                          : "Removed"}
                      </span>
                    </li>
                  ))}
                </ul>
                {groups.previous.length > historyLimit ? (
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() => setHistoryLimit((value) => value + 100)}
                  >
                    Show next{" "}
                    {Math.min(100, groups.previous.length - historyLimit)}
                  </Button>
                ) : null}
              </>
            ) : (
              <EmptyState>
                Finished and removed reminders will appear here.
              </EmptyState>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-2 text-[13px] leading-5 text-muted-foreground">
      {children}
    </p>
  )
}
