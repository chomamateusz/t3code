#!/usr/bin/env bash
set -euo pipefail
if test "$#" -ne 3; then
  printf 'usage: %s <stack-dir> <source-repo> <result-file>\n' "${0##*/}" >&2
  exit 2
fi
stack=$(cd -- "$1" && pwd)
source=$2
result=$3
mapfile -t patches < <(find "$stack/patches" -maxdepth 1 -name '*.patch' -printf '%f\n' | LC_ALL=C sort)
if test "${#patches[@]}" -eq 0; then
  printf 'No patches in %s/patches\n' "$stack" >&2
  exit 1
fi
if test -n "$(git -C "$source" status --porcelain)"; then
  printf 'Source checkout %s is not clean\n' "$source" >&2
  exit 1
fi
upstream_sha=$(git -C "$source" rev-parse HEAD)
git_dir=$(git -C "$source" rev-parse --absolute-git-dir)
log=$(mktemp)
trap 'rm -f "$log" "$log.paths"' EXIT
export GIT_COMMITTER_NAME=${GIT_COMMITTER_NAME:-t3code stack}
export GIT_COMMITTER_EMAIL=${GIT_COMMITTER_EMAIL:-stack@t3code.invalid}
paths=()
for patch in "${patches[@]}"; do paths+=("$stack/patches/$patch"); done
if git -C "$source" -c core.autocrlf=false am --3way --keep --keep-cr --no-scissors \
  --no-message-id --no-gpg-sign --committer-date-is-author-date --whitespace=nowarn \
  "${paths[@]}" 2> "$log"; then
  cat "$log" >&2
  jq -n \
    --arg upstreamSha "$upstream_sha" \
    --arg head "$(git -C "$source" rev-parse HEAD)" \
    --arg tree "$(git -C "$source" rev-parse 'HEAD^{tree}')" \
    --argjson patches "${#patches[@]}" \
    '{status: "applied", upstreamSha: $upstreamSha, head: $head, tree: $tree, patches: $patches}' > "$result"
  printf 'Applied %s patches onto %s\n' "${#patches[@]}" "$upstream_sha"
  exit 0
fi
cat "$log" >&2
index=0
if test -f "$git_dir/rebase-apply/next"; then index=$(cat "$git_dir/rebase-apply/next"); fi
failed_patch=''
if test "$index" -ge 1 && test "$index" -le "${#patches[@]}"; then failed_patch=${patches[index - 1]}; fi
subject=''
if test -n "$failed_patch"; then
  subject=$(git mailinfo -k /dev/null /dev/null < "$stack/patches/$failed_patch" | sed -n 's/^Subject: //p')
fi
failing_paths() {
  sed -nE \
    -e 's/^error: patch failed: (.*):[0-9]+$/\1/p' \
    -e 's/^error: (.*): (does not exist in index|already exists in index|already exists in working directory|patch does not apply|does not match index)$/\1/p' \
    -e 's/^CONFLICT \([^)]*\): .* in (.*)$/\1/p'
}
{
  git -C "$source" diff --name-only --diff-filter=U
  failing_paths < "$log"
} | LC_ALL=C sort -u > "$log.paths"
# The blob-less fetch leaves git am without the preimages for a 3-way merge, so it names no paths.
if test ! -s "$log.paths" && test -n "$failed_patch"; then
  { git -C "$source" apply --check "$stack/patches/$failed_patch" 2>&1 >/dev/null || true; } \
    | failing_paths | LC_ALL=C sort -u > "$log.paths"
fi
jq -n \
  --arg upstreamSha "$upstream_sha" \
  --arg patch "$failed_patch" \
  --arg subject "$subject" \
  --argjson index "$index" \
  --argjson patches "${#patches[@]}" \
  --rawfile conflicted "$log.paths" \
  '{status: "failed", upstreamSha: $upstreamSha, patches: $patches, failedIndex: $index,
    failedPatch: $patch, failedSubject: $subject,
    conflictedPaths: ($conflicted | split("\n") | map(select(length > 0)))}' > "$result"
printf 'Patch %s/%s failed: %s\n' "$index" "${#patches[@]}" "${failed_patch:-<none>}" >&2
exit 1
