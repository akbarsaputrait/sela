import * as React from "react"

import type { Reminder } from "@/app/native-store"
import { useCurrentTime } from "@/app/clock"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  groupReminders,
  parseDuration,
  remainingLabel,
} from "@/features/reminders/model"
import type { PreviousEntry } from "@/features/reminders/model"
import { ScheduleForm } from "@/features/reminders/schedule-form"
import {
  localDateString,
  toReminderSchedule,
} from "@/features/reminders/schedule"
import { Input } from "@/components/ui/input"
import type { NativeCommand } from "@/app/use-native-state"
import { reminderEditConflict } from "./editor"

const TIMING_OPTIONS = [
  { value: "keep", label: "Keep current timing" },
  { value: "timer", label: "Start a new timer" },
  { value: "schedule", label: "Set a schedule" },
  { value: "none", label: "No timer" },
] as const
type TimingChoice = (typeof TIMING_OPTIONS)[number]["value"]

function dateLabel(timestamp: number) {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function ReminderRow({
  reminder,
  now,
  disabled,
  suppressed = false,
  onChange,
  onEdit,
}: {
  reminder: Reminder
  now: number
  disabled: boolean
  suppressed?: boolean
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
        {suppressed && (
          <p className="mt-1 text-xs text-muted-foreground">
            No further alert is scheduled for this occurrence. Reschedule to be
            reminded again.
          </p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          disabled={disabled}
          size="xs"
          variant="outline"
          onClick={() => onChange(reminder, "reschedule", 5 * 60_000)}
        >
          {effectiveDue === null ? "Start 5m timer" : "+5m"}
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
  suppressedReminderIds,
  disabled,
  onNewReminder,
  onChange,
  command,
}: {
  reminders: Reminder[]
  suppressedReminderIds: string[]
  disabled: boolean
  onNewReminder: () => void
  command: NativeCommand
  onChange: (
    reminder: Reminder,
    action: "done" | "remove" | "reschedule",
    durationMs?: number
  ) => void
}) {
  const suppressedIds = React.useMemo(
    () => new Set(suppressedReminderIds),
    [suppressedReminderIds]
  )
  const now = useCurrentTime()
  const [editing, setEditing] = React.useState<{
    session: number
    reminder: Reminder
    initialReminder: Reminder
  } | null>(null)
  const nextSession = React.useRef(0)
  const currentSession = React.useRef<number | null>(null)
  const saveLock = React.useRef<number | "history" | null>(null)
  const titleInput = React.useRef<HTMLInputElement>(null)
  const returnFocus = React.useRef<HTMLElement | null>(null)
  const [editTitle, setEditTitle] = React.useState("")
  const [editDuration, setEditDuration] = React.useState("")
  const [timingChoice, setTimingChoice] = React.useState<TimingChoice>("keep")
  const scheduleFormId = React.useId()
  const [reanchor, setReanchor] = React.useState(false)
  const [editError, setEditError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [historyMessage, setHistoryMessage] = React.useState<string | null>(
    null
  )
  const [historyError, setHistoryError] = React.useState<string | null>(null)
  const [reopening, setReopening] = React.useState<PreviousEntry | null>(null)
  const reopen = async (entry: PreviousEntry) => {
    if (disabled || saveLock.current !== null) return
    saveLock.current = "history"
    setSaving(true)
    setHistoryError(null)
    setHistoryMessage(null)
    try {
      await command("reopen_reminder", {
        id: entry.kind === "occurrence" ? entry.reminderId : entry.id,
        expectedOccurrenceRevision: entry.occurrenceRevision ?? 0,
        occurrenceIndex:
          entry.kind === "occurrence" ? entry.occurrenceIndex : null,
        occurrenceTimestamp:
          entry.kind === "occurrence" ? entry.timestamp : null,
      })
      setReopening(null)
      setHistoryMessage(
        entry.kind === "occurrence"
          ? "Occurrence reopened as a separate reminder. The series was not changed."
          : "Reminder reopened with its original timing."
      )
    } catch (failure) {
      setHistoryError(
        failure instanceof Error ? failure.message : String(failure)
      )
    } finally {
      saveLock.current = null
      setSaving(false)
    }
  }
  const startEditing = (reminder: Reminder) => {
    if (disabled || saveLock.current !== null) return
    const session = ++nextSession.current
    currentSession.current = session
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    setEditError(null)
    setEditDuration("")
    setTimingChoice("keep")
    setReanchor(false)
    setEditing({ session, reminder, initialReminder: reminder })
    setEditTitle(reminder.title)
  }
  const closeEditor = () => {
    if (saveLock.current !== null) return
    currentSession.current = null
    setEditing(null)
  }
  const latestReminder = editing
    ? reminders.find((reminder) => reminder.id === editing.reminder.id)
    : undefined
  const latestDue =
    latestReminder?.snoozedUntil ?? latestReminder?.dueAt ?? null
  const conflict =
    editing !== null &&
    reminderEditConflict(editing.reminder, latestReminder) !== null
  const editorDisabled = disabled || saving || conflict
  const saveEdit = async (
    name: string,
    timing: Record<string, unknown> = {}
  ) => {
    if (!editing || editorDisabled || saveLock.current !== null)
      throw new Error(
        "This editor is unavailable. Review the latest reminder before saving."
      )
    if (!editTitle.trim()) {
      setEditError("Enter a reminder title.")
      throw new Error("Enter a reminder title.")
    }
    const session = editing.session
    saveLock.current = session
    setSaving(true)
    setEditError(null)
    try {
      await command(name, {
        id: editing.reminder.id,
        title: editTitle,
        expectedOccurrenceRevision: editing.reminder.occurrenceRevision ?? 0,
        ...timing,
      })
      if (currentSession.current === session) {
        currentSession.current = null
        setEditing(null)
      }
    } catch (failure) {
      if (currentSession.current === session)
        setEditError(
          failure instanceof Error ? failure.message : String(failure)
        )
      throw failure
    } finally {
      if (saveLock.current === session) {
        saveLock.current = null
        setSaving(false)
      }
    }
  }
  const saveTimer = (duration: string | null) => {
    try {
      const durationMs = duration === null ? null : parseDuration(duration)
      if (duration !== null && durationMs === null)
        throw new Error("Enter a timer duration, or choose No timer.")
      void saveEdit("edit_timer_reminder", { durationMs }).catch(
        () => undefined
      )
    } catch (failure) {
      setEditError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  const deleteResolved = async () => {
    if (disabled || saveLock.current !== null || !confirmDelete) return
    saveLock.current = "history"
    setSaving(true)
    setHistoryError(null)
    setHistoryMessage(null)
    try {
      const count = await command<number>("clear_resolved_history")
      setConfirmDelete(false)
      setHistoryMessage(
        `Deleted ${count} resolved reminder${count === 1 ? "" : "s"}. Pending reminders and their occurrence history were kept.`
      )
    } catch (failure) {
      setHistoryError(
        failure instanceof Error ? failure.message : String(failure)
      )
    } finally {
      saveLock.current = null
      setSaving(false)
    }
  }
  const [upcomingLimit, setUpcomingLimit] = React.useState(100)
  const [untimedLimit, setUntimedLimit] = React.useState(100)
  const [historyLimit, setHistoryLimit] = React.useState(100)
  const groups = React.useMemo(() => groupReminders(reminders), [reminders])
  const resolvedCount = reminders.filter(
    (reminder) => reminder.status !== "pending"
  ).length
  return (
    <section aria-labelledby="activities-title" className="sela-page">
      <header className="mb-4 flex items-center justify-between gap-4">
        <h1 id="activities-title" className="sela-page-title">
          Activities
        </h1>
        <Button disabled={disabled || saving} onClick={onNewReminder}>
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
          const initialReminder = editing.initialReminder
          const schedule = initialReminder.schedule
          const due = new Date(initialReminder.dueAt ?? now)
          const initialValues = schedule
            ? { ...schedule, endDate: schedule.endDate ?? "" }
            : {
                kind: "once" as const,
                date: localDateString(due),
                time:
                  initialReminder.dueAt === null
                    ? ""
                    : `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`,
                weekdays: [],
                dates: [""],
                endDate: "",
              }
          return (
            <Dialog
              open
              onOpenChange={(open, details) => {
                if (!open && details.reason === "outside-press") return
                if (
                  !open &&
                  details.reason === "escape-key" &&
                  details.event.target instanceof Element &&
                  details.event.target.closest('[role="listbox"]')
                ) {
                  return
                }
                if (!open) closeEditor()
              }}
            >
              <DialogContent
                className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto sm:max-w-xl"
                aria-busy={saving}
                initialFocus={titleInput}
                finalFocus={returnFocus}
                showCloseButton={!saving}
              >
                <DialogHeader>
                  <DialogTitle>Edit reminder</DialogTitle>
                  <DialogDescription>
                    Update the title or replace the reminder timing.
                  </DialogDescription>
                </DialogHeader>
                {conflict && (
                  <div
                    role="alert"
                    className="space-y-2 rounded-md border p-3 text-sm"
                  >
                    <p>
                      This reminder changed while you were editing. Your draft
                      is preserved; nothing has been overwritten.
                    </p>
                    {latestReminder ? (
                      <p>
                        Latest: {latestReminder.title} · {latestReminder.status}
                        {latestReminder.status === "pending"
                          ? ` · ${remainingLabel(latestReminder.snoozedUntil ?? latestReminder.dueAt, now)}`
                          : ""}
                        {latestReminder.status === "pending" &&
                        latestDue !== null
                          ? ` · ${dateLabel(latestDue)}`
                          : ""}
                        {latestReminder.schedule &&
                        latestReminder.schedule.kind !== "once"
                          ? ` · repeats in ${latestReminder.schedule.timeZone}`
                          : ""}
                      </p>
                    ) : (
                      <p>The reminder is no longer available.</p>
                    )}
                    {latestReminder?.status === "pending" && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={disabled || saving}
                        onClick={() => {
                          setEditing({ ...editing, reminder: latestReminder })
                          setEditError(null)
                        }}
                      >
                        Reload latest version (keep draft)
                      </Button>
                    )}
                    <p>
                      After reloading, review your draft before saving it over
                      the latest version, or cancel.
                    </p>
                  </div>
                )}
                {!conflict && editing.reminder !== editing.initialReminder && (
                  <p role="status" className="text-sm">
                    Latest version loaded; your draft was kept. Review it before
                    saving. A timing save replaces the latest schedule and
                    snooze.
                  </p>
                )}
                <FieldGroup className="gap-4">
                  <Field className="gap-1.5">
                    <FieldLabel htmlFor="edit-reminder-title">Title</FieldLabel>
                    <Input
                      ref={titleInput}
                      id="edit-reminder-title"
                      maxLength={240}
                      disabled={editorDisabled}
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                    />
                  </Field>
                  <Field className="gap-1.5">
                    <FieldLabel htmlFor="edit-reminder-timing">
                      Timing
                    </FieldLabel>
                    <Select
                      items={TIMING_OPTIONS}
                      value={timingChoice}
                      disabled={editorDisabled}
                      onValueChange={(value) => {
                        if (value) {
                          setTimingChoice(value as TimingChoice)
                          setEditError(null)
                        }
                      }}
                    >
                      <SelectTrigger
                        id="edit-reminder-timing"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {TIMING_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {timingChoice === "keep" && (
                      <FieldDescription>
                        {latestDue === null
                          ? "Currently has no timer."
                          : `Currently ${dateLabel(latestDue)}${editing.reminder.snoozedUntil != null ? " · snoozed" : ""}.`}
                      </FieldDescription>
                    )}
                  </Field>
                  {timingChoice !== "keep" &&
                    (editing.reminder.schedule ||
                      editing.reminder.snoozedUntil != null) && (
                      <p className="text-sm text-muted-foreground">
                        Changing timing replaces the current schedule and
                        snooze. Completed occurrences are kept.
                      </p>
                    )}
                  {timingChoice === "timer" && (
                    <Field className="gap-1.5">
                      <FieldLabel htmlFor="edit-reminder-duration">
                        Duration
                      </FieldLabel>
                      <Input
                        id="edit-reminder-duration"
                        placeholder="10m, 1h 30m, or 10s"
                        disabled={editorDisabled}
                        value={editDuration}
                        onChange={(event) =>
                          setEditDuration(event.target.value)
                        }
                      />
                      <FieldDescription>
                        Starts when saved. A number alone means minutes.
                      </FieldDescription>
                    </Field>
                  )}
                  <div hidden={timingChoice !== "schedule"}>
                    {schedule &&
                    schedule.timeZone !== localZone &&
                    !reanchor ? (
                      <div className="flex flex-col gap-2">
                        <p>
                          This reminder uses {schedule.timeZone}. Editing in{" "}
                          {localZone} changes its scheduled instant and
                          re-anchors future occurrences to {localZone}.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={editorDisabled}
                          onClick={() => setReanchor(true)}
                        >
                          Edit using {localZone}
                        </Button>
                      </div>
                    ) : (
                      <ScheduleForm
                        editing
                        disabled={editorDisabled}
                        key={editing.session}
                        formId={scheduleFormId}
                        externalSubmit
                        initialValues={initialValues}
                        onSubmit={(resolved) =>
                          saveEdit("edit_scheduled_reminder", {
                            schedule: toReminderSchedule(resolved),
                          })
                        }
                      />
                    )}
                  </div>
                  {editError && (
                    <p role="alert" className="text-sm text-destructive">
                      {editError}
                    </p>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={closeEditor}
                    >
                      Cancel
                    </Button>
                    <Button
                      type={timingChoice === "schedule" ? "submit" : "button"}
                      form={
                        timingChoice === "schedule" ? scheduleFormId : undefined
                      }
                      disabled={
                        editorDisabled ||
                        !editTitle.trim() ||
                        (timingChoice === "schedule" &&
                          !!schedule &&
                          schedule.timeZone !== localZone &&
                          !reanchor)
                      }
                      onClick={() => {
                        if (timingChoice === "keep")
                          void saveEdit("rename_reminder").catch(
                            () => undefined
                          )
                        else if (timingChoice === "timer")
                          saveTimer(editDuration)
                        else if (timingChoice === "none") saveTimer(null)
                      }}
                    >
                      {saving ? "Saving…" : "Save changes"}
                    </Button>
                  </div>
                </FieldGroup>
              </DialogContent>
            </Dialog>
          )
        })()}
      <Accordion
        className="border-y"
        defaultValue={["upcoming", "untimed"]}
        multiple
      >
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
                      suppressed={suppressedIds.has(reminder.id)}
                      now={now}
                      disabled={disabled || saving}
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
                      disabled={disabled || saving}
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
            <div className="mb-3 space-y-2">
              {confirmDelete ? (
                <div
                  role="group"
                  aria-label="Confirm deleting resolved reminders"
                  className="space-y-2 rounded-md border p-3 text-sm"
                >
                  <p>
                    Permanently delete all completed and removed reminders and
                    their recorded occurrences? Pending reminders, recurring
                    schedules, and their recorded occurrences will not be
                    deleted.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={disabled || saving}
                      onClick={() => void deleteResolved()}
                    >
                      Delete resolved reminders permanently
                    </Button>
                    <Button
                      variant="outline"
                      disabled={saving}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Keep reminders
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  disabled={disabled || saving || resolvedCount === 0}
                  onClick={() => {
                    setConfirmDelete(true)
                    setHistoryMessage(null)
                    setHistoryError(null)
                  }}
                >
                  Delete resolved reminders
                </Button>
              )}
              {historyMessage && (
                <p role="status" className="text-sm">
                  {historyMessage}
                </p>
              )}
              {historyError && (
                <p role="alert" className="text-sm">
                  {historyError}
                </p>
              )}
            </div>
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
                          {reminder.kind === "occurrence"
                            ? `Scheduled for ${dateLabel(reminder.timestamp)}`
                            : reminder.resolvedAt !== null
                              ? `Resolved ${dateLabel(reminder.resolvedAt)}`
                              : "Resolution time unavailable"}
                        </p>
                      </div>
                      {reopening?.id === reminder.id ? (
                        <div
                          role="group"
                          aria-label={`Confirm reopening ${reminder.title}`}
                          className="flex flex-col items-end gap-2"
                        >
                          <p className="text-xs text-muted-foreground">
                            {reminder.kind === "occurrence"
                              ? "Creates a separate reminder for this occurrence; the series stays unchanged."
                              : "Reopens with its original timing and schedule."}
                            {(reminder.kind === "occurrence"
                              ? reminder.timestamp
                              : reminder.dueAt) !== null &&
                            (reminder.kind === "occurrence"
                              ? reminder.timestamp
                              : reminder.dueAt!) <= now
                              ? " This time has passed and may alert immediately."
                              : ""}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              size="xs"
                              disabled={disabled || saving}
                              onClick={() => void reopen(reminder)}
                            >
                              Confirm reopen
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={saving}
                              onClick={() => setReopening(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={disabled || saving}
                          onClick={() => {
                            setHistoryError(null)
                            setHistoryMessage(null)
                            setReopening(reminder)
                          }}
                        >
                          Reopen
                        </Button>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {reminder.kind === "occurrence"
                          ? "Completed occurrence"
                          : reminder.status === "completed"
                            ? "Reminder completed"
                            : "Reminder removed"}
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
                Completed occurrences and resolved reminders will appear here.
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
