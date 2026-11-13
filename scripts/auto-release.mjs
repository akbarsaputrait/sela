import { execFileSync, spawnSync } from "node:child_process"
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { classifyApplicationChanges } from "./detect-application-changes.mjs"
import { assertVersions, releaseVersion } from "./release-contract.mjs"

const versionPaths = ["package.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json"]
const identity = ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"]
const git = (cwd, args, options = {}) => execFileSync("git", args, { cwd, encoding: "utf8", ...options })

function stableTags(tags) {
  return tags.filter((tag) => {
    try { releaseVersion(tag); return true } catch { return false }
  }).sort((a, b) => compareVersions(releaseVersion(b), releaseVersion(a)))
}

function compareVersions(a, b) {
  const left = a.split(".").map(BigInt)
  const right = b.split(".").map(BigInt)
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

export function nextReleaseVersion(source, tags) {
  releaseVersion(`v${source}`)
  const latest = stableTags(tags)[0]
  if (!latest || compareVersions(source, releaseVersion(latest)) > 0) return source
  const [major, minor, patch] = releaseVersion(latest).split(".")
  return `${major}.${minor}.${BigInt(patch) + 1n}`
}

function assertFileVersions(files, version) {
  releaseVersion(`v${version}`)
  assertVersions(version, files["src-tauri/Cargo.toml"], JSON.parse(files["src-tauri/tauri.conf.json"]), files["src-tauri/Cargo.lock"])
}

export function versionReleaseFiles(files, version) {
  assertFileVersions(files, JSON.parse(files["package.json"]).version)
  releaseVersion(`v${version}`)
  const updated = {
    "package.json": files["package.json"].replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`),
    "src-tauri/tauri.conf.json": files["src-tauri/tauri.conf.json"].replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`),
    "src-tauri/Cargo.toml": files["src-tauri/Cargo.toml"].replace(/(\[package\][\s\S]*?^version\s*=\s*)"[^"]*"/m, `$1"${version}"`),
    "src-tauri/Cargo.lock": files["src-tauri/Cargo.lock"].replace(/(\[\[package\]\]\nname = "sela"\nversion = )"[^"]*"/, `$1"${version}"`),
  }
  if (JSON.parse(updated["package.json"]).version !== version) throw new Error("Unable to update the package version")
  assertFileVersions(updated, version)
  return updated
}

function readGitFile(cwd, ref, path) {
  if (!ref || !git(cwd, ["ls-tree", "--name-only", ref, "--", path]).trim()) return ""
  return git(cwd, ["show", `${ref}:${path}`])
}

function snapshot(cwd, ref) {
  return { packageJSON: readGitFile(cwd, ref, "package.json") || "{}", lockfile: readGitFile(cwd, ref, "bun.lock") }
}

function remoteMain(cwd) {
  const result = git(cwd, ["ls-remote", "--exit-code", "origin", "refs/heads/main"]).trim()
  const sha = result.match(/^([a-f0-9]{40})\s+refs\/heads\/main$/)?.[1]
  if (!sha) throw new Error("Unable to resolve current remote main")
  return sha
}

export function planAutomaticRelease({ sourceSHA, cwd = process.cwd() }) {
  if (!/^[a-f0-9]{40}$/.test(sourceSHA ?? "")) throw new Error("An exact successful main CI source SHA is required")
  if (git(cwd, ["rev-parse", "HEAD"]).trim() !== sourceSHA) throw new Error("HEAD must match the successful main CI source")
  if (remoteMain(cwd) !== sourceSHA) {
    return { applicationChanged: false, sourceSHA, reasons: ["Main advanced; wait for successful CI on the newer source"] }
  }
  const tags = stableTags(git(cwd, ["tag", "--list", "v*"]).trim().split("\n"))
  let baselineSHA = null
  for (const tag of tags) {
    const common = spawnSync("git", ["merge-base", `refs/tags/${tag}^{commit}`, sourceSHA], { cwd, encoding: "utf8" })
    if (common.status === 0) { baselineSHA = common.stdout.trim(); break }
    if (common.status !== 1) throw new Error(common.stderr || `Unable to inspect ${tag}`)
  }
  const paths = baselineSHA
    ? git(cwd, ["diff", "--name-only", "--no-renames", "-z", baselineSHA, sourceSHA, "--"])
    : git(cwd, ["ls-tree", "-r", "--name-only", "-z", sourceSHA])
  const detection = classifyApplicationChanges({
    changedFiles: paths.split("\0").filter(Boolean), before: snapshot(cwd, baselineSHA), after: snapshot(cwd, sourceSHA),
  })
  if (!detection.applicationChanged) return { ...detection, sourceSHA, baselineSHA }
  const files = Object.fromEntries(versionPaths.map((path) => [path, readGitFile(cwd, sourceSHA, path)]))
  const sourceVersion = JSON.parse(files["package.json"]).version
  assertFileVersions(files, sourceVersion)
  const version = nextReleaseVersion(sourceVersion, tags)
  return { ...detection, sourceSHA, baselineSHA, version, tag: `v${version}` }
}

