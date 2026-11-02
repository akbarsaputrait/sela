# macOS release process

Sela currently targets macOS 14+, Apple Silicon and Intel. Public releases are draft DMGs; review and publish the draft only after local verification.

## Before tagging

1. Run `bun run check`.
2. Run `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.
3. Run the packaged smoke test on a Mac:

   ```bash
   bun run tauri build --debug --no-bundle
   src-tauri/target/debug/sela --smoke-test
   ```

4. Manually verify clean first launch, prototype SQLite migration, full-screen/notch/native alert behavior, Launch at Login, sleep/wake recovery, keyboard access, and external links.
5. Verify `productName`, `identifier`, `version`, minimum macOS, and icon in `src-tauri/tauri.conf.json`. Once published, do not change the bundle identifier casually; it determines the database and Login Item identity.
6. Update the changelog/release notes and bump the package/Tauri versions consistently before creating the version tag.

## Publish a manually built DMG

You can create a normal, versioned GitHub Release without an Apple Developer account. This is an ad-hoc signed DMG, not a notarized distribution; macOS may require users to approve opening it. Use a standard release title such as `Sela v0.1.0`.

1. Commit and push the source at the version you are releasing.
2. Build the DMG on your Mac:

   ```bash
   APPLE_SIGNING_IDENTITY=- bun run tauri build --bundles app,dmg
   ```

3. Find the generated DMG under `src-tauri/target/release/bundle/dmg/`, then create a draft GitHub Release and attach it:

   ```bash
   VERSION="$(node -p 'require("./package.json").version')"
   DMG="$(find src-tauri/target/release/bundle/dmg -name '*.dmg' -print -quit)"
   test -n "$DMG"
   gh release create "v${VERSION}" "$DMG" \
     --target "$(git rev-parse HEAD)" \
     --title "Sela v${VERSION}" \
     --notes "Ad-hoc signed and not notarized. macOS may ask you to approve opening this download." \
     --draft
   ```

   Review the draft in GitHub, then publish it when ready. The existing `v*` release workflow runs for this tag but skips its signed build unless the `APPLE_RELEASE_ENABLED` repository variable is set to `true`.

## Apple Developer credentials

To enable the automated signed/notarized workflow, set the repository variable `APPLE_RELEASE_ENABLED` to `true` and configure these GitHub Actions secrets:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12` certificate.
- `APPLE_CERTIFICATE_PASSWORD`: password used to export that `.p12`.
- `APPLE_SIGNING_IDENTITY`: exact Developer ID Application identity from `security find-identity -v -p codesigning`.
- `APPLE_ID`: Apple ID email used for notarization.
- `APPLE_PASSWORD`: app-specific password, not the normal Apple ID password.
- `APPLE_TEAM_ID`: Apple Developer team identifier.

Keep certificates and credentials in GitHub Actions Secrets only. Do not put them in the repository, `.env`, build artifacts, or logs. If the variable is unset, tag-triggered releases remain available for manual DMG uploads and the automated signing job is skipped. If it is enabled, the workflow requires all listed secrets and fails before packaging when any are missing.

The automated release workflow uses `tauri-apps/tauri-action` to sign/notarize and build separate Apple Silicon and Intel DMGs. Verify those artifacts with `codesign --verify --deep --strict`, `spctl`, and `xcrun stapler validate` before publishing.

## Not enabled

- No App Store submission workflow.
- No updater or updater signing keys.
- No Windows/Linux release artifacts until those platforms are implemented and tested.
