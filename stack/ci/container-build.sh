#!/usr/bin/env bash
set -euo pipefail
if test "$#" -ne 2; then
  printf 'usage: %s <version> <expected-tree>\n' "${0##*/}" >&2
  exit 2
fi
VERSION=$1
TREE=$2
export DEBIAN_FRONTEND=noninteractive
export TZ=Etc/UTC
finish() {
  local result=$?
  trap - EXIT
  mkdir -p /output/logs
  if test -d /work/build/out; then
    for name in build.log fork-markers.txt archive-markers.txt version.txt provenance.txt version-stamp-diff.txt; do
      if test -f "/work/build/out/$name"; then cp "/work/build/out/$name" /output/logs/; fi
    done
  fi
  printf 'CONTAINER_BUILD_EXIT_CODE=%s\n' "$result" | tee /output/logs/container-exit.txt
  # The runner reads /output as a non-root user.
  chmod -R a+rX /output
  exit "$result"
}
trap finish EXIT
apt-get update
apt-get install -y git curl ca-certificates xz-utils python3 build-essential pkg-config patchelf libatomic1 libsecret-1-dev libssl-dev
curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs -o "${TMPDIR:-/tmp}/rustup-init.sh"
sh "${TMPDIR:-/tmp}/rustup-init.sh" -y --profile minimal --default-toolchain stable --no-modify-path
export PATH="/root/.cargo/bin:$PATH"
export RUSTUP_TOOLCHAIN=stable
uname -a
cat /etc/os-release
getconf GNU_LIBC_VERSION
bash /ci/build-runtime.sh /input/source.tar.gz /work/build "$VERSION" "$TREE"
cp "/work/build/out/t3-$VERSION-linux-x64.tar.gz" /work/build/out/SHA256SUMS /work/build/out/provenance.txt /output/
tar -czf /output/server-bundle.tar.gz -C /work/build/out server
