import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

export const repository = "akbarsaputrait/sela"
export const downloadPath = "downloads/Sela-macOS-arm64.dmg"
export const websiteURL = "https://sela.akbarsaputrait.tech"

export function releaseVersion(tag) {
  if (typeof tag !== "string" || tag !== tag.trim() || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) {
    throw new Error("A stable release tag of the form vMAJOR.MINOR.PATCH is required")
  }
  return tag.slice(1)
}

export function assertVersions(version, cargo, tauri, lock) {
  const cargoVersion = cargo.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1]
  const lockVersion = lock.match(/\[\[package\]\]\nname = "sela"\nversion = "([^"]+)"/)?.[1]
  if (cargoVersion !== version || tauri.version !== version || lockVersion !== version) {
    throw new Error("package.json, Cargo.toml, Cargo.lock and tauri.conf.json versions must match")
  }
  if (tauri.productName !== "Sela") throw new Error("Release asset naming requires productName Sela")
}

export function sourceVersion() {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version
  releaseVersion(`v${version}`)
  assertVersions(version, readFileSync("src-tauri/Cargo.toml", "utf8"),
    JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")),
    readFileSync("src-tauri/Cargo.lock", "utf8"))
  return version
}

export function assetName(version, arch = "aarch64") {
  releaseVersion(`v${version}`)
  if (!["aarch64", "x86_64"].includes(arch)) throw new Error("Unsupported release architecture")
  return `Sela_${version}_${arch === "x86_64" ? "x64" : arch}.dmg`
}

export function selectAsset(release, expectedID) {
  if (!Number.isSafeInteger(release.id) || release.id <= 0 ||
      (expectedID !== undefined && String(release.id) !== String(expectedID))) {
    throw new Error("Release ID does not match the requested release")
  }
  if (release.draft !== false || release.prerelease !== false) {
    throw new Error("Only a published stable release can be deployed")
  }
  const version = releaseVersion(release.tag_name)
  const matches = release.assets.filter((asset) => asset.name === assetName(version))
  if (matches.length !== 1) throw new Error(`Expected exactly one ${assetName(version)} asset`)
  const asset = matches[0]
  if (!Number.isSafeInteger(asset.id) || asset.id <= 0 || asset.state !== "uploaded" ||
      !Number.isSafeInteger(asset.size) || asset.size < 512 ||
      !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "")) {
    throw new Error("Release asset requires an uploaded ID, size and GitHub SHA256 digest")
  }
  return asset
}

export function verifyDMG(bytes, asset) {
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  if (bytes.length !== asset.size || digest !== asset.digest) {
    throw new Error("DMG size or SHA256 digest mismatch; refusing unverified download")
  }
  if (bytes.length < 512 || bytes.subarray(bytes.length - 512, bytes.length - 508).toString() !== "koly") {
    throw new Error("Download is not a UDIF DMG (HTML and other payloads are rejected)")
  }
  return digest
}

export function assertDeveloperID(signature, teamID) {
  const authority = signature.match(/^Authority=Developer ID Application: .+ \(([A-Z0-9]+)\)$/m)?.[1]
  const team = signature.match(/^TeamIdentifier=([A-Z0-9]+)$/m)?.[1]
  if (!teamID || !/^[A-Z0-9]+$/.test(teamID) || authority !== teamID || team !== teamID) {
    throw new Error("App must be signed with the configured Developer ID Application team")
  }
}

export function assertSourceCommit(head, currentMain, expected = head) {
  if (!/^[a-f0-9]{40}$/.test(head) || head !== currentMain || head !== expected) {
    throw new Error("Website source HEAD must match current main and the resolved deployment source")
  }
}
