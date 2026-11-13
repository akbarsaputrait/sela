import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import { classifyApplicationChanges } from "./detect-application-changes.mjs"

const clone = (value) => structuredClone(value)
const entry = (name, version = "1.0.0", metadata = {}) => [`${name}@${version}`, "", metadata, `sha512-${name}-${version}`]

function fixture() {
  const packageJSON = {
    name: "sela", version: "1.1.0", type: "module",
    scripts: { build: "node init.cjs && tsc -b && vite build", tauri: "tauri", "build:website": "vite build --config vite.website.config.ts" },
    dependencies: { react: "^1.0.0" },
    devDependencies: { vite: "^1.0.0", typescript: "^1.0.0", "@tauri-apps/cli": "^1.0.0" },
  }
  return {
    packageJSON,
    lockfile: {
      lockfileVersion: 2, configVersion: 1,
      workspaces: { "": { name: "sela", dependencies: clone(packageJSON.dependencies), devDependencies: clone(packageJSON.devDependencies) } },
      packages: {
        react: entry("react", "1.0.0", { dependencies: { scheduler: "^1.0.0" } }),
        scheduler: entry("scheduler"),
        vite: entry("vite", "1.0.0", { dependencies: { bundler: "^1.0.0" }, peerDependencies: { esbuild: "*" }, optionalPeers: ["esbuild"] }),
        bundler: entry("bundler", "1.0.0", { optionalDependencies: { "@bundler/darwin-arm64": "1.0.0" } }),
        "@bundler/darwin-arm64": entry("@bundler/darwin-arm64", "1.0.0", { os: "darwin", cpu: "arm64" }),
        typescript: entry("typescript"),
        "@tauri-apps/cli": entry("@tauri-apps/cli", "1.0.0", { optionalDependencies: { "@tauri-apps/cli-darwin-arm64": "1.0.0" } }),
        "@tauri-apps/cli-darwin-arm64": entry("@tauri-apps/cli-darwin-arm64"),
      },
    },
  }
}

function raw(snapshot) {
  return { packageJSON: JSON.stringify(snapshot.packageJSON), lockfile: JSON.stringify(snapshot.lockfile) }
}

function classify(before, after = before, changedFiles = ["package.json", "bun.lock"]) {
  return classifyApplicationChanges({ changedFiles, before: raw(before), after: raw(after) })
}

function changed(result, reason) {
  assert.equal(result.applicationChanged, true, JSON.stringify(result))
  if (reason) assert.ok(result.reasons.some((value) => value.includes(reason)), JSON.stringify(result))
}

function unchanged(result) {
  assert.deepEqual(result, { applicationChanged: false, reasons: [] })
}

function addWebsiteTools(snapshot) {
  snapshot.packageJSON.devDependencies.sharp = "^1.0.0"
  snapshot.packageJSON.devDependencies.wrangler = "^1.0.0"
  Object.assign(snapshot.lockfile.workspaces[""].devDependencies, { sharp: "^1.0.0", wrangler: "^1.0.0" })
  snapshot.packageJSON.scripts["og:generate"] = "bun scripts/generate-og-image.mjs"
  snapshot.packageJSON.scripts["build:website"] = "bun run og:generate && vite build --config vite.website.config.ts"
  Object.assign(snapshot.lockfile.packages, {
    sharp: entry("sharp", "1.0.0", { dependencies: { "detect-libc": "^1.0.0" }, optionalDependencies: { "@img/sharp-darwin-arm64": "1.0.0" } }),
    "detect-libc": entry("detect-libc"),
    "@img/sharp-darwin-arm64": entry("@img/sharp-darwin-arm64"),
    wrangler: entry("wrangler", "1.0.0", { dependencies: { esbuild: "^1.0.0", workerd: "^1.0.0" } }),
    esbuild: entry("esbuild"),
    workerd: entry("workerd", "1.0.0", { optionalDependencies: { "@cloudflare/workerd-darwin-arm64": "1.0.0" } }),
    "@cloudflare/workerd-darwin-arm64": entry("@cloudflare/workerd-darwin-arm64"),
  })
}

const repository = {
  packageJSON: readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  lockfile: readFileSync(new URL("../bun.lock", import.meta.url), "utf8"),
}

test("the existing real Bun JSONC graph is valid, not a fail-closed false positive", () => {
  unchanged(classifyApplicationChanges({ changedFiles: ["website/src/page.tsx"], before: repository, after: repository }))
})

