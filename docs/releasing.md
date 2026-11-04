# macOS release process

Sela targets macOS 14+ on Apple Silicon and Intel. Release scripts attach artifacts to a **draft**; a person must review and publish it. An ad-hoc build is not Developer ID signed or notarized and Gatekeeper may warn users. Do not describe it as a signed production release.

## Before tagging

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

Publishing a stable release triggers the serialized website workflow; it can also be dispatched manually. Configure `CLOUDFLARE_API_TOKEN` as a secret and `CLOUDFLARE_ACCOUNT_ID` as a variable in the `website` environment. The token must have the minimum permissions required to deploy the existing `sela` Worker and its assets. Preserve the existing Worker and custom-domain routing; validate Cloudflare dashboard-managed routes against the deployment configuration before enabling automation.

The workflow resolves GitHub's latest stable release, checks out its tag, checks source versions and tag commit, selects the one exact ARM64 asset by immutable ID, and verifies its GitHub SHA-256 digest, size and DMG envelope. It rechecks latest release and source before deployment and afterwards; then it verifies the actual stable download URL's bytes, digest and no-store cache policy. An older release event is ignored. A newer release published during an in-flight deployment can make that run fail its post-deploy check; ensure the newer release's workflow completes successfully.

For a manual deployment, check out the latest release tag with matching source, authenticate GitHub CLI and Wrangler, and run `bun run deploy:website`. Manual deployments are not serialized with the GitHub Actions workflow; avoid running both at the same time. Direct `wrangler deploy` bypasses the integrity checks.

## Not enabled

- No App Store submission workflow.
- No updater or updater signing keys.
- No Windows/Linux release artifacts until those platforms are implemented and tested.
