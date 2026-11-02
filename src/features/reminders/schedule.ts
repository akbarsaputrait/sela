export type ScheduleKind = "once" | "daily" | "weekdays" | "dates"

// Dates and times are local wall-clock values, not UTC strings.
export type ScheduleFormValues = {
  kind: ScheduleKind
  date: string
  time: string
  weekdays: number[] // Sunday = 0
  dates: string[]
  endDate: string
}

export type ReminderSchedule = {
  kind: ScheduleKind
  date: string
  time: string
  weekdays: number[]
  dates: string[]
  endDate: string | null
  timeZone: string
}

export function toReminderSchedule(
  schedule: ResolvedSchedule
): ReminderSchedule {
  return {
    ...schedule.values,
    date:
      schedule.values.kind === "dates"
        ? (schedule.values.dates[0] ?? schedule.values.date)
        : schedule.values.date,
    weekdays:
      schedule.values.kind === "weekdays" ? schedule.values.weekdays : [],
    dates: schedule.values.kind === "dates" ? schedule.values.dates : [],
    endDate:
      schedule.values.kind === "once" ? null : schedule.values.endDate || null,
    timeZone: schedule.timeZone,
  }
}

export type ResolvedSchedule = {
  values: ScheduleFormValues
  nextOccurrence: Date
  timeZone: string
}

export function localDateTime(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return null
  const [, year, month, day] = d.map(Number)
  const [, hour, minute] = t.map(Number)
  if (year < 100 || hour > 23 || minute > 59) return null
  const result = new Date(year, month - 1, day, hour, minute)
  return result.getFullYear() === year &&
    result.getMonth() === month - 1 &&
    result.getDate() === day &&
    result.getHours() === hour &&
    result.getMinutes() === minute
    ? result
    : null
}

// Date chooses one side of a repeated wall time; the backend skips both.
function isAmbiguous(date: Date): boolean {
  const offset = date.getTimezoneOffset()
  return [-2, -1, 1, 2].some((days) => {
    const nearby = new Date(date.getTime() + days * 86_400_000)
    const difference = (nearby.getTimezoneOffset() - offset) * 60_000
    if (!difference) return false
    const alternative = new Date(date.getTime() + difference)
    return (
      alternative.getFullYear() === date.getFullYear() &&
      alternative.getMonth() === date.getMonth() &&
      alternative.getDate() === date.getDate() &&
      alternative.getHours() === date.getHours() &&
      alternative.getMinutes() === date.getMinutes()
    )
  })
}

export function editScheduleValues(
  values: ScheduleFormValues,
  now = new Date()
): ScheduleFormValues {
  if (values.kind !== "dates") return values
  return {
    ...values,
    dates: values.dates.filter((date) => {
      const occurrence = localDateTime(date, values.time)
      return occurrence === null || occurrence.getTime() > now.getTime()
    }),
  }
}

export function localDateString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function resolveSchedule(
  values: ScheduleFormValues,
  now = new Date()
): { schedule: ResolvedSchedule | null; errors: string[] } {
  const errors: string[] = []
  if (!Intl.DateTimeFormat().resolvedOptions().timeZone) {
    errors.push("Your device time zone is unavailable.")
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(values.time)) {
    errors.push("Choose a valid time.")
  }
  const validDate = (date: string) => localDateTime(date, "12:00") !== null
  const today = localDateString(now)
  if (values.kind !== "dates" && !validDate(values.date))
    errors.push("Choose a valid date.")
  if (values.kind === "dates") {
    if (!values.dates.length || values.dates.some((date) => !validDate(date)))
      errors.push("Choose valid dates for every entry.")
  }
  if (
    values.kind === "weekdays" &&
    (!values.weekdays.length ||
      values.weekdays.some(
        (day) => !Number.isInteger(day) || day < 0 || day > 6
      ))
  )
    errors.push("Choose at least one valid weekday.")
  if (values.kind !== "once" && values.endDate && !validDate(values.endDate))
    errors.push("Choose a valid end date.")
  if (
    values.kind !== "once" &&
    values.endDate &&
    validDate(values.endDate) &&
    values.endDate < today
  )
    errors.push("The end date cannot be in the past.")
  if (
    (values.kind === "daily" || values.kind === "weekdays") &&
    values.endDate &&
    values.endDate < values.date
  )
    errors.push("The end date must be on or after the start date.")
  if (errors.length) return { schedule: null, errors }

  let next: Date | null = null
  if (values.kind === "daily" || values.kind === "weekdays") {
    const start = localDateTime(values.date, values.time)
    if (!start || isAmbiguous(start))
      errors.push(
        "The start date and time is ambiguous or does not exist in the local timezone."
      )
  }
  if (values.kind === "once" || values.kind === "dates") {
    const dates = values.kind === "once" ? [values.date] : values.dates
    const occurrences = dates.map((date) => localDateTime(date, values.time))
    if (occurrences.some((date) => !date))
      errors.push(
        "A selected date and time does not exist in the local timezone."
      )
    if (occurrences.some((date) => date && isAmbiguous(date)))
      errors.push(
        "A selected date and time is ambiguous in the local timezone."
      )
    if (occurrences.some((date) => date && date.getTime() <= now.getTime()))
      errors.push("Choose dates and times in the future.")
    if (
      values.kind === "dates" &&
      values.endDate &&
      dates.some((date) => date > values.endDate)
    )
      errors.push("Selected dates must be on or before the end date.")
    next =
      occurrences
        .filter((date): date is Date => date !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
  } else {
    // A valid weekday must occur within the next week; skip nonexistent DST times.
    const start = localDateTime(
      values.date > today ? values.date : today,
      "12:00"
    )
    if (!start)
      return { schedule: null, errors: ["Choose a valid start date."] }
    for (let offset = 0; offset < 15; offset++) {
      const day = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + offset,
        12
      )
      const date = localDateString(day)
      if (values.endDate && date > values.endDate) break
      if (values.kind === "weekdays" && !values.weekdays.includes(day.getDay()))
        continue
      const candidate = localDateTime(date, values.time)
      if (
        candidate &&
        !isAmbiguous(candidate) &&
        candidate.getTime() > now.getTime()
      ) {
        next = candidate
        break
      }
    }
    if (!next)
      errors.push("No future occurrence falls on or before the end date.")
  }
  if (errors.length || !next) return { schedule: null, errors }
  return {
    schedule: {
      values: {
        ...values,
        weekdays: [...new Set(values.weekdays)].sort((a, b) => a - b),
        dates: [...new Set(values.dates)].sort(),
      },
      nextOccurrence: next,
      timeZone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time",
    },
    errors: [],
  }
}
