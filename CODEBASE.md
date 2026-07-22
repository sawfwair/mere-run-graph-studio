# Codebase map

Mere Graph Studio is an optional authoring and operations UI for portable
`mere.run` graphs. It owns editing, project persistence, diagnostics, and run
inspection; it does not own graph semantics, providers, model execution,
scheduling, or secret values.

- `web/src/App.tsx`: editor orchestration and composition root.
- `web/src/components/`: focused React surfaces; `GraphCanvas` adapts documents
  to XYFlow and `Inspector` edits the selected document element.
- `web/src/graph.ts`, `program.ts`, `app-mode.ts`: deterministic domain logic.
- `web/src/decode.ts`: the only browser JSON decoder; all HTTP, file, recovery,
  and Tauri data is `unknown` until decoded.
- `web/src/runtime.ts`: offline Tauri adapter. `cloud-runtime.ts`: same-origin
  hosted adapter. Both implement `StudioRuntime`.
- `src-tauri/src/`: workspace-confined native orchestration around public JSON
  CLIs. No auth or network client belongs here.
- `cloud/`: OAuth, account Durable Object, and allow-listed Relay proxy.
- `contracts/`: compatibility fixtures; `scripts/`: local gates and release tools.

Start with `pnpm preflight`; finish with `./scripts/check.sh`. Preserve separate
workflow, inputs, editor sidecar, and optional program documents. Never persist
credentials or add execution semantics to Studio.
