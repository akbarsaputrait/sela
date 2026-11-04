import { describe, expect, it, vi } from "vitest"

import fixturesJson from "./schedule-fixtures.json?raw"
import {
  MAX_SELECTED_DATES,
  editScheduleValues,
  localDateTime,
  resolveSchedule,
  type ScheduleFormValues,
  type ReminderSchedule,
} from "./schedule"

const fixtures = JSON.parse(fixturesJson) as {
  name: string
  schedule: ReminderSchedule
  after: string
  expected: string | null
}[]

const now = new Date(2030, 0, 7, 10, 0) // Monday
const base: ScheduleFormValues = {
  kind: "once",
  date: "2030-01-07",
  time: "11:00",
  weekdays: [],
  dates: [],
  endDate: "",
}

describe("schedule resolution", () => {
  it.each(fixtures)("$name matches the shared expected instant", (fixture) => {
    vi.stubEnv("TZ", fixture.schedule.timeZone)
    try {
      const result = resolveSchedule(
        {
          ...fixture.schedule,
          kind: fixture.schedule.kind as ScheduleFormValues["kind"],
          endDate: fixture.schedule.endDate ?? "",
        },
        new Date(fixture.after)
      )
      expect(result.schedule?.nextOccurrence.getTime() ?? null).toBe(
        fixture.expected === null ? null : Date.parse(fixture.expected)
      )
      if (fixture.expected === null)
        expect(result.errors.length).toBeGreaterThan(0)
      else expect(result.errors).toEqual([])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("accepts the selected-date limit and rejects over-cap selections", () => {
    const values: ScheduleFormValues = {
      ...base,
      kind: "dates",
      dates: Array.from({ length: MAX_SELECTED_DATES }, () => "2030-01-08"),
    }
    expect(resolveSchedule(values, now).schedule?.values.dates).toEqual([
      "2030-01-08",
    ])
    expect(
      resolveSchedule(
        { ...values, dates: [...values.dates, "2030-01-09"] },
        now
      ).errors
    ).toContain("Choose no more than 10,000 dates.")
  })

  it("resolves a local one-time date and rejects past times and invalid dates", () => {
    expect(resolveSchedule(base, now).schedule?.nextOccurrence).toEqual(
      new Date(2030, 0, 7, 11)
    )
    expect(resolveSchedule({ ...base, time: "09:00" }, now).errors).toContain(
      "Choose dates and times in the future."
    )
    expect(localDateTime("2030-02-30", "10:00")).toBeNull()
    expect(localDateTime("2030-01-01", "24:00")).toBeNull()
  })
  it("finds the next daily or selected weekday occurrence", () => {
    expect(
      resolveSchedule({ ...base, kind: "daily", time: "09:00" }, now).schedule
        ?.nextOccurrence
    ).toEqual(new Date(2030, 0, 8, 9))
    expect(
      resolveSchedule(
        { ...base, kind: "weekdays", weekdays: [1], time: "09:00" },
        now
      ).schedule?.nextOccurrence
    ).toEqual(new Date(2030, 0, 14, 9))
    expect(
      resolveSchedule({ ...base, kind: "weekdays" }, now).errors
    ).toContain("Choose at least one valid weekday.")
  })
  it("removes elapsed selected dates only when preparing an edit", () => {
    const values: ScheduleFormValues = {
      ...base,
      kind: "dates",
      dates: ["2030-01-06", "2030-01-08"],
    }
    expect(resolveSchedule(values, now).schedule).toBeNull()
    const edited = editScheduleValues(values, now)
    expect(edited.dates).toEqual(["2030-01-08"])
    expect(resolveSchedule(edited, now).schedule).not.toBeNull()
    expect(values.dates).toHaveLength(2)
  })
  it("rejects ambiguous selected times and skips repeated recurring times", () => {
    vi.stubEnv("TZ", "America/New_York")
    try {
      const before = new Date(2030, 10, 2, 12)
      const values: ScheduleFormValues = {
        ...base,
        date: "2030-11-03",
        time: "01:30",
      }
      expect(resolveSchedule(values, before).schedule).toBeNull()
      const daily = resolveSchedule(
        { ...values, kind: "daily", date: "2030-11-02" },
        before
      )
      expect(daily.schedule?.nextOccurrence).toEqual(
        new Date(2030, 10, 4, 1, 30)
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it("enforces inclusive end dates", () => {
    expect(
      resolveSchedule({ ...base, kind: "daily", endDate: "2030-01-07" }, now)
        .schedule
    ).not.toBeNull()
    expect(
      resolveSchedule(
        { ...base, kind: "daily", time: "09:00", endDate: "2030-01-07" },
        now
      ).schedule
    ).toBeNull()
  })
  it("normalizes selected dates and rejects past dates and dates beyond the end", () => {
    const values = {
      ...base,
      kind: "dates" as const,
      dates: ["2030-01-09", "2030-01-08"],
    }
    expect(resolveSchedule(values, now).schedule?.nextOccurrence).toEqual(
      new Date(2030, 0, 8, 11)
    )
    expect(
      resolveSchedule({ ...values, dates: ["2030-01-08", "2030-01-08"] }, now)
        .schedule?.values.dates
    ).toEqual(["2030-01-08"])
    expect(
      resolveSchedule({ ...values, dates: ["2030-01-06"] }, now).schedule
    ).toBeNull()
    expect(
      resolveSchedule({ ...values, endDate: "2030-01-08" }, now).schedule
    ).toBeNull()
    expect(values.dates).toEqual(["2030-01-09", "2030-01-08"])
  })
})
