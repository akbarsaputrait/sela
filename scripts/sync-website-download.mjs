import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { assertSourceCommit, downloadPath, repository, selectAsset, sourceVersion, verifyDMG } from "./release-contract.mjs"

export function githubJSON(endpoint) {
  return JSON.parse(execFileSync("gh", ["api", `repos/${repository}/${endpoint}`], { encoding: "utf8" }))
}

export function latestRelease() {
  return githubJSON("releases/latest")
}

export function assertLatest(releaseID) {
  if (String(latestRelease().id) !== String(releaseID)) {
    throw new Error("Release is no longer the latest stable release; refusing a stale website deployment")
  }
}

export function assertReleaseSource(release) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const published = githubJSON(`commits/${release.tag_name}`)
  assertSourceCommit(head, published.sha)
}

export function syncDownload() {
  const version = sourceVersion()
  const expectedID = process.env.SELA_RELEASE_ID
  if (expectedID && !/^[1-9]\d*$/.test(expectedID)) throw new Error("SELA_RELEASE_ID must be a numeric release ID")
  const release = expectedID ? githubJSON(`releases/${expectedID}`) : latestRelease()
  const asset = selectAsset(release, version, expectedID)
  assertReleaseSource(release)
  assertLatest(release.id)
  // The API asset ID is immutable for this request; never resolve a tag/glob a second time.
  const bytes = execFileSync("gh", ["api", "--header", "Accept: application/octet-stream",
    `repos/${repository}/releases/assets/${asset.id}`], { maxBuffer: 512 * 1024 * 1024 })
  verifyDMG(bytes, asset)
  mkdirSync("dist-website/downloads", { recursive: true })
  writeFileSync(`dist-website/${downloadPath}`, bytes)
  // Stable download URLs must not keep yesterday's binary in a browser or edge cache.
  writeFileSync("dist-website/_headers", "/downloads/*\n  Cache-Control: no-store, max-age=0\n  Content-Type: application/x-apple-diskimage\n  X-Content-Type-Options: nosniff\n")
  console.log(`Prepared verified ${asset.name} from release ID ${release.id} (${release.tag_name}).`)
  return { release, asset }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) syncDownload()
