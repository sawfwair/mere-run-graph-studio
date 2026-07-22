# Contributing

Thanks for helping improve Mere Graph Studio. Keep changes focused, explain the
user-facing reason for them, and preserve the boundary between Studio and the
execution systems it consumes.

By submitting a contribution, you agree that it may be distributed under the
repository's [MIT License](LICENSE).

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities
through the private process in [SECURITY.md](SECURITY.md), not a public issue.

## Prerequisites

Install Node.js `20.19+` or `22.12+`, the `pnpm` version declared in
`package.json`, a stable Rust toolchain, and the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your
platform. The full visual gate also needs Playwright Chromium.

## Setup

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm hooks:install
pnpm preflight
```

Run `pnpm desktop:dev` for the offline native app or `pnpm desktop:build` for a
local installer. Use `pnpm cloud:dev` for the authenticated hosted surface. The
main check script validates both supported products:

```bash
./scripts/check.sh
```

## Boundaries

- Treat `mere.run` graph JSON as authoritative. Do not add a Studio-only
  executable graph format.
- Keep positions, viewport, groups, notes, and other visual state in the editor
  sidecar.
- Invoke only documented public CLI commands. Never accept arbitrary shell
  text from the native host.
- Keep native Studio usable without an account or network. Authentication may
  gate Relay/cloud features only.
- Keep provider-specific catalogs, templates, compilers, and compatibility
  bridges in `mere-run-plugins`.
- Keep hosted scheduling and fleet state in `relay-mere-run`.

## Tests

Native-host changes require focused Rust tests in `src-tauri/`. Graph-editing
changes require focused Vitest coverage under `web/src/`. Repository and
release-contract changes require Node tests under `scripts/`. User-interface
changes must also be checked at desktop and compact viewport sizes against a
real catalog.

Before opening a pull request:

1. Rebase or merge the latest `main` without discarding unrelated work.
2. Run `pnpm preflight` while iterating and `./scripts/check.sh` before review.
3. Include tests for changed behavior and screenshots for visible UI changes.
4. Update public documentation when commands, compatibility, or trust
   boundaries change.
5. Keep commits reviewable; do not include build output, credentials, local
   workspaces, or generated coverage reports.

Pull requests should describe the problem, the chosen boundary, verification
performed, and any follow-up work that remains. Maintainers may ask for a
smaller change when a proposal crosses repository ownership boundaries.
