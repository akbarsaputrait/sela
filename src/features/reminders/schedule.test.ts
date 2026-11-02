import { describe, expect, it, vi } from "vitest"

import {
  editScheduleValues,
  localDateTime,
  resolveSchedule,
  type ScheduleFormValues,
} from "./schedule"

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
