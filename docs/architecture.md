# Sela architecture

Sela is a macOS-first, keyboard-first reminder app. Rust owns durable reminder data, validation, scheduling, shortcuts, tray, windows, and notifications. React renders snapshots from Rust and issues explicit commands. There is no Sela account, backend, analytics, or cloud asset dependency.

## Runtime boundaries

```text
React webviews (dashboard / capture / alert)
      │ typed commands + revisioned state events
      ▼
commands.rs ── native delivery orchestration ── windows / Notification Center
      │
      ├── runtime.rs: serialized document mutation + ephemeral due queue
      ├── domain.rs: validated models + pure transitions
      └── storage.rs: SQLite transactions, migrations, backups, recovery
```

Every Tauri window owns a separate JavaScript realm. Rust is the source of truth. `AppRuntime` publishes snapshots with a monotonic revision; the React store subscribes before reading the initial snapshot and ignores older revisions. The dashboard receives the activity list, the alert receives only its active reminder, and quick add receives no reminder rows. Reminder writes run through one async mutation gate, SQLite transaction, and `spawn_blocking` boundary. No `RwLock` guard is held across filesystem or SQLite I/O.

## Rust modules

- `domain.rs`: reminder/status/settings types, limits, normalization, pure transitions.
- `storage.rs`: SQLite schema, WAL, transactions, incremental row updates, legacy import, daily SQLite backup, integrity recovery.
- `runtime.rs`: shared snapshot, mutation gate, state revision, due ordering, alert tokens, failure handoff.
- `commands.rs`: Tauri command validation, state publication, delivery selection, notifications and actions.
- `windows.rs`: dashboard, notch capture, full-screen/notch alert placement, theme application.
- `notifications.rs`: macOS Notification Center messages and Done/Snooze actions.
- `lib.rs`: app composition, tray, global shortcut, single instance, autostart, scheduler, external navigation.

## SQLite data model

Database: `sela.sqlite3` under Tauri `app_data_dir`; SQLite is bundled in Rust, no server or shell executable is required.

- `reminders`: stable ID, text, created/due/resolved times, pending/completed/cancelled state, nullable Apple Reminder ID reserved for future sync.
- `settings`: one row for alert style, appearance, accent theme, and onboarding completion.
- `metadata`: database migration and daily backup metadata.
- `PRAGMA user_version`: SQLite schema version. Schema changes must add an explicit, transactional migration.
- Indexed due queue for pending timed reminders; indexed previous/history query.

Reminder changes update only affected rows in a transaction. SQLite uses WAL, a busy timeout, private user-only data-directory/file permissions, foreign-key enforcement, and synchronous FULL. A daily online SQLite backup is created before the first write of a new day with existing data, and an initial backup is created after the first reminder is saved. Migration and write failures preserve the original source and leave the runtime read-only rather than silently resetting reminders.

## Upgrade/migration

On first Sela run, import a valid prior JSON document from (in order):

1. `~/Library/Application Support/com.akbarsaputrait.sela/sela.json` (an early production-development build),
2. `~/Library/Application Support/local.reminder.prototype/reminders.json` (prototype).

The import and `legacy_import` marker are written in one SQLite transaction; the JSON source is never deleted. IDs, titles, timers, status, alert style, appearance, themes, onboarding state, and migration metadata are preserved. Unknown/malformed versions are rejected with a user-facing error. An existing nonempty Sela database is never overwritten by a legacy import.

SQLite open runs `quick_check`. If integrity fails, Sela preserves the database and existing WAL/SHM sidecars under a timestamped `sela.corrupt-*.sqlite3` name and starts read-only. A schema version newer than this app is left untouched.

## Scheduler and alert policy

Deadlines are absolute Unix timestamps. The native scheduler sleeps until the next deadline, wakes immediately on reminder writes, and rechecks at least every 30 seconds for wall-clock changes. It catches overdue reminders after resume/relaunch; it cannot wake a sleeping or powered-off Mac. Full-screen and notch alerts show one reminder at a time; dismissing leaves it due in Activities. Native notifications hand off the alert while keeping the reminder due and rate-limit overdue backlog delivery. Failed display attempts are kept in Activities and do not block the rest of the queue.

Actions carry both snapshot revision and alert token. Stale alert clicks are rejected. The dashboard groups timed, untimed, and previous records; only a bounded page is rendered at once.

## Frontend structure

- `app/`: one native snapshot store per webview and system-theme synchronization.
- `features/reminders`: duration grammar and status/time selectors.
- `features/quick-add`: compact keyboard entry; no dashboard form.
- `features/activities`: time/status accordion and bounded history paging.
- `features/settings`: system appearance, optional accent, alert style, login item, shortcuts.
- `features/onboarding`: three optional-first-run slides; settings/permissions remain opt-in.
- `features/alert`: fullscreen, notch, and macOS notification interaction.
- `features/about`: version, creator, data and platform limits.
- `components/ui`: upstream shadcn/Base UI primitives; domain composition stays in feature folders.

`ThemeSync` applies appearance and accent to every window. The Tauri notification banner itself is system-owned. Tauri UI debug instrumentation is development-only and mounts only in the dashboard.

## Security and privacy

- No account, analytics, backend, or remote assets.
- Production CSP denies arbitrary network connections, framing, objects, and remote scripts.
- Main/dashboard and auxiliary windows use separate Tauri capabilities. No filesystem/shell/process capability is granted to webviews.
- External URLs go through the existing navigation guard and system browser.
- Reminder text remains in local SQLite unless a future explicit Apple Reminders sync feature is enabled. Native notification content may be displayed by macOS according to system notification settings.

## Release

Initial supported release target: macOS 14+ (Apple Silicon + Intel target builds). `docs/releasing.md` lists CI checks and Apple Developer signing/notarization requirements. No updater is configured. Do not distribute unsigned/ad-hoc bundles as production releases.