test("the real OG/Sharp addition and website-only source do not release the desktop app", () => {
  const beforePackage = JSON.parse(repository.packageJSON)
  const beforeLock = ts.parseConfigFileTextToJson("bun.lock", repository.lockfile).config
  delete beforePackage.devDependencies.sharp
  delete beforePackage.scripts["og:generate"]
  beforePackage.scripts["build:website"] = beforePackage.scripts["build:website"].replace("bun run og:generate && ", "")
  delete beforeLock.workspaces[""].devDependencies.sharp
  const before = { packageJSON: JSON.stringify(beforePackage), lockfile: JSON.stringify(beforeLock) }
  unchanged(classifyApplicationChanges({
    changedFiles: ["package.json", "bun.lock", "scripts/generate-og-image.mjs", "public/og-image.png", "website/index.html", "website/src/page.tsx"],
    before, after: repository,
  }))
})

test("Sharp/Wrangler additions including Vite's unused optional esbuild peer are website-only", () => {
  const before = fixture()
  const after = clone(before)
  addWebsiteTools(after)
  unchanged(classify(before, after, ["package.json", "bun.lock", "public/og-image.png", "scripts/generate-og-image.mjs", "vite.website.config.ts", "wrangler.jsonc"]))
  unchanged(classify(after, before))
})

test("lock-only changes anywhere in a website-only dependency closure do not release", () => {
  const before = fixture()
  addWebsiteTools(before)
  for (const name of ["sharp", "detect-libc", "@img/sharp-darwin-arm64", "wrangler", "esbuild", "workerd", "@cloudflare/workerd-darwin-arm64"]) {
    const after = clone(before)
    after.lockfile.packages[name][3] += "-changed"
    unchanged(classify(before, after, ["bun.lock"]))
  }
})

test("native, frontend, shared assets, app HTML and build configurations include deletions/renames", () => {
  for (const path of [
    "src/main.tsx", "src/removed.ts", "src-tauri/src/lib.rs", "src-tauri/Cargo.lock", "src-tauri/icons/icon.icns",
    "public/favicon.png", "public/sounds/announce.wav", "public/new.png", "index.html", "init.cjs", "app-icon.png",
    "vite.config.ts", "tsconfig.json", "tsconfig.app.json", "postcss.config.js", "tailwind.config.ts", ".env.production", "bunfig.toml",
  ]) changed(classify(fixture(), undefined, [path]), path)
  // --no-renames yields an old app filename even when its destination is website-only.
  changed(classify(fixture(), undefined, ["src/old.ts", "website/src/old.ts"]), "src/old.ts")
  changed(classify(fixture(), undefined, ["website/src/old.ts", "src/new.ts"]), "src/new.ts")
  unchanged(classify(fixture(), undefined, ["website/src/page.tsx", "docs/releasing.md", "CHANGELOG.md", "vite.website.config.ts", "wrangler.jsonc", "public/og-image.png"]))
})

test("version/metadata and unrelated tooling scripts alone are not application changes", () => {
  const before = fixture()
  const after = clone(before)
  after.packageJSON.version = "9.9.9"
  after.packageJSON.description = "New copy"
  after.packageJSON.scripts["test:distribution"] = "node --test scripts/*.check.mjs"
  after.packageJSON.scripts["release:auto"] = "node scripts/auto-release.mjs"
  after.packageJSON.scripts["lint"] = "oxlint --fix"
  after.lockfile.workspaces[""].version = "9.9.9"
  unchanged(classify(before, after))
})

test("Sharp's actual semver hoisting pattern preserves Babel and conf's app resolutions", () => {
  const before = fixture()
  before.packageJSON.devDependencies.shadcn = "^1.0.0"
  before.lockfile.workspaces[""].devDependencies.shadcn = "^1.0.0"
  Object.assign(before.lockfile.packages, {
    shadcn: entry("shadcn", "1.0.0", { dependencies: { "@babel/core": "^1.0.0", "@babel/helper-compilation-targets": "^1.0.0", conf: "^1.0.0" } }),
    "@babel/core": entry("@babel/core", "1.0.0", { dependencies: { semver: "^6.0.0" } }),
    "@babel/helper-compilation-targets": entry("@babel/helper-compilation-targets", "1.0.0", { dependencies: { semver: "^6.0.0" } }),
    conf: entry("conf", "1.0.0", { dependencies: { semver: "^7.0.0" } }),
    semver: entry("semver", "6.3.1"),
    "conf/semver": entry("semver", "7.8.5"),
  })
  const after = clone(before)
  addWebsiteTools(after)
  after.lockfile.packages.sharp[2].dependencies.semver = "^7.8.5"
  after.lockfile.packages.semver = entry("semver", "7.8.5")
  after.lockfile.packages["@babel/core/semver"] = entry("semver", "6.3.1")
  after.lockfile.packages["@babel/helper-compilation-targets/semver"] = entry("semver", "6.3.1")
  delete after.lockfile.packages["conf/semver"]
  unchanged(classify(before, after))
  const changedResolution = clone(after)
  changedResolution.lockfile.packages["@babel/core/semver"][3] += "-changed"
  changed(classify(after, changedResolution), "Resolved application")
})

