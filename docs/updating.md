# Updating Sela on your Mac

Sela is currently an unsigned-development distribution. You do **not** need an Apple Developer subscription to build and use it on your own Mac. A local ad-hoc signature is not the same as Apple Developer ID signing or notarization; Gatekeeper may warn when you open a downloaded or transferred build.

## Before replacing the app

1. In Sela's menu-bar icon, choose **Quit Sela**. Timed alerts will not fire while Sela is closed.
2. Back up your data after Sela has fully quit. The data folder is:

   ```text
   ~/Library/Application Support/com.akbarsaputrait.sela/
   ```

   Copy the entire folder, including `sela.sqlite3`, any `-wal` / `-shm` files, `sela.backup.sqlite3` if present, and the `sounds/` folder containing any uploaded WAV files, to a safe location. Quit Sela first so the SQLite database and WAL files are not copied while they are being written. Do not delete the backup when replacing the app.
3. Note your current version in **About**, and keep the existing `.app` somewhere safe if you may need to roll back.

## Build a local app

From the project directory:

```bash
cd /path/to/sela
bun install --frozen-lockfile
bun run check
cargo test --manifest-path src-tauri/Cargo.toml
APPLE_SIGNING_IDENTITY=- bun run tauri build --bundles app
```

If all commands succeed, the app is written to:

```text
src-tauri/target/release/bundle/macos/Sela.app
```

The build does not update `/Applications` automatically. Open the build folder in Finder and drag `Sela.app` into Applications; choose Replace only after confirming you have the data backup and intend to replace the installed copy. Then launch Sela from Applications.

## Verify after updating

- Open **About** and confirm the expected version.
- Open **Activities** and check a few existing reminders and settings are still present.
- Check `⌘⇧Space` or the shortcut configured in that build, and create a short test reminder.
- If you use Launch at Login, check its switch in **Settings**. If you moved the app, toggle it off and back on after it is in Applications so macOS points at the installed location.
- If you use macOS notifications, check **System Settings → Notifications → Sela**, then use **Test alert** in Settings.

## If something looks wrong

Do not keep opening and closing Sela or delete the database. Quit Sela, preserve the entire data folder and the backup copy, and report the version and the message you see. A restore or rollback may require a matching database schema; **do not replace a newer database with an older backup without explicitly deciding which data you can afford to lose**.

For public distribution to other Macs, Developer ID signing, notarization and Gatekeeper validation remain a separate release step. See [`releasing.md`](releasing.md).
