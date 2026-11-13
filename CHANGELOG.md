# Changelog

## Unreleased

### Added
- Add a branded 1200×630 social preview image, Open Graph metadata, and an X/Twitter large-image card to the landing page.
- Regenerate the social image locally with `bun run og:generate` and automatically during website builds.
- Create verified ad-hoc Apple Silicon draft releases after successful main CI only when application code or its dependency graph changes, with automatic patch tags and protected-main preservation.
- Keep landing-page deployments in the existing Cloudflare Git integration, separate from automatic application drafts.

### Fixed
- Pin Bun 1.4.4 for Cloudflare dependency installation and GitHub builds so the version-2 lockfile is supported.
- Replace retired macOS 14 CI/release runners with supported macOS 15 runners.

## [1.1.0] - 2026-11-04

### Improved
- Explain untimed reminders, dismissed alerts, notification permission, and sleep/Focus behavior where they matter.
- Make overdue and untimed reminders easier to find, and allow confirmed reopening from Previous.
- Show the Sela logo in onboarding and clarify saved timer durations.
- Simplify reminder editing with one save action and consistent schedule controls.
- Let the landing page follow the system appearance or remember a light/dark choice.
- Show reminder occurrence history and allow confirmed cleanup of resolved reminders.
- Make release assets verifiable and automate landing-page updates after stable releases.

### Fixed
- Avoid accidental alert completion from an unfocused Enter key and preserve editor drafts on backdrop clicks.
- Prevent a successful Quick Add save completed after the window closes from leaving a duplicate-ready draft.
- Keep selected Quick Add timer presets readable in dark mode.
- Keep Activities synchronized without other windows overwriting its reminders.
- Prevent alert keyboard shortcuts from completing reminders when another action has focus.
- Keep long alerts usable on smaller screens and prevent duplicate or stale Quick Add saves.
- Preserve reminder drafts when concurrent changes require reloading, and save timer edits atomically.
- Offer recovery when the initial reminder state cannot be loaded and preserve tray navigation requests.
- Route native notification actions correctly, report delivery failures, and clean up unused custom sounds safely.
- Use a monotonic clock for alert queue cooldowns and preserve recurring history across restarts.

## [1.0.0] - 2026-11-01

### Added
- Flexible one-time and recurring schedules, with time-zone-aware reminders and snoozing.
- Alert sound choices and custom WAV uploads.
- A streamlined onboarding experience with selectable alert previews.

### Improved
- Quick Add, reminder activities, alert delivery, and keyboard interactions.
- Motion and reduced-motion behavior across the app and landing page.
- Reminder change detection and debug-panel resource cleanup.

### Security
- Removed untrusted build-time code execution and stopped tracking the unused `.env` file.

### Distribution
- Apple Silicon macOS DMG is ad-hoc signed and not notarized; macOS may require approval on first launch.
