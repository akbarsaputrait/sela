import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { assertDeveloperID, assetName, repository, sourceVersion, verifyDMG } from "./release-contract.mjs"

const mode = process.argv[2]
if (!["--validate", "--attach", "--manual"].includes(mode)) {
  throw new Error("Usage: node scripts/prepare-release.mjs --validate|--attach|--manual")
}
const version = sourceVersion()
const tag = `v${version}`
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", ...options })
function validateSource() {
  if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== tag) throw new Error("Release tag/version mismatch")
  if (run("git", ["status", "--porcelain"]).trim()) throw new Error("Release requires a clean working tree, including untracked source")
  const head = run("git", ["rev-parse", "HEAD"]).trim()
  const tagged = run("git", ["rev-parse", `refs/tags/${tag}^{commit}`]).trim()
  const published = run("gh", ["api", `repos/${repository}/commits/${tag}`, "--jq", ".sha"]).trim()
  if (head !== tagged || head !== published) throw new Error("HEAD must exactly match the pushed canonical version tag")
}
validateSource()
if (mode === "--validate") process.exit(0)
const architectures = mode === "--manual" ? ["aarch64"] : ["aarch64", "x86_64"]
if (mode === "--manual") {
  run("bun", ["run", "tauri", "build", "--target", "aarch64-apple-darwin", "--bundles", "app,dmg"], {
    stdio: "inherit", env: { ...process.env, APPLE_SIGNING_IDENTITY: "-" },
  })
}
const assets = architectures.map((arch) => {
  const root = `src-tauri/target/${arch}-apple-darwin/release/bundle`
  run("codesign", ["--verify", "--deep", "--strict", `${root}/macos/Sela.app`], { stdio: "inherit" })
  const path = `${root}/dmg/${assetName(version, arch)}`
  const bytes = readFileSync(path)
  verifyDMG(bytes, { size: bytes.length, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` })
  const mount = mkdtempSync(join(tmpdir(), "sela-release-"))
  let attached = false
  try {
    run("hdiutil", ["verify", path], { stdio: "inherit" })
    run("hdiutil", ["attach", path, "-readonly", "-nobrowse", "-mountpoint", mount], { stdio: "inherit" })
    attached = true
    const app = join(mount, "Sela.app")
    const plist = join(app, "Contents", "Info.plist")
    const field = (key) => run("plutil", ["-extract", key, "raw", "-o", "-", plist]).trim()
    if (field("CFBundleShortVersionString") !== version ||
        field("CFBundleIdentifier") !== JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).identifier) {
      throw new Error("Mounted app version or bundle identifier does not match the source")
    }
    const executable = field("CFBundleExecutable")
    if (!/^[A-Za-z0-9_.-]+$/.test(executable) || executable === "." || executable === "..") {
      throw new Error("Invalid mounted app executable")
    }
    run("lipo", ["-verify_arch", arch === "aarch64" ? "arm64" : arch, join(app, "Contents", "MacOS", executable)])
    run("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" })
    if (mode === "--attach") {
      const signature = spawnSync("codesign", ["-dv", "--verbose=4", app], { encoding: "utf8" })
      if (signature.status !== 0) throw new Error(signature.stderr || "Unable to inspect app signature")
      assertDeveloperID(signature.stderr, process.env.APPLE_TEAM_ID)
      run("spctl", ["--assess", "--type", "execute", "--verbose", app], { stdio: "inherit" })
      run("xcrun", ["stapler", "validate", app], { stdio: "inherit" })
      run("xcrun", ["stapler", "validate", path], { stdio: "inherit" })
    }
  } finally {
    if (attached) run("hdiutil", ["detach", mount], { stdio: "inherit" })
    rmSync(mount, { recursive: true, force: true })
  }
  return path
})
// Validate again after packaging, before any release creation or attachment.
validateSource()
const existing = spawnSync("gh", ["release", "view", tag, "--repo", repository, "--json", "isDraft,tagName"], { encoding: "utf8" })
if (existing.status === 0) {
  const release = JSON.parse(existing.stdout)
  if (!release.isDraft || release.tagName !== tag) throw new Error("Never mutate a published release")
} else {
  if (!existing.stderr.includes("release not found")) throw new Error(existing.stderr || "Unable to inspect draft release")
  run("gh", ["release", "create", tag, "--repo", repository, "--verify-tag", "--title", `Sela ${tag}`,
    "--notes", mode === "--manual"
      ? "Ad-hoc signed; not Developer ID signed or notarized. Gatekeeper may require manual approval."
      : "Developer ID signed and notarized macOS builds. Review and manually verify before publishing.",
    "--draft"], { stdio: "inherit" })
}
// Do not overwrite existing assets on retry. Remove an incorrect draft asset explicitly after review.
run("gh", ["release", "upload", tag, "--repo", repository, ...assets], { stdio: "inherit" })
console.log(`Verified assets attached to draft ${tag}; review and publish explicitly.`)
