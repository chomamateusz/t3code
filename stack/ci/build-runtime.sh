#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64
if test "$#" -ne 4; then
  printf 'usage: %s <source-archive> <build-dir> <version> <expected-tree>\n' "${0##*/}" >&2
  exit 2
fi
STACK_CI=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SOURCE_ARCHIVE=$(realpath -e "$1")
BUILD=$(realpath -m "$2")
VERSION=$3
TREE=$4
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-local\.stack\.[0-9]{8}\.[0-9]+$ ]]
[[ "$TREE" =~ ^[0-9a-f]{40}$ ]]
test ! -e "$BUILD"
for command in git curl tar xz python3 make g++ pkg-config patchelf dpkg-query cargo rustc; do
  command -v "$command" >/dev/null
done
dpkg-query -W -f='${Status}\n' libatomic1 libsecret-1-dev
mkdir -p "$BUILD/toolchain" "$BUILD/out" "$BUILD/source"
exec > >(tee "$BUILD/out/build.log") 2>&1
trap 'printf "BUILD_EXIT_CODE=%s\n" "$?"' EXIT
set -x
tar --no-same-owner -xzf "$SOURCE_ARCHIVE" -C "$BUILD/source"
cd "$BUILD/source"
test "$(git rev-parse 'HEAD^{tree}')" = "$TREE"
test -z "$(git status --porcelain)"
COMMIT=$(git rev-parse HEAD)
NODE_VERSION=$(python3 -I -c 'import json; print(json.load(open("package.json"))["engines"]["node"])')
PNPM_VERSION=$(python3 -I -c 'import json; print(json.load(open("package.json"))["packageManager"])')
[[ "$PNPM_VERSION" == pnpm@* ]]
PNPM_VERSION=${PNPM_VERSION#pnpm@}
PNPM_VERSION=${PNPM_VERSION%%+*}
[[ "$PNPM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
NODE_BIN=$(bash "$STACK_CI/fetch-node.sh" "$NODE_VERSION" "$BUILD/toolchain")
export PATH="$NODE_BIN:$PATH"
npm install --prefix "$BUILD/toolchain/pnpm" --ignore-scripts --no-package-lock "pnpm@$PNPM_VERSION"
export PATH="$BUILD/toolchain/pnpm/node_modules/.bin:$PATH"
test "$(node -v)" = "v$NODE_VERSION"
test "$(pnpm -v)" = "$PNPM_VERSION"
rustc --version
cargo --version
unset VITE_HTTP_URL VITE_WS_URL T3CODE_HOME T3CODE_RELEASE_BASE_URL T3CODE_PACK_EXE T3CODE_PACK_EXE_TARGET
export CI=true T3CODE_TELEMETRY_CHANNEL=dev T3CODE_TELEMETRY_ENABLED=false
pnpm install --frozen-lockfile
export PATH="$BUILD/source/node_modules/.bin:$PATH"
node scripts/update-release-package-versions.ts "$VERSION"
mkdir -p "$BUILD/out/server" "$BUILD/out/web" "$BUILD/out/exe" "$BUILD/out/resource-monitor/linux-x64"
ln -s "$BUILD/out/server" apps/server/dist
ln -s "$BUILD/out/web" apps/web/dist
ln -s "$BUILD/out/exe" apps/server/dist-exe
vp run --filter t3 build
node apps/server/scripts/cli.ts build-exe --verbose
export CARGO_TARGET_DIR="$BUILD/out/cargo"
cargo build --locked --release --manifest-path native/resource-monitor/Cargo.toml --target x86_64-unknown-linux-gnu
cp "$CARGO_TARGET_DIR/x86_64-unknown-linux-gnu/release/t3-resource-monitor" "$BUILD/out/resource-monitor/linux-x64/t3-resource-monitor"
node scripts/build-cli-archive.ts --platform linux --arch x64 --version "$VERSION" --resource-monitor-dir "$BUILD/out/resource-monitor" --output-dir "$BUILD/out"
ARCHIVE="$BUILD/out/t3-$VERSION-linux-x64.tar.gz"
python3 -I "$STACK_CI/materialize-archive.py" "$ARCHIVE"
node "$STACK_CI/verify-bundle.mjs" "$BUILD/out/server/bin.mjs" "$BUILD/out/exe/t3" "$VERSION" | tee "$BUILD/out/fork-markers.txt"
node scripts/smoke-cli-archive.ts --archive "$ARCHIVE" --expect-version "$VERSION"
mkdir "$BUILD/out/verified"
tar -xzf "$ARCHIVE" -C "$BUILD/out/verified" --strip-components=1
"$BUILD/out/verified/t3" --version | tee "$BUILD/out/version.txt"
node "$STACK_CI/verify-bundle.mjs" "$BUILD/out/server/bin.mjs" "$BUILD/out/verified/t3" "$VERSION" | tee "$BUILD/out/archive-markers.txt"
node "$STACK_CI/verify-native.mjs" "$BUILD/out/verified"
git diff --stat | tee "$BUILD/out/version-stamp-diff.txt"
git diff --exit-code -- . ':!apps/server/package.json' ':!apps/web/package.json' ':!apps/desktop/package.json' ':!packages/contracts/package.json'
cd "$BUILD/out"
sha256sum "t3-$VERSION-linux-x64.tar.gz" > SHA256SUMS
printf 'SOURCE_COMMIT=%s\nSOURCE_TREE=%s\nVERSION=%s\nNODE=%s\nPNPM=%s\n' "$COMMIT" "$TREE" "$VERSION" "$(node -v)" "$(pnpm -v)" > provenance.txt
printf 'Ready: %s\n' "$ARCHIVE"
