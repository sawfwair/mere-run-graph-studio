# Web editor module

`App.tsx` is the composition root. It owns document history, selected UI state,
operation lifecycles, and wiring between focused components. Put deterministic
document changes in `graph.ts`, `program.ts`, or `app-mode.ts`, not in JSX.

`StudioRuntime` is the inward-facing port. `runtime.ts` and `cloud-runtime.ts`
are outward adapters and must decode every result before returning it. Add new
wire shapes to `decode.ts` with decoder tests; never cast external JSON.

Components may import domain modules and types. Domain modules must not import
components, runtimes, or browser composition. Oxlint enforces cycles and unsafe
boundaries. Core behavior belongs in readable unit tests; rendered behavior
belongs in `web/harness` desktop/mobile smoke states.
