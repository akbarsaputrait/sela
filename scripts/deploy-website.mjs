import { execFileSync } from "node:child_process"
import { downloadPath, verifyDMG, websiteURL } from "./release-contract.mjs"
import { assertLatest, assertMainSource, syncDownload } from "./sync-website-download.mjs"

console.warn("Optional manual deployment: avoid running concurrently with Cloudflare's Git-connected deployments.")

assertMainSource()
execFileSync("bun", ["run", "build:website"], { stdio: "inherit" })
const { release, asset } = syncDownload()
assertLatest(release.id)
assertMainSource()
// Automatic production deployments belong to the existing Cloudflare Git integration.
execFileSync("node_modules/.bin/wrangler", ["deploy"], { stdio: "inherit" })
const url = new URL(downloadPath, `${websiteURL}/`)
assertLatest(release.id)
assertMainSource()
const response = await fetch(url, { cache: "no-store", headers: { "Cache-Control": "no-cache" } })
if (!response.ok) throw new Error(`Deployed download returned HTTP ${response.status}: ${url}`)
if ((response.headers.get("content-type") ?? "").includes("text/html")) {
  throw new Error("Deployed binary URL returned HTML instead of a DMG")
}
verifyDMG(Buffer.from(await response.arrayBuffer()), asset)
if (!(response.headers.get("cache-control") ?? "").includes("no-store")) {
  throw new Error("Deployed binary URL is missing the required no-store cache policy")
}
assertLatest(release.id)
assertMainSource()
console.log(`Verified deployed URL bytes and SHA256: ${url}`)
