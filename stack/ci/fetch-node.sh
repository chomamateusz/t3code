#!/usr/bin/env bash
set -euo pipefail
if test "$#" -ne 2; then
  printf 'usage: %s <node-version> <destination>\n' "${0##*/}" >&2
  exit 2
fi
version=$1
destination=$2
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'Node version must be exact X.Y.Z, got %s\n' "$version" >&2
  exit 1
fi
sha256=(sha256sum --quiet)
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux-x64 ;;
  Darwin-arm64)
    platform=darwin-arm64
    sha256=(shasum -a 256)
    ;;
  *)
    printf 'No Node.js build for %s %s\n' "$(uname -s)" "$(uname -m)" >&2
    exit 1
    ;;
esac
name="node-v$version-$platform"
mkdir -p "$destination"
cd "$destination"
curl -fsSL --retry 3 -o "$name.tar.xz" "https://nodejs.org/dist/v$version/$name.tar.xz"
curl -fsSL --retry 3 -o "node-v$version-SHASUMS256.txt" "https://nodejs.org/dist/v$version/SHASUMS256.txt"
grep -E "^[0-9a-f]{64}  $name\.tar\.xz\$" "node-v$version-SHASUMS256.txt" | "${sha256[@]}" -c - >&2
tar -xJf "$name.tar.xz"
rm "$name.tar.xz"
test "$("$PWD/$name/bin/node" -v)" = "v$version"
printf '%s\n' "$PWD/$name/bin"
