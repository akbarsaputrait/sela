import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  editScheduleValues,
  localDateString,
  resolveSchedule,
  type ResolvedSchedule,
  type ScheduleFormValues,
  type ScheduleKind,
} from "./schedule"

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

export function ScheduleForm({
  initialValues,
  editing = false,
  onSubmit,
  submitLabel = "Save reminder",
}: {
  initialValues?: ScheduleFormValues
  editing?: boolean
  onSubmit: (schedule: ResolvedSchedule) => Promise<void>
  submitLabel?: string
}) {
  const id = React.useId()
  const [values, setValues] = React.useState<ScheduleFormValues>(
    () =>
      (initialValues && editing
        ? editScheduleValues(initialValues)
        : initialValues) ?? {
        kind: "once",
        date: localDateString(new Date()),
        time: "",
        weekdays: [],
        dates: [""],
        endDate: "",
      }
  )
  const [submitted, setSubmitted] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const submitting = React.useRef(false)
  const [today] = React.useState(() => localDateString(new Date()))
  const result = resolveSchedule(values)
  const update = (patch: Partial<ScheduleFormValues>) =>
    setValues((current) => ({ ...current, ...patch }))
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time"

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        setSubmitted(true)
        const current = resolveSchedule(values)
        if (!current.schedule || submitting.current) return
        submitting.current = true
        setSaving(true)
        setError(null)
        void onSubmit(current.schedule)
          .catch((failure: unknown) =>
            setError(
              failure instanceof Error
                ? failure.message
                : "Something went wrong. Please try again."
            )
          )
          .finally(() => {
            submitting.current = false
            setSaving(false)
          })
      }}
    >
      <fieldset disabled={saving} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor={`${id}-kind`}>Schedule</label>
          <select
            id={`${id}-kind`}
            className="block w-full rounded-md border bg-background p-2"
            value={values.kind}
            onChange={(event) =>
              update({ kind: event.target.value as ScheduleKind })
            }
          >
            <option value="once">One time</option>
            <option value="daily">Daily</option>
            <option value="weekdays">Selected weekdays</option>
            <option value="dates">Selected dates</option>
          </select>
        </div>
        {values.kind !== "dates" && (
          <div className="space-y-1">
            <label htmlFor={`${id}-date`}>
              {values.kind === "once" ? "Date" : "Start date"}
            </label>
            <Input
              id={`${id}-date`}
              type="date"
              min={today}
              value={values.date}
              onChange={(event) => update({ date: event.target.value })}
            />
          </div>
        )}
        {values.kind === "weekdays" && (
          <fieldset className="space-y-2">
            <legend>Weekdays</legend>
            <div className="flex flex-wrap gap-3">
              {DAYS.map((day, index) => (
                <label className="flex items-center gap-1" key={day}>
                  <input
                    type="checkbox"
                    checked={values.weekdays.includes(index)}
                    onChange={(event) =>
                      update({
                        weekdays: event.target.checked
                          ? [...values.weekdays, index]
                          : values.weekdays.filter((value) => value !== index),
                      })
                    }
                  />
                  {day}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {values.kind === "dates" && (
          <fieldset className="space-y-2">
            <legend>Dates</legend>
            {values.dates.map((date, index) => (
              <div className="flex items-end gap-2" key={index}>
                <div className="flex-1 space-y-1">
                  <label htmlFor={`${id}-date-${index}`}>
                    Date {index + 1}
                  </label>
                  <Input
                    id={`${id}-date-${index}`}
                    type="date"
                    min={today}
                    value={date}
                    onChange={(event) =>
                      update({
                        dates: values.dates.map((value, i) =>
                          i === index ? event.target.value : value
                        ),
                      })
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`Remove date ${index + 1}`}
                  onClick={() =>
                    update({
                      dates: values.dates.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => update({ dates: [...values.dates, ""] })}
            >
              Add date
            </Button>
          </fieldset>
        )}
        <div className="space-y-1">
          <label htmlFor={`${id}-time`}>Time</label>
          <Input
            id={`${id}-time`}
            type="time"
            value={values.time}
            onChange={(event) => update({ time: event.target.value })}
          />
          <p className="text-sm text-muted-foreground">
            Local time · {timeZone}
          </p>
        </div>
        {values.kind !== "once" && (
          <div className="space-y-1">
            <label htmlFor={`${id}-end`}>End date (optional, inclusive)</label>
            <Input
              id={`${id}-end`}
              type="date"
              min={today}
              value={values.endDate}
              onChange={(event) => update({ endDate: event.target.value })}
            />
          </div>
        )}
        {result.schedule && (
          <p role="status" className="text-sm">
            Next:{" "}
            {new Intl.DateTimeFormat(undefined, {
              dateStyle: "full",
              timeStyle: "short",
            }).format(result.schedule.nextOccurrence)}{" "}
            ({timeZone})
          </p>
        )}
        {submitted && result.errors.length > 0 && (
          <div role="alert" className="text-sm text-destructive">
            <ul>
              {result.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Times are checked for daylight saving changes when saved.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit">{saving ? "Saving…" : submitLabel}</Button>
      </fieldset>
    </form>
  )
}
