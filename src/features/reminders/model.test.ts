import { describe, expect, it } from "vitest"

import type { Reminder } from "@/app/native-store"
import {
  groupReminders,
  MAX_DURATION_MS,
  parseDuration,
  remainingLabel,
} from "./model"

describe("duration input", () => {
  it.each([
    ["", null],
    ["10", 600_000],
    ["5m", 300_000],
    ["1h 30m", 5_400_000],
    ["1h30m", 5_400_000],
    ["10s", 10_000],
    ["720h", MAX_DURATION_MS],
  ])("parses %j", (input, expected) =>
    expect(parseDuration(input)).toBe(expected)
  )
  it.each([
    "0",
    "-1",
    "1.5h",
    "5m5m",
    "1e3",
    "at 3:30",
    "721h",
    "999999999999999m",
  ])("rejects %j", (input) => expect(() => parseDuration(input)).toThrow())
})

it("groups reminders by active status and time without mutating source", () => {
  const item = (
    id: string,
    dueAt: number | null,
    status: Reminder["status"]
  ): Reminder => ({
    id,
    title: id,
    createdAt: 100,
    dueAt,
    status,
    resolvedAt: status === "pending" ? null : 200,
    appleReminderId: null,
  })
  const data = [
    item("later", 200, "pending"),
    item("untimed", null, "pending"),
    item("first", 100, "pending"),
    item("removed", 50, "cancelled"),
    item("done", 0, "completed"),
  ]
  const before = JSON.stringify(data)
  const groups = groupReminders(data)
  expect(groups.upcoming.map((r) => r.id)).toEqual(["first", "later"])
  expect(groups.untimed.map((r) => r.id)).toEqual(["untimed"])
  expect(groups.previous.map((r) => r.id)).toEqual(["done", "removed"])
  expect(JSON.stringify(data)).toBe(before)
})

it("uses deterministic ordering when timestamps match", () => {
  const make = (
    id: string,
    createdAt: number,
    dueAt: number | null,
    status: Reminder["status"],
    resolvedAt: number | null
  ): Reminder => ({
    id,
    title: id,
    createdAt,
    dueAt,
    status,
    resolvedAt,
    appleReminderId: null,
  })
  const data = [
    make("b", 100, 200, "pending", null),
    make("a", 100, 200, "pending", null),
    make("d", 100, null, "pending", null),
    make("c", 100, null, "pending", null),
    make("z", 100, 20, "completed", 300),
    make("y", 200, 20, "completed", 300),
  ]
  const result = groupReminders(data)
  expect(result.upcoming.map((item) => item.id)).toEqual(["a", "b"])
  expect(result.untimed.map((item) => item.id)).toEqual(["c", "d"])
  expect(result.previous.map((item) => item.id)).toEqual(["y", "z"])
})

it("labels due and untimed reminders", () => {
  expect(remainingLabel(null, 100)).toBe("No timer")
  expect(remainingLabel(100, 100)).toBe("Due now")
  expect(remainingLabel(10_100, 100)).toBe("In 10s")
  expect(remainingLabel(3_600_100, 100)).toBe("In 1h")
})
