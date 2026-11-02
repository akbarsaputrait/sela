# Contributing to Sela

Thanks for helping make Sela a little easier to remember. Small, focused fixes and clear bug reports are welcome.

## Before you start

For larger changes, open an [issue](https://github.com/akbarsaputrait/sela/issues) first so we can agree on the behavior and scope. Keep Sela local-first, macOS-first, and centered on quick reminders—not a full task or project manager. Apple Reminders sync is not implemented.

## Development setup

Requirements: Bun 1.4+, Rust 1.90+, and macOS 14+ to run the app.

```bash
bun install --frozen-lockfile
bun run tauri dev
```

The landing page runs separately with `bun run dev:website` and builds to `dist-website/`. To deploy, authenticate `gh` with access to the private Sela repository and confirm Wrangler is logged into the Cloudflare account that owns the Sela domain. `bun run deploy:website` builds the site, downloads the latest GitHub release's `*_aarch64.dmg` as `downloads/Sela-macOS-arm64.dmg`, then deploys using `wrangler.jsonc`. Each new release must include exactly one Apple Silicon DMG matching that pattern; redeploy the website after publishing it. Never include GitHub credentials in the output.

`bun install` installs Lefthook; pre-commit automatically formats and lints staged TypeScript files.

## Checks

Before opening a pull request, run:

```bash
bun run check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Changes to the landing page should be checked at mobile and desktop widths, in light and dark appearance, and with reduced motion enabled. For macOS behavior, test on a packaged app when possible; native notifications, sleep/wake, and Spaces cannot be fully verified by frontend tests.

Use isolated test data for storage or alert testing. Never add personal reminder data, credentials, `.env` files, generated `dist/` or `target/` output, or build artifacts to a pull request.

## Commits and pull requests

Use English commit messages in Conventional Commits format, for example:

- `feat: add a reminder preview`
- `fix: preserve overdue reminders after wake`
- `docs: clarify local backup steps`

Keep changes focused. In the pull request description, explain the user-visible behavior and list the checks you ran. Include before/after screenshots for visual changes.

Sela is distributed under the [MIT License](LICENSE).
