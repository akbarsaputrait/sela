# Scheduling policy

- A one-time reminder stores a resolved instant. Changing the Mac's time zone changes how that instant is displayed, not when it fires.
- A recurring reminder is anchored to the IANA time zone, local date, and wall-clock time chosen when it is created or edited. Moving the Mac to another time zone does not change the series' zone; the interface should show that zone.
- When creating or editing, local times that are nonexistent or ambiguous because of daylight-saving changes are rejected with an explanation rather than silently choosing an instant. For future daily or weekly dates where the chosen wall time is nonexistent or ambiguous, that occurrence is skipped; the next valid date is used. Explicitly selected dates with ambiguous or nonexistent times are rejected when saved. The app cannot alert while the Mac is asleep or powered off or while Sela is not running.
- A range's end date is inclusive in the series' time zone. Explicitly selected dates share a time and are normalized and de-duplicated.
- After downtime or sleep, at most one missed occurrence per series is surfaced. Once it is handled, the next occurrence is the first valid scheduled time in the future. Snoozing changes only the current occurrence's delivery time, not the series schedule.
