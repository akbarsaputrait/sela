# Reminder reliability checklist

Run these checks on a separately identified test build with an isolated database. Do not use or overwrite the installed Sela app or its reminder data. Record the macOS version, app version, display configuration, results, and any error messages. Never assume an automated smoke test proves that macOS displayed a notification.

## Build the isolated test app

From the project root, build the explicitly separate test bundle:

```sh
APPLE_SIGNING_IDENTITY=- bun run tauri build --bundles app --config src-tauri/tauri.reliability.conf.json
```

The resulting `src-tauri/target/release/bundle/macos/Sela Reliability Test.app` uses the bundle identifier `com.akbarsaputrait.sela.reliability-test` and its own Application Support directory. Its legacy import cannot access the real prototype's data path. This is an ad-hoc test build, not a notarized release. Do not replace the installed app with it.

## Data isolation

- Confirm the test app's bundle identifier and Application Support directory are different from the installed app's, and confirm the test database contains only test reminders before proceeding.
- Do not import the real prototype JSON into the test database. Do not change the installed app's Launch at Login setting.
- Back up any test database and its WAL/SHM sidecars only after quitting the test app. Never restore an older database over data you need to keep.

## Reminder delivery

- Create a short reminder in each alert style. Confirm it becomes visible, remains pending until handled, and Done and snooze affect the intended reminder.
- Let several reminders become overdue together; confirm each remains actionable and none is silently marked complete.
- Quit and restart with reminders due while the app was closed. Confirm overdue reminders are visible and actionable.
- With permission to interrupt the test Mac, let it sleep across a deadline and wake it. Confirm overdue behavior; Sela cannot wake a sleeping or powered-off Mac.
- Switch Spaces and test fullscreen and notch alerts; repeat on each available display, including a notched display if available.

## Native integration

- Check native notifications with permission allowed and denied and with Focus enabled. macOS may suppress or delay delivery or sound; a successful API call does not guarantee a visible banner.
- Trigger actions on old notifications after a reminder has been edited, snoozed, completed, or advanced to another occurrence. Confirm they cannot change a newer occurrence.
- Occupy the global shortcut with another application and confirm the menu-bar fallback works. Restore the original shortcut configuration afterward.
- Verify Launch at Login only with the isolated test build, after moving that test build to its test location; clean up its login item afterward. Do not alter the installed app's login item.

## Storage and recovery

- Test a fresh database, upgrade from a copy of an older database, and restart. Verify IDs, reminders, statuses, settings, and legacy import behavior.
- Verify a consistent backup exists before migration and that a simulated migration failure leaves the original database recoverable.
- Simulate a failed write against test data and confirm no partial changes appear after restart.
- Test corrupt and newer-schema databases using copies. Confirm no silent reset or downgrade and that recovery messages identify what to preserve.

## Results

Record **pass**, **fail**, or **not tested** for each check, with reproduction steps for failures. Multiple displays, sleep/wake, Focus, and real notification permissions require a suitable physical macOS environment; leave them unverified if unavailable.

Latest isolated-build smoke check: the ad-hoc test bundle launched with the test identifier, created its own schema-v3 database, and recorded `legacy_import=none-found` with zero reminders. This checks startup isolation only; it does **not** establish notification, alert, sleep/wake, or login-item behavior.
