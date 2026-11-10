#!/usr/bin/env bash
set -euo pipefail
if test "$#" -ne 3; then
  printf 'usage: %s <app> <leaf-sha1> <work-dir>\n' "${0##*/}" >&2
  exit 2
fi
app=$1
leaf=$2
work=$3
[[ "$leaf" =~ ^[0-9a-f]{40}$ ]]
test -d "$app"
test ! -e "$work"
: "${STACK_MACOS_CERT_P12_BASE64:?}" "${STACK_MACOS_CERT_PASSWORD:?}"
umask 077
mkdir -p "$work"
keychain="$work/signing.keychain-db"
identity="$work/identity.p12"
keychain_password=$(openssl rand -hex 24)
echo "::add-mask::$keychain_password"
cleanup() {
  security delete-keychain "$keychain" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

printf '%s' "$STACK_MACOS_CERT_P12_BASE64" | tr -d '[:space:]' | base64 --decode > "$identity"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$identity" -k "$keychain" -f pkcs12 -P "$STACK_MACOS_CERT_PASSWORD" -T /usr/bin/codesign
rm -f "$identity"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" > /dev/null
search_list=("$keychain")
while IFS= read -r entry; do
  entry=${entry#"${entry%%[![:space:]]*}"}
  entry=${entry#\"}
  entry=${entry%\"}
  if [[ -n "$entry" ]]; then search_list+=("$entry"); fi
done < <(security list-keychains -d user)
security list-keychains -d user -s "${search_list[@]}"

# find-identity without -v: a self-signed identity is untrusted on the runner, and codesign does not need trust to sign.
identities=$(security find-identity -p codesigning "$keychain")
if ! grep -qiE "\) $leaf \"" <<< "$identities"; then
  echo "::error title=macOS signing::The signing secret holds no code signing identity with certificate SHA-1 $leaf. Identities found:" >&2
  grep -E '^ +[0-9]+\) ' <<< "$identities" >&2 || true
  exit 1
fi

codesign --force --deep --timestamp=none --keychain "$keychain" --sign "$leaf" "$app"
codesign --verify --deep --strict --verbose=2 "$app"
codesign -d -r- "$app"
