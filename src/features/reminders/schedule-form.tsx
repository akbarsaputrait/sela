import * as React from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  editScheduleValues,
  localDateString,
  MAX_SELECTED_DATES,
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

const SCHEDULE_KINDS = [
  { value: "once", label: "One time" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Selected weekdays" },
  { value: "dates", label: "Selected dates" },
] as const

export function ScheduleForm({
  initialValues,
  editing = false,
  disabled = false,
  onSubmit,
  submitLabel = "Save reminder",
  formId,
  externalSubmit = false,
}: {
  initialValues?: ScheduleFormValues
  editing?: boolean
  disabled?: boolean
  onSubmit: (schedule: ResolvedSchedule) => Promise<void>
  formId?: string
  externalSubmit?: boolean
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
      id={formId}
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        setSubmitted(true)
        const current = resolveSchedule(values)
        if (disabled || !current.schedule || submitting.current) return
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
      <FieldSet disabled={disabled || saving}>
        <FieldGroup className="gap-4">
          <Field className="gap-1">
            <FieldLabel htmlFor={`${id}-kind`}>Schedule</FieldLabel>
            <Select
              items={SCHEDULE_KINDS}
              value={values.kind}
              disabled={disabled || saving}
              onValueChange={(kind) => {
                if (kind) update({ kind: kind as ScheduleKind })
              }}
            >
              <SelectTrigger id={`${id}-kind`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {SCHEDULE_KINDS.map((kind) => (
                    <SelectItem key={kind.value} value={kind.value}>
                      {kind.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {values.kind !== "dates" && (
            <Field className="gap-1">
              <FieldLabel htmlFor={`${id}-date`}>
                {values.kind === "once" ? "Date" : "Start date"}
              </FieldLabel>
              <Input
                id={`${id}-date`}
                type="date"
                min={today}
                value={values.date}
                onChange={(event) => update({ date: event.target.value })}
              />
            </Field>
          )}
          {values.kind === "weekdays" && (
            <FieldSet className="gap-2">
              <FieldLegend variant="label">Weekdays</FieldLegend>
              <div className="flex flex-wrap gap-3">
                {DAYS.map((day, index) => (
                  <Field orientation="horizontal" className="w-auto" key={day}>
                    <Checkbox
                      id={`${id}-weekday-${index}`}
                      disabled={disabled || saving}
                      checked={values.weekdays.includes(index)}
                      onCheckedChange={(checked) =>
                        update({
                          weekdays: checked
                            ? [...values.weekdays, index]
                            : values.weekdays.filter(
                                (value) => value !== index
                              ),
                        })
                      }
                    />
                    <FieldLabel htmlFor={`${id}-weekday-${index}`}>
                      {day}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
            </FieldSet>
          )}
          {values.kind === "dates" && (
            <FieldSet className="gap-2">
              <FieldLegend variant="label">Dates</FieldLegend>
              {values.dates.map((date, index) => (
                <div className="flex items-end gap-2" key={index}>
                  <Field className="flex-1 gap-1">
                    <FieldLabel htmlFor={`${id}-date-${index}`}>
                      Date {index + 1}
                    </FieldLabel>
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
                  </Field>
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
                disabled={values.dates.length >= MAX_SELECTED_DATES}
                onClick={() => update({ dates: [...values.dates, ""] })}
              >
                Add date
              </Button>
              {values.dates.length >= MAX_SELECTED_DATES && (
                <p role="status" className="text-sm">
                  A schedule can include at most 10,000 dates.
                </p>
              )}
            </FieldSet>
          )}
          <Field className="gap-1">
            <FieldLabel htmlFor={`${id}-time`}>Time</FieldLabel>
            <Input
              id={`${id}-time`}
              type="time"
              value={values.time}
              onChange={(event) => update({ time: event.target.value })}
            />
            <FieldDescription>Local time · {timeZone}</FieldDescription>
          </Field>
          {values.kind !== "once" && (
            <Field className="gap-1">
              <FieldLabel htmlFor={`${id}-end`}>
                End date (optional, inclusive)
              </FieldLabel>
              <Input
                id={`${id}-end`}
                type="date"
                min={today}
                value={values.endDate}
                onChange={(event) => update({ endDate: event.target.value })}
              />
            </Field>
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
          {!externalSubmit && (
            <Button type="submit">{saving ? "Saving…" : submitLabel}</Button>
          )}
        </FieldGroup>
      </FieldSet>
    </form>
  )
}
