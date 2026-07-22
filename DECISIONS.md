# Architectural decisions

## Local and hosted checks run the same gate

Every local commit runs `.githooks/pre-commit`, which invokes `pnpm preflight`.
The preflight has zero-warning type-aware lint, strict TypeScript checks,
an enforced complexity ratchet, coverage-gated web and Worker tests, desktop
formatting, and desktop/mobile browser smoke captures. Install it with
`pnpm hooks:install`. GitHub Actions runs the complete repository check for
public pull requests and `main`; local enforcement remains available and
identical when hosted infrastructure is unavailable.

## Complexity is measured locally and ratcheted

`pnpm complexity` uses Oxlint's classic McCabe calculation and Radon's A-F
bands for JavaScript and TypeScript. Complexity 10 is the target maximum. The
checked-in profile permits today's hotspots only while rejecting a new hotspot
or an increase in the sorted per-file profile. The baseline should be lowered
alongside each reduction so improvements become permanent without hiding the
existing work. Rust uses Clippy's cognitive-complexity lint with a ceiling of 10
because Clippy does not expose a McCabe lint; the report keeps the two metrics
explicitly distinct. Both checks run locally and in the hosted repository gate.

## External values are decoded, not asserted

HTTP JSON, imported files, recovery storage, Relay event lines, and Tauri IPC
all enter as `unknown`. Browser contracts are decoded in `web/src/decode.ts`;
Worker token bodies use `cloud/decode.ts`. Oxlint forbids unsafe assertions and
the repository contract test prevents raw parsing or IPC calls from spreading.
This keeps the Rust, Relay, and plugin boundaries independently versionable.

## One document is not four concerns

Workflow, inputs, editor sidecar, and optional program documents stay separate
on disk and in memory. A `.meregraph.json` package is only a transport envelope.
Secrets are named references, never values. This preserves portable execution
and keeps visual/editor state out of the public graph contract.

## Coverage measures deterministic cores

The web coverage gate includes graph/program transformations, runtime decoders,
cloud bundle construction, model selection, run previews, and UI value helpers.
The Worker gate covers account persistence and credential rejection. Browser
composition is exercised by the real Workspace visual harness at desktop and
mobile widths; the Rust host is exercised by Cargo tests.

## TypeScript 7 uses Oxlint's type-aware engine

The current `typescript-eslint` release does not support this repository's
TypeScript version. Oxlint with `oxlint-tsgolint` supplies type-aware promise,
unsafe-value, exhaustiveness, import-cycle, React hook, and accessibility rules
without downgrading TypeScript.

## The editor shell has a 650 kB entry budget

React, XYFlow, and the editor load as one application shell in both desktop and
hosted builds; route-level lazy loading would not remove a user-facing startup
dependency. Vite's warning budget is set to 650 kB, just above the current
~600-618 kB minified entries, so material growth still fails visibly without a
permanent generic warning.