test("CSS and previously unknown build-tool dependency additions remain application changes", () => {
  const before = fixture()
  for (const name of ["shadcn", "tw-animate-css", "@tailwindcss/vite", "@types/node", "new-build-tool"]) {
    const after = clone(before)
    after.packageJSON.devDependencies[name] = "^1.0.0"
    after.lockfile.workspaces[""].devDependencies[name] = "^1.0.0"
    after.lockfile.packages[name] = entry(name)
    changed(classify(before, after), "declarations")
    const updated = clone(after)
    updated.lockfile.packages[name][3] += "-changed"
    changed(classify(after, updated, ["bun.lock"]), "Resolved application")
  }
})

test("runtime declarations, optional runtime roots and shared build dependencies release", () => {
  for (const [group, name] of [["dependencies", "react"], ["devDependencies", "vite"], ["devDependencies", "typescript"], ["devDependencies", "@tauri-apps/cli"]]) {
    const before = fixture()
    const after = clone(before)
    after.packageJSON[group][name] = "^1.1.0"
    after.lockfile.workspaces[""][group][name] = "^1.1.0"
    after.lockfile.packages[name][0] = `${name}@1.1.0`
    changed(classify(before, after), "declarations")
  }
  const before = fixture()
  const after = clone(before)
  after.packageJSON.optionalDependencies = { sharp: "^1.0.0" }
  after.lockfile.workspaces[""].optionalDependencies = { sharp: "^1.0.0" }
  after.lockfile.packages.sharp = entry("sharp")
  changed(classify(before, after), "declarations")
  changed(classify(after, before), "declarations")
})

test("lock-only runtime, build transitive and optional/native resolutions release", () => {
  const before = fixture()
  for (const name of ["react", "scheduler", "vite", "bundler", "typescript", "@bundler/darwin-arm64", "@tauri-apps/cli-darwin-arm64"]) {
    const after = clone(before)
    after.lockfile.packages[name][3] += "-changed"
    changed(classify(before, after, ["bun.lock"]), "Resolved application")
  }
})

test("shared dependencies remain application dependencies when website tools also use them", () => {
  const before = fixture()
  addWebsiteTools(before)
  before.lockfile.packages.bundler[2].dependencies = { "detect-libc": "^1.0.0" }
  const after = clone(before)
  after.lockfile.packages["detect-libc"][3] += "-changed"
  changed(classify(before, after, ["bun.lock"]), "Resolved application")
})

test("scoped nested duplicates and their optional dependencies resolve through package ancestors", () => {
  const before = fixture()
  before.lockfile.packages.bundler[2].dependencies = { "@scope/duplicate": "^1.0.0" }
  Object.assign(before.lockfile.packages, {
    "@scope/duplicate": entry("@scope/duplicate", "9.0.0"),
    "bundler/@scope/duplicate": entry("@scope/duplicate", "1.0.0", { dependencies: { leaf: "^1.0.0" }, optionalDependencies: { "@scope/native": "1.0.0" } }),
    leaf: entry("leaf", "9.0.0"),
    "bundler/leaf": entry("leaf"),
    "@scope/native": entry("@scope/native", "9.0.0"),
    "bundler/@scope/duplicate/@scope/native": entry("@scope/native"),
  })
  unchanged(classify(before))
  for (const key of ["bundler/@scope/duplicate", "bundler/leaf", "bundler/@scope/duplicate/@scope/native"]) {
    const after = clone(before)
    after.lockfile.packages[key][3] += "-changed"
    changed(classify(before, after, ["bun.lock"]), "Resolved application")
  }
  for (const key of ["@scope/duplicate", "leaf", "@scope/native"]) {
    const after = clone(before)
    after.lockfile.packages[key][3] += "-changed"
    unchanged(classify(before, after, ["bun.lock"]))
  }
})