export function prepareAutomaticRelease({ sourceSHA, expectedTag, cwd = process.cwd() }) {
  if (git(cwd, ["status", "--porcelain"]).trim()) throw new Error("Release preparation requires a clean working tree")
  const plan = planAutomaticRelease({ sourceSHA, cwd })
  if (!plan.applicationChanged) throw new Error(plan.reasons.join("; ") || "No unreleased application changes")
  if (plan.tag !== expectedTag) throw new Error("Release plan changed; rerun planning instead of reusing a version")
  const files = Object.fromEntries(versionPaths.map((path) => [path, readFileSync(resolve(cwd, path), "utf8")]))
  const updated = versionReleaseFiles(files, plan.version)
  git(cwd, ["checkout", "--detach", sourceSHA])
  for (const path of versionPaths) writeFileSync(resolve(cwd, path), updated[path])
  if (versionPaths.some((path) => files[path] !== updated[path])) {
    git(cwd, ["add", "--", ...versionPaths])
    git(cwd, [...identity, "commit", "--no-gpg-sign", "-m", `chore(release): ${plan.tag}`, "-m", `Version-only release commit from successful main CI ${sourceSHA}. Main remains PR-protected.`])
  }
  if (remoteMain(cwd) !== sourceSHA) throw new Error("Main advanced during preparation; no tag was pushed")
  git(cwd, [...identity, "tag", "--annotate", plan.tag, "--message", `Sela ${plan.tag}: ad-hoc draft from ${sourceSHA}; review and publish manually`])
  // Push only the immutable release tag. Never push to or bypass protected main.
  git(cwd, ["push", "origin", `refs/tags/${plan.tag}:refs/tags/${plan.tag}`], { stdio: "inherit" })
  return { ...plan, releaseSHA: git(cwd, ["rev-parse", "HEAD"]).trim() }
}

function retryPlan(tag, cwd) {
  const version = releaseVersion(tag)
  const sourceSHA = git(cwd, ["rev-parse", `refs/tags/${tag}^{commit}`]).trim()
  const files = Object.fromEntries(versionPaths.map((path) => [path, readGitFile(cwd, sourceSHA, path)]))
  if (JSON.parse(files["package.json"]).version !== version) throw new Error("Retry tag must match its source version")
  assertFileVersions(files, version)
  return { applicationChanged: true, sourceSHA, version, tag, reasons: ["Explicit retry of an existing immutable ad-hoc draft tag"] }
}

function report(plan) {
  console.log(JSON.stringify(plan, null, 2))
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    `release_needed=${plan.applicationChanged}\nrelease_tag=${plan.tag ?? ""}\nsource_sha=${plan.sourceSHA}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Automatic app draft\n\n${plan.applicationChanged ? `Prepare **${plan.tag}** (ad-hoc Apple Silicon; manual Publish).` : "No app release."}\n\n${plan.reasons.map((reason) => `- ${reason}`).join("\n")}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.argv[2]
  const sourceSHA = process.env.EXPECTED_SOURCE_SHA
  if (mode === "--plan") report(planAutomaticRelease({ sourceSHA }))
  else if (mode === "--prepare") report(prepareAutomaticRelease({ sourceSHA, expectedTag: process.env.RELEASE_TAG }))
  else if (mode === "--retry") report(retryPlan(process.env.RELEASE_TAG, process.cwd()))
  else throw new Error("Usage: node scripts/auto-release.mjs --plan|--prepare|--retry")
}
