import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { assertDeveloperID, assertSourceCommit, assertVersions, assetName, releaseVersion, selectAsset, sourceVersion, verifyDMG } from "./release-contract.mjs"

// Minimal deterministic UDIF envelope; no network, user files, real DMG or credentials.
const dmg = Buffer.alloc(1024, 7)
dmg.write("koly", dmg.length - 512)
const asset = {
  id: 91, name: "Sela_1.2.3_aarch64.dmg", state: "uploaded", size: dmg.length,
  digest: `sha256:${createHash("sha256").update(dmg).digest("hex")}`,
}
const release = { id: 42, tag_name: "v1.2.3", draft: false, prerelease: false, assets: [asset] }

test("manual and signed builds use Tauri's canonical versioned ARM64 name", () => {
  assert.equal(assetName("1.2.3"), "Sela_1.2.3_aarch64.dmg")
  assert.equal(assetName("1.2.3", "x86_64"), "Sela_1.2.3_x64.dmg")
  assert.throws(() => assetName("1.2.3", "universal"))
  assert.equal(selectAsset(release, "1.2.3", "42"), asset)
  assert.equal(sourceVersion().length > 0, true)
})

test("selection cannot fall through to a different version, arch, tag or release ID", () => {
  for (const name of ["Sela_1.2.2_aarch64.dmg", "Sela_1.2.3_x64.dmg", "Sela-1.2.3-macos-apple-silicon.dmg"]) {
    assert.throws(() => selectAsset({ ...release, assets: [{ ...asset, name }] }, "1.2.3"))
  }
  assert.throws(() => selectAsset(release, "1.2.4"))
  assert.throws(() => selectAsset(release, "1.2.3", "43"))
  assert.throws(() => selectAsset({ ...release, assets: [asset, { ...asset, id: 92 }] }, "1.2.3"))
  assert.throws(() => selectAsset({ ...release, draft: true }, "1.2.3"))
  assert.throws(() => selectAsset({ ...release, prerelease: true }, "1.2.3"))
  assert.throws(() => selectAsset({ ...release, draft: undefined }, "1.2.3"))
  assert.throws(() => selectAsset({ ...release, prerelease: undefined }, "1.2.3"))
  for (const tag of ["1.2.3", "v1.2.3-beta.1", "v1.2", "v1.2.3\n", "v1.2.3/other"]) {
    assert.throws(() => releaseVersion(tag))
  }
})

test("all source manifests and lockfile must agree before release attachment", () => {
  const cargo = '[package]\nname = "sela"\nversion = "1.2.3"\n'
  const lock = '[[package]]\nname = "sela"\nversion = "1.2.3"\n'
  const tauri = { productName: "Sela", version: "1.2.3" }
  assert.doesNotThrow(() => assertVersions("1.2.3", cargo, tauri, lock))
  assert.throws(() => assertVersions("1.2.4", cargo, tauri, lock))
  assert.throws(() => assertVersions("1.2.3", cargo.replace("1.2.3", "1.2.4"), tauri, lock))
  assert.throws(() => assertVersions("1.2.3", cargo, { ...tauri, version: "1.2.4" }, lock))
  assert.throws(() => assertVersions("1.2.3", cargo, tauri, lock.replace("1.2.3", "1.2.4")))
})

test("GitHub must supply the uploaded asset size and SHA256 digest", () => {
  for (const override of [{ digest: null }, { digest: "sha256:nope" }, { size: 0 }, { state: "new" }, { id: 0 }]) {
    assert.throws(() => selectAsset({ ...release, assets: [{ ...asset, ...override }] }, "1.2.3"))
  }
})

test("download and served bytes reject truncation, alteration, stale data and SPA HTML", () => {
  assert.equal(verifyDMG(dmg, asset), asset.digest)
  assert.throws(() => verifyDMG(dmg.subarray(1), asset))
  const altered = Buffer.from(dmg)
  altered[0] ^= 1
  assert.throws(() => verifyDMG(altered, asset))
  const html = Buffer.from("<!doctype html><html>Wrong download</html>".padEnd(1024))
  assert.throws(() => verifyDMG(html, asset))
  // Even if a wrong HTML payload has a matching declared digest, it isn't a DMG.
  assert.throws(() => verifyDMG(html, {
    size: html.length, digest: `sha256:${createHash("sha256").update(html).digest("hex")}`,
  }), /not a UDIF DMG/)
})

test("signed releases require the intended Developer ID Application team", () => {
  const signature = "Authority=Developer ID Application: Example Inc (ABCDE12345)\nTeamIdentifier=ABCDE12345\n"
  assert.doesNotThrow(() => assertDeveloperID(signature, "ABCDE12345"))
  assert.throws(() => assertDeveloperID(signature, "WRONG12345"))
  assert.throws(() => assertDeveloperID(signature.replace("Developer ID Application", "Apple Development"), "ABCDE12345"))
  assert.throws(() => assertDeveloperID(signature.replace("TeamIdentifier=ABCDE12345", "TeamIdentifier=OTHER12345"), "ABCDE12345"))
  assert.throws(() => assertDeveloperID("Signature=adhoc\nTeamIdentifier=not set\n", "ABCDE12345"))
  assert.throws(() => assertDeveloperID(signature, undefined))
})

test("website source must be the exact pushed release-tag commit", () => {
  const commit = "a".repeat(40)
  assert.doesNotThrow(() => assertSourceCommit(commit, commit))
  assert.throws(() => assertSourceCommit(commit, "b".repeat(40)))
  assert.throws(() => assertSourceCommit("invalid", "invalid"))
})
