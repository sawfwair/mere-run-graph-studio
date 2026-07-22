# Native host map

`lib.rs` registers Tauri and the command surface. `commands.rs` contains thin
IPC functions. `model.rs` owns serialized request/response records. `service.rs`
defines shared state and includes four bounded service sections:
`service_projects.rs` for configuration/projects/assets/model pulls,
`service_tools.rs` for validation/templates/programs/Comfy,
`service_runs.rs` for run lifecycle, and the two `service_*_support.rs` files for
pure parsing and persistence helpers. `error.rs` normalizes diagnostics.

The native host is offline and unauthenticated by construction: do not add an
HTTP client, OAuth, Relay protocol, provider implementation, graph semantics,
or secret storage. Paths must be validated before filesystem access, stdout
from child CLIs stays machine-readable, and diagnostics are bounded. New IPC
results require a matching decoder in `web/src/decode.ts` and tests on both
sides of the boundary.
