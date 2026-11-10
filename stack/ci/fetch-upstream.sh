#!/usr/bin/env bash
set -euo pipefail
if test "$#" -ne 3; then
  printf 'usage: %s <repository-url> <ref-or-sha> <destination>\n' "${0##*/}" >&2
  exit 2
fi
url=$1
ref=$2
destination=$3
if test -e "$destination"; then
  printf '%s already exists\n' "$destination" >&2
  exit 1
fi
git init -q "$destination"
git -C "$destination" config core.autocrlf false
git -C "$destination" remote add origin "$url"
git -C "$destination" sparse-checkout set --no-cone '/*' '!/.repos/' '!/apps/mobile/modules/t3-terminal/Vendor/**/*.a'
git -C "$destination" fetch -q --depth=1 --filter=blob:none --no-tags origin "$ref"
git -C "$destination" checkout -q --detach FETCH_HEAD
git -C "$destination" rev-parse HEAD
