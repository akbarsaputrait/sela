import { describe, expect, it } from "vitest"

import { toReminderSchedule } from "./schedule"

describe("schedule command payload", () => {
  it("uses the backend shape and removes irrelevant fields", () => {
    expect(
      toReminderSchedule({
        values: {
          kind: "once",
          date: "2030-01-07",
          time: "11:00",
          weekdays: [1],
          dates: [""],
          endDate: "2030-02-01",
        },
        nextOccurrence: new Date(2030, 0, 7, 11),
        timeZone: "America/New_York",
      })
    ).toEqual({
      kind: "once",
      date: "2030-01-07",
      time: "11:00",
      weekdays: [],
      dates: [],
      endDate: null,
      timeZone: "America/New_York",
    })
  })
})
