#!/usr/bin/env bash
set -euo pipefail
if test "$#" -ne 3; then
  printf 'usage: %s <repo> <base> <tip>\n' "${0##*/}" >&2
  exit 2
fi
repo=$1
stack=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
base=$(git -C "$repo" rev-parse --verify --end-of-options "$2^{commit}")
tip=$(git -C "$repo" rev-parse --verify --end-of-options "$3^{commit}")
git -C "$repo" merge-base --is-ancestor "$base" "$tip"
if test -n "$(git -C "$repo" rev-list --merges "$base..$tip")"; then
  printf 'The series %s..%s contains merge commits; git am cannot replay them.\n' "$base" "$tip" >&2
  exit 1
fi
count=$(git -C "$repo" rev-list --count "$base..$tip")
test "$count" -gt 0
series_date=$(date -u +%Y%m%d)
if test -f "$stack/series-date"; then
  previous=$(cat "$stack/series-date")
  if [[ ! "$previous" =~ ^[0-9]{8}$ ]]; then
    printf '%s/series-date must be YYYYMMDD, got %s\n' "$stack" "$previous" >&2
    exit 1
  fi
  if test "$previous" -gt "$series_date"; then series_date=$previous; fi
fi
staging=$(mktemp -d "$stack/.export.XXXXXXXX")
trap 'rm -rf "$staging"' EXIT
# User and system config must not change the bytes of the exported patches.
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 git -C "$repo" \
  -c core.quotePath=false -c i18n.logOutputEncoding=UTF-8 \
  format-patch --keep-subject --no-numbered --zero-commit --full-index --binary \
  --no-signature --no-thread --no-attach --no-cover-letter --no-notes --no-base \
  --encode-email-headers --find-renames --unified=3 --diff-algorithm=myers \
  --src-prefix=a/ --dst-prefix=b/ --no-relative --no-ext-diff --no-textconv \
  --output-directory "$staging" "$base..$tip" >/dev/null
test "$(find "$staging" -maxdepth 1 -name '*.patch' | wc -l)" -eq "$count"
mkdir -p "$stack/patches"
find "$stack/patches" -maxdepth 1 -name '*.patch' -delete
mv "$staging"/*.patch "$stack/patches/"
printf '%s\n' "$base" > "$stack/upstream-base"
printf '%s\n' "$series_date" > "$stack/series-date"
printf 'Exported %s patches from %s..%s (series date %s) into %s\n' "$count" "$base" "$tip" "$series_date" "$stack"
