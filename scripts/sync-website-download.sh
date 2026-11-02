#!/bin/sh
set -eu

# Fail before deployment if the latest release does not contain exactly one arm64 DMG.
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

release=$(gh release view --repo akbarsaputrait/sela --json tagName --jq .tagName)
gh release download "$release" --repo akbarsaputrait/sela --pattern '*_aarch64.dmg' --dir "$tmp_dir"
set -- "$tmp_dir"/*_aarch64.dmg
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Expected exactly one Apple Silicon DMG in release $release." >&2
  exit 1
fi
mkdir -p dist-website/downloads
cp "$1" dist-website/downloads/Sela-macOS-arm64.dmg
printf 'Prepared Apple Silicon download from %s.\n' "$release"
