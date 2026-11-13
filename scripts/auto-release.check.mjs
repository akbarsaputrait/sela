import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { nextReleaseVersion, planAutomaticRelease, prepareAutomaticRelease, versionReleaseFiles } from "./auto-release.mjs"

function manifests(version = "1.1.0") {
  return {
    "package.json": `${JSON.stringify({ name: "sela", version, dependencies: {}, devDependencies: {} }, null, 2)}\n`,
    "src-tauri/tauri.conf.json": `${JSON.stringify({ productName: "Sela", version, identifier: "test.sela" }, null, 2)}\n`,
    "src-tauri/Cargo.toml": `[package]\nname = "sela"\nversion = "${version}"\n\n[dependencies]\nexample = "1.1.0"\n`,
    "src-tauri/Cargo.lock": `version = 4\n\n[[package]]\nname = "example"\nversion = "1.1.0"\n\n[[package]]\nname = "sela"\nversion = "${version}"\n`,
  }
}

function fixture(t, { tagged = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sela-auto-release-check-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const cwd = join(root, "work")
  const remote = join(root, "remote.git")
  mkdirSync(cwd)
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
  const write = (path, text) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true })
    writeFileSync(join(cwd, path), text)
  }
  git("init", "--bare", "--initial-branch=main", remote)
  git("init", "--initial-branch=main")
  git("config", "user.name", "Release test")
  git("config", "user.email", "release-test@example.invalid")
  git("config", "commit.gpgsign", "false")
  git("config", "tag.gpgsign", "false")
  git("remote", "add", "origin", remote)
  for (const [path, text] of Object.entries(manifests())) write(path, text)
  write("bun.lock", JSON.stringify({ lockfileVersion: 2, configVersion: 1, workspaces: { "": { name: "sela", dependencies: {}, devDependencies: {} } }, packages: {} }))
  write("src/app.ts", "export const label = 'first app'\n")
  git("add", ".")
  git("commit", "-m", "Initial app")
  const initialSHA = git("rev-parse", "HEAD")
  if (tagged) git("tag", "v1.1.0")
  git("push", "origin", "main", ...(tagged ? ["refs/tags/v1.1.0"] : []))
  const commit = (path, text) => {
    write(path, text)
    git("add", "--", path)
    git("commit", "-m", `Change ${path}`)
    git("push", "origin", "main")
    return git("rev-parse", "HEAD")
  }
  return { cwd, git, write, commit, initialSHA }
}

test("patch versions reserve existing stable tags and honor an explicit higher version", () => {
  assert.equal(nextReleaseVersion("1.1.0", ["v1.1.0", "v1.1.1"]), "1.1.2")
  assert.equal(nextReleaseVersion("1.1.0", ["v1.9.9", "v1.10.2"]), "1.10.3")
  assert.equal(nextReleaseVersion("2.0.0", ["v1.1.0", "v2.0.0-beta.1"]), "2.0.0")
  assert.equal(nextReleaseVersion("1.1.0", []), "1.1.0")
})

test("release versions align all four manifests without changing dependency versions", () => {
  const updated = versionReleaseFiles(manifests(), "1.1.1")
  assert.equal(JSON.parse(updated["package.json"]).version, "1.1.1")
  assert.equal(JSON.parse(updated["src-tauri/tauri.conf.json"]).version, "1.1.1")
  assert.match(updated["src-tauri/Cargo.toml"], /name = "sela"\nversion = "1.1.1"/)
  assert.match(updated["src-tauri/Cargo.toml"], /example = "1.1.0"/)
  assert.match(updated["src-tauri/Cargo.lock"], /name = "example"\nversion = "1.1.0"/)
  assert.match(updated["src-tauri/Cargo.lock"], /name = "sela"\nversion = "1.1.1"/)
  assert.throws(() => versionReleaseFiles({ ...manifests(), "src-tauri/Cargo.toml": manifests("1.2.0")["src-tauri/Cargo.toml"] }, "1.1.1"), /versions must match/)
})

test("app release pushes only a versioned tag; later landing changes do not produce another draft", (t) => {
  const f = fixture(t)
  const sourceSHA = f.commit("src/app.ts", "export const label = 'updated app'\n")
  const plan = planAutomaticRelease({ cwd: f.cwd, sourceSHA })
  assert.equal(plan.applicationChanged, true)
  assert.equal(plan.tag, "v1.1.1")
  assert.equal(plan.baselineSHA, f.initialSHA)
  const prepared = prepareAutomaticRelease({ cwd: f.cwd, sourceSHA, expectedTag: plan.tag })
  assert.notEqual(prepared.releaseSHA, sourceSHA)
  assert.equal(f.git("rev-parse", "refs/heads/main"), sourceSHA)
  assert.equal(f.git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0], sourceSHA)
  assert.equal(f.git("rev-parse", "refs/tags/v1.1.1^{commit}"), prepared.releaseSHA)
  assert.equal(f.git("ls-remote", "origin", "refs/tags/v1.1.1^{}").split(/\s/)[0], prepared.releaseSHA)
  assert.equal(JSON.parse(readFileSync(join(f.cwd, "package.json"), "utf8")).version, "1.1.1")
  assert.equal(JSON.parse(f.git("show", "main:package.json")).version, "1.1.0")
  f.git("switch", "main")
  const landingSHA = f.commit("website/index.html", "<title>Updated landing</title>\n")
  const landing = planAutomaticRelease({ cwd: f.cwd, sourceSHA: landingSHA })
  assert.equal(landing.applicationChanged, false)
  assert.equal(landing.baselineSHA, sourceSHA)
  const nextSHA = f.commit("src/app.ts", "export const label = 'second app update'\n")
  assert.equal(planAutomaticRelease({ cwd: f.cwd, sourceSHA: nextSHA }).tag, "v1.1.2")
})

test("stale green source cannot reserve a release tag after main advances", (t) => {
  const f = fixture(t)
  const sourceSHA = f.commit("src/app.ts", "export const label = 'first change'\n")
  f.commit("src/app.ts", "export const label = 'newer change'\n")
  f.git("checkout", "--detach", sourceSHA)
  const plan = planAutomaticRelease({ cwd: f.cwd, sourceSHA })
  assert.equal(plan.applicationChanged, false)
  assert.match(plan.reasons.join(" "), /Main advanced/)
  assert.throws(() => prepareAutomaticRelease({ cwd: f.cwd, sourceSHA, expectedTag: "v1.1.1" }), /Main advanced/)
  assert.equal(f.git("ls-remote", "origin", "refs/tags/v1.1.1"), "")
})

test("an outdated version plan or dirty source never pushes an app tag", (t) => {
  const f = fixture(t)
  const sourceSHA = f.commit("src/app.ts", "export const label = 'changed'\n")
  assert.throws(() => prepareAutomaticRelease({ cwd: f.cwd, sourceSHA, expectedTag: "v9.0.0" }), /Release plan changed/)
  f.write("uncommitted.txt", "Keep this local change\n")
  assert.throws(() => prepareAutomaticRelease({ cwd: f.cwd, sourceSHA, expectedTag: "v1.1.1" }), /clean working tree/)
  assert.equal(f.git("ls-remote", "origin", "refs/tags/v1.1.1"), "")
})

test("a repository without release tags detects the initial app", (t) => {
  const f = fixture(t, { tagged: false })
  const plan = planAutomaticRelease({ cwd: f.cwd, sourceSHA: f.initialSHA })
  assert.equal(plan.applicationChanged, true)
  assert.equal(plan.baselineSHA, null)
  assert.equal(plan.tag, "v1.1.0")
})
