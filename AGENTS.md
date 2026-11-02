# Agent Instructions

## Package Manager
- Use **Bun**: `bun install`.
- Keep `bun.lock` in sync with dependency changes.

## Commands
| Task | Command |
|---|---|
| Run web app | `bun run dev` |
| Run desktop app | `bun run tauri dev` |
| Lint | `bun run lint` |
| Type-check | `bun run typecheck` |
| Unit tests | `bun run test` |
| Full frontend checks | `bun run check` |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Production web build | `bun run build` |
| Package desktop app | `bun run tauri build` |
| Format TypeScript | `bun run format` |

## Project Layout
- Frontend: `src/` (React, TypeScript, Vite, Tailwind CSS).
- Reusable UI primitives: `src/components/ui/`; product features: `src/features/`; native state/theme: `src/app/`.
- Tauri backend: `src-tauri/`; capabilities: `src-tauri/capabilities/`.
- Release workflow: `.github/workflows/release.yml`.

## Key Conventions
- Use `@/` aliases for imports rooted at `src/`.
- Follow `.oxfmtrc.json`: double quotes, no semicolons, 2-space indentation, Tailwind class sorting.
- Add shadcn components with `bunx shadcn@latest add <component>`; do not hand-edit generated schema files in `src-tauri/gen/`.
- Keep external-link behavior in `src-tauri/src/lib.rs` when changing navigation.
- Do not manually edit generated schemas in `src-tauri/gen/` or build output in `src-tauri/target/` and `dist/`.

## References
| Need | File |
|---|---|
| Frontend setup and shadcn usage | `README.md` |
| UI component configuration | `components.json` |
| Desktop app configuration | `src-tauri/tauri.conf.json` |
| Desktop dependencies | `src-tauri/Cargo.toml` |
| Architecture and storage migrations | `docs/architecture.md` |
| Release/signing process | `docs/releasing.md` |
