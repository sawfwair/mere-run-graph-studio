#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

node --test scripts/*.test.mjs
pnpm lint
./scripts/complexity.sh --quiet
pnpm web:check
pnpm harness:check
pnpm web:test
pnpm cloud:check
pnpm cloud:test
pnpm harness:shoot
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