test("identical resolved packages can be rehoisted without a desktop release", () => {
  const before = fixture()
  const after = clone(before)
  after.lockfile.packages["react/scheduler"] = after.lockfile.packages.scheduler
  delete after.lockfile.packages.scheduler
  unchanged(classify(before, after, ["bun.lock"]))
})

test("required peers and aliases resolve as application dependencies", () => {
  const before = fixture()
  before.lockfile.packages.bundler[2].peerDependencies = { react: "^1.0.0" }
  before.packageJSON.dependencies.alias = "npm:actual@^1.0.0"
  before.lockfile.workspaces[""].dependencies.alias = "npm:actual@^1.0.0"
  before.lockfile.packages.alias = entry("actual")
  unchanged(classify(before))
  const after = clone(before)
  after.lockfile.packages.alias[3] += "-changed"
  changed(classify(before, after), "Resolved application")
})

test("app script bodies, lifecycle hooks, referenced script aliases and package configuration release", () => {
  const before = fixture()
  for (const edit of [
    (snapshot) => { snapshot.packageJSON.scripts.build += " --mode custom" },
    (snapshot) => { snapshot.packageJSON.scripts.prebuild = "node scripts/prebuild.mjs" },
    (snapshot) => { snapshot.packageJSON.scripts.prepare = "node scripts/prepare.mjs" },
    (snapshot) => { snapshot.packageJSON.type = "commonjs" },
    (snapshot) => { snapshot.packageJSON.engines = { node: ">=24" } },
  ]) {
    const after = clone(before)
    edit(after)
    changed(classify(before, after))
  }
  before.packageJSON.scripts.build = "bun run compile && vite build"
  before.packageJSON.scripts.compile = "tsc -b"
  const after = clone(before)
  after.packageJSON.scripts.compile = "tsc -b --force"
  changed(classify(before, after), "scripts")
})

test("malformed/ambiguous relevant graphs fail closed, even if both snapshots match", () => {
  for (const edit of [
    (snapshot) => { snapshot.lockfile.lockfileVersion = 99 },
    (snapshot) => { snapshot.lockfile.configVersion = 99 },
    (snapshot) => { snapshot.lockfile.patchedDependencies = { "react@1.0.0": "patches/react.patch" } },
    (snapshot) => { delete snapshot.lockfile.packages.scheduler },
    (snapshot) => { delete snapshot.lockfile.packages["@bundler/darwin-arm64"] },
    (snapshot) => { snapshot.lockfile.packages.react = ["react@1.0.0"] },
    (snapshot) => { snapshot.lockfile.packages.react[2].dependencies = [] },
    (snapshot) => { snapshot.lockfile.packages.react[0] = "unrelated@1.0.0" },
    (snapshot) => { snapshot.lockfile.packages.react[0] = "react@not-a-version" },
    (snapshot) => { snapshot.lockfile.workspaces[""].dependencies.react = "^2.0.0" },
    (snapshot) => { snapshot.lockfile.workspaces.extra = {} },
  ]) {
    const invalid = fixture()
    edit(invalid)
    assert.throws(() => classify(invalid), /Cannot classify application changes safely/)
  }
  for (const lockfile of ["", "{", '{"lockfileVersion":2,"packages":{},"packages":{},"workspaces":{"":{}}}']) {
    const invalid = { ...raw(fixture()), lockfile }
    assert.throws(() => classifyApplicationChanges({ changedFiles: ["website/index.html"], before: invalid, after: invalid }), /Cannot classify application changes safely/)
  }
  const valid = raw(fixture())
  const invalid = { ...valid, lockfile: valid.lockfile.replace('"react":[', '"react":["invalid"],"react":[') }
  assert.throws(() => classifyApplicationChanges({ changedFiles: ["bun.lock"], before: valid, after: invalid }), /Duplicate key/)
})

test("JSONC formatting and object-key order do not change semantic snapshots", () => {
  const before = raw(fixture())
  const after = { ...before, lockfile: before.lockfile.replace('"lockfileVersion":2,', '/* Bun lock */ "lockfileVersion":2,').replace(/}$/, ",}") }
  unchanged(classifyApplicationChanges({ changedFiles: ["bun.lock"], before, after }))
})

test("initial release baseline is explicit, and still validates the new snapshot", () => {
  const before = { packageJSON: "{}", lockfile: "" }
  changed(classifyApplicationChanges({ changedFiles: [], before, after: raw(fixture()) }), "Initial application snapshot")
  assert.throws(() => classifyApplicationChanges({ changedFiles: [], before, after: { packageJSON: "{}", lockfile: "not JSON" } }), /Cannot classify application changes safely/)
})
