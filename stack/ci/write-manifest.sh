#!/usr/bin/env bash
set -euo pipefail
if test "$#" -ne 7; then
  printf 'usage: %s <output> <version> <upstream-sha> <stack-sha> <series-date> <build-number> <run-url>\n' "${0##*/}" >&2
  exit 2
fi
[[ "$2" =~ ^[0-9]+\.[0-9]+\.[0-9]+-local\.stack\.[0-9]{8}\.[0-9]+$ ]]
[[ "$3" =~ ^[0-9a-f]{40}$ ]]
[[ "$4" =~ ^[0-9a-f]{40}$ ]]
[[ "$5" =~ ^[0-9]{8}$ ]]
[[ "$6" =~ ^[1-9][0-9]*$ ]]
jq -n \
  --arg version "$2" \
  --arg upstreamSha "$3" \
  --arg stackSha "$4" \
  --arg seriesDate "$5" \
  --argjson buildNumber "$6" \
  --arg runUrl "$7" \
  '{version: $version, upstreamSha: $upstreamSha, stackSha: $stackSha, seriesDate: $seriesDate, buildNumber: $buildNumber, runUrl: $runUrl}' > "$1"
