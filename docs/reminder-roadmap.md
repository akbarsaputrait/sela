# Sela reminder roadmap

**Goal:** make Sela dependable for everyday use, then add flexible reminders without turning it into a complicated task manager.

Sela remains macOS-first, local-first, free, and usable without an Apple Developer subscription. Apple Reminders sync is a separate future milestone, not part of this implementation.

## Current progress

- Fixed in source: a preview alert could block a real due reminder. Due reminders now take priority over preview; a stale preview action cannot dismiss the real reminder.
- Wrote `docs/updating.md` covering local ad-hoc builds, backups, and replacement without a Developer ID subscription.
- Verified at that point: 16 Rust tests and 32 frontend tests passed, plus lint, typecheck, and frontend build.
- Scheduling, recurring occurrences, sound and snooze preferences, and onboarding updates are implemented in source; see [`scheduling.md`](scheduling.md) for the time-zone policy.
- An isolated test bundle has been built and its separate database startup checked. Full physical macOS verification is still required; see [`reminder-reliability-checklist.md`](reminder-reliability-checklist.md). No new app has been installed over the user's existing copy.

## Phase 1 — Reliability and data safety

1. Test a packaged build with an **isolated test database**, not the user's actual reminders.
2. Verify normal due reminders, sleep across a deadline followed by wake, app quit/restart, and several reminders becoming overdue simultaneously.
3. Test full-screen and notch alerts across Spaces and multiple displays.
4. Test native notifications with permissions allowed/denied and macOS Focus enabled; test actions on old notifications.
5. Verify global-shortcut conflicts preserve the menu-bar fallback, and Launch at Login after moving Sela to `/Applications`.
6. Test SQLite migration, backup, recovery, and failed writes. Add targeted regression tests for confirmed bugs.

**Acceptance:** reminders are not silently marked complete on delivery failure; overdue reminders remain visible and actionable; stale alert actions cannot mutate newer occurrences; errors describe recovery. Document macOS constraints. Sela cannot wake a sleeping or powered-off Mac, and in-app alerts require it to be running.

## Phase 2 — Reminder model and database migration

Establish a shared scheduling model before building the features independently.

- Add versioned SQLite migrations for scheduled date/time, recurrence rules and optional range end, explicitly selected dates if chosen, snooze state, per-occurrence identity, sound and default snooze preferences.
- Keep the original occurrence schedule separate from temporary snooze time, so snoozing does not shift the entire series.
- Preserve IDs, text, statuses, existing settings, and prototype JSON migration behavior.
- Back up before migration; reject unsupported newer database schemas without modifying them.

**Acceptance:** existing databases upgrade without lost reminders/settings; failed migrations remain recoverable. Test fresh install, upgrade, malformed data, restart, and rollback behavior.

## Phase 3 — Specific date/time and editing

Keep quick add compact. The existing `Other` control can open a small scheduling panel for either duration (`45m`) or specific date and time using native-style controls. Repeat options come from Phase 4. Show the resolved date/time before saving; no AI or natural-language guessing is required initially.

Add **Edit** to a reminder in Activities:
- Edit title and schedule while preserving reminder identity and history.
- Validate invalid and past times with clear messages.
- Reject stale alert actions that could otherwise overwrite an edited reminder.

**Time-zone policy:** one-time reminders store a resolved instant. Recurring reminders are anchored to the chosen local date and wall-clock time. Define and document behavior for time-zone changes and ambiguous/nonexistent daylight-saving times before implementation; do not silently choose an unexpected date.

**Acceptance:** creation and edits work offline, survive restart, and show the same intended schedule in quick add, Activities, and alerts.

## Phase 4 — Flexible recurring reminders

First version:
- Daily.
- Weekly, selecting one or more weekdays.
- Optional start and inclusive end date (date range).
- Multiple explicitly selected dates sharing a reminder and time.

Avoid complex patterns such as “third Tuesday of every second month” until required.

### Missed-occurrence policy

User chose **at most one catch-up alert** after sleep or app downtime. If multiple occurrences were missed, do not flood the user; surface one overdue reminder and continue to the next valid scheduled occurrence after it is handled.

### Interaction rules

- **Done** completes the current occurrence, not the entire series.
- Stop repeating/remove the series is an explicit action.
- Show the editing scope clearly. Initial recommendation: edit **future occurrences**; snooze handles the current one.
- Validate start/end dates, de-duplicate selected dates, and state that the range end is inclusive.

**Decision:** explicitly selected dates share one time in v1, as approved by the user.

**Acceptance:** tests cover daily, multiple weekdays, selected dates, range boundaries, snooze, restart, missed events, DST transitions, and time-zone changes.

## Phase 5 — Sound and snooze

### Sound

- Settings provide sound on/off and a short preview.
- Begin with a small number of system or locally bundled sounds; no network assets.
- Apply preference to full-screen and notch alerts.
- For native notification banners, verify macOS capabilities; explain that Notification Center/Focus settings can affect sound and delivery.

### Snooze

- User chooses a default duration in Settings, e.g. 5, 10, 15, or 30 minutes.
- Alerts keep one primary snooze action labelled with the chosen duration.
- A secondary menu may offer another duration without placing every choice directly on the alert.
- Verify native-notification actions reflect the selected duration, or honestly disclose any platform-limited fixed duration.

**Acceptance:** preferences persist; previews are optional; snooze neither completes a reminder nor changes future recurring occurrences.

## Phase 6 — Onboarding review

Keep three short slides matching the current compact dashboard and monochrome/Follow System appearance:

1. Quick add: shortcut and compact input.
2. Alerts: three styles with optional preview.
3. Stay ready: optional Launch at Login and what happens during sleep.

Use real screenshots when available; keep existing local diagrams as clearly identified placeholders until then. Do not automatically request permissions or enable Launch at Login. Do not imply Apple Reminders sync exists before it ships.

## Phase 7 — Update and release workflow

Extend and verify `docs/updating.md`:
- Confirm local build and update commands against the final build.
- Explain quitting Sela, backing up the SQLite database plus existing WAL/SHM sidecars, replacing the app, and verifying its version and data.
- Explain cautious restore/rollback across database schema changes.
- Explain ad-hoc signing and possible Gatekeeper warnings.
- Maintain a concise changelog.

A paid Apple Developer account is **not required for personal local builds**. Public distribution to other users requires a separate decision on Developer ID signing and notarization; do not describe an ad-hoc build as notarized.

## Delivery order

| Order | Milestone | Verification |
|---|---|---|
| 1 | Reliability pass | Packaged-app manual checklist and regression tests |
| 2 | SQLite/model migration | Upgrade, backup, failed write, restart tests |
| 3 | Specific date/time and editing | Create/edit/restart and time-zone tests |
| 4 | Flexible recurrence | Range, selected dates, missed events and DST tests |
| 5 | Sound and snooze | Persistence and all alert styles |
| 6 | Onboarding refresh | Keyboard, light/dark and permission behavior |
| 7 | Update guide and local build | Follow the guide on a packaged test build |
