# Roadmap

## Delivered authoring

- Easy and Pro presentation modes over one non-destructive project model;
- compact and phone layouts with executor-aware running at every width;
- command palette, contextual shortcut help, and non-blocking status feedback;
- first-class graph outputs and ordering-only edges on the canvas;
- first-class graph input cards with typed edges, inline media, and positions
  stored only in the editor sidecar;
- native multi-file canvas drop with workspace-confined asset copies and one
  named input per file;
- Run-as-App: a generated run-only surface — exposed graph inputs become a form,
  graph outputs become a results gallery, with per-field hide, lock, relabel, and
  reorder stored only in the editor sidecar, and one-file portable sharing;
- variation sweeps that fan one setup into many runs across a seed, number, or
  choice input and compare the outputs together, unmetered on local compute;
- in-place model swap and model races on generation nodes, sourced only from the
  target executor's installed models (from `mere.run executor list --json`), so the
  picker never offers an uninstalled model;
- missing-model handling for portable graphs: a referenced model that the target
  has not installed is flagged on the node and in the App view, with swap and
  run-on-a-capable-executor guidance and never a silent rewrite or hard block;
- one-click model install from the node chip and the App view: a review sheet
  reports download size, free disk, and usage terms from `mere.run model pull
  --preflight --json`, then a live progress bar (parsed from the pull's stderr)
  tracks the install to completion and refreshes the installed set; the hosted
  runtime installs across the paired fleet through Relay model-plans;
- document-wide undo and redo with save-state and dirty-state tracking;
- local browser recovery for unsaved workflow, input, and sidecar changes;
- nested object and array field editors driven by catalog schemas;
- canvas-editable creative material nodes, including prompts, values, seeds,
  choices, joins, templates, model-backed enhancement, and image description;
- constant promotion, literal material inlining, and recursively wired
  JSON-pointer ports;
- latest-run scalar and media galleries guarded by source graph and input
  fingerprints, with variant navigation and full-screen inspection, so edited
  documents never display stale results;
- groups, notes, selection sets, alignment, and automatic layout in the editor
  sidecar;
- module authoring, mapped execution, and compile-time branch visualization;
- template parameter forms and confined template publishing through plugin
  contracts;
- a pinned cross-runtime compatibility matrix and canonical contract fixtures.

## Delivered operations

- streamed events rather than polling for active runs;
- artifact previews, hashes, provenance, and node fingerprint comparison;
- preflight action review for model pulls, licenses, disk, and memory;
- resume and cache-evidence controls for local runs;
- remote artifact selection, interrupted fetch recovery, and attempt history;
- executor capability comparison before submission.

Run actions remain declarative and review-only. Studio reads authoritative
manifests, events, actions, node logs, and artifact descriptors from the
standard run directory instead of creating a parallel run format.

## Distribution

- Tauri 2 desktop app with a Rust orchestration host and the shared React editor;
- native macOS Apple Silicon and Intel, Windows x64, and Linux x64 packages;
- no external language runtime, Node.js, account, network, or external-browser
  dependency in desktop packages;
- first-run `mere.run`, workflow-tools, and workspace discovery with native
  file dialogs and persistent Desktop settings;
- native project persistence, CLI orchestration, run lifecycle, cancellation,
  artifact confinement, retry, resume, and remote inspection;
- pull-request compilation on macOS, Windows, and Linux;
- tag-driven draft releases with optional Developer ID notarization and Windows
  Authenticode signing;
- one-file project import and export;

Remaining distribution work:

- install signing credentials in repository secrets and execute the first
  notarized and Authenticode-signed release;
- execute real-machine acceptance on Windows and Linux against compatible
  local or remote `mere.run` clients;
- add automatic updates after a stable public release channel exists.

Exact exported-bundle reuse across local, SSH, and Relay is a `mere.run`
runtime contract and is tested there. Studio consumes that contract instead of
shipping a separate acceptance harness.

## Compatibility

- expand the conservative Comfy importer node by node with explicit reports;
- retain imported source metadata without preserving Comfy as runtime state;
- add import fixtures from real workflows and reject unsupported custom nodes;
- never export arbitrary Studio or plugin behavior as executable shell nodes.
