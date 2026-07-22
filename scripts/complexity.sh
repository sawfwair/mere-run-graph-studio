#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

QUIET=false
BASELINE_ONLY=false
for argument in "$@"; do
  if [[ "$argument" == "--quiet" ]]; then
    QUIET=true
  elif [[ "$argument" == "--print-baseline" ]]; then
    BASELINE_ONLY=true
  fi
done

node scripts/complexity.mjs "$@"
if [[ "$BASELINE_ONLY" == true ]]; then
  exit 0
fi

cargo clippy --quiet --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D clippy::cognitive-complexity
if [[ "$QUIET" == false ]]; then
  printf '%s\n' 'Rust cognitive complexity: PASS (maximum 10)'
fi
