# macOS release process

Sela targets macOS 14+ on Apple Silicon and Intel. Release scripts attach artifacts to a **draft**; a person must review and publish it. An ad-hoc build is not Developer ID signed or notarized and Gatekeeper may warn users. Do not describe it as a signed production release.

## Automatic app-only ad-hoc draft

After a successful `CI` **push** run on current `main`, `Automatic app draft` compares the tested source against the source behind the newest stable version tag. PR CI, failed/cancelled CI and stale main commits cannot create an automatic app release. App changes accumulate since the last tagged source, not just the last merge; an existing draft or reserved tag is already a baseline even before publication. A landing-only diff from that baseline does not create an app release.

Application source, native code/configuration, shared public assets and app build configuration count as app changes. Package and Bun lockfile changes are inspected semantically: runtime/shared build dependencies count, including their resolved transitive dependencies; website-only Sharp/Wrangler changes, OG assets, landing code, documentation and release automation do not. A dependency graph the detector cannot safely understand fails the workflow instead of silently skipping a release.

The workflow reserves the next patch above existing stable tags, or respects a higher version explicitly aligned in all four source manifests. It creates a detached version-only release commit when needed, pushes only its immutable `vMAJOR.MINOR.PATCH` tag, and builds the existing verified ad-hoc Apple Silicon draft. It never writes to protected `main`, bypasses PR rules, publishes a release, notarizes the app, or creates an Intel artifact. Source versions on `main` may therefore be older than automatic release tags; the installer and tagged manifests contain the actual release version.

Automatic packaging runs directly in the workflow: tags pushed with `GITHUB_TOKEN` do not trigger another push workflow. Existing Developer ID release automation remains separate and unchanged.

Review the installer, draft notes and Gatekeeper warning, then click **Publish release** yourself. A packaging failure can leave a reserved tag without a complete draft. To retry, dispatch **Automatic app draft** on `main` with that existing tag; this builds its exact tagged source without bumping again. It never overwrites an existing asset or changes a published release. Review and explicitly remove an incorrect draft asset before retrying. Rerunning automatic change detection does not create a second draft for already tagged source.

## Before manual tagging

1. Run `bun run check` and `bun run test:distribution`. The distribution tests are offline and do not need Apple or Cloudflare credentials.
2. Run `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.
3. On a Mac with a logged-in GUI session, run `bun run tauri build --debug --no-bundle` and `src-tauri/target/debug/sela --smoke-test`. The isolated smoke test simulates notification submission; it does not request permission or post a real notification.
4. Manually verify clean first launch, prototype SQLite migration, full-screen/notch/native alert behavior, Launch at Login, sleep/wake recovery, keyboard access, and external links.
5. Verify product name, identifier, minimum macOS, and icon in `src-tauri/tauri.conf.json`. Keep the published bundle identifier stable: it determines database and Login Item identity.
6. Update release notes and align the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. Commit and push the source, then create and push the matching stable tag `vMAJOR.MINOR.PATCH`. Release preparation requires a clean working tree and verifies HEAD against both the local tag and the pushed tag commit.

## Manual ad-hoc draft

On an Apple Silicon Mac with Bun, the Rust Apple Silicon target, Xcode tools, and authenticated `gh` with release write access, check out the pushed tag in a clean working tree and run:

```bash
bun install --frozen-lockfile
bun run release:manual
```

The script builds the ARM64 app and DMG with an ad-hoc signature, validates the exact versioned `Sela_<version>_aarch64.dmg` and its mounted app, and creates or attaches to a draft. It never overwrites an existing asset or modifies a published release. An existing incorrect draft asset must be reviewed and removed explicitly before retrying. Review the draft, its notes, the app and installer, and the Gatekeeper warning before publishing. This path does not create an Intel artifact or notarize the app. When `APPLE_RELEASE_ENABLED` is unset, the tag-triggered signed job is skipped.

## Developer ID signed draft

Set the repository variable `APPLE_RELEASE_ENABLED` to `true` and configure the following secrets in the `release` GitHub Actions environment:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12` certificate.
- `APPLE_CERTIFICATE_PASSWORD`: password used to export the certificate.
- `APPLE_SIGNING_IDENTITY`: exact Developer ID Application identity from `security find-identity -v -p codesigning`.
- `APPLE_ID`: Apple ID email used for notarization.
- `APPLE_PASSWORD`: app-specific password, not the normal Apple ID password.
- `APPLE_TEAM_ID`: Apple Developer team identifier.

Keep credentials in GitHub Actions Secrets, not in the repository, `.env`, artifacts, or logs. The tag-triggered or manually dispatched workflow builds both architectures and checks the exact DMGs, app signatures, Gatekeeper assessment, and stapled notarization tickets before attaching either artifact. The attachment script mounts each DMG and verifies the contained app and configured Developer ID team as well. It creates a draft only; review the artifacts and notes before explicitly publishing. Retrying does not replace existing assets.

## Website deployment

Production website deployments are handled by the existing Cloudflare Git integration connected to `main`, independently of application releases. There is no GitHub Actions website deployment workflow, and no Cloudflare deployment token or account ID needs to be added to GitHub. Keep the existing Cloudflare dashboard build/deploy settings, Worker and custom-domain routing unchanged.

Builds use Bun 1.4.4, pinned by the root `package.json` `packageManager` field and the GitHub `setup-bun` inputs. [Cloudflare Workers Builds reads `packageManager` before dependency installation](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/#package-manager-versions); an old default Bun cannot read this repository's version-2 lockfile. Keep any explicit Cloudflare `BUN_VERSION` override aligned with the project pin. Do not regenerate/downgrade the lockfile or disable `--frozen-lockfile` to accommodate an obsolete runtime. Native CI/release jobs use the supported `macos-15` Apple Silicon runner; the application's minimum supported macOS remains 14.

`bun run build:website` builds the landing page and regenerates its OG image without Cloudflare deployment credentials. Installer synchronization is not part of this build command. Publishing an app release does not push `main` and therefore does not itself trigger a Git-connected website rebuild; manage any required rebuild through the existing Cloudflare integration.

The optional local `bun run deploy:website` helper remains separate from automatic Cloudflare builds. To use it, check out current `main` in a clean working tree and authenticate GitHub CLI and Wrangler locally. It verifies the latest published stable installer by immutable asset ID, SHA-256, size and DMG envelope, checks source/release staleness, then validates the served download and no-store policy. Do not run it concurrently with a Cloudflare-managed deployment. Direct `wrangler deploy` bypasses these installer checks.

## Not enabled

- No App Store submission workflow.
- No updater or updater signing keys.
- No Windows/Linux release artifacts until those platforms are implemented and tested.
