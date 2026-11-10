#!/usr/bin/env bash
set -euo pipefail
umask 077
if test "$#" -ne 1; then
  printf 'usage: %s <version>\n' "${0##*/}" >&2
  exit 2
fi
VERSION=$1
mkdir -p /verification
exec > >(tee /verification/transcript.txt) 2>&1
transcript_pid=$!
server_pid=''
finish() {
  local result=$?
  trap - EXIT
  if test -n "$server_pid"; then
    kill -TERM "$server_pid" 2>/dev/null || true
    wait "$server_pid" || true
  fi
  printf 'VERIFICATION_EXIT_CODE=%s\n' "$result"
  exec 1>&- 2>&-
  wait "$transcript_pid"
  # The runner reads /verification as a non-root user.
  chmod -R a+rX /verification
  exit "$result"
}
trap finish EXIT
set -x
test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64
cat /etc/os-release
getconf GNU_LIBC_VERSION
uname -a
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends curl ca-certificates
dpkg-query -W -f='${Package} ${Version}\n' > /verification/packages.txt
cd /artifacts
sha256sum -c SHA256SUMS
scratch=$(mktemp -d "${TMPDIR:-/tmp}/t3-accept.XXXXXXXX")
runtime="$scratch/runtime"
mkdir "$runtime" "$scratch/home" "$scratch/t3-home"
tar -xzf "t3-$VERSION-linux-x64.tar.gz" -C "$runtime" --strip-components=1
test ! -L "$runtime/client"
test -d "$runtime/client"
test -f "$runtime/client/index.html"
test -f "$runtime/lib/libatomic.so.1.LICENSE"
env -i PATH= HOME="$scratch/home" TMPDIR="$scratch" "$runtime/t3" --version | tee /verification/version.txt
ldd "$runtime/t3" | tee /verification/ldd-t3.txt
grep -F "libatomic.so.1 => $runtime/lib/libatomic.so.1" /verification/ldd-t3.txt
if grep -F 'not found' /verification/ldd-t3.txt; then exit 1; fi
probe_node() {
  env -i PATH=/usr/bin:/bin HOME="$scratch/home" TMPDIR="$scratch" LD_LIBRARY_PATH="$runtime/lib" /probe/node/bin/node "$@"
}
probe_node --version
probe_node -p 'JSON.stringify(process.versions)'
probe_node /ci/verify-bundle.mjs /probe/server/bin.mjs "$runtime/t3" "$VERSION"
probe_node /ci/verify-native.mjs "$runtime"
probe_node /ci/verify-unpacked.mjs "$runtime" /verification/version.txt "$VERSION"
cd "$runtime"
env -i PATH= HOME="$scratch/home" USERPROFILE="$scratch/home" TMPDIR="$scratch" TEMP="$scratch" T3CODE_HOME="$scratch/t3-home" T3CODE_TELEMETRY_ENABLED=false "$runtime/t3" serve --host 127.0.0.1 --port 47700 --no-browser > /verification/server.log 2>&1 &
server_pid=$!
printf 'SERVER_PID=%s\n' "$server_pid"
curl -fsS --max-time 2 --retry 30 --retry-delay 1 --retry-max-time 60 --retry-connrefused --retry-all-errors http://127.0.0.1:47700/.well-known/t3/environment -o /verification/environment.json
cat /verification/environment.json
probe_node --input-type=module -e 'import assert from "node:assert/strict"; import fs from "node:fs"; const descriptor = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); assert.equal(descriptor.serverVersion, process.argv[2]); console.log("environment serverVersion:", descriptor.serverVersion);' /verification/environment.json "$VERSION"
curl -fsS --max-time 10 http://127.0.0.1:47700/ -o /verification/index.html
cmp "$runtime/client/index.html" /verification/index.html
printf 'Bundled web index served intact: PASS\n'
kill -TERM "$server_pid"
server_result=0
wait "$server_pid" || server_result=$?
server_pid=''
printf 'SERVER_EXIT_CODE=%s\n' "$server_result"
case "$server_result" in 0|130|143) ;; *) exit "$server_result" ;; esac
grep -F 'V2 orchestration shutdown reconciliation completed' /verification/server.log
printf 'FRESH_CONTAINER_VERIFICATION=PASS\n'
