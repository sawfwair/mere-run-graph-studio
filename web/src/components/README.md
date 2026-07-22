# Component map

- `GraphCanvas`: translates graph plus sidecar state to XYFlow nodes and edges.
- `WorkflowNode`, `GraphInputNode`, `GraphOutputNode`: canvas document nodes.
- `Inspector`: selected graph/input/output/editor-item editing.
- `Library`: catalog, templates, and graph-input discovery.
- `AppView`: run-only form, variations, and output gallery.
- `RunsView`: run history, node evidence, and artifacts.
- `ProgramView`, `PrepareView`: advanced compiler and preflight surfaces.
- `DesktopSetup`, `CloudLanding`: environment-specific entry surfaces.

Components receive typed values and callbacks. They do not fetch, invoke Tauri,
parse JSON, persist documents, or invent graph semantics. Keep state local only
when it is transient presentation state; document state flows through `App.tsx`.
