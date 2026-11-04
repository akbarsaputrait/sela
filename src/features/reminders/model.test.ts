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

it("shows only recorded completed occurrences without resolving a pending recurrence", () => {
  const repeating: Reminder = {
    id: "daily",
    title: "Daily walk",
    createdAt: 100,
    dueAt: 500,
    status: "pending",
    resolvedAt: null,
    appleReminderId: null,
    occurrenceHistory: [200, 300],
  }
  const removed: Reminder = {
    ...repeating,
    id: "stopped",
    title: "Stopped recurrence",
    status: "cancelled",
    resolvedAt: 450,
    occurrenceHistory: [250],
  }
  const uncompleted: Reminder = {
    ...repeating,
    id: "not-completed",
    occurrenceHistory: [],
  }
  const source = [repeating, removed, uncompleted]
  const before = JSON.stringify(source)
  const groups = groupReminders(source)
  expect(groups.upcoming.map((entry) => entry.id)).toEqual([
    "daily",
    "not-completed",
  ])
  expect(
    groups.previous.map((entry) => [entry.kind, entry.title, entry.timestamp])
  ).toEqual([
    ["reminder", "Stopped recurrence", 450],
    ["occurrence", "Daily walk", 300],
    ["occurrence", "Stopped recurrence", 250],
    ["occurrence", "Daily walk", 200],
  ])
  expect(
    groups.previous.filter((entry) => entry.kind === "occurrence")
  ).toEqual([
    expect.objectContaining({
      reminderId: "daily",
      occurrenceIndex: 1,
      occurrenceRevision: 0,
    }),
    expect.objectContaining({
      reminderId: "stopped",
      occurrenceIndex: 0,
      occurrenceRevision: 0,
    }),
    expect.objectContaining({
      reminderId: "daily",
      occurrenceIndex: 0,
      occurrenceRevision: 0,
    }),
  ])
  expect(
    groups.previous.filter((entry) => entry.kind === "reminder")
  ).toHaveLength(1)
  expect(JSON.stringify(source)).toBe(before)
})

it("keeps a terminal reminder distinct from its last recorded occurrence", () => {
  const reminder: Reminder = {
    id: "last",
    title: "Final scheduled task",
    createdAt: 1,
    dueAt: 200,
    status: "completed",
    resolvedAt: 210,
    appleReminderId: null,
    occurrenceHistory: [100, 200],
  }
  const previous = groupReminders([reminder]).previous
  expect(previous.map((entry) => [entry.kind, entry.timestamp])).toEqual([
    ["reminder", 210],
    ["occurrence", 200],
    ["occurrence", 100],
  ])
  expect(new Set(previous.map((entry) => entry.id)).size).toBe(3)
})

it("orders mixed history deterministically across the 100-entry page boundary", () => {
  const source: Reminder[] = Array.from({ length: 104 }, (_, index) => ({
    id: `reminder-${String(index).padStart(3, "0")}`,
    title: `Task ${index}`,
    createdAt: 1,
    dueAt: 100,
    status: index % 2 === 0 ? "pending" : "cancelled",
    resolvedAt: index % 2 === 0 ? null : 100,
    appleReminderId: null,
    occurrenceHistory: [100],
  }))
  const forward = groupReminders(source).previous
  const reverse = groupReminders([...source].reverse()).previous
  const firstPage = forward.slice(0, 100)
  const secondPage = forward.slice(100, 200)
  expect(forward.map((entry) => entry.id)).toEqual(
    reverse.map((entry) => entry.id)
  )
  expect(firstPage).toHaveLength(100)
  expect(secondPage).toHaveLength(56)
  expect(
    new Set([...firstPage, ...secondPage].map((entry) => entry.id)).size
  ).toBe(forward.length)
})

it("labels due and untimed reminders", () => {
  expect(remainingLabel(null, 100)).toBe("No timer")
  expect(remainingLabel(100, 100)).toBe("Due now")
  expect(remainingLabel(10_100, 100)).toBe("In 10s")
  expect(remainingLabel(3_600_100, 100)).toBe("In 1h")
  expect(remainingLabel(99, 100)).toBe("Overdue by 1s")
  expect(remainingLabel(100, 120_100)).toBe("Overdue by 2m")
  expect(remainingLabel(100, 3_900_100)).toBe("Overdue by 1h 5m")
})
