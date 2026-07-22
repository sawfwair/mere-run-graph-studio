#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: sign-macos-release.sh --input APP.zip --output SIGNED.zip --identity NAME [--notary-profile NAME]
EOF
  exit 64
}

INPUT=""
OUTPUT=""
IDENTITY=""
NOTARY_PROFILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --input) shift; [[ $# -gt 0 ]] || usage; INPUT="$1" ;;
    --output) shift; [[ $# -gt 0 ]] || usage; OUTPUT="$1" ;;
    --identity) shift; [[ $# -gt 0 ]] || usage; IDENTITY="$1" ;;
    --notary-profile) shift; [[ $# -gt 0 ]] || usage; NOTARY_PROFILE="$1" ;;
    *) usage ;;
  esac
  shift
done

[[ "$(uname -s)" == "Darwin" ]] || { echo "macOS signing requires macOS" >&2; exit 69; }
[[ -f "$INPUT" ]] || { echo "input app archive does not exist: $INPUT" >&2; exit 66; }
[[ -n "$OUTPUT" && -n "$IDENTITY" ]] || usage
[[ ! -e "$OUTPUT" ]] || { echo "output already exists: $OUTPUT" >&2; exit 73; }

WORK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mere-graph-studio-sign.XXXXXX")"
trap 'rm -rf "$WORK_ROOT"' EXIT
ditto -x -k "$INPUT" "$WORK_ROOT"
APP="$WORK_ROOT/Mere Graph Studio.app"
[[ -d "$APP" ]] || { echo "archive does not contain Mere Graph Studio.app" >&2; exit 65; }

codesign --force --options runtime --timestamp --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

if [[ -n "$NOTARY_PROFILE" ]]; then
  SUBMISSION="$WORK_ROOT/notarization.zip"
  ditto -c -k --keepParent "$APP" "$SUBMISSION"
  xcrun notarytool submit "$SUBMISSION" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$APP"
  xcrun stapler validate "$APP"
fi

ditto -c -k --keepParent "$APP" "$OUTPUT"
codesign --verify --deep --strict --verbose=2 "$APP"
shasum -a 256 "$OUTPUT"
