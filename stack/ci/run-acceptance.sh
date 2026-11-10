#!/usr/bin/env bash
set -euo pipefail
if test "$#" -ne 5; then
  printf 'usage: %s <ubuntu-release> <artifacts-dir> <probe-dir> <destination> <version>\n' "${0##*/}" >&2
  exit 2
fi
release=$1
artifacts=$(realpath -e "$2")
probe=$(realpath -e "$3")
destination=$(realpath -m "$4")
version=$5
ci=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
test -x "$probe/node/bin/node"
test -f "$probe/server/bin.mjs"
mkdir -p "$destination"
docker pull --platform linux/amd64 "ubuntu:$release"
docker image inspect "ubuntu:$release" --format '{{json .RepoDigests}}' > "$destination/image-digest.txt"
result=0
docker run --rm --platform linux/amd64 \
  --mount "type=bind,src=$artifacts,dst=/artifacts,readonly" \
  --mount "type=bind,src=$ci,dst=/ci,readonly" \
  --mount "type=bind,src=$probe,dst=/probe,readonly" \
  --mount "type=bind,src=$destination,dst=/verification" \
  "ubuntu:$release" bash /ci/accept-fresh.sh "$version" || result=$?
printf 'UBUNTU=%s FRESH_CONTAINER_EXIT_CODE=%s\n' "$release" "$result" | tee "$destination/exit.txt"
exit "$result"
