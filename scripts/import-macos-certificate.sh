#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${APPLE_CERTIFICATE:-}" || -z "${APPLE_CERTIFICATE_PASSWORD:-}" || -z "${KEYCHAIN_PASSWORD:-}" ]]; then
  echo "macOS signing secrets are incomplete" >&2
  exit 2
fi

certificate_path="$RUNNER_TEMP/mere-graph-studio-signing.p12"
keychain_path="$RUNNER_TEMP/mere-graph-studio-signing.keychain-db"

printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$certificate_path"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$keychain_path"
security set-keychain-settings -lut 21600 "$keychain_path"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$keychain_path"
security import "$certificate_path" -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$keychain_path"
security list-keychains -d user -s "$keychain_path" login.keychain-db
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$keychain_path"
security find-identity -v -p codesigning "$keychain_path"
