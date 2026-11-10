#!/usr/bin/env bash
set -euo pipefail
if test "$#" -ne 3; then
  printf 'usage: %s <carried-repo> <tip> <scratch-parent>\n' "${0##*/}" >&2
  exit 2
fi
carried=$1
stack=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
tip=$(git -C "$carried" rev-parse --verify --end-of-options "$2^{commit}")
base=$(cat "$stack/upstream-base")
scratch=$(mktemp -d "$3/verify-series.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
bash "$stack/ci/fetch-upstream.sh" "${UPSTREAM_URL:-https://github.com/pingdotgg/t3code.git}" "$base" "$scratch/source" >/dev/null
bash "$stack/ci/apply-series.sh" "$stack" "$scratch/source" "$scratch/result.json"
expected_tree=$(git -C "$carried" rev-parse "$tip^{tree}")
actual_tree=$(git -C "$scratch/source" rev-parse 'HEAD^{tree}')
printf 'carried tree %s\napplied tree %s\n' "$expected_tree" "$actual_tree"
test "$expected_tree" = "$actual_tree"
messages() {
  local commit
  for commit in $(git -C "$1" rev-list --reverse "$2"); do
    git -C "$1" log -1 --format='%an%x00%ae%x00%aI%x00%s%x00' "$commit"
    git -C "$1" log -1 --format=%B "$commit" | git stripspace
  done
}
cmp <(messages "$carried" "$base..$tip") <(messages "$scratch/source" "$base..HEAD")
printf 'Series round trip: tree, authors, dates and subjects identical; bodies identical after git stripspace\n'
