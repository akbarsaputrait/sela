import ts from "typescript"

// Keep this list aligned with the desktop build's imports (including src/index.css).
// Unknown development tools count conservatively; only known non-build tools are omitted.
const nonApplicationTools = new Set(["sharp", "wrangler", "lefthook", "oxfmt", "oxlint", "vitest"])
const runtimeGroups = ["dependencies", "optionalDependencies", "peerDependencies"]
const scriptRoots = ["build", "dev", "preview", "tauri", "preinstall", "install", "postinstall", "prepare"]
const metadataFields = new Set([
  "version", "description", "keywords", "author", "contributors", "license", "homepage",
  "repository", "bugs", "funding", "private", "scripts", "devDependencies", ...runtimeGroups,
])

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`)
  return value
}

function dependencyMap(value, label) {
  if (value === undefined) return {}
  object(value, label)
  for (const [name, spec] of Object.entries(value)) {
    packageLocation(name)
    if (packageLocation(name).length !== 1 || typeof spec !== "string" || !spec.trim()) {
      throw new Error(`Invalid dependency in ${label}: ${name}`)
    }
  }
  return value
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function parse(text, label, jsonc = false) {
  if (typeof text !== "string" || !text.trim()) throw new Error(`Missing ${label}`)
  // TypeScript understands Bun's comments and trailing commas. Inspect the AST as
  // well: JSON.parse and parseConfigFileTextToJson silently discard duplicate keys.
  const source = ts.parseJsonText(label, text)
  if (source.parseDiagnostics.length) throw new Error(`Malformed ${label}`)
  function inspect(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const seen = new Set()
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) {
          throw new Error(`Invalid JSON property in ${label}`)
        }
        const name = property.name.text
        if (seen.has(name)) throw new Error(`Duplicate key in ${label}: ${name}`)
        seen.add(name)
      }
    }
    ts.forEachChild(node, inspect)
  }
  inspect(source)
  const result = jsonc ? ts.parseConfigFileTextToJson(label, text) : { config: JSON.parse(text) }
  if (result.error) throw new Error(`Malformed ${label}`)
  return object(result.config, label)
}

// Bun uses installation paths, not package identities, for duplicate entries:
// @scope/parent/child/@other/leaf. Never strip a scoped package in half.
function packageLocation(key) {
  const parts = key.split("/")
  const packages = []
  for (let index = 0; index < parts.length; index++) {
    let name = parts[index]
    if (name.startsWith("@")) {
      if (name.length === 1 || !parts[index + 1] || parts[index + 1].startsWith("@")) throw new Error(`Invalid lock package path: ${key}`)
      name += `/${parts[++index]}`
    }
    if (!name || name === "." || name === ".." || /[\\\s]/.test(name)) throw new Error(`Invalid lock package path: ${key}`)
    packages.push(name)
  }
  return packages
}

function applicationPath(path) {
  if (path === "public/og-image.png") return false
  return path.startsWith("src/") || path.startsWith("src-tauri/") || path.startsWith("public/") ||
    ["index.html", "init.cjs", "app-icon.png", "bunfig.toml", ".npmrc", ".node-version", ".tool-versions"].includes(path) ||
    /^tsconfig(?:\.[^/]+)?\.json$/.test(path) ||
    /^(?:vite|postcss|tailwind)\.config\.[^/]+$/.test(path) ||
    /^\.env(?:\.[^/]+)?$/.test(path)
}

function applicationScripts(scripts) {
  scripts = dependencyMap(scripts, "package scripts")
  const selected = {}
  const pending = [...scriptRoots]
  while (pending.length) {
    const name = pending.pop()
    if (Object.hasOwn(selected, name)) continue
    // Record absent roots too, so adding/removing a lifecycle hook is visible.
    selected[name] = scripts[name] ?? null
    if (!scripts[name]) continue
    pending.push(`pre${name}`, `post${name}`)
    for (const match of scripts[name].matchAll(/\b(?:bun|npm|pnpm)\s+run\s+(?:--\s+)?([\w:.-]+)|\byarn\s+(?:run\s+)?([\w:.-]+)/g)) {
      pending.push(match[1] ?? match[2])
    }
  }
  return selected
}

function snapshot(raw) {
  const manifest = parse(raw?.packageJSON, "package.json")
  const lock = parse(raw?.lockfile, "bun.lock", true)
  const supportedLockFields = new Set(["lockfileVersion", "configVersion", "workspaces", "packages"])
  for (const key of Object.keys(lock)) {
    if (!supportedLockFields.has(key)) throw new Error(`Unsupported Bun lockfile field: ${key}`)
  }
  if (![1, 2].includes(lock.lockfileVersion) || (lock.configVersion !== undefined && lock.configVersion !== 1)) {
    throw new Error("Unsupported Bun lockfile version")
  }
  const workspaces = object(lock.workspaces, "Bun workspaces")
  if (Object.keys(workspaces).length !== 1 || !Object.hasOwn(workspaces, "")) throw new Error("Unsupported Bun workspace graph")
  const workspace = object(workspaces[""], "Bun root workspace")
  const packages = object(lock.packages, "Bun packages")
  const roots = {}
  const declarations = {}
  for (const group of [...runtimeGroups, "devDependencies"]) {
    const declared = dependencyMap(manifest[group], `package ${group}`)
    const locked = dependencyMap(workspace[group], `workspace ${group}`)
    const relevant = (name) => group !== "devDependencies" || !nonApplicationTools.has(name)
    declarations[group] = Object.fromEntries(Object.entries(declared).filter(([name]) => relevant(name)))
    const lockedRelevant = Object.fromEntries(Object.entries(locked).filter(([name]) => relevant(name)))
    if (canonical(declarations[group]) !== canonical(lockedRelevant)) throw new Error(`Package/lock mismatch in ${group}`)
    for (const [name, spec] of Object.entries(declarations[group])) {
      if (roots[name] && roots[name] !== spec) throw new Error(`Ambiguous root dependency: ${name}`)
      roots[name] = spec
    }
  }
  const records = new Map()
  const edges = new Map()
  function resolve(name, from = "", peer = false) {
    const ancestors = from ? packageLocation(from) : []
    if (peer) ancestors.pop()
    while (true) {
      const candidate = [...ancestors, name].join("/")
      if (Object.hasOwn(packages, candidate)) return candidate
      if (!ancestors.length) return null
      ancestors.pop()
    }
  }
  function visit(key, expectedName, spec) {
    const entry = packages[key]
    if (!Array.isArray(entry) || entry.length !== 4 || typeof entry[0] !== "string" ||
      typeof entry[1] !== "string" || typeof entry[3] !== "string" || !entry[3]) {
      throw new Error(`Unsupported or malformed app lock entry: ${key}`)
    }
    const metadata = object(entry[2], `lock metadata for ${key}`)
    const identityName = spec.startsWith("npm:") ? spec.slice(4).replace(/@[^@/]*$/, "") : expectedName
    if (!entry[0].startsWith(`${identityName}@`) || entry[0].length <= identityName.length + 1) {
      throw new Error(`Ambiguous app lock identity: ${key}`)
    }
    const version = entry[0].slice(identityName.length + 1)
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error(`Unsupported app lock resolution: ${key} (${entry[0]})`)
    }
    if (records.has(key)) return
    records.set(key, entry)
    const outgoing = []
    edges.set(key, outgoing)
    const optionalPeers = metadata.optionalPeers ?? []
    if (!Array.isArray(optionalPeers) || optionalPeers.some((name) => typeof name !== "string")) throw new Error(`Invalid optional peers: ${key}`)
    for (const group of runtimeGroups) {
      for (const [name, range] of Object.entries(dependencyMap(metadata[group], `${key} ${group}`))) {
        // Optional peers are integrations, not installed dependencies. In particular,
        // Vite's optional esbuild peer may be present solely because Wrangler uses it.
        // If the app selects one directly or transitively, it is already in this graph.
        if (group === "peerDependencies" && optionalPeers.includes(name)) continue
        const target = resolve(name, key, group === "peerDependencies")
        if (!target) throw new Error(`Unresolved app ${group}: ${key} -> ${name}`)
        outgoing.push([group, name, target])
        visit(target, name, range)
      }
    }
  }
  const rootEntries = []
  for (const [name, spec] of Object.entries(roots)) {
    const key = resolve(name)
    if (!key) throw new Error(`Unresolved app root: ${name}`)
    visit(key, name, spec)
    rootEntries.push([name, packages[key]])
  }
  // Compare semantic nodes and resolved edges, not hoisting paths or object order.
  // A website install can relocate an identical package without changing the app.
  const graph = [...new Set([...records].map(([key, entry]) => canonical({
    entry,
    edges: edges.get(key).map(([group, name, target]) => [group, name, records.get(target)]).sort((a, b) => canonical(a).localeCompare(canonical(b))),
  })))].sort()
  const configuration = Object.fromEntries(Object.entries(manifest).filter(([key]) => !metadataFields.has(key)))
  return {
    declarations,
    scripts: applicationScripts(manifest.scripts),
    configuration,
    graph: { roots: rootEntries.sort(([a], [b]) => a.localeCompare(b)), nodes: graph },
  }
}

/**
 * Compare raw Git snapshots without consulting the checkout's installed graph.
 * changedFiles must include deleted names and BOTH sides of renames (git diff --no-renames).
 * Invalid/unsupported app graphs throw: callers must stop before reserving a release tag.
 */
export function classifyApplicationChanges({ changedFiles, before, after }) {
  if (!Array.isArray(changedFiles) || changedFiles.some((path) => typeof path !== "string" || !path)) {
    throw new Error("changedFiles must be an array of Git paths")
  }
  const reasons = [...new Set(changedFiles.filter(applicationPath))].sort().map((path) => `Application path changed: ${path}`)
  try {
    const current = snapshot(after)
    const initial = before?.lockfile === "" && canonical(parse(before?.packageJSON, "initial package.json")) === "{}"
    if (initial) {
      reasons.push("Initial application snapshot")
      return { applicationChanged: true, reasons }
    }
    const previous = snapshot(before)
    for (const [field, label] of [
      ["declarations", "Application dependency declarations changed"],
      ["scripts", "Application build scripts changed"],
      ["configuration", "Application package configuration changed"],
      ["graph", "Resolved application dependency graph changed"],
    ]) {
      if (canonical(previous[field]) !== canonical(current[field])) reasons.push(label)
    }
  } catch (error) {
    throw new Error(`Cannot classify application changes safely: ${error.message}`, { cause: error })
  }
  return { applicationChanged: reasons.length > 0, reasons }
}
